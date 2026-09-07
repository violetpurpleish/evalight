(ns evalight.actions
  (:require [clojure.string :as str]
            [evalight.bytes :as bytes]
            [evalight.editor :as editor]
            [evalight.export :as export]
            [evalight.fs :as fs]
            [evalight.fs.http :as http-fs]
            [evalight.fs.opfs :as opfs]
            [evalight.history :as history]
            [evalight.paths :as paths]
            [evalight.kit :as kit]
            [evalight.preview :as preview]
            [evalight.prefs :as prefs]
            [evalight.projects :as projects]
            [evalight.promise :as p]
            [evalight.ns-graph :as ns-graph]
            [evalight.state :as state]
            [evalight.template :as template]
            [evalight.commands :as commands]
            [evalight.crumbs :as crumbs]))

(defonce !fs (atom nil))
(defonce !workspace (atom nil))
(defonce !history-fs (atom nil))
(defonce !save-timer (atom nil))
(defonce !live-timer (atom nil))
(defonce !frame-timer (atom nil))
(defonce !save-queue (atom (p/ok nil)))

(defn- schedule-native-frame!
  "GPUI preview is a snapshot, not an iframe. Eval already mutated the
  live window, so refresh immediately. Save goes through clj-gpui's
  watcher first, so wait a beat. No-op unless Preview is native."
  [ms]
  (when (preview/native-preview?)
    (when-let [t @!frame-timer]
      (js/clearTimeout t))
    (reset! !frame-timer
            (js/setTimeout
             (fn []
               (reset! !frame-timer nil)
               (preview/fetch-frame!))
             ms))))

(defn- now-fs []
  (or @!fs (throw (js/Error. "Filesystem is not ready."))))

(defn- with-history-fs! []
  (cond
    @!history-fs (p/ok @!history-fs)
    (opfs/available?) (-> (opfs/workspace-root)
                          (.then (fn [ws]
                                   (reset! !history-fs ws)
                                   ws)))
    :else (p/ok nil)))

(defn- persist-history! []
  (let [st @state/app]
    (history/save @!history-fs
                  (history/store-path (:mode st) (:project st))
                  (:history st))))

(defn- load-history! []
  (-> (with-history-fs!)
      (.then (fn [hfs]
               (let [st @state/app]
                 (history/load hfs (history/store-path (:mode st) (:project st))))))
      (.then (fn [entries]
               (swap! state/app assoc :history (vec entries) :history-open? false)
               entries))))

(defn- record-entry! [entry]
  (if-not entry
    (p/ok nil)
    (do (swap! state/app update :history history/push entry)
        (persist-history!))))

(defn close-history! []
  (swap! state/app assoc :history-open? false))

(defn toggle-history! []
  (swap! state/app
         (fn [s]
           (-> s
               (assoc :help? false :beta? false :pick nil)
               (update :history-open? not)))))

(defn- flash!
  ([text] (flash! text :ok))
  ([text kind] (state/notice! text kind)))

