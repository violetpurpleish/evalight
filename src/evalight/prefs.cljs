(ns evalight.prefs
  "UI chrome that should survive a reload in this browser: pane layout
  and REPL history. Project files already live in OPFS."
  (:require [evalight.state :as state]))

(def ^:private layout-key "evalight.layout")

(defonce !repl-timer (atom nil))

(defn- store []
  (try (.-localStorage js/window)
       (catch :default _ nil)))

(defn- read-json [k]
  (when-let [ls (store)]
    (try
      (let [raw (.getItem ls k)]
        (when (and raw (pos? (.-length raw)))
          (js->clj (js/JSON.parse raw) :keywordize-keys true)))
      (catch :default _ nil))))

(defn- write-json [k data]
  (when-let [ls (store)]
    (try
      (.setItem ls k (js/JSON.stringify (clj->js data)))
      (catch :default _ nil))))

(defn- repl-key [project]
  (when (and project (not= project ""))
    (str "evalight.repl." project)))

(defn save-layout! []
  (let [l (:layout @state/app)]
    (write-json layout-key
                {:filesOpen (boolean (:files-open? l))
                 :previewOpen (boolean (:preview-open? l))
                 :filesWidth (:files-width l)
                 :previewWidth (:preview-width l)})))

(defn restore-layout! []
  (when-let [saved (read-json layout-key)]
    (swap! state/app update :layout
           (fn [l]
             (cond-> l
               (contains? saved :filesOpen)
               (assoc :files-open? (boolean (:filesOpen saved)))
               (contains? saved :previewOpen)
               (assoc :preview-open? (boolean (:previewOpen saved)))
               (number? (:filesWidth saved))
               (assoc :files-width (:filesWidth saved))
               (number? (:previewWidth saved))
               (assoc :preview-width (:previewWidth saved)))))))

(defn save-repl! []
  (let [s @state/app
        k (repl-key (:project s))
        entries (mapv (fn [e]
                        {:kind (name (:kind e))
                         :text (str (:text e))})
                      (take-last 80 (or (get-in s [:repl :entries]) [])))]
    (when k
      (write-json k {:ns (or (get-in s [:repl :ns]) "app.core")
                     :entries entries}))))

(defn restore-repl! [project]
  (let [saved (when project (read-json (repl-key project)))
        entries (mapv (fn [e]
                        {:id (str (random-uuid))
                         :kind (keyword (or (:kind e) "out"))
                         :text (str (:text e))})
                      (take-last 80 (or (:entries saved) [])))]
    (swap! state/app assoc :repl {:ns (or (:ns saved)
                                          (get-in @state/app [:repl :ns])
                                          "user")
                                  :entries entries})))

(defn schedule-save-repl! []
  (when-let [t @!repl-timer]
    (js/clearTimeout t))
  (reset! !repl-timer
          (js/setTimeout
           (fn []
             (reset! !repl-timer nil)
             (save-repl!))
           400)))

(defn bind! []
  (add-watch state/app ::prefs
             (fn [_ _ old new]
               (let [keys [:files-open? :preview-open? :files-width :preview-width]]
                 (when (not= (select-keys (:layout old) keys)
                             (select-keys (:layout new) keys))
                   (save-layout!)))
               (when (not= (get-in old [:repl :entries])
                           (get-in new [:repl :entries]))
                 (schedule-save-repl!))))
  (.addEventListener js/window "beforeunload"
                     (fn [_]
                       (save-layout!)
                       (save-repl!))))
