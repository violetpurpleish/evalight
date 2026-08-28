(ns evalight.ui
  (:require [evalight.actions :as actions]
            [evalight.editor :as editor]
            [evalight.icons :as icons]
            [evalight.kit :as kit]
            [evalight.preview :as preview]
            [evalight.state :as state]
            [ui.button :as btn]
            [ui.dialog :as ui-dialog]
            [ui.input :as ui-input]))

(defn- dirty? [state path]
  (contains? (:dirty state) path))

(defn- editor-mount [{:keys [replicant/node]}]
  (editor/create! node)
  (when-let [path (:active-file @state/app)]
    (actions/open-file! path)))

(defn- editor-unmount [_]
  (editor/destroy!))

(defn- resize-repl-field! [el]
  (when el
    (let [style (.-style el)]
      (set! (.-height style) "auto")
      (set! (.-height style) (str (min (.-scrollHeight el) 160) "px")))))

(defn- repl-expr-mount [{:keys [replicant/node]}]
  (resize-repl-field! node))

(defn- preview-mount [{:keys [replicant/node]}]
  (preview/attach! node actions/on-preview-event))

(defn- file-row [state {:keys [path name]}]
  [:div.tree-row
   [:button.tree-item
    {:on {:click [:open-file path]}
     :class (when (= path (:active-file state)) "is-active")}
    [:span.twisty.tree-leaf {:aria-hidden "true"}]
    (icons/file)
    [:span.tree-name name]
    (when (dirty? state path)
      [:span.dot {:title "Unsaved changes"}])]
   [:div.tree-ops
    [:button.tiny {:on {:click [:rename-dialog path]} :title "Rename" :aria-label "Rename"}
     (icons/pencil)]
    [:button.tiny {:on {:click [:delete-dialog path]} :title "Delete" :aria-label "Delete"}
     (icons/trash)]]])