(defn- cljs-file? [path]
  (boolean (re-find #"\.(cljs|cljc)$" (or path ""))))

(defn- cljs-sources []
  (let [files (->> (fs/flatten-files (:tree @state/app))
                   (filter #(cljs-file? (:path %))))]
    (p/reduce-p
     (fn [acc {:keys [path]}]
       (if-let [buffered (editor/text-for path)]
         (p/ok (conj acc {:path path :source buffered}))
         (.then (fs/read-file (now-fs) path)
                (fn [source]
                  (conj acc {:path path :source source})))))
     []
     files)))

(defn- write-sources! [files]
  (p/reduce-p
   (fn [_ {:keys [path source]}]
     (.then (fs/write-file (now-fs) path source)
            (fn [_]
              (editor/set-doc! path source)
              (swap! state/app update :dirty disj path)
              nil)))
   nil
   files))

(defn- ns-label [file]
  (str (or (ns-graph/ns-name-of file) (:path file))))

(defn- format-ns-names [files]
  (str/join ", " (map ns-label files)))

(defn- unused-project-name [base names]
  (let [taken (set names)]
    (if-not (contains? taken base)
      base
      (loop [i 2]
        (let [n (str base "-" i)]
          (if (contains? taken n)
            (recur (inc i))
            n))))))

(defn suggested-project-name []
  (unused-project-name "amber-counter" (:projects @state/app)))

(declare schedule-live-reload!)

(defn- reload-after-files! []
  (when-not (:attached @state/app)
    (schedule-live-reload!)))

(defn- sync-ui-facade! [dest tree]
  (let [paths (set (map :path (fs/flatten-files tree)))
        path kit/facade-path]
    (if (or (not (contains? paths path))
            (contains? (:dirty @state/app) path))
      (p/ok nil)
      (-> (fs/read-file dest path)
          (.then (fn [old]
                   (let [source (kit/facade-source paths)]
                     (when (and (str/starts-with? old kit/facade-header) (not= source old))
                       (.then (fs/write-file dest path source)
                              (fn [_]
                                (if (= path (editor/current-path))
                                  (editor/load-fresh! path source)
                                  (editor/drop-path! path))))))))))))

(defn refresh-tree! []
  (let [dest (now-fs)]
    (-> (fs/read-tree dest "")
        (.then (fn [tree]
                 (.then (sync-ui-facade! dest tree)
                        (fn [_]
                          (swap! state/app assoc :tree tree)
                          tree)))))))

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
                   (-> (p/reduce-p
                        (fn [details name]
                          (-> (projects/load! ws name)
                              (.then (fn [metadata] (assoc details name metadata)))))
                        {} names)
                       (.then (fn [details]
                                (let [ordered (projects/ordered names details)]
                                  (swap! state/app assoc :projects ordered :project-details details)
                                  ordered))))))))
    (p/ok [])))

(defn- track-project [project-fs name]
  (if-let [ws @!workspace]
    (projects/->TrackedFS
     project-fs
     (fn []
       (-> (projects/touch! ws name)
           (.then (fn [metadata]
                    (swap! state/app
                           (fn [s]
                             (let [details (assoc (:project-details s) name metadata)]
                               (assoc s :project-details details
                                      :projects (projects/ordered (:projects s) details))))))))))
    project-fs))

(defn close-project-picker! []
  (swap! state/app assoc :project-picker-open? false)
  (when-let [el (.getElementById js/document "project-select")]
    (.focus el)))

(defn toggle-project-picker! []
  (let [open? (not (:project-picker-open? @state/app))]
    (swap! state/app assoc :project-picker-open? open? :project-query ""
           :project-clock (.now js/Date) :pick nil :history-open? false :help? false :beta? false)
    (when open? (refresh-projects!))))

(declare save-current!)

(defn open-file! [path]
  (if-not path
    (p/ok nil)
    (-> (save-current!)
        (.then (fn [_] (fs/read-file (now-fs) path)))
        (.then (fn [content]
                 (swap! state/app assoc :active-file path :mobile-tab :editor)
                 (cond
                   (paths/image-file? path)
                   (do (editor/park!)
                       (swap! state/app assoc :media
                              {:kind :image
                               :src (when (bytes/packed? content)
                                      (bytes/data-url content))})
                       path)

                   (or (paths/binary-file? path) (bytes/packed? content))
                   (do (editor/park!)
                       (swap! state/app assoc :media {:kind :binary})
                       path)

                   :else
                   (do (swap! state/app dissoc :media)
                       (editor/load-fresh! path
                                           (if (contains? (:dirty @state/app) path)
                                             (or (editor/text-for path) content)
                                             content))
                       (editor/focus!)
                       path)))))))

(defn- apply-preview-result [result]
  (if (:ok result)
    (do (swap! state/app assoc-in [:preview :status] :ok)
        (swap! state/app assoc-in [:preview :error] nil)
        (preview/refresh-intel!)
        (preview/fetch-frame!))
    (do (swap! state/app assoc-in [:preview :status] :error)
        (swap! state/app assoc-in [:preview :error]
               (or (get-in result [:error :message]) "Preview failed to load."))))
  result)

(defn run-preview!
  ([] (run-preview! {:reset? true}))
  ([{:keys [reset?]}]
   (swap! state/app assoc-in [:preview :status] :loading)
   (swap! state/app assoc-in [:preview :error] nil)
   (-> (save-current! {:reload? false})
       (.then (fn [_]
                (when (and reset? (preview/iframe-runtime?))
                  (preview/reload-frame!))
                (preview/load-project (now-fs) {:reset? reset?})))
       (.then apply-preview-result)
       (.catch (fn [e]
                 (swap! state/app assoc-in [:preview :status] :error)
                 (swap! state/app assoc-in [:preview :error] (.-message e))
                 nil)))))

