(ns evalight.preview
  (:require [cljs.reader :as reader]
            [evalight.fs :as fs]
            [evalight.ns-graph :as ns-graph]
            [evalight.promise :as p]))

(defonce !iframe (atom nil))
(defonce !id (atom 0))
(defonce !pending (atom {}))
(defonce !ready (atom false))
(defonce !queue (atom []))
(defonce !on-event (atom nil))

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
     (swap! !pending assoc id {:resolve resolve :reject reject}))))

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

        nil))))

(defonce !listening (atom false))

(defn attach!
  "Bind the preview iframe and message handler. `on-event` receives every
  evalight/* message from the sandbox."
  [iframe on-event]
  (reset! !iframe iframe)
  (reset! !on-event on-event)
  (reset! !ready false)
  (when-not @!listening
    (.addEventListener js/window "message" handle-message)
    (reset! !listening true)))

(defn reload-frame!
  "Force a fresh SCI image by reloading the iframe document."
  []
  (reset! !ready false)
  (when-let [iframe @!iframe]
    (let [src (.-src iframe)]
      (set! (.-src iframe) "")
      (js/requestAnimationFrame
       (fn []
         (set! (.-src iframe) (or (not-empty src) "/preview.html")))))))

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
   (let [id (next-id)
         result (wait-for id)]
     (-> (project-payload fs)
         (.then (fn [payload]
                  (send (assoc payload
                                 :type (if reset? "evalight/load" "evalight/reload")
                                 :id id))
                  result))))))

(defn eval-code [code]
  (let [id (next-id)
        p (wait-for id)]
    (send {:type "evalight/eval" :id id :code code})
    p))
