(ns evalight.preview.runtime
  (:require [cljs.pprint :as pprint]
            [clojure.string :as str]
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
        (let [result (eval-string ctx source)]
          (when-not (:ok result)
            (throw (ex-info (str "Error in " path ": "
                                 (get-in result [:error :message]))
                            {:path path
                             :error (:error result)})))))
      (when (seq main)
        (sci/eval-string* ctx (str "(in-ns '" main ")"))
        (reset! !main (symbol main)))
      {:ok true}
      (catch :default e
        {:ok false
         :error (error->map e)}))))

(defn- handle [data]
  (let [typ (keyword (:type data))]
    (case typ
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
            result (eval-string ctx (:code data))
            payload (cond-> {:type "evalight/result"
                              :id (:id data)
                              :ok (:ok result)
                              :stdout (:stdout result)}
                      (:ok result) (assoc :value (format-val (:value result)))
                      (not (:ok result)) (assoc :error (:error result)))]
        (post payload))

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
