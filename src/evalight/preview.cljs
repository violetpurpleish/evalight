(ns evalight.preview
  (:require [cljs.reader :as reader]
            [evalight.fs :as fs]
            [evalight.intel :as intel]
            [evalight.ns-graph :as ns-graph]
            [evalight.promise :as p]
            [evalight.state :as state]
            [clojure.string :as str]))

(defonce !iframe (atom nil))
(defonce !id (atom 0))
(defonce !pending (atom {}))
(defonce !ready (atom false))
(defonce !queue (atom []))
(defonce !on-event (atom nil))

(declare reload-frame!)

(def known-runtimes #{:sci :compiled :clj :gpui})

(defn coerce-runtime
  "Map /api/meta :runtime (or detectProject :kind) onto the four
  client runtimes. detectProject says :cljs / :workshop; the editor
  must not store those, or iframe Live / Add UI / SCI eval all drop.

  Do not round-trip keywords through str. (keyword (str :compiled))
  is not :compiled, and compiled REPL eval would fall back to SCI."
  [x]
  (let [k (cond
            (keyword? x) x
            (and (string? x) (not (str/blank? x))) (keyword x)
            :else :sci)]
    (case k
      (:compiled :cljs) :compiled
      :clj :clj
      :gpui :gpui
      :sci)))

(defn runtime []
  (let [rt (:runtime @state/app)]
    (if (contains? known-runtimes rt)
      rt
      (coerce-runtime rt))))

(defn compiled-runtime? []
  (= :compiled (runtime)))

(defn nrepl-runtime? []
  (contains? #{:compiled :clj :gpui} (runtime)))

(defn iframe-runtime? []
  (contains? #{:sci :compiled} (runtime)))

(defn native-preview? []
  (or (= :gpui (runtime))
      (= :native (keyword (:preview-kind @state/app)))))

(defn preview-pane? []
  (not (or (= :clj (runtime))
           (= :none (keyword (:preview-kind @state/app))))))

(defn preview-src []
  (cond
    (compiled-runtime?) (or (:preview-url @state/app) "about:blank")
    (iframe-runtime?) "/preview.html"
    :else "about:blank"))

(defn- runtime-json [url body]
  (let [opts (if body
               #js {:method "POST"
                    :headers #js {"Content-Type" "application/json"}
                    :body (js/JSON.stringify (clj->js body))}
               #js {:method "GET"})]
    (-> (js/fetch url opts)
        (.then (fn [res]
                 (if (.-ok res)
                   (.then (.json res) (fn [j] (js->clj j :keywordize-keys true)))
                   (.then (.text res)
                          (fn [t]
                            (throw (js/Error. (or (not-empty t) (str "HTTP " (.-status res)))))))))))))

(defn- wait-compiled [ms]
  (js/Promise.
   (fn [resolve reject]
     (let [t0 (.now js/Date)
           !reloaded (atom false)]
       (letfn [(step []
                 (-> (runtime-json "/api/runtime" nil)
                     (.then (fn [st]
                              (cond
                                (:connected st)
                                (resolve st)

                                (:fatal st)
                                (reject (js/Error. (or (:error st) "Runtime failed to start.")))

                                (> (- (.now js/Date) t0) ms)
                                (reject (js/Error. (or (:error st)
                                                       (if (compiled-runtime?)
                                                         "The compiled app did not connect. Need a JDK and bun install, and Preview must stay open."
                                                         "Clojure nREPL did not connect. Need a JDK and the Clojure CLI."))))

                                (and (compiled-runtime?) (:ready st) (not @!reloaded))
                                (do (reset! !reloaded true)
                                    (reload-frame!)
                                    (js/setTimeout step 600))

                                :else
                                (js/setTimeout step 400))))
                     (.catch (fn [e]
                               (if (> (- (.now js/Date) t0) ms)
                                 (reject e)
                                 (js/setTimeout step 400))))))]
         (step))))))

(defn- post [msg]
  (when-let [iframe @!iframe]
    (when-let [w (.-contentWindow iframe)]
      (.postMessage w (clj->js msg) "*"))))

(defn- flush-queue! []
  (when @!ready
    (doseq [msg @!queue]
      (post msg))
    (reset! !queue [])))

(defn- send [msg]
  (if @!ready
    (post msg)
    (swap! !queue conj msg)))

(defn- next-id []
  (swap! !id inc))

(defn- wait-for [id]
  (js/Promise.
   (fn [resolve reject]
     (swap! !pending assoc id {:resolve resolve :reject reject})
     (js/setTimeout
      (fn []
        (when-let [{:keys [reject]} (get @!pending id)]
          (swap! !pending dissoc id)
          (reject (js/Error. "The preview sandbox did not respond."))))
      20000))))

(defn- handle-message [event]
  (let [data (js->clj (.-data event) :keywordize-keys true)
        typ (keyword (:type data))]
    (when (and typ (= "evalight" (namespace typ)))
      (let [on-event @!on-event]
        (when on-event (on-event data)))
      (case typ
        :evalight/ready
        (do (reset! !ready true)
            (flush-queue!))

        :evalight/result
        (when-let [{:keys [resolve]} (get @!pending (:id data))]
          (swap! !pending dissoc (:id data))
          (resolve data))

        :evalight/loaded
        (when-let [{:keys [resolve]} (get @!pending (:id data))]
          (swap! !pending dissoc (:id data))
          (resolve data))

        :evalight/intel
        (when-let [{:keys [resolve]} (get @!pending (:id data))]
          (swap! !pending dissoc (:id data))
          (resolve data))

        nil))))

(defonce !listening (atom false))

(defn attach!
  "Bind the preview iframe and message handler. `on-event` receives every
  evalight/* message from the sandbox. Compiled preview has no SCI
  postMessage protocol; attach still holds the iframe for reloads."
  [iframe on-event]
  (reset! !iframe iframe)
  (reset! !on-event on-event)
  (reset! !ready false)
  (when-not @!listening
    (.addEventListener js/window "message" handle-message)
    (reset! !listening true))
  (when (and (iframe-runtime?) (not (compiled-runtime?)))
    (js/setTimeout
     (fn []
       (post {:type "evalight/hello"}))
     0)))

(defn reload-frame!
  "Reload the preview document. SCI uses preview.html. Compiled uses
  the project's shadow-cljs HTTP server."
  []
  (reset! !ready false)
  (reset! !queue [])
  (when-let [iframe @!iframe]
    (set! (.-src iframe) (str (preview-src) (if (re-find #"\?" (preview-src)) "&" "?") "t=" (js/Date.now)))))

(defn parse-config [source]
  (try
    (reader/read-string source)
    (catch :default _
      {:main 'app.core})))

(defn project-payload [fs]
  (-> (fs/read-tree fs "")
      (.then
       (fn [tree]
         (let [cljs (->> (fs/flatten-files tree)
                         (filter #(re-find (if (contains? #{:clj :gpui} (runtime))
                                             #"\.(clj|cljs|cljc)$"
                                             #"\.(cljs|cljc)$")
                                           (:path %)))
                         vec)]
           (p/reduce-p
            (fn [acc {:keys [path]}]
              (.then (fs/read-file fs path)
                     (fn [source]
                       (conj acc {:path path :source source}))))
            []
            cljs))))
      (.then
       (fn [with-source]
         (-> (fs/exists? fs "evalight.edn")
             (.then (fn [exists]
                      (if exists
                        (.then (fs/read-file fs "evalight.edn") parse-config)
                        (p/ok {:main 'app.core}))))
             (.then (fn [config]
                      (let [css-paths (or (get-in config [:preview :css]) ["public/style.css"])]
                        (-> (p/reduce-p
                             (fn [acc css-path]
                               (-> (fs/exists? fs css-path)
                                   (.then (fn [exists]
                                            (if exists
                                              (.then (fs/read-file fs css-path)
                                                     (fn [css] (conj acc css)))
                                              (p/ok acc))))))
                             []
                             css-paths)
                            (.then (fn [css]
                                     {:files (ns-graph/load-order with-source (str (:main config)))
                                      :main (str (:main config))
                                      :css css})))))))))))

(defn load-project
  ([fs] (load-project fs {:reset? true}))
  ([fs {:keys [reset?]}]
   (if (nrepl-runtime?)
     (-> (project-payload fs)
         (.then (fn [payload]
                  (intel/index-sources! (:files payload) (:main payload))
                  (wait-compiled 120000)))
         (.then (fn [st]
                  {:ok true
                   :runtime (or (:runtime st) "compiled")
                   :preview-url (or (:preview-url st) (:previewUrl st))})))
     (let [id (next-id)
           result (wait-for id)]
       (-> (project-payload fs)
           (.then (fn [payload]
                    (intel/index-sources! (:files payload) (:main payload))
                    (send (assoc payload
                                 :type (if reset? "evalight/load" "evalight/reload")
                                 :id id))
                    result)))))))

(defn- eval-ns []
  (or (get-in @state/app [:repl :ns])
      (let [app (:app-var @state/app)]
        (cond
          (and app (re-find #"/" (str app))) (first (str/split (str app) #"/"))
          (seq (str app)) (str app)
          (compiled-runtime?) "app.core"
          :else "user"))))

(defn eval-code
  ([code] (eval-code code nil))
  ([code ns-name]
   (if (nrepl-runtime?)
     (runtime-json "/api/runtime/eval" {:code code :ns (or ns-name (eval-ns))})
     (let [id (next-id)
           p (wait-for id)]
       (send (cond-> {:type "evalight/eval" :id id :code code}
               ns-name (assoc :ns ns-name)))
       p))))

(defn fetch-frame!
  "Ask local Evalight for a PNG of the GPUI window, if the image provides one."
  []
  (when (native-preview?)
    (-> (runtime-json "/api/runtime/frame" nil)
        (.then (fn [data]
                 (when (:ok data)
                   (swap! state/app assoc :preview-frame (or (:png data) nil)))
                 data))
        (.catch (fn [_] nil)))))

(defn refresh-intel!
  "Ask the live image for interned names, arglists, and docstrings."
  []
  (if (nrepl-runtime?)
    (let [ns-name (eval-ns)]
      (-> (runtime-json "/api/runtime/intel" {:ns ns-name})
          (.then (fn [data]
                   (when (:ok data)
                     (intel/set-live! (or (:items data) []) (:ns data)))
                   data))))
    (let [id (next-id)
          p (wait-for id)]
      (send {:type "evalight/intel" :id id})
      (.then p (fn [data]
                 (when (:ok data)
                   (intel/set-live! (or (:items data) []) (:ns data)))
                 data)))))