(defn- schedule-live-reload! []
  (when (and (:live? (:preview @state/app))
             (not (:attached @state/app))
             (preview/iframe-runtime?))
    (when-let [t @!live-timer]
      (js/clearTimeout t))
    (reset! !live-timer
            (js/setTimeout
             (fn []
               (let [compiled? (preview/compiled-runtime?)]
                 (when compiled?
                   (preview/reload-frame!))
                 (-> (preview/load-project (now-fs) {:reset? false})
                     (.then apply-preview-result)
                     (.then (fn [r]
                              (preview/fetch-frame!)
                              r))
                     (.catch (fn [e]
                               (swap! state/app assoc-in [:preview :status] :error)
                               (swap! state/app assoc-in [:preview :error] (.-message e)))))))
             (if (preview/compiled-runtime?) 1400 450)))))

(defn- save-buffer! [project-fs path text reload?]
  ;; Serialize writes so an older save cannot finish after a newer one.
  (let [saved (-> @!save-queue
                  (.catch (fn [_] nil))
                  (.then (fn [_] (fs/write-file project-fs path text)))
                  (.then (fn [_]
                           (when (identical? project-fs @!fs)
                             (when (= text (editor/text-for path))
                               (swap! state/app update :dirty disj path))
                             (when reload?
                               (schedule-live-reload!)
                               (schedule-native-frame! 450)))
                           path)))]
    (reset! !save-queue saved)
    saved))

(defn save-current!
  ([] (save-current! {:reload? true}))
  ([{:keys [reload?]}]
   (when-let [t @!save-timer]
     (js/clearTimeout t)
     (reset! !save-timer nil))
   (let [path (editor/current-path)
         text (editor/current-text)]
     (if (and path text (contains? (:dirty @state/app) path)
              (not (paths/binary-file? path)))
       (save-buffer! (now-fs) path text reload?)
       @!save-queue))))

(defn on-editor-change [text]
  (when-let [path (editor/current-path)]
    (swap! state/app update :dirty conj path)
    (when-let [t @!save-timer]
      (js/clearTimeout t))
    (let [project-fs (now-fs)]
      (reset! !save-timer
              (js/setTimeout
               (fn []
                 (reset! !save-timer nil)
                 (-> (save-buffer! project-fs path text true)
                     (.catch (fn [e] (flash! (.-message e) :err)))))
               320)))))

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
                             (preview/refresh-intel!)
                             (schedule-native-frame! 0))
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

(def ^:private preferred-candidates
  ["src/app/core.cljs" "src/my/app.clj" "src/app/core.clj"])

