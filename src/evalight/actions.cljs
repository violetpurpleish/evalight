(ns evalight.actions
  (:require [clojure.string :as str]
            [evalight.editor :as editor]
            [evalight.export :as export]
            [evalight.fs :as fs]
            [evalight.fs.http :as http-fs]
            [evalight.fs.opfs :as opfs]
            [evalight.paths :as paths]
            [evalight.kit :as kit]
            [evalight.preview :as preview]
            [evalight.promise :as p]
            [evalight.state :as state]
            [evalight.template :as template]))

(defonce !fs (atom nil))
(defonce !workspace (atom nil))
(defonce !save-timer (atom nil))
(defonce !live-timer (atom nil))
(defonce !notice-timer (atom nil))

(defn- now-fs []
  (or @!fs (throw (js/Error. "Filesystem is not ready."))))

(defn- flash!
  ([text] (flash! text :ok))
  ([text kind]
   (state/notice! text kind)
   (when-let [t @!notice-timer]
     (js/clearTimeout t))
   (reset! !notice-timer
           (js/setTimeout #(swap! state/app assoc :notice nil) 2800))))

(defn refresh-tree! []
  (-> (fs/read-tree (now-fs) "")
      (.then (fn [tree]
               (swap! state/app assoc :tree tree)
               tree))))

(defn refresh-projects! []
  (if-let [ws @!workspace]
    (-> (fs/exists? ws "projects")
        (.then (fn [exists]
                 (if exists
                   (p/ok nil)
                   (fs/mkdir ws "projects"))))
        (.then (fn [_] (fs/list-dir ws "projects")))
        (.then (fn [entries]
                 (let [names (->> entries
                                  (filter #(= :dir (:type %)))
                                  (map :name)
                                  sort
                                  vec)]
                   (swap! state/app assoc :projects names)
                   names))))
    (p/ok [])))

(defn open-file! [path]
  (if-not path
    (p/ok nil)
    (-> (fs/read-file (now-fs) path)
        (.then (fn [content]
                 (swap! state/app assoc :active-file path :mobile-tab :editor)
                 (editor/load-fresh! path content)
                 (editor/focus!)
                 path)))))

(defn- apply-preview-result [result]
  (if (:ok result)
    (do (swap! state/app assoc-in [:preview :status] :ok)
        (swap! state/app assoc-in [:preview :error] nil)
        (preview/refresh-intel!))
    (do (swap! state/app assoc-in [:preview :status] :error)
        (swap! state/app assoc-in [:preview :error]
               (or (get-in result [:error :message]) "Preview failed to load."))))
  result)

(declare save-current!)

(defn run-preview!
  ([] (run-preview! {:reset? true}))
  ([{:keys [reset?]}]
   (swap! state/app assoc-in [:preview :status] :loading)
   (swap! state/app assoc-in [:preview :error] nil)
   (-> (save-current! {:reload? false})
       (.then (fn [_]
                (when reset?
                  (preview/reload-frame!))
                (preview/load-project (now-fs) {:reset? reset?})))
       (.then apply-preview-result)
       (.catch (fn [e]
                 (swap! state/app assoc-in [:preview :status] :error)
                 (swap! state/app assoc-in [:preview :error] (.-message e))
                 nil)))))

(defn- schedule-live-reload! []
  (when (:live? (:preview @state/app))
    (when-let [t @!live-timer]
      (js/clearTimeout t))
    (reset! !live-timer
            (js/setTimeout
             (fn []
               (-> (preview/load-project (now-fs) {:reset? false})
                   (.then apply-preview-result)
                   (.catch (fn [e]
                             (swap! state/app assoc-in [:preview :status] :error)
                             (swap! state/app assoc-in [:preview :error] (.-message e))))))
             450))))

(defn save-current!
  ([] (save-current! {:reload? true}))
  ([{:keys [reload?]}]
   (let [path (editor/current-path)
         text (editor/current-text)]
     (if (and path text)
       (-> (fs/write-file (now-fs) path text)
           (.then (fn [_]
                    (swap! state/app update :dirty disj path)
                    (when reload?
                      (schedule-live-reload!))
                    path)))
       (p/ok nil)))))

(defn on-editor-change [_text]
  (when-let [path (editor/current-path)]
    (swap! state/app update :dirty conj path)
    (when-let [t @!save-timer]
      (js/clearTimeout t))
    (reset! !save-timer
            (js/setTimeout (fn [] (save-current!)) 320))))

(defn- repl-in [code]
  (state/repl-entry {:kind :in :text code}))

(defn- repl-out [text]
  (state/repl-entry {:kind :out :text text}))

(defn- repl-err [text]
  (state/repl-entry {:kind :err :text text}))

(defn eval-code! [code _origin]
  (let [code (str/trim (or code ""))]
    (if (seq code)
      (do (repl-in code)
          (-> (preview/eval-code code)
              (.then (fn [result]
                       (when (seq (:stdout result))
                         (repl-out (:stdout result)))
                       (if (:ok result)
                         (do (repl-out (or (:value result) "nil"))
                             (preview/refresh-intel!))
                         (repl-err (or (get-in result [:error :message])
                                       "Evaluation failed.")))))
              (.catch (fn [e]
                        (repl-err (or (.-message e) (str e)))))))
      (p/ok nil))))

(defn on-editor-eval [code origin]
  (-> (save-current! {:reload? false})
      (.then (fn [_] (eval-code! code origin)))))

(defn on-preview-event [data]
  (let [typ (keyword (:type data))]
    (case typ
      :evalight/console
      (when (= "error" (:level data))
        (state/repl-entry {:kind :err :text (str/join " " (:args data))}))

      :evalight/loaded
      (apply-preview-result data)

      nil)))

(defn write-template! [fs project-name]
  (p/reduce-p
   (fn [_ [path content]]
     (fs/write-file fs path content))
   nil
   (template/files project-name)))

(defn- preferred-file [project-fs]
  (-> (fs/exists? project-fs "src/app/core.cljs")
      (.then (fn [exists]
               (if exists
                 "src/app/core.cljs"
                 (some :path (fs/flatten-files (:tree @state/app))))))))

(defn open-project! [name]
  (let [mode (:mode @state/app)
        fs-p (if (= :local mode)
               (p/ok (now-fs))
               (opfs/open ["evalight" "projects" name]))]
    (-> fs-p
        (.then (fn [project-fs]
                 (reset! !fs project-fs)
                 (editor/clear-buffers!)
                 (swap! state/app assoc :project name :active-file nil :dirty #{} :tree [])
                 (if-let [ws @!workspace]
                   (fs/write-file ws "workspace.json"
                                 (js/JSON.stringify (clj->js {:active name})))
                   (p/ok nil))))
        (.then (fn [_] (refresh-tree!)))
        (.then (fn [_] (preferred-file (now-fs))))
        (.then (fn [preferred]
                 (if preferred
                   (open-file! preferred)
                   (p/ok nil))))
        (.then (fn [_]
                 (if (= :ready (:fs-status @state/app))
                   (run-preview! {:reset? true})
                   (p/ok nil)))))))

(defn create-project! [raw-name]
  (let [name (paths/slug raw-name)]
    (cond
      (str/blank? name)
      (p/ok (flash! "Give the project a name." :err))

      (nil? @!workspace)
      (p/ok (flash! "Browser projects need OPFS." :err))

      :else
      (-> (opfs/open ["evalight" "projects" name])
          (.then (fn [dest] (write-template! dest name)))
          (.then (fn [_] (refresh-projects!)))
          (.then (fn [_]
                   (swap! state/app assoc :dialog nil)
                   (open-project! name)))
          (.then (fn [_] (flash! (str "Created " name))))))))

(defn- read-saved-project [ws names]
  (-> (fs/read-file ws "workspace.json")
      (.then (fn [raw]
               (let [data (js->clj (js/JSON.parse raw) :keywordize-keys true)
                     saved (:active data)]
                 (if (some #{saved} names) saved (first names)))))
      (.catch (fn [_] (first names)))))

(defn seed-browser! []
  (-> (opfs/workspace-root)
      (.then (fn [ws]
               (reset! !workspace ws)
               (refresh-projects!)))
      (.then (fn [names]
               (if (seq names)
                 (-> (read-saved-project @!workspace names)
                     (.then open-project!))
                 (create-project! "lamp"))))))

(defn create-file! [raw-path]
  (let [path (paths/normalize raw-path)]
    (if (str/blank? path)
      (p/ok (flash! "Enter a path like src/app/util.cljs." :err))
      (let [content (if (paths/clojure-file? path)
                      (let [ns-name (-> path
                                       (str/replace #"^src/" "")
                                       (str/replace #"\.(cljs?|cljc)$" "")
                                       (str/replace "/" "."))]
                        (str "(ns " ns-name ")\n"))
                      "")]
        (-> (fs/write-file (now-fs) path content)
            (.then (fn [_]
                     (swap! state/app assoc :dialog nil)
                     (swap! state/app update :expanded conj (paths/dirname path))
                     (refresh-tree!)))
            (.then (fn [_] (open-file! path))))))))

(defn create-folder! [raw-path]
  (let [path (paths/normalize raw-path)]
    (if (str/blank? path)
      (p/ok (flash! "Enter a folder path." :err))
      (-> (fs/mkdir (now-fs) path)
          (.then (fn [_]
                   (swap! state/app assoc :dialog nil)
                   (swap! state/app update :expanded conj path)
                   (refresh-tree!)))))))

(defn delete-path! [path]
  (-> (fs/delete (now-fs) path)
      (.then (fn [_]
               (editor/drop-path! path)
               (swap! state/app assoc :dialog nil)
               (when (= path (:active-file @state/app))
                 (swap! state/app assoc :active-file nil))
               (refresh-tree!)))
      (.then (fn [_] (flash! (str "Deleted " path))))))

(defn- seed-lamp! []
  (-> (opfs/open ["evalight" "projects" "lamp"])
      (.then (fn [dest] (write-template! dest "lamp")))
      (.then (fn [_] (refresh-projects!)))
      (.then (fn [_] (open-project! "lamp")))))

(defn delete-project! [project-name]
  (let [name (or project-name (:project @state/app))]
    (cond
      (not= :browser (:mode @state/app))
      (p/ok (flash! "Local mode opens a folder on disk. Delete that folder there." :err))

      (str/blank? name)
      (p/ok (flash! "No project to delete." :err))

      (nil? @!workspace)
      (p/ok (flash! "Browser projects need OPFS." :err))

      :else
      (do
        (swap! state/app assoc :dialog nil)
        (-> (fs/delete @!workspace (paths/join "projects" name))
            (.then (fn [_]
                     (editor/clear-buffers!)
                     (swap! state/app assoc :active-file nil :dirty #{} :tree [] :project nil)
                     (refresh-projects!)))
            (.then (fn [names]
                     (if (seq names)
                       (open-project! (first names))
                       (seed-lamp!))))
            (.then (fn [_] (flash! (str "Deleted " name)))))))))

(defn rename-path! [from to]
  (let [to (paths/normalize to)]
    (-> (fs/rename (now-fs) from to)
        (.then (fn [_]
                 (editor/rename-path! from to)
                 (swap! state/app assoc :dialog nil)
                 (when (= from (:active-file @state/app))
                   (swap! state/app assoc :active-file to))
                 (refresh-tree!))))))

(defn toggle-expanded! [path]
  (swap! state/app update :expanded
         (fn [s]
           (if (contains? s path)
             (disj s path)
             (conj s path)))))

(defn- write-kit-files! [fs files]
  (p/reduce-p
   (fn [acc {:keys [path content]}]
     (-> (fs/exists? fs path)
         (.then (fn [exists]
                  (if exists
                    (conj acc :exists)
                    (.then (fs/write-file fs path content)
                           (fn [_] (conj acc path))))))))
   []
   files))

(defn- ensure-ui-css-listed! [fs]
  (-> (fs/exists? fs "evalight.edn")
      (.then (fn [exists]
               (if-not exists
                 nil
                 (.then (fs/read-file fs "evalight.edn")
                        (fn [text]
                          (fs/write-file fs "evalight.edn"
                                         (kit/with-ui-css text)))))))))

(defn add-ui-component!
  "Copy a kit control (and its deps) into the open project."
  [id]
  (let [item (kit/by-id id)
        files (kit/files-for id)
        fs (now-fs)]
    (if-not (and item (seq files))
      (p/ok (flash! "Unknown control." :err))
      (-> (write-kit-files! fs files)
          (.then (fn [acc]
                   (.then (ensure-ui-css-listed! fs)
                          (fn [_] acc))))
          (.then (fn [acc]
                   (swap! state/app assoc :dialog nil)
                   (swap! state/app update :expanded conj "src" "src/ui" "public" "public/css")
                   (.then (refresh-tree!)
                          (fn [_]
                            (schedule-live-reload!)
                            (if (every? #{:exists} acc)
                              (flash! (str (:title item) " is already in this project."))
                              (flash! (str "Added " (:title item))))))))))))

(defn set-dialog! [dialog]
  (swap! state/app assoc :dialog dialog))

(defn close-dialog! []
  (swap! state/app assoc :dialog nil))

(defn toggle-help! []
  (swap! state/app update :help? not))

(defn toggle-live! []
  (swap! state/app update-in [:preview :live?] not))

(defn set-mobile-tab! [tab]
  (swap! state/app assoc :mobile-tab tab))

(def ^:private files-min 160)
(def ^:private files-max 480)
(def ^:private preview-min 200)
(def ^:private preview-max 640)
(def ^:private main-min 240)

(defonce !drag (atom nil))

(defn toggle-files! []
  (swap! state/app update-in [:layout :files-open?] not))

(defn toggle-preview-pane! []
  (swap! state/app update-in [:layout :preview-open?] not))

(defn- clamp-pane [pane w]
  (let [{:keys [files-open? preview-open? files-width preview-width]} (:layout @state/app)
        stage (some-> js/document (.querySelector ".stage") .-clientWidth)
        other (cond
                (and (= pane :files) preview-open?) preview-width
                (and (= pane :preview) files-open?) files-width
                :else 0)
        lo (if (= pane :files) files-min preview-min)
        hi-cap (if (= pane :files) files-max preview-max)
        room (max lo (- (or stage 1200) other main-min 12))]
    (-> w (max lo) (min hi-cap) (min room) js/Math.round)))

(defn- apply-pane-el-width! [pane w]
  (when-let [el (.querySelector js/document (if (= pane :files)
                                              ".stage > .sidebar"
                                              ".stage > .preview"))]
    (let [px (str w "px")
          style (.-style el)]
      (set! (.-width style) px)
      (set! (.-flexBasis style) px))))

(defn- commit-drag-width! []
  (when-let [{:keys [pane current-w]} @!drag]
    (when current-w
      (let [k (if (= pane :files) :files-width :preview-width)]
        (apply-pane-el-width! pane current-w)
        (swap! state/app assoc-in [:layout k] current-w)))))

(defn pane-resize-move! [event]
  (when-let [{:keys [pane id start-x start-w]} @!drag]
    (when (or (nil? id) (= id (.-pointerId event)))
      (.preventDefault event)
      (let [dx (- (.-clientX event) start-x)
            w (clamp-pane pane (if (= pane :files) (+ start-w dx) (- start-w dx)))]
        (swap! !drag assoc :current-w w)
        (apply-pane-el-width! pane w)))))

(defn pane-resize-end! [event]
  (when @!drag
    (when (and event (.-pointerId event))
      (try
        (let [el (or (.-currentTarget event) (.-target event))]
          (when (and el (.hasPointerCapture el (.-pointerId event)))
            (.releasePointerCapture el (.-pointerId event))))
        (catch :default _ nil)))
    (commit-drag-width!)
    (reset! !drag nil)
    (swap! state/app assoc-in [:layout :dragging?] false)
    (.removeEventListener js/window "pointermove" pane-resize-move!)
    (.removeEventListener js/window "pointerup" pane-resize-end!)
    (.removeEventListener js/window "pointercancel" pane-resize-end!)))

(defn start-pane-resize! [pane event]
  (when event
    (.preventDefault event)
    (when-let [el (.-currentTarget event)]
      (try
        (.setPointerCapture el (.-pointerId event))
        (catch :default _ nil)))
    (let [k (if (= pane :files) :files-width :preview-width)]
      (reset! !drag {:pane pane
                     :id (.-pointerId event)
                     :start-x (.-clientX event)
                     :start-w (get-in @state/app [:layout k])
                     :current-w (get-in @state/app [:layout k])}))
    (swap! state/app assoc-in [:layout :dragging?] true)
    (.removeEventListener js/window "pointermove" pane-resize-move!)
    (.removeEventListener js/window "pointerup" pane-resize-end!)
    (.removeEventListener js/window "pointercancel" pane-resize-end!)
    (.addEventListener js/window "pointermove" pane-resize-move!)
    (.addEventListener js/window "pointerup" pane-resize-end!)
    (.addEventListener js/window "pointercancel" pane-resize-end!)))

(defn reset-pane-width! [pane]
  (swap! state/app assoc-in [:layout (if (= pane :files) :files-width :preview-width)]
         (if (= pane :files) 220 360)))

(defn submit-repl! [code]
  (let [code (str/trim (or code ""))]
    (if (seq code)
      (eval-code! code :repl)
      (p/ok nil))))

(defn- resize-repl-field! [el]
  (when el
    (let [style (.-style el)]
      (set! (.-height style) "auto")
      (set! (.-height style) (str (min (.-scrollHeight el) 160) "px")))))

(defn repl-expr-input! [event]
  (resize-repl-field! (.-target event)))

(defn repl-expr-keydown! [event]
  (when (and (= "Enter" (.-key event))
             (not (.-isComposing event))
             (or (not (.-shiftKey event))
                 (.-ctrlKey event)
                 (.-metaKey event)))
    (.preventDefault event)
    (when-let [form (.closest (.-target event) "form")]
      (.requestSubmit form))))

(defn clear-repl! []
  (swap! state/app assoc-in [:repl :entries] []))

(defn export-zip! []
  (-> (save-current! {:reload? false})
      (.then (fn [_]
               (let [name (or (:project @state/app) "evalight-project")]
                 (.then (export/download (now-fs) name)
                        (fn [_] (flash! (str "Exported " name ".zip")))))))))

(defn catch-ui [p]
  (when p
    (.catch p (fn [e]
                (flash! (or (.-message e) (str e)) :err)
                nil))))

(defn handle
  "Replicant dispatch. `action` is a keyword or [op & args]."
  [event-data action]
  (let [event (:replicant/dom-event event-data)
        op (if (keyword? action) action (first action))
        args (if (vector? action) (vec (rest action)) [])]
    (when (and event (= (.-type event) "submit"))
      (.preventDefault event))
    (case op
      :open-file (catch-ui (open-file! (first args)))
      :toggle-dir (toggle-expanded! (first args))
      :new-file-dialog (set-dialog! {:kind :new-file :value "src/"})
      :new-folder-dialog (set-dialog! {:kind :new-folder :value "src/"})
      :new-project-dialog (set-dialog! {:kind :new-project :value ""})
      :rename-dialog (set-dialog! {:kind :rename :from (first args) :value (first args)})
      :delete-dialog (set-dialog! {:kind :delete :path (first args)})
      :delete-project-dialog (set-dialog! {:kind :delete-project
                                            :name (:project @state/app)
                                            :last? (= 1 (count (:projects @state/app)))})
      :add-ui-dialog (set-dialog! {:kind :add-ui})
      :add-ui (catch-ui (add-ui-component! (first args)))
      :close-dialog (close-dialog!)
      :toggle-help (toggle-help!)
      :toggle-live (toggle-live!)
      :toggle-files (toggle-files!)
      :toggle-preview-pane (toggle-preview-pane!)
      :resize-files (when event (start-pane-resize! :files event))
      :resize-preview (when event (start-pane-resize! :preview event))
      :pane-resize-move (when event (pane-resize-move! event))
      :pane-resize-end (pane-resize-end! event)
      :reset-files-width (reset-pane-width! :files)
      :reset-preview-width (reset-pane-width! :preview)
      :mobile-tab (set-mobile-tab! (first args))
      :submit-repl (when event
                     (let [form (.-target event)
                           input (when form (.querySelector form "[name=expr]"))
                           code (if input (.-value input) "")]
                       (when input
                         (set! (.-value input) "")
                         (set! (.-height (.-style input)) "")
                         (.focus input))
                       (catch-ui (submit-repl! code))))
      :repl-expr-input (when event (repl-expr-input! event))
      :repl-expr-keydown (when event (repl-expr-keydown! event))
      :clear-repl (clear-repl!)
      :run (catch-ui (run-preview! {:reset? true}))
      :export (catch-ui (export-zip!))
      :switch-project (catch-ui (open-project! (.-value (.-target event))))
      :submit-new-file (when event
                         (let [v (.-value (.querySelector (.-target event) "input"))]
                           (catch-ui (create-file! v))))
      :submit-new-folder (when event
                           (let [v (.-value (.querySelector (.-target event) "input"))]
                             (catch-ui (create-folder! v))))
      :submit-new-project (when event
                            (let [v (.-value (.querySelector (.-target event) "input"))]
                              (catch-ui (create-project! v))))
      :submit-rename (when event
                        (let [v (.-value (.querySelector (.-target event) "input"))
                              from (:from (:dialog @state/app))]
                          (catch-ui (rename-path! from v))))
      :confirm-delete (catch-ui (delete-path! (or (first args)
                                                     (:path (:dialog @state/app)))))
      :confirm-delete-project (catch-ui (delete-project! (or (first args)
                                                             (:name (:dialog @state/app)))))
      nil)))

(defn- boot-local [meta]
  (swap! state/app assoc :mode :local :project (or (:name meta) "local"))
  (reset! !fs (http-fs/open))
  (-> (refresh-tree!)
      (.then (fn [_] (preferred-file (now-fs))))
      (.then (fn [preferred]
               (if preferred
                 (open-file! preferred)
                 (p/ok nil))))
      (.then (fn [_]
               (swap! state/app assoc :fs-status :ready)
               (run-preview! {:reset? false})
               nil))))

(defn- boot-browser []
  (if (opfs/available?)
    (do (swap! state/app assoc :mode :browser)
        (-> (seed-browser!)
            (.then (fn [_]
                     (swap! state/app assoc :fs-status :ready)
                     (run-preview! {:reset? false})
                     nil))))
    (do (swap! state/app assoc :fs-status :error)
        (swap! state/app assoc :fs-error
               "This browser does not expose the Origin Private File System. Try a recent Chrome, Edge, Firefox, or Safari.")
        (p/ok nil))))

(defn boot! []
  (swap! state/app assoc :fs-status :loading)
  (editor/set-handlers! {:on-change on-editor-change
                         :on-eval on-editor-eval})
  (js/setTimeout
   (fn []
     (when (= :loading (:fs-status @state/app))
       (swap! state/app assoc
              :fs-status :error
              :fs-error "Evalight could not finish starting. Check the browser console, or try Chrome, Edge, Firefox, or Safari.")))
   8000)
  (-> (http-fs/server-meta)
      (.then (fn [meta]
               (if (= "local" (:mode meta))
                 (boot-local meta)
                 (boot-browser))))
      (.catch (fn [e]
                (js/console.error "Evalight failed to start" e)
                (swap! state/app assoc :fs-status :error :fs-error (or (.-message e) (str e)))))))