(defn- dir-row [state {:keys [path name children]}]
  (let [open? (contains? (:expanded state) path)]
    [:div.tree-dir
     [:div.tree-row
      [:button.tree-item {:on {:click [:toggle-dir path]}}
       [:span.twisty {:class (when open? "is-open")} "▸"]
       (icons/folder)
       [:span.tree-name name]]
      [:div.tree-ops
       [:button.tiny {:on {:click [:delete-dialog path]} :title "Delete" :aria-label "Delete"}
        (icons/trash)]]]
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
  [:aside.help {:replicant/key :help-panel}
   [:header.help-head
    [:h2 "Living with the program"]
    [:button.icon-btn.help-close
     {:type "button"
      :on {:click [:toggle-help]}
      :title "Close"
      :aria-label "Close help"}
     (icons/close)]]
   [:p "Evalight is a small ClojureScript workshop. The preview is the running program. Evaluating a form talks to that program, not a separate compiler."]
   [:ul.shortcuts
    (shortcut ["Tab"] "Indent this line, or accept a completion when the list is showing")
    (shortcut ["Shift" "Tab"] "Dedent. Parinfer moves the parentheses.")
    (shortcut ["Enter"] "New line in the editor. Evaluate in the REPL.")
    (shortcut ["Ctrl" "Enter"] "Evaluate the form at the cursor")]
   [:p.muted "In the REPL, Shift-Enter inserts a new line. Indent is what you edit; parentheses follow."]
   [:p.muted "Hover a symbol in the editor for its docstring. Completions appear as you type, from the running preview."]
   [:p.muted "src/ui is a small Replicant kit copied into the project. Add UI in the Files pane puts a control back if you deleted it. Restore writes the original file over one you edited."]
   [:p.muted "Projects in the browser live in the Origin Private File System. Export writes a zip of those files, with Evalight already in the folder. Unzip and `bun run evalight` to keep editing here. `bun run dev` compiles the site at localhost:3456 if you want another editor."]])

(defn- tree-file-paths [nodes]
  (mapcat (fn [n]
            (if (= :dir (:type n))
              (tree-file-paths (:children n))
              [(:path n)]))
          nodes))

(defn dialog [state]
  (let [{:keys [kind value path] :as d} (:dialog state)]
    (if (= kind :add-ui)
    (let [present (kit/present-ids (tree-file-paths (:tree state)))]
      (ui-dialog/dialog {:on-close [:close-dialog] :title "Add UI"}
        [:p.muted "Each control is a ClojureScript file. Add copies it into this project. Restore puts the original kit file back."]
        [:ul.kit-list
         (for [{:keys [id title blurb]} kit/catalog]
           [:li {:replicant/key id}
            [:div
             [:div.kit-title title]
             [:p.muted blurb]]
            (if (contains? present id)
              (btn/button {:size :sm
                           :title "Replace this file with the original kit source"
                           :on {:click [:restore-ui id]}}
                "Restore")
              (btn/button {:size :sm :on {:click [:add-ui id]}} "Add"))])]
        (ui-dialog/actions
         (btn/button {:on {:click [:close-dialog]}} "Done"))))
    (ui-dialog/dialog {:on-close [:close-dialog]}
      [:form
       {:on {:submit (case kind
                       :new-file [:submit-new-file]
                       :new-folder [:submit-new-folder]
                       :new-project [:submit-new-project]
                       :rename [:submit-rename]
                       :delete [:confirm-delete]
                       :delete-project [:confirm-delete-project])}}
       (case kind
         :new-file
         [:div
          [:h2.ui-dialog-title "New file"]
          [:p.muted "Path relative to the project root."]
          (ui-input/input {:name "path"
                           :value value
                           :replicant/on-mount (fn [{:keys [replicant/node]}]
                                                 (.focus node)
                                                 (.select node))})
          (ui-dialog/actions
           (btn/button {:type "button" :class "ghost" :on {:click [:close-dialog]}} "Cancel")
           (btn/button {:variant :primary :class "primary" :type "submit"} "Create"))]

         :new-folder
         [:div
          [:h2.ui-dialog-title "New folder"]
          (ui-input/input {:name "path"
                           :value value
                           :replicant/on-mount (fn [{:keys [replicant/node]}]
                                                 (.focus node))})
          (ui-dialog/actions
           (btn/button {:type "button" :class "ghost" :on {:click [:close-dialog]}} "Cancel")
           (btn/button {:variant :primary :class "primary" :type "submit"} "Create"))]

         :new-project
         [:div
          [:h2.ui-dialog-title "New project"]
          [:p.muted "A fresh ClojureScript project stored in this browser."]
          (ui-input/input {:name "name"
                           :placeholder "amber-counter"
                           :value value
                           :replicant/on-mount (fn [{:keys [replicant/node]}]
                                                 (.focus node))})
          (ui-dialog/actions
           (btn/button {:type "button" :class "ghost" :on {:click [:close-dialog]}} "Cancel")
           (btn/button {:variant :primary :class "primary" :type "submit"} "Create"))]

         :rename
         [:div
          [:h2.ui-dialog-title "Rename"]
          (ui-input/input {:name "path"
                           :value value
                           :replicant/on-mount (fn [{:keys [replicant/node]}]
                                                 (.focus node)
                                                 (.select node))})
          (ui-dialog/actions
           (btn/button {:type "button" :class "ghost" :on {:click [:close-dialog]}} "Cancel")
           (btn/button {:variant :primary :class "primary" :type "submit"} "Rename"))]

         :delete
         [:div
          [:h2.ui-dialog-title "Delete"]
          [:p "Delete " [:code path] "? This cannot be undone."]
          (ui-dialog/actions
           (btn/button {:type "button" :class "ghost" :on {:click [:close-dialog]}} "Cancel")
           (btn/button {:variant :danger :class "danger" :type "submit"} "Delete"))]

         :delete-project
         [:div
          [:h2.ui-dialog-title "Delete project"]
          [:p "Delete " [:code (:name d)] " from this browser? The files are gone for good."]
          (when (:last? d)
            [:p.muted "This is the only project, so a new lamp will take its place."])
          (ui-dialog/actions
           (btn/button {:type "button" :class "ghost" :on {:click [:close-dialog]}} "Cancel")
           (btn/button {:variant :danger :class "danger" :type "submit"
                        :replicant/on-mount (fn [{:keys [replicant/node]}]
                                              (.focus node))}
                       "Delete project"))])]))))

(defn repl-pane [{:keys [repl]}]
  [:section.repl {:replicant/key "repl-pane"}
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
        [:div {:replicant/key id :class ["repl-line" (str "is-" (name kind))]}
         [:span.gutter (case kind :in "›" :err "!" "=")]
         [:pre text]])
      [:p.muted.empty "Enter evaluates. Shift-Enter adds a line. Results come from the live preview, so (bump) will move the lamp."])]
   [:form.repl-input
    {:replicant/key "repl-form"
     :on {:submit [:submit-repl]}}
    [:span.gutter "›"]
    [:textarea {:name "expr"
                :rows 1
                :placeholder "(bump)"
                :autocomplete "off"
                :autocorrect "off"
                :autocapitalize "off"
                :spellcheck "false"
                :aria-label "REPL expression"
                :replicant/key "repl-expr"
                :replicant/on-mount repl-expr-mount
                :on {:input [:repl-expr-input]
                     :keydown [:repl-expr-keydown]}}]]])