(defn- preferred-file [project-fs]
  (-> (p/reduce-p
       (fn [found path]
         (if found
           (p/ok found)
           (.then (fs/exists? project-fs path)
                  (fn [exists] (when exists path)))))
       nil
       preferred-candidates)
      (.then (fn [found]
               (or found
                   (some (fn [{:keys [path]}]
                           (when (re-find #"\.(clj|cljs|cljc)$" path) path))
                         (fs/flatten-files (:tree @state/app))))))))

(defn- migrate-project-docs! [fs name]
  (-> (fs/exists? fs "README.md")
      (.then (fn [exists]
               (if-not exists
                 (p/ok nil)
                 (.then (fs/read-file fs "README.md")
                        (fn [text]
                          (if-not (template/stale-evalight-readme? text)
                            (p/ok nil)
                            (fs/write-file fs "README.md" (template/readme name))))))))
      (.then (fn [_] (fs/exists? fs "package.json")))
      (.then (fn [exists]
               (if-not exists
                 (p/ok nil)
                 (.then (fs/read-file fs "package.json")
                        (fn [text]
                          (let [next (export/with-evalight-script text)]
                            (if (= next text)
                              (p/ok nil)
                              (fs/write-file fs "package.json" next))))))))
      (.then (fn [_] (fs/exists? fs "public/style.css")))
      (.then (fn [exists]
               (if-not exists
                 (p/ok nil)
                 (.then (fs/read-file fs "public/style.css")
                        (fn [text]
                          (let [next (template/with-title-wrap text)]
                            (if (= next text)
                              (p/ok nil)
                              (fs/write-file fs "public/style.css" next))))))))))

(defn open-project! [name]
  (let [mode (:mode @state/app)
        prev (:project @state/app)
        fs-p (if (= :local mode)
               (p/ok (now-fs))
               (opfs/open ["evalight" "projects" name]))]
    (when (and prev (not= prev name))
      (prefs/save-repl!))
    (-> (save-current! {:reload? false})
        (.then (fn [_] fs-p))
        (.then (fn [project-fs]
                 (reset! !fs project-fs)
                 (editor/clear-buffers!)
                 (swap! state/app assoc :project name :active-file nil :dirty #{} :tree [] :history-open? false :media nil)
                 (prefs/restore-repl! name)
                 (if-let [ws @!workspace]
                   (fs/write-file ws "workspace.json"
                                 (js/JSON.stringify (clj->js {:active name})))
                   (p/ok nil))))
        (.then (fn [_] (load-history!)))
        (.then (fn [_] (migrate-project-docs! (now-fs) name)))
        (.then (fn [_] (reset! !fs (track-project (now-fs) name))))
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
      (-> (fs/exists? @!workspace (paths/join "projects" name))
          (.then (fn [exists]
                   (if exists
                     (p/ok (flash! (str name " already exists.") :err))
                     (-> (opfs/open ["evalight" "projects" name])
                         (.then (fn [dest] (write-template! dest name)))
                         (.then (fn [_]
                                  (let [now (.now js/Date)]
                                    (projects/save! @!workspace name {:created-at now :edited-at now}))))
                         (.then (fn [_] (refresh-projects!)))
                         (.then (fn [_]
                                  (swap! state/app assoc :dialog nil)
                                  (open-project! name)))
                         (.then (fn [_] (flash! (str "Created " name))))))))))))

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
               (reset! !history-fs ws)
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
        (-> (fs/exists? (now-fs) path)
            (.then (fn [exists]
                     (when exists
                       (throw (js/Error. (str path " already exists."))))
                     (fs/write-file (now-fs) path content)))
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
  (-> (save-current! {:reload? false})
      (.then (fn [_]
               (p/all [(cljs-sources)
                       (history/snapshot-path (now-fs) path (editor/buffer-texts))])))
      (.then (fn [pair]
               (let [files (aget pair 0)
                     snap (aget pair 1)
                     removed (filterv #(or (= (:path %) path)
                                           (paths/starts-with-path? (:path %) path))
                                      files)
                     kept (filterv #(not (or (= (:path %) path)
                                             (paths/starts-with-path? (:path %) path)))
                                   files)
                     missing (->> removed
                                  (map ns-graph/ns-name-of)
                                  (remove nil?)
                                  distinct
                                  vec)
                     leftover (filterv (fn [f]
                                         (and (not (and (= kit/facade-path (:path f))
                                                        (str/starts-with? (:source f) kit/facade-header)))
                                              (some (fn [ns-sym]
                                                 (seq (ns-graph/requiring [f] ns-sym)))
                                               missing)))
                                       kept)]
                 (.then (fs/delete (now-fs) path)
                        (fn [_]
                          (editor/drop-tree! path)
                          (swap! state/app assoc :dialog nil)
                            (when (and (:active-file @state/app)
                                     (paths/starts-with-path? (:active-file @state/app) path))
                            (swap! state/app assoc :active-file nil :media nil))
                          (record-entry! (history/delete-entry snap))
                          (.then (refresh-tree!)
                                 (fn [_]
                                   (reload-after-files!)
                                   (if (seq leftover)
                                     (flash! (str "Deleted " path ". "
                                                  (format-ns-names leftover)
                                                  " still require"
                                                  (if (= 1 (count leftover)) "s " " ")
                                                  (str/join ", " (map str missing)) ".")
                                             :err)
                                     (flash! (str "Deleted " path))))))))))))

(defn- seed-lamp! []
  (-> (opfs/open ["evalight" "projects" "lamp"])
      (.then (fn [dest] (write-template! dest "lamp")))
      (.then (fn [_]
               (let [now (.now js/Date)]
                 (projects/save! @!workspace "lamp" {:created-at now :edited-at now}))))
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
        (-> (save-current! {:reload? false})
            (.then (fn [_] (fs/delete @!workspace (paths/join "projects" name))))
            (.then (fn [_] (fs/delete @!workspace (projects/metadata-path name))))
            (.then (fn [_]
                     (editor/clear-buffers!)
                     (swap! state/app assoc :active-file nil :dirty #{} :tree [] :project nil :history [] :media nil)
                     (history/drop-store @!history-fs (history/store-path :browser name))))
            (.then (fn [_] (refresh-projects!)))
            (.then (fn [names]
                     (if (seq names)
                       (open-project! (first names))
                       (seed-lamp!))))
            (.then (fn [_] (flash! (str "Deleted " name)))))))))

