(ns evalight.export
  (:require ["jszip" :as JSZip]
            [evalight.fs :as fs]))

(defn- download-blob [blob filename]
  (let [url (js/URL.createObjectURL blob)
        a (js/document.createElement "a")]
    (set! (.-href a) url)
    (set! (.-download a) filename)
    (.appendChild js/document.body a)
    (.click a)
    (.remove a)
    (js/URL.revokeObjectURL url)))

(defn zip-project
  "Package every file in `fs` into a Blob. Directories are implied by paths."
  [fs project-name]
  (-> (fs/read-all-files fs)
      (.then (fn [files]
               (let [zip (new JSZip)]
                 (doseq [[path content] files]
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
