(ns evalight.ui
  (:require [evalight.actions :as actions]
            [evalight.editor :as editor]
            [evalight.icons :as icons]
            [evalight.preview :as preview]
            [evalight.state :as state]))

(defn- dirty? [state path]
  (contains? (:dirty state) path))

(defn- file-row [state {:keys [path name]}]
  [:div.tree-row
   [:button.tree-item
    {:on {:click [:open-file path]}
     :class (when (= path (:active-file state)) "is-active")}
    (icons/file)
    [:span.tree-name name]
    (when (dirty? state path)
      [:span.dot {:title "Unsaved changes"}])]
   [:div.tree-ops
    [:button.tiny {:on {:click [:rename-dialog path]} :title "Rename"} "Rename"]
    [:button.tiny {:on {:click [:delete-dialog path]} :title "Delete"} "Delete"]]])

(defn- dir-row [state {:keys [path name children]}]
  (let [open? (contains? (:expanded state) path)]
    [:div.tree-dir
     [:div.tree-row
      [:button.tree-item {:on {:click [:toggle-dir path]}}
       [:span.twisty {:class (when open? "is-open")} "▸"]
       (icons/folder)
       [:span.tree-name name]]
      [:div.tree-ops
       [:button.tiny {:on {:click [:delete-dialog path]} :title "Delete"} "Delete"]]]
     (when open?
       [:div.tree-children
        (for [child children]
          [:div {:replicant/key (:path child)}
           (if (= :dir (:type child))
             (dir-row state child)
             (file-row state child))])])]))

(defn file-tree [state]
  [:div.tree
   (if (seq (:tree state))
     (for [node (:tree state)]
       [:div {:replicant/key (:path node)}
        (if (= :dir (:type node))
          (dir-row state node)
          (file-row state node))])
     [:p.muted.empty-tree "This project has no files yet."])])

(defn- shortcut [keys label]
  [:li
   [:span.keys
    (map (fn [k] [:kbd {:replicant/key k} k]) keys)]
   [:span label]])

(defn help-panel []
  [:aside.help
   [:header.help-head
    [:h2 "Living with the program"]
    [:button.icon-btn {:on {:click [:toggle-help]} :title "Close"}
     (icons/close)]]
   [:p "Evalight is a small ClojureScript workshop. The preview is the running program. Evaluating a form talks to that program, not a separate compiler."]
   [:ul.shortcuts
    (shortcut ["Ctrl" "Enter"] "Evaluate the form at the cursor")
    (shortcut ["Ctrl" "Shift" "Enter"] "Evaluate the top-level form")
    (shortcut ["Alt" "Enter"] "Evaluate the whole file")
    (shortcut ["Tab"] "Parinfer follows indentation")]
   [:p.muted "Projects in the browser live in the Origin Private File System. Export writes a normal zip of those files — the same tree you would open locally."]])

(defn dialog [{:keys [kind value path]}]
  [:div.modal-backdrop {:on {:click [:close-dialog]}}
   [:form.modal
    {:on {:click (fn [e] (.stopPropagation e))
          :submit (case kind
                    :new-file [:submit-new-file]
                    :new-folder [:submit-new-folder]
                    :new-project [:submit-new-project]
                    :rename [:submit-rename]
                    :delete [:confirm-delete])}}
    (case kind
      :new-file
      [:div
       [:h2 "New file"]
       [:p.muted "Path relative to the project root."]
       [:input {:name "path"
                :value value
                :replicant/on-mount (fn [{:keys [replicant/node]}]
                                      (.focus node)
                                      (.select node))}]
       [:div.modal-actions
        [:button.ghost {:type "button" :on {:click [:close-dialog]}} "Cancel"]
        [:button.primary {:type "submit"} "Create"]]]

      :new-folder
      [:div
       [:h2 "New folder"]
       [:input {:name "path"
                :value value
                :replicant/on-mount (fn [{:keys [replicant/node]}]
                                      (.focus node))}]
       [:div.modal-actions
        [:button.ghost {:type "button" :on {:click [:close-dialog]}} "Cancel"]
        [:button.primary {:type "submit"} "Create"]]]

      :new-project
      [:div
       [:h2 "New project"]
       [:p.muted "A fresh ClojureScript project stored in this browser."]
       [:input {:name "name"
                :placeholder "amber-counter"
                :value value
                :replicant/on-mount (fn [{:keys [replicant/node]}]
                                      (.focus node))}]
       [:div.modal-actions
        [:button.ghost {:type "button" :on {:click [:close-dialog]}} "Cancel"]
        [:button.primary {:type "submit"} "Create"]]]

      :rename
      [:div
       [:h2 "Rename"]
       [:input {:name "path"
                :value value
                :replicant/on-mount (fn [{:keys [replicant/node]}]
                                      (.focus node)
                                      (.select node))}]
       [:div.modal-actions
        [:button.ghost {:type "button" :on {:click [:close-dialog]}} "Cancel"]
        [:button.primary {:type "submit"} "Rename"]]]

      :delete
      [:div
       [:h2 "Delete"]
       [:p "Delete " [:code path] "? This cannot be undone."]
       [:div.modal-actions
        [:button.ghost {:type "button" :on {:click [:close-dialog]}} "Cancel"]
        [:button.danger {:type "submit"} "Delete"]]])]])