(defn rename-path! [from to]
  (let [to (paths/normalize to)]
    (if (or (str/blank? to) (= from to))
      (p/ok (swap! state/app assoc :dialog nil))
      (-> (save-current! {:reload? false})
          (.then (fn [_] (fs/exists? (now-fs) to)))
          (.then (fn [exists]
                   (when exists
                     (throw (js/Error. (str to " already exists."))))
                   (p/all [(cljs-sources)
                           (history/snapshot-path (now-fs) from (editor/buffer-texts))])))
          (.then (fn [pair]
                   (let [files (aget pair 0)
                         snap (aget pair 1)]
                     (.then (fs/rename (now-fs) from to)
                            (fn [_]
                              (editor/rename-path! from to)
                              (swap! state/app assoc :dialog nil)
                              (when-let [active (:active-file @state/app)]
                                (when (paths/starts-with-path? active from)
                                  (swap! state/app assoc :active-file (paths/remap-under active from to))))
                              (let [moved (mapv (fn [f]
                                                  (assoc f :path (paths/remap-under (:path f) from to)
                                                         :from-path (:path f)))
                                                files)
                                    mapping (into []
                                                  (keep (fn [{:keys [from-path path source]}]
                                                          (ns-graph/conventional-move from-path source path)))
                                                  moved)
                                    rewritten (mapv (fn [f]
                                                      (assoc f :source (ns-graph/rewrite-ns-syms (:source f) mapping)))
                                                    moved)
                                    changed (filterv (fn [f]
                                                       (let [old (first (filter #(= (:path %) (:path f)) moved))]
                                                         (not= (:source f) (:source old))))
                                                     rewritten)
                                    others (filterv (fn [f]
                                                      (not (paths/starts-with-path? (:path f) to)))
                                                    changed)
                                    extra (into {}
                                                (keep (fn [{:keys [path source]}]
                                                        (when (some #(= path (:path %)) others)
                                                          [path source])))
                                                files)
                                    entry (history/rename-entry from to
                                                                (when snap
                                                                  (update snap :files merge extra)))]
                                (.then (write-sources! changed)
                                       (fn [_]
                                         (record-entry! entry)
                                         (.then (refresh-tree!)
                                                (fn [_]
                                                  (reload-after-files!)
                                                  (cond
                                                    (and (= 1 (count mapping)) (seq others))
                                                    (let [[from-ns to-ns] (first mapping)]
                                                      (flash! (str from-ns " is now " to-ns ". Updated "
                                                                   (format-ns-names others) ".")))
                                                    (= 1 (count mapping))
                                                    (let [[from-ns to-ns] (first mapping)]
                                                      (flash! (str from-ns " is now " to-ns ".")))
                                                    (seq mapping)
                                                    (flash! (str "Updated " (count mapping)
                                                                 " namespaces after the rename."))
                                                    (seq others)
                                                    (flash! (str "Updated " (format-ns-names others)
                                                                 " after the rename."))
                                                    :else nil)))))))))))))))

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
                   (.then (fs/exists? fs kit/facade-path)
                          (fn [exists]
                            (if exists acc
                              (.then (fs/write-file fs kit/facade-path kit/facade-header)
                                     (fn [_] acc)))))))
          (.then (fn [acc]
                   (.then (ensure-ui-css-listed! fs)
                          (fn [_] acc))))
          (.then (fn [acc]
                   (swap! state/app update :expanded conj "src" "src/ui" "public" "public/css")
                   (.then (refresh-tree!)
                          (fn [_]
                            (schedule-live-reload!)
                            (if (every? #{:exists} acc)
                              (flash! (str (:title item) " is already in this project."))
                              (flash! (str "Added " (:title item))))))))))))

