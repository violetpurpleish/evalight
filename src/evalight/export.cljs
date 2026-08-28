(ns evalight.export
  (:require ["jszip" :as JSZip]
            [clojure.string :as str]
            [evalight.fs :as fs]
            [evalight.promise :as p]))

(def ^:private static-pack
  [["/index.html" "evalight/public/index.html"]
   ["/preview.html" "evalight/public/preview.html"]
   ["/favicon.svg" "evalight/public/favicon.svg"]
   ["/css/ui.css" "evalight/public/css/ui.css"]
   ["/css/evalight.css" "evalight/public/css/evalight.css"]
   ["/css/preview.css" "evalight/public/css/preview.css"]
   ["/js/main.js" "evalight/public/js/main.js"]
   ["/js/preview/preview.js" "evalight/public/js/preview/preview.js"]
   ["/evalight-embed/server.mjs" "evalight/server.mjs"]])

(defn- download-blob [blob filename]
  (let [url (js/URL.createObjectURL blob)
        a (js/document.createElement "a")]
    (set! (.-href a) url)
    (set! (.-download a) filename)
    (.appendChild js/document.body a)
    (.click a)
    (.remove a)
    (js/URL.revokeObjectURL url)))

(defn with-evalight-script
  "Ensure package.json has `\"evalight\": \"bun evalight/server.mjs\"`."
  [text]
  (try
    (let [pkg (js/JSON.parse (or text "{}"))]
      (aset pkg "scripts"
            (js/Object.assign #js {} (or (.-scripts pkg) #js {})
                              #js {:evalight "bun evalight/server.mjs"}))
      (str (js/JSON.stringify pkg nil 2) "\n"))
    (catch :default _ text)))

(defn- fetch-ok-text [url]
  (-> (js/fetch url)
      (.then (fn [res]
               (if (.-ok res)
                 (.text res)
                 (throw (js/Error. (str "Missing " url " (needed to put Evalight in the zip)."))))))))

(defn- pack-from-static []
  (p/reduce-p
   (fn [acc [url path]]
     (.then (fetch-ok-text url)
            (fn [text]
              (when (and (= path "evalight/public/js/main.js")
                         (str/includes? text "cljs-runtime"))
                (throw (js/Error. "This Evalight is a watch build. Run bun run embed from the Evalight folder, then export again.")))
              (assoc acc path text))))
   {}
   static-pack))

(defn- pack-error [res]
  (-> (.text res)
      (.then (fn [body]
               (let [msg (try (.-error (js/JSON.parse body))
                              (catch :default _ nil))]
                 (throw (js/Error. (or (not-empty msg)
                                       "Evalight could not be packed into the zip."))))))))

(defn- files-from-pack [data]
  (when (and data (.-files data))
    (js->clj (.-files data) :keywordize-keys false)))

(defn fetch-evalight-pack
  "Release UI + server, keyed by zip path. From /api/evalight-pack, or
  the same-origin release files when this is a static host."
  []
  (-> (js/fetch "/api/evalight-pack")
      (.then (fn [res]
               (cond
                 (.-ok res)
                 (-> (.json res)
                     (.then (fn [data]
                              (or (files-from-pack data)
                                  (pack-from-static))))
                     (.catch (fn [_] (pack-from-static))))

                 (= 404 (.-status res))
                 (pack-from-static)

                 :else (pack-error res))))
      (.catch (fn [e]
                (if (and (.-message e)
                         (or (str/includes? (.-message e) "Failed to fetch")
                             (str/includes? (.-message e) "NetworkError")
                             (str/includes? (.-message e) "Load failed")))
                  (pack-from-static)
                  (throw e))))))

(defn zip-project
  "Package every project file plus Evalight into a Blob."
  [fs _project-name]
  (-> (p/all [(fs/read-all-files fs) (fetch-evalight-pack)])
      (.then (fn [pair]
               (let [files (aget pair 0)
                     pack (aget pair 1)
                     merged (cond-> (merge files pack)
                              (get files "package.json")
                              (assoc "package.json"
                                     (with-evalight-script (get files "package.json"))))
                     zip (new JSZip)]
                 (doseq [[path content] merged]
                   (.file zip path content))
                 (.generateAsync zip #js {:type "blob"
                                           :compression "DEFLATE"}))))))

(defn download
  [fs project-name]
  (-> (zip-project fs project-name)
      (.then (fn [blob]
               (let [filename (str (or project-name "evalight-project") ".zip")]
                 (download-blob blob filename)
                 filename)))))
