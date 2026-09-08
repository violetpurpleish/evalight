(ns evalight.preview.runtime
  (:require [cljs.pprint :as pprint]
            [clojure.string :as str]
            [evalight.intel :as intel]
            [evalight.ns-graph :as ns-graph]
            [replicant.dom :as r]
            [sci.core :as sci]))

(defonce !ctx (atom nil))
(defonce !main (atom 'user))

(defn- post [msg]
  (.postMessage (.-parent js/window) (clj->js msg) "*"))

(defn- format-val [v]
  (try
    (str/trim-newline (with-out-str (pprint/pprint v)))
    (catch :default _
      (try
        (pr-str v)
        (catch :default _
          (str v))))))

(defn- error->map [e]
  {:message (or (ex-message e) (.-message e) (str e))
   :stack (.-stack e)})

(defn- make-ctx []
  (sci/init
   {:namespaces {'replicant.dom {'render r/render
                                  'unmount r/unmount
                                  'set-dispatch! r/set-dispatch!}}
    :classes {'js goog/global :allow :all}
    :ns-aliases {'clojure.pprint 'cljs.pprint}}))

(defn- ensure-ctx []
  (or @!ctx (reset! !ctx (make-ctx))))

(defn- apply-css [css-blobs]
  (doseq [el (vec (array-seq (.querySelectorAll js/document "style[data-evalight-css]")))]
    (.remove el))
  (doseq [css css-blobs]
    (when (seq css)
      (let [el (js/document.createElement "style")]
        (.setAttribute el "data-evalight-css" "true")
        (set! (.-textContent el) css)
        (.appendChild js/document.head el)))))

(defn- eval-string [ctx code]
  (let [out (atom "")
        err (atom "")]
    (sci/binding [sci/print-fn (fn [s] (swap! out str s))
                 sci/print-newline true]
      (try
        {:ok true
         :value (sci/eval-string* ctx code)
         :stdout @out
         :stderr @err}
        (catch :default e
          {:ok false
           :error (error->map e)
           :stdout @out})))))

(defn- enrich-intel-item [ctx item]
  (if (and (seq (:doc item)) (seq (:arglists item)))
    item
    (try
      (if-let [v (sci/resolve ctx (symbol (:ns item) (name (symbol (:name item)))))]
        (intel/enrich-live-item item (meta v))
        item)
      (catch :default _
        item))))

(defn- collect-intel [ctx ns-name]
  (try
    ;; SCI restores *ns* after each eval-string* call. Select the namespace
    ;; in the same evaluation that reads its vars, aliases, and metadata.
    (let [code (str (when ns-name
                      (str "(when (find-ns '" ns-name ") (in-ns '" ns-name "))\n"))
                    intel/sci-intel-form)
          data (sci/eval-string* ctx code)]
      {:ok true
       :ns (or (:ns data) (str ns-name))
       :items (mapv #(enrich-intel-item ctx %) (:items data))})
    (catch :default e
      {:ok false
       :ns (str ns-name)
       :items []
       :error (error->map e)})))

(defn- load-files [{:keys [files main css reset]}]
  (when reset
    (reset! !ctx (make-ctx))
    (when-let [el (.getElementById js/document "app")]
      (try (r/unmount el)
           (catch :default _ nil))
      (set! (.-innerHTML el) "")))
  (apply-css css)
  (let [ctx (ensure-ctx)]
    (try
      (doseq [{:keys [source path]} files]
        (let [result (eval-string ctx (ns-graph/with-forward-refs source))]
          (when-not (:ok result)
            (throw (ex-info (str "Error in " path ": "
                                 (get-in result [:error :message]))
                            {:path path
                             :error (:error result)})))))
      (when (seq main)
        (sci/eval-string* ctx (str "(in-ns '" main ")"))
        (reset! !main (symbol main))
        (let [mounted (eval-string ctx "(when-let [f (resolve 'init)] (f))")]
          (when-not (:ok mounted)
            (throw (ex-info (str "Error in " main "/init: "
                                 (get-in mounted [:error :message]))
                            {:error (:error mounted)})))))
      {:ok true}
      (catch :default e
        {:ok false
         :error (error->map e)}))))

(defn- handle [data]
  (let [typ (keyword (:type data))]
    (case typ
      :evalight/hello
      (post {:type "evalight/ready"})

      :evalight/load
      (post (assoc (load-files (assoc data :reset true))
                   :type "evalight/loaded"
                   :id (:id data)))

      :evalight/reload
      (post (assoc (load-files (assoc data :reset false))
                   :type "evalight/loaded"
                   :id (:id data)))

      :evalight/eval
      (let [ctx (ensure-ctx)
            ns-sym (or (:ns data) @!main)
            code (if ns-sym
                   (str "(in-ns '" ns-sym ")\n" (:code data))
                   (:code data))
            result (eval-string ctx code)
            payload (cond-> {:type "evalight/result"
                              :id (:id data)
                              :ok (:ok result)
                              :stdout (:stdout result)}
                      (:ok result) (assoc :value (format-val (:value result)))
                      (not (:ok result)) (assoc :error (:error result)))]
        (post payload))

      :evalight/intel
      (post (assoc (collect-intel (ensure-ctx) (or (:ns data) (str @!main)))
                   :type "evalight/intel"
                   :id (:id data)))

      :evalight/reset
      (do (reset! !ctx (make-ctx))
          (post {:type "evalight/loaded" :id (:id data) :ok true}))

      nil)))

(defn- wrap-console []
  (let [levels ["log" "info" "warn" "error"]]
    (doseq [level levels]
      (let [orig (aget js/console level)]
        (aset js/console level
              (fn [& args]
                (.apply orig js/console (into-array args))
                (post {:type "evalight/console"
                       :level level
                       :args (mapv str args)})))))))

(defn ^:export init []
  (set! (.-EVALIGHT_SCI js/window) true)
  (wrap-console)
  (set! (.-onerror js/window)
        (fn [message source lineno colno error]
          (post {:type "evalight/console"
                 :level "error"
                 :args [(str message " (" source ":" lineno ")")]})))
  (.addEventListener js/window "message"
                     (fn [event]
                       (let [data (js->clj (.-data event) :keywordize-keys true)]
                         (when (and (:type data)
                                    (str/starts-with? (str (:type data)) "evalight"))
                           (handle data)))))
  (post {:type "evalight/ready"}))
