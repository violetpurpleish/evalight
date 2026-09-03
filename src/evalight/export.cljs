(ns evalight.export
  (:require ["jszip" :as JSZip]
            [clojure.string :as str]
            [evalight.bytes :as bytes]
            [evalight.fs :as fs]
            [evalight.promise :as p]
            [evalight.template :as template]))

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
  "Ensure package.json has `\"evalight\": \"bun evalight/server.mjs\"`.
  Keep in sync with scripts/evalight-pack.mjs withEvalightScript."
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

(defn watch-build-js?
  "True when main.js is a shadow-cljs watch loader, not a release module.
  Release :simple still sets CLOSURE_BASE_PATH to /js/cljs-runtime/, so a
  substring check for that path rejects the Vercel build."
  [body]
  (not (str/includes? body "COMPILED=!0")))

(defn- pack-from-static []
  (-> (fetch-ok-text "/evalight-embed/manifest.json")
      (.then (fn [text]
               (let [data (js/JSON.parse text)
                     items (js->clj (.-files data))]
                 (when-not (seq items)
                   (throw (js/Error. "evalight-embed/manifest.json has no files.")))
                 (p/reduce-p
                  (fn [acc item]
                    (let [url (get item "url")
                          zip (get item "zip")]
                      (.then (fetch-ok-text url)
                             (fn [body]
                               (when (and (= zip "evalight/public/js/main.js")
                                          (watch-build-js? body))
                                 (throw (js/Error. "This Evalight is a watch build. Run bun run embed from the Evalight folder, then export again.")))
                               (assoc acc zip body)))))
                  {}
                  items))))))

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

(defn rewrite-docs
  "Patch package.json, replace a README that still says to clone Evalight,
  and add LICENSE if the project has none."
  [files project-name]
  (let [name (or project-name "lamp")
        files (if (get files "package.json")
                (assoc files "package.json"
                       (with-evalight-script (get files "package.json")))
                files)
        files (if (get files "LICENSE")
                files
                (assoc files "LICENSE" (template/license)))
        readme (get files "README.md")]
    (if (template/stale-evalight-readme? readme)
      (assoc files "README.md" (template/readme name))
      files)))

(defn zip-project
  "Package every project file plus Evalight into a Blob."
  [fs project-name]
  (-> (p/all [(fs/read-all-files fs) (fetch-evalight-pack)])
      (.then (fn [pair]
               (let [original (aget pair 0)
                     files (rewrite-docs original project-name)
                     pack (aget pair 1)
                     writes (cond-> []
                              (not= (get original "README.md") (get files "README.md"))
                              (conj ["README.md" (get files "README.md")])
                              (not= (get original "package.json") (get files "package.json"))
                              (conj ["package.json" (get files "package.json")])
                              (not= (get original "LICENSE") (get files "LICENSE"))
                              (conj ["LICENSE" (get files "LICENSE")]))
                     merged (merge files pack)
                     zip (new JSZip)]
                 (doseq [[path content] merged]
                   (if (bytes/packed? content)
                     (.file zip path (bytes/unpack-u8 content))
                     (.file zip path content)))
                 (-> (p/reduce-p
                      (fn [_ [path content]]
                        (fs/write-file fs path content))
                      nil
                      writes)
                     (.then (fn [_]
                              (.generateAsync zip #js {:type "blob"
                                                          :compression "DEFLATE"})))))))))

(defn download
  [fs project-name]
  (-> (zip-project fs project-name)
      (.then (fn [blob]
               (let [filename (str (or project-name "evalight-project") ".zip")]
                 (download-blob blob filename)
                 filename)))))
