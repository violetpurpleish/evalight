(ns evalight.preview
  (:require [cljs.reader :as reader]
            [evalight.fs :as fs]
            [evalight.intel :as intel]
            [evalight.ns-graph :as ns-graph]
            [evalight.promise :as p]
            [evalight.state :as state]))

(defonce !iframe (atom nil))
(defonce !id (atom 0))
(defonce !pending (atom {}))
(defonce !ready (atom false))
(defonce !queue (atom []))
(defonce !on-event (atom nil))

(declare reload-frame!)

(defn compiled-runtime? []
  (= :compiled (:runtime @state/app)))

(defn preview-src []
  (if (compiled-runtime?)
    (or (:preview-url @state/app) "about:blank")
    "/preview.html"))

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

                                (> (- (.now js/Date) t0) ms)
                                (reject (js/Error. (or (:error st)
                                                       "The compiled app did not connect. Need a JDK and bun install, and Preview must stay open.")))

                                (and (:ready st) (not @!reloaded))
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
  (when-not (compiled-runtime?)
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
                         (filter #(re-find #"\.(cljs|cljc)$" (:path %)))
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
   (if (compiled-runtime?)
     (-> (project-payload fs)
         (.then (fn [payload]
                  (intel/index-sources! (:files payload) (:main payload))
                  (wait-compiled 120000)))
         (.then (fn [st]
                  {:ok true :runtime "compiled" :preview-url (or (:preview-url st) (:previewUrl st))})))
     (let [id (next-id)
           result (wait-for id)]
       (-> (project-payload fs)
           (.then (fn [payload]
                    (intel/index-sources! (:files payload) (:main payload))
                    (send (assoc payload
                                 :type (if reset? "evalight/load" "evalight/reload")
                                 :id id))
                    result)))))))

(defn eval-code [code]
  (if (compiled-runtime?)
    (let [ns-name (or (get-in @state/app [:repl :ns]) "app.core")]
      (runtime-json "/api/runtime/eval" {:code code :ns ns-name}))
    (let [id (next-id)
          p (wait-for id)]
      (send {:type "evalight/eval" :id id :code code})
      p)))

(defn refresh-intel!
  "Ask the live image for interned names, arglists, and docstrings."
  []
  (if (compiled-runtime?)
    (let [ns-name (or (get-in @state/app [:repl :ns]) "app.core")]
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
