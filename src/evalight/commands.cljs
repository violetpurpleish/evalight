(ns evalight.commands
  (:require [evalight.crumbs :as crumbs]
            [evalight.fs :as fs]
            [evalight.paths :as paths]
            [evalight.state :as state]
            [ui.command :as cmd]))

(def registry
  [{:id :new-file :label "New file" :group "Files" :action [:new-file-dialog]}
   {:id :new-folder :label "New folder" :group "Files" :action [:new-folder-dialog]}
   {:id :add-ui :label "Add UI" :group "Files"
    :when (fn [s] (contains? #{:sci :compiled} (:runtime s)))
    :action [:add-ui-dialog]}
   {:id :history :label "History" :group "Files" :action [:toggle-history]}
   {:id :undo-last :label "Undo last file change" :group "Files"
    :when (fn [s] (seq (:history s)))
    :action [:undo-last]}
   {:id :toggle-files :label "Toggle files pane" :group "View" :action [:toggle-files]}
   {:id :toggle-preview :label "Toggle preview pane" :group "View"
    :when (fn [s] (not (or (= :clj (:runtime s)) (= :none (:preview-kind s)))))
    :action [:toggle-preview-pane]}
   {:id :toggle-word-wrap :label "Toggle word wrap" :group "View"
    :action [:toggle-word-wrap]}
   {:id :toggle-live :label "Toggle live reload" :group "Preview"
    :when (fn [s] (contains? #{:sci :compiled} (:runtime s)))
    :action [:toggle-live]}
   {:id :run :label "Run" :group "Preview" :action [:run]}
   {:id :clear-repl :label "Clear REPL" :group "View" :action [:clear-repl]}
   {:id :toggle-help :label "Help" :group "View" :action [:toggle-help]}
   {:id :export :label "Export ZIP" :group "Project"
    :when (fn [s] (= :browser (:mode s)))
    :action [:export]}
   {:id :new-project :label "New project" :group "Project"
    :when (fn [s] (= :browser (:mode s)))
    :action [:new-project-dialog]}
   {:id :delete-project :label "Delete project" :group "Project"
    :when (fn [s] (= :browser (:mode s)))
    :action [:delete-project-dialog]}])

(defn- decorate [state row]
  (cond-> row
    (= :toggle-word-wrap (:id row))
    (assoc :hint (if (:word-wrap? state) "On" "Off"))))

(defn- visible-registry [state]
  (->> registry
       (filter (fn [row]
                 (if-let [w (:when row)] (w state) true)))
       (map #(dissoc % :when))
       (map #(decorate state %))
       vec))

(defn- file-rows [tree]
  (mapv (fn [{:keys [path name]}]
          {:id (str "file:" path)
           :label name
           :hint path
           :group "Go to file"
           :action [:open-file path]})
        (fs/flatten-files tree)))

(defn items
  [state]
  (into (visible-registry state) (file-rows (:tree state))))

(defn- clamp-active [state pick]
  (let [vis (cmd/visible (items state) (:query pick ""))
        id (:active pick)]
    (assoc pick :active
           (if (some #(= (:id %) id) vis)
             id
             (:id (first vis))))))

(defn close!
  []
  (swap! state/app assoc :pick nil))

(defn open!
  [spec]
  (swap! state/app
         (fn [s]
           (let [via (:via spec)
                 anchor (:anchor spec)
                 listing (:path spec)
                 cur (:pick s)
                 same-crumb? (and (= :crumb via)
                                  (= :crumb (:via cur))
                                  (= anchor (:anchor cur))
                                  (nil? listing))
                 next (cond
                        same-crumb? nil
                        (= :palette via) {:via :palette :query "" :active nil}
                        (= :crumb via) {:via :crumb
                                        :anchor anchor
                                        :path (or listing (paths/dirname anchor))
                                        :query ""
                                        :active nil}
                        :else cur)
                 picked (when next (clamp-active s next))]
             (cond-> (assoc s :pick picked)
               picked (assoc :dialog nil))))))

(defn toggle-palette!
  []
  (if (= :palette (:via (:pick @state/app)))
    (close!)
    (open! {:via :palette})))

(defn set-query!
  [q]
  (swap! state/app
         (fn [s]
           (if-not (:pick s)
             s
             (let [p (clamp-active s (assoc (:pick s) :query (or q "")))]
               (if (= p (:pick s)) s (assoc s :pick p)))))))

(defn set-active!
  [id]
  (swap! state/app
         (fn [s]
           (if (or (not (:pick s)) (= id (get-in s [:pick :active])))
             s
             (assoc-in s [:pick :active] id)))))

(defn crumb-menu
  [state]
  (let [p (:pick state)]
    (when (= :crumb (:via p))
      (let [listing (or (:path p) (paths/dirname (:anchor p)))
            active (:active-file state)]
        (if (= listing (paths/dirname (:anchor p)))
          (crumbs/sibling-rows (:tree state) (:anchor p) active)
          (crumbs/child-rows (:tree state) listing active))))))

(defn- palette-hotkey? [e]
  (and (or (.-metaKey e) (.-ctrlKey e))
       (not (.-altKey e))
       (let [k (.toLowerCase (.-key e))]
         (or (and (= k "k") (not (.-shiftKey e)))
             (and (.-shiftKey e) (= k "p"))))))

(defn- on-window-key [e]
  (cond
    (and (= "Escape" (.-key e)) (not (.-isComposing e)))
    (let [s @state/app]
      (cond
        (:project-picker-open? s)
        (do (.preventDefault e)
            (swap! state/app assoc :project-picker-open? false)
            (some-> (.getElementById js/document "project-select") .focus))

        (:pick s)
        (when-not (.closest (.-target e) ".ui-command")
          (.preventDefault e)
          (close!))

        (:dialog s)
        (do (.preventDefault e)
            (swap! state/app assoc :dialog nil))

        (:history-open? s)
        (do (.preventDefault e)
            (swap! state/app assoc :history-open? false))

        (:beta? s)
        (do (.preventDefault e)
            (swap! state/app assoc :beta? false))

        (:help? s)
        (do (.preventDefault e)
            (swap! state/app assoc :help? false))))

    (palette-hotkey? e)
    (do (.preventDefault e) (toggle-palette!))))

(defonce !bound (atom false))

(defn bind-keys!
  []
  (when-not @!bound
    (reset! !bound true)
    (.addEventListener js/window "keydown" on-window-key true)))
