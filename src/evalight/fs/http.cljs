(ns evalight.fs.http
  (:require [evalight.build :as build]
            [evalight.fs.protocol :as proto]
            [goog.object :as gobj]))

(defn- json [res]
  (.then (.json res) (fn [j] (js->clj j :keywordize-keys true))))

(defn- check [res]
  (if (.-ok res)
    res
    (.then (.text res)
           (fn [body]
             (throw (js/Error. (or (not-empty body) (str "HTTP " (.-status res)))))))))

(defn- request
  ([method url]
   (request method url nil))
  ([method url body]
   (-> (js/fetch url
                 (cond-> #js {:method method}
                   body (doto (aset "headers" #js {"Content-Type" "application/json"})
                          (aset "body" (js/JSON.stringify (clj->js body))))))
       (.then check))))

(defn- keywordize-type [e]
  (update e :type (fn [t]
                    (keyword (if (keyword? t) (name t) t)))))

(defn- js-get [obj k]
  (when (some? obj)
    (gobj/get obj k)))

(defn- entries-of [data]
  (cond
    (nil? data) []
    (map? data) (or (:entries data) (get data "entries") [])
    :else (js->clj (js-get data "entries") :keywordize-keys true)))

(defn- path-of [data]
  (cond
    (string? data) data
    (map? data) (or (:path data) (get data "path"))
    :else (js-get data "path")))

(defn- to-of [data]
  (cond
    (string? data) data
    (map? data) (or (:to data) (get data "to"))
    :else (js-get data "to")))

(defn- exists-of [data]
  (boolean
   (cond
     (boolean? data) data
     (map? data) (or (:exists data) (get data "exists"))
     :else (js-get data "exists"))))

(defn- file-text
  "File bodies must be strings. After advanced compilation, Keyword IFn
  is gone, so Promise.then(:content) and sometimes cljs map lookup on
  JSON can yield the whole {path, content} object. Read the string from
  the raw JSON object first."
  [data]
  (let [c (cond
            (string? data) data
            (map? data) (or (:content data) (get data "content"))
            :else (js-get data "content"))]
    (if (string? c) c "")))

(defrecord HttpFS [base]
  proto/FileSystem
  (-list-dir [_ path]
    (-> (request "GET" (str base "/list?path=" (js/encodeURIComponent (or path ""))))
        (.then json)
        (.then (fn [data]
                 (mapv keywordize-type (vec (or (entries-of data) [])))))))
  (-read-file [_ path]
    (-> (request "GET" (str base "/read?path=" (js/encodeURIComponent path)))
        (.then (fn [res] (.json res)))
        (.then file-text)))
  (-write-file [_ path content]
    (-> (request "PUT" (str base "/write") {:path path :content content})
        (.then json)
        (.then path-of)))
  (-mkdir [_ path]
    (-> (request "POST" (str base "/mkdir") {:path path})
        (.then json)
        (.then path-of)))
  (-rename [_ from to]
    (-> (request "POST" (str base "/rename") {:from from :to to})
        (.then json)
        (.then to-of)))
  (-delete [_ path]
    (-> (request "DELETE" (str base "/delete?path=" (js/encodeURIComponent path)))
        (.then json)
        (.then path-of)))
  (-exists [_ path]
    (-> (request "GET" (str base "/exists?path=" (js/encodeURIComponent (or path ""))))
        (.then (fn [res] (.json res)))
        (.then exists-of))))

(defn open
  ([] (open "/api/fs"))
  ([base]
   (set! (.-EVALIGHT_BUILD js/window) build/id)
   (->HttpFS base)))

(defn server-meta []
  (if-let [mode (some-> js/window .-EVALIGHT_MODE)]
    (js/Promise.resolve {:mode mode})
    (let [ctrl (js/AbortController.)]
      (js/setTimeout #(.abort ctrl) 1200)
      (-> (js/fetch "/api/meta" #js {:signal (.-signal ctrl)})
          (.then (fn [res]
                   (if (.-ok res)
                     (.then (.json res)
                            (fn [j] (js->clj j :keywordize-keys true)))
                     nil)))
          (.catch (fn [_] nil))))))