(defn restore-ui-component!
  "Overwrite this control's file with the original kit source."
  [id]
  (let [file (kit/own-file id)
        path (:path file)
        content (:content file)]
    (if-not file
      (p/ok (flash! "Unknown control." :err))
      (do
        (when (= path (editor/current-path))
          (when-let [t @!save-timer]
            (js/clearTimeout t))
          (reset! !save-timer nil))
        (let [previous (get (editor/buffer-texts) path)
              old-p (if (string? previous)
                      (p/ok previous)
                      (fs/read-file (now-fs) path))]
          (-> old-p
              (.then (fn [old]
                       (.then (fs/write-file (now-fs) path content)
                              (fn [_] old))))
              (.then (fn [old]
                       (if (= path (editor/current-path))
                         (editor/load-fresh! path content)
                         (editor/drop-path! path))
                       (swap! state/app update :dirty disj path)
                       (record-entry! (history/overwrite-entry path old))))
              (.then (fn [_]
                       (flash! (str "Restored " (:title file)))
                       (schedule-live-reload!)
                       (refresh-tree!)))))))))

(defn- apply-restore-op! [op]
  (case (:op op)
    :mkdir (fs/mkdir (now-fs) (:path op))
    :write (fs/write-file (now-fs) (:path op) (or (:content op) ""))
    :rename (fs/rename (now-fs) (:from op) (:to op))
    :delete (fs/delete (now-fs) (:path op))
    (p/ok nil)))

(defn- restore-blocked? [entry]
  (case (:kind entry)
    :delete (fs/exists? (now-fs) (:path entry))
    :rename (-> (p/all [(fs/exists? (now-fs) (:from entry))
                        (fs/exists? (now-fs) (:to entry))])
                (.then (fn [pair]
                         (or (aget pair 0) (not (aget pair 1))))))
    (p/ok false)))

(defn- after-restore! [entry]
  (case (:kind entry)
    :rename
    (do (if (seq (:files entry))
          (do (editor/drop-tree! (:to entry))
              (doseq [[path content] (:files entry)]
                (when-not (paths/starts-with-path? path (or (:from entry) ""))
                  (editor/set-doc! path content)))
              (when-let [active (:active-file @state/app)]
                (when (paths/starts-with-path? active (:to entry))
                  (let [restored (if (= active (:to entry))
                                   (:from entry)
                                   (paths/remap-under active (:to entry) (:from entry)))]
                    (swap! state/app assoc :active-file restored)
                    (open-file! restored)))))
          (do (editor/rename-path! (:to entry) (:from entry))
              (when (= (:to entry) (:active-file @state/app))
                (swap! state/app assoc :active-file (:from entry)))))
        (when-let [parent (paths/dirname (:from entry))]
          (swap! state/app update :expanded conj parent)))

    :overwrite
    (let [path (:path entry)
          content (or (:content entry) "")]
      (if (= path (editor/current-path))
        (editor/load-fresh! path content)
        (editor/drop-path! path))
      (swap! state/app update :dirty disj path))

    :delete
    (let [files (:files entry)
          only (when (= 1 (count files)) (first (keys files)))]
      (when-let [parent (paths/dirname (or only (:path entry)))]
        (swap! state/app update :expanded conj parent))
      (when only
        (open-file! only)))

    nil)
  (swap! state/app update :history history/without (:id entry))
  (schedule-live-reload!)
  (-> (persist-history!)
      (.then (fn [_] (refresh-tree!)))
      (.then (fn [_]
               (flash! (str "Restored " (or (:path entry) (:from entry))))))))