(defn preview-pane [{:keys [preview layout]}]
  (let [w (or (:preview-width layout) 360)]
    [:section.preview
     {:style {:width (str w "px")
              :flex-basis (str w "px")}}
     [:header.pane-head
      [:button.icon-btn.pane-hide
       {:on {:click [:toggle-preview-pane]}
        :title "Hide preview"
        :aria-label "Hide preview"}
       (icons/panel-right)]
      [:span "Preview"]
      (when (= :loading (:status preview))
        [:span.muted "loading"])
      (when (:error preview)
        [:span.preview-error {:title (:error preview)} "error"])
      [:label.live
       [:input {:type "checkbox"
                :checked (boolean (:live? preview))
                :on {:change [:toggle-live]}}]
       "Live"]]
   [:div.preview-frame
    (when-let [err (:error preview)]
      [:div.preview-banner
       [:p "The lamp did not start."]
       [:pre err]])
    [:iframe {:src "/preview.html"
              :sandbox "allow-scripts"
              :title "Live application preview"
              :replicant/key "preview-frame"
              :replicant/on-mount preview-mount}]]]))

(defn editor-pane [state]
  [:section.editor
   [:header.pane-head
    [:span.file-path (or (:active-file state) "No file open")]
    (when (and (:active-file state) (dirty? state (:active-file state)))
      [:span.pill "saving"])]
   (if (:active-file state)
     [:div.editor-host
      {:replicant/key "editor-host"
       :replicant/on-mount editor-mount
       :replicant/on-unmount editor-unmount}]
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
      [:label.project-picker
       [:span.sr-only "Project"]
       [:select {:id "project-select"
                 :on {:change [:switch-project]}
                 :value (:project state)}
        (for [name (:projects state)]
          [:option {:value name :replicant/key name} name])]])]
   [:nav.actions
    (when (= :browser (:mode state))
      [:button.ghost {:on {:click [:new-project-dialog]}} "New project"])
    (when (= :browser (:mode state))
      [:button.icon-btn.delete-project
       {:on {:click [:delete-project-dialog]}
        :title "Delete project"
        :aria-label "Delete project"}
       (icons/trash)])
    [:button.ghost {:on {:click [:export]}} (icons/download) "Export ZIP"]
    [:button.primary {:on {:click [:run]}} (icons/play) "Run"]
    [:button.icon-btn {:on {:click [:toggle-help]} :title "Help"}
     (icons/help)]]])

(defn sidebar [state]
  (let [w (or (get-in state [:layout :files-width]) 220)]
    [:aside.sidebar
     {:style {:width (str w "px")
              :flex-basis (str w "px")}}
     [:header.pane-head
      [:span "Files"]
      [:div.tree-tools
       [:button.tiny {:on {:click [:new-file-dialog]}} "File"]
       [:button.tiny {:on {:click [:new-folder-dialog]}} "Folder"]
       [:button.tiny {:on {:click [:add-ui-dialog]}} "UI"]
       [:button.icon-btn.pane-hide
        {:on {:click [:toggle-files]}
         :title "Hide files"
         :aria-label "Hide files"}
        (icons/panel-left)]]]
     (file-tree state)]))

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

(defn- pane-rail [side]
  (let [files? (= side :files)]
    [:button.pane-rail
     {:class (if files? "pane-rail-files" "pane-rail-preview")
      :title (if files? "Show files" "Show preview")
      :aria-label (if files? "Show files" "Show preview")
      :on {:click (if files? [:toggle-files] [:toggle-preview-pane])}}
     (if files? (icons/panel-left) (icons/panel-right))]))

(defn- splitter [pane]
  (let [files? (= pane :files)]
    [:div.splitter
     {:replicant/key (if files? "split-files" "split-preview")
      :class (if files? "splitter-files" "splitter-preview")
      :role "separator"
      :aria-orientation "vertical"
      :aria-label (if files? "Resize files" "Resize preview")
      :title "Drag to resize. Double-click resets the width."
      :on {:pointerdown (if files? [:resize-files] [:resize-preview])
           :dblclick (if files? [:reset-files-width] [:reset-preview-width])}}]))

(defn workspace [state]
  (let [{:keys [files-open? preview-open? dragging?]} (:layout state)]
    [:div.shell {:class (str "tab-" (name (:mobile-tab state)))}
     [:div.workspace
      (header state)
      [:div.stage
       {:class [(when-not files-open? "is-files-closed")
                (when-not preview-open? "is-preview-closed")
                (when dragging? "is-dragging")]}
       (when-not files-open? (pane-rail :files))
       (sidebar state)
       (splitter :files)
       [:div.main
        (editor-pane state)
        (repl-pane state)]
       (splitter :preview)
       (preview-pane state)
       (when-not preview-open? (pane-rail :preview))]
      (mobile-tabs state)]
     (when (:help? state) (help-panel))
     (when (:dialog state)
       (dialog state))
     (notice state)]))

(defn view [state]
  (case (:fs-status state)
    :loading (loading-screen)
    :error (error-screen state)
    (workspace state)))