(defn repl-pane [{:keys [repl]}]
  [:section.repl
   [:header.pane-head
    [:span "REPL"]
    [:span.ns (:ns repl)]
    [:button.ghost.small {:on {:click [:clear-repl]}} "Clear"]]
   [:div.repl-log
    {:replicant/on-render
     (fn [{:keys [replicant/node]}]
       (set! (.-scrollTop node) (.-scrollHeight node)))}
    (if (seq (:entries repl))
      (for [{:keys [id kind text]} (:entries repl)]
        [:div {:replicant/key id :class (str "repl-line is-" (name kind))}
         [:span.gutter (case kind :in "›" :err "!" "=")]
         [:pre text]])
      [:p.muted.empty "Evaluate a form with Ctrl-Enter. Results come from the live preview, so (bump) will move the lamp."])]
   [:form.repl-input {:on {:submit [:submit-repl]}}
    [:span.gutter "›"]
    [:input {:type "text"
             :name "expr"
             :value (:input repl)
             :placeholder "(bump)"
             :autocomplete "off"
             :spellcheck "false"
             :on {:input [:set-repl-input]}}]]])

(defn preview-pane [{:keys [preview]}]
  [:section.preview
   [:header.pane-head
    [:span "Preview"]
    [:label.live
     [:input {:type "checkbox"
              :checked (boolean (:live? preview))
              :on {:change [:toggle-live]}}]
     "Live"]
    (when (:error preview)
      [:span.preview-error {:title (:error preview)} "error"])]
   [:div.preview-frame
    [:iframe {:src "/preview.html"
              :sandbox "allow-scripts"
              :title "Live application preview"
              :replicant/on-mount
              (fn [{:keys [replicant/node]}]
                (preview/attach! node actions/on-preview-event))}]]])

(defn editor-pane [state]
  [:section.editor
   [:header.pane-head
    [:span.file-path (or (:active-file state) "No file open")]
    (when (and (:active-file state) (dirty? state (:active-file state)))
      [:span.pill "saving"])]
   (if (:active-file state)
     [:div.editor-host
      {:replicant/key "editor-host"
       :replicant/on-mount
       (fn [{:keys [replicant/node]}]
         (editor/create! node)
         (when-let [path (:active-file @state/app)]
           (actions/open-file! path)))
       :replicant/on-unmount
       (fn [_] (editor/destroy!))}]
     [:div.empty-editor
      [:p "Open a file from the tree, or create one."]
      [:button.primary {:on {:click [:new-file-dialog]}} "New file"]])])

(defn header [state]
  [:header.top
   [:div.brand
    (icons/lamp)
    [:div
     [:div.wordmark "Evalight"]
     [:p.tagline
      (if (= :local (:mode state))
        "Local files"
        "Browser workshop")]]]
   [:div.project
    (if (= :local (:mode state))
      [:span.project-name (:project state)]
      [:select {:on {:change [:switch-project]}
                :value (:project state)}
       (for [name (:projects state)]
         [:option {:value name :replicant/key name} name])])]
   [:nav.actions
    (when (= :browser (:mode state))
      [:button.ghost {:on {:click [:new-project-dialog]}} "New project"])
    [:button.ghost {:on {:click [:export]}} (icons/download) "Export ZIP"]
    [:button.primary {:on {:click [:run]}} (icons/play) "Run"]
    [:button.icon-btn {:on {:click [:toggle-help]} :title "Help"}
     (icons/help)]]])

(defn sidebar [state]
  [:aside.sidebar
   [:header.pane-head
    [:span "Files"]
    [:div.tree-tools
     [:button.tiny {:on {:click [:new-file-dialog]}} (icons/plus) "File"]
     [:button.tiny {:on {:click [:new-folder-dialog]}} "Folder"]]]
   (file-tree state)])

(defn mobile-tabs [{:keys [mobile-tab]}]
  [:nav.mobile-tabs
   (for [[tab label] [[:files "Files"] [:editor "Edit"] [:preview "Preview"] [:repl "REPL"]]]
     [:button {:class (when (= tab mobile-tab) "is-active")
               :on {:click [:mobile-tab tab]}}
      label])])

(defn loading-screen []
  [:div.boot
   (icons/lamp)
   [:p "Lighting the workshop…"]])

(defn error-screen [{:keys [fs-error]}]
  [:div.boot
   [:h1 "Evalight could not start"]
   [:p fs-error]])

(defn notice [{:keys [notice]}]
  (when notice
    [:div.toast {:class (name (:kind notice))}
     (:text notice)]))

(defn workspace [state]
  [:div.shell {:class (str "tab-" (name (:mobile-tab state)))}
   (header state)
   [:div.stage
    (sidebar state)
    [:div.main
     (editor-pane state)
     (repl-pane state)]
    (preview-pane state)]
   (mobile-tabs state)
   (when (:help? state) (help-panel))
   (when-let [d (:dialog state)]
     (dialog d))
   (notice state)])

(defn view [state]
  (case (:fs-status state)
    :loading (loading-screen)
    :error (error-screen state)
    (workspace state)))