(defn undo-entry! [id]
  (let [entry (some #(when (= id (:id %)) %) (:history @state/app))]
    (if-not entry
      (p/ok (flash! "That history entry is gone." :err))
      (-> (restore-blocked? entry)
          (.then (fn [blocked]
                   (if blocked
                     (flash! (str "Cannot undo. "
                                  (or (:path entry) (:from entry))
                                  " is in the way.")
                             :err)
                     (-> (p/reduce-p (fn [_ op] (apply-restore-op! op))
                                     nil
                                     (history/restore-ops entry))
                         (.then (fn [_] (after-restore! entry)))))))))))

(defn undo-last! []
  (if-let [id (:id (first (:history @state/app)))]
    (undo-entry! id)
    (p/ok (flash! "History is empty."))))

(defn clear-history! []
  (swap! state/app assoc :history [])
  (-> (persist-history!)
      (.then (fn [_] (flash! "Cleared history")))))

(defn set-dialog! [dialog]
  (swap! state/app assoc :dialog dialog :pick nil :history-open? false :project-picker-open? false :project-actions-open? false))

(defn close-dialog! []
  (swap! state/app assoc :dialog nil))

(defn toggle-help! []
  (swap! state/app (fn [s]
                     (-> s
                         (assoc :history-open? false)
                         (update :help? not)))))

(defn close-beta! []
  (swap! state/app assoc :beta? false))

(defn toggle-beta! []
  (swap! state/app (fn [s]
                     (-> s
                         (assoc :history-open? false)
                         (update :beta? not)))))

(defn toggle-live! []
  (if (:attached @state/app)
    (flash! "shadow-cljs autoload reloads the attached app. Evalight Live stays off.")
    (swap! state/app update-in [:preview :live?] not)))

(defn set-mobile-tab! [tab]
  (swap! state/app assoc :mobile-tab tab))

(def ^:private files-min 160)
(def ^:private files-max 480)
(def ^:private preview-min 200)
(def ^:private preview-max 640)
(def ^:private main-min 240)


(defn toggle-files! []
  (swap! state/app update-in [:layout :files-open?] not))

(defn toggle-preview-pane! []
  (swap! state/app update-in [:layout :preview-open?] not))

(defn toggle-word-wrap! []
  (let [on? (not (boolean (:word-wrap? @state/app)))]
    (swap! state/app assoc :word-wrap? on?)
    (editor/apply-wrap!)
    (flash! (if on? "Word wrap on" "Word wrap off"))))

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

(defn pane-resize-props [pane]
  {:value (get-in @state/app [:layout (if (= pane :files) :files-width :preview-width)])
   :reverse? (= pane :preview)
   :clamp #(clamp-pane pane %)
   :on-input #(apply-pane-el-width! pane %)
   :on-change (fn [width]
                (swap! state/app assoc-in
                       [:layout (if (= pane :files) :files-width :preview-width)] width))
   :on-dragging #(swap! state/app assoc-in [:layout :dragging?] %)})

(defn reset-pane-width! [pane]
  (swap! state/app assoc-in [:layout (if (= pane :files) :files-width :preview-width)]
         (if (= pane :files) 220 360)))

(defn submit-repl! [code]
  (let [code (str/trim (or code ""))]
    (if (seq code)
      (eval-code! code :repl)
      (p/ok nil))))

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
  (flash! "Packing Evalight into the zip…")
  (-> (save-current! {:reload? false})
      (.then (fn [_]
               (let [name (or (:project @state/app) "evalight-project")
                     path (:active-file @state/app)]
                 (.then (export/download (now-fs) name)
                        (fn [_]
                          (let [done (fn [] (flash! (str "Exported " name ".zip")))]
                            (if (contains? #{"README.md" "package.json"} path)
                              (.then (fs/read-file (now-fs) path)
                                     (fn [content]
                                       (editor/load-fresh! path content)
                                       (done)))
                              (done))))))))))

(defn catch-ui [p]
  (when p
    (.catch p (fn [e]
                (flash! (or (.-message e) (str e)) :err)
                nil))))

(defn crumb-pick! [id]
  (let [tree (:tree @state/app)
        node (crumbs/find-node tree id)
        pick (:pick @state/app)]
    (cond
      (nil? node) (commands/close!)
      (= :file (:type node)) (do (commands/close!) (open-file! id))
      :else (commands/open! {:via :crumb :anchor (:anchor pick) :path id}))))

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
      :new-project-dialog (set-dialog! {:kind :new-project :value (suggested-project-name)})
      :rename-dialog (set-dialog! {:kind :rename :from (first args) :value (first args)})
      :delete-dialog (set-dialog! {:kind :delete :path (first args)})
      :delete-project-dialog (set-dialog! {:kind :delete-project
                                            :name (:project @state/app)
                                            :last? (= 1 (count (:projects @state/app)))})
      :add-ui-dialog (set-dialog! {:kind :add-ui})
      :add-ui (catch-ui (add-ui-component! (first args)))
      :restore-ui (catch-ui (restore-ui-component! (first args)))
      :close-dialog (close-dialog!)
      :dismiss-notice (when (= (first args) (get-in @state/app [:notice :id]))
                        (swap! state/app assoc :notice nil))
      :pick-open (do (close-history!) (commands/open! (first args)))
      :pick-close (commands/close!)
      :pick-query (when event
                    (let [t (.-target event)]
                      (commands/set-query! (when t (.-value t)))))
      :crumb-open (commands/open! {:via :crumb :anchor (first args)})
      :crumb-pick (catch-ui (crumb-pick! (first args)))
      :toggle-help (toggle-help!)
      :close-help (swap! state/app assoc :help? false)
      :toggle-beta (toggle-beta!)
      :close-beta (close-beta!)
      :toggle-history (toggle-history!)
      :close-history (close-history!)
      :undo-entry (catch-ui (undo-entry! (first args)))
      :undo-last (catch-ui (undo-last!))
      :clear-history (catch-ui (clear-history!))
      :toggle-live (toggle-live!)
      :toggle-files (toggle-files!)
      :toggle-preview-pane (toggle-preview-pane!)
      :toggle-word-wrap (toggle-word-wrap!)
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
      :repl-expr-keydown (when event (repl-expr-keydown! event))
      :clear-repl (clear-repl!)
      :run (catch-ui (run-preview! {:reset? true}))
      :export (do (swap! state/app assoc :project-actions-open? false)
                  (catch-ui (export-zip!)))
      :toggle-project-actions (swap! state/app
                                     (fn [s] (assoc s :project-actions-open? (not (:project-actions-open? s))
                                                     :project-picker-open? false :history-open? false)))
      :close-project-actions (swap! state/app assoc :project-actions-open? false)
      :toggle-project-picker (catch-ui (toggle-project-picker!))
      :close-project-picker (close-project-picker!)
      :project-query (swap! state/app assoc :project-query (.-value (.-target event)))
      :switch-project (do (close-project-picker!)
                          (when (not= (first args) (:project @state/app))
                            (catch-ui (open-project! (first args)))))
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

(defn- app-var-ns [app]
  (when (and app (not (str/blank? (str app))))
    (let [s (str app)]
      (if (re-find #"/" s)
        (first (str/split s #"/"))
        s))))

(defn- boot-local [meta]
  (let [rt (preview/coerce-runtime (or (:runtime meta) (:kind meta)))
        attached? (boolean (:attached meta))
        preview-kind (keyword (or (:preview meta) (:preview-kind meta)))
        gpui? (= rt :gpui)
        clj? (= rt :clj)
        app (or (:app meta) (:mainNs meta) (:main-ns meta))
        repl-ns (app-var-ns app)]
    (swap! state/app
           (fn [s]
             (cond-> (-> s
                          (assoc :mode :local
                                 :runtime rt
                                 :preview-kind preview-kind
                                 :preview-url (or (:preview-url meta) (:previewUrl meta))
                                 :nrepl-port (or (:nrepl-port meta) (:nreplPort meta))
                                 :app-var (or app (get-in s [:repl :ns]))
                                 :project (or (:name meta) "local")
                                 :attached attached?
                                 :attach-label (:attach-label meta)))
               (and clj? (not gpui?)) (assoc-in [:layout :preview-open?] false)
               gpui? (assoc-in [:layout :preview-open?] true)
               (or attached? gpui?) (assoc-in [:preview :live?] false)
               repl-ns (assoc-in [:repl :ns] repl-ns))))
    (reset! !fs (http-fs/open))
    (prefs/restore-repl! (or (:name meta) "local"))
    ;; History restore can put back a ClojureScript ns. Only JVM apps
    ;; should ignore that and keep the nREPL main ns.
    (when (and repl-ns (or clj? gpui?))
      (swap! state/app assoc-in [:repl :ns] repl-ns)))
  (-> (load-history!)
      (.then (fn [_] (refresh-tree!)))
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
    (do (swap! state/app assoc :mode :browser :runtime :sci :preview-url nil)
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
  (prefs/restore-layout!)
  (prefs/bind!)
  (editor/set-handlers! {:on-change on-editor-change
                         :on-eval on-editor-eval})
  (commands/bind-keys!)
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
