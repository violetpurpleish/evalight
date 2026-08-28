(ns evalight.fs.http
  (:require [evalight.fs.protocol :as proto]))

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

(defrecord HttpFS [base]
  proto/FileSystem
  (-list-dir [_ path]
    (-> (request "GET" (str base "/list?path=" (js/encodeURIComponent (or path ""))))
        (.then json)
        (.then (fn [data]
                 (mapv keywordize-type (vec (:entries data)))))))
  (-read-file [_ path]
    (-> (request "GET" (str base "/read?path=" (js/encodeURIComponent path)))
        (.then json)
        ;; Do not pass a keyword to Promise.then. Advanced compilation
        ;; drops Keyword.prototype.call, so .then(:content) is identity
        ;; and CodeMirror gets the whole {:path :content} map.
        (.then (fn [data] (:content data)))))
  (-write-file [_ path content]
    (-> (request "PUT" (str base "/write") {:path path :content content})
        (.then json)
        (.then (fn [data] (:path data)))))
  (-mkdir [_ path]
    (-> (request "POST" (str base "/mkdir") {:path path})
        (.then json)
        (.then (fn [data] (:path data)))))
  (-rename [_ from to]
    (-> (request "POST" (str base "/rename") {:from from :to to})
        (.then json)
        (.then (fn [data] (:to data)))))
  (-delete [_ path]
    (-> (request "DELETE" (str base "/delete?path=" (js/encodeURIComponent path)))
        (.then json)
        (.then (fn [data] (:path data)))))
  (-exists [_ path]
    (-> (request "GET" (str base "/exists?path=" (js/encodeURIComponent (or path ""))))
        (.then json)
        (.then (fn [data] (:exists data))))))

(defn open
  ([] (open "/api/fs"))
  ([base] (->HttpFS base)))

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
