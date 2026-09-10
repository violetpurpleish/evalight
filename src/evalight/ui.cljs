(ns evalight.ui
  (:require [evalight.actions :as actions]
            [evalight.editor :as editor]
            [evalight.icons :as icons]
            [evalight.kit :as kit]
            [evalight.paths :as paths]
            [evalight.preview :as preview]
            [evalight.project-picker :as project-picker]
            [evalight.state :as state]
            [evalight.commands :as commands]
            [evalight.crumbs :as crumbs]
            [evalight.history :as history]
            [ui.breadcrumbs :as ui-crumbs]
            [ui.button :as btn]
            [ui.command :as ui-command]
            [ui.dialog :as ui-dialog]
            [ui.input :as ui-input]
            [ui.popover :as popover]
            [ui.dropdown :as dropdown]
            [ui.tabs :as tabs]
            [ui.split :as split]
            [ui.switch :as switch]
            [ui.toast :as toast]
            [ui.tree :as tree]))

(defn- dirty? [state path]
  (contains? (:dirty state) path))

(defn- editor-mount [{:keys [replicant/node]}]
  (editor/create! node)
  (when-let [path (:active-file @state/app)]
    (actions/open-file! path)))

(defn- editor-unmount [_]
  (editor/save-current-state!)
  (editor/destroy!))

(defn- preview-mount [{:keys [replicant/node]}]
  (preview/attach! node actions/on-preview-event))

(defn- tree-icon [node]
  (if (= :dir (:type node))
    (icons/folder)
    (icons/file)))

(defn- tree-trailing [state node]
  (when (and (= :file (:type node))
             (dirty? state (:path node)))
    [:span.dot {:title "Unsaved changes"}]))

(defn- tree-actions [node]
  (let [path (:path node)]
    (if (= :dir (:type node))
      [:button.tiny {:on {:click [:delete-dialog path]} :title "Delete" :aria-label "Delete"}
       (icons/trash)]
      [[:button.tiny {:on {:click [:rename-dialog path]} :title "Rename" :aria-label "Rename"}
        (icons/pencil)]
       [:button.tiny {:on {:click [:delete-dialog path]} :title "Delete" :aria-label "Delete"}
        (icons/trash)]])))

(defn file-tree [state]
  (tree/tree
   {:nodes (:tree state)
    :expanded (:expanded state)
    :selected (:active-file state)
    :on-toggle [:toggle-dir]
    :on-select [:open-file]
    :render-icon tree-icon
    :render-trailing #(tree-trailing state %)
    :render-actions tree-actions
    :empty "This project has no files yet."}))

(defn- shortcut [keys label]
  [:li
   [:span.keys
    (map (fn [k] [:kbd {:replicant/key k} k]) keys)]
   [:span label]])

(defn help-panel [state]
  [:aside.help {:replicant/key :help-panel}
   [:header.help-head [:h2 "Living with the program"]]
   [:div.help-body
    [:p (case (:runtime state)
          :gpui "Evalight is editing a clj-gpui app. Ctrl-Enter talks to the JVM nREPL. The native window is the running program."
          :clj "Evalight is editing JVM Clojure. Ctrl-Enter talks to nREPL. There is no preview pane: this project has no window to show."
          "Evalight is a small ClojureScript workshop. The preview is the running program. Evaluating a form talks to that program, not a separate compiler.")]
    [:section.help-shortcuts {:aria-labelledby "help-shortcuts-title"}
     [:h3#help-shortcuts-title "Keyboard shortcuts"]
     [:ul.shortcuts
     (shortcut ["Tab"] "Indent this line, or accept a completion when the list is showing")
     (shortcut ["Shift" "Tab"] "Dedent. Parinfer moves the parentheses.")
     (shortcut ["Enter"] "New line in the editor. Evaluate in the REPL.")
     (shortcut ["Ctrl" "Enter"] "Evaluate the form at the cursor")
     (shortcut ["Ctrl" "K"] "Command palette")]]
    [:p.muted "In the REPL, Shift-Enter inserts a new line. Indent is what you edit; parentheses follow."]
    [:p.muted "Hover a symbol in the editor for its docstring. Completions appear as you type, from the running image."]
    (when (contains? #{:sci :compiled} (or (:runtime state) :sci))
      [:p.muted "src/ui is a small Replicant kit copied into the project. Add UI in the toolbar puts a control back if you deleted it. Restore writes the original kit file over one you edited."])
    [:p.muted "Deletes, renames, and kit restores are listed under History in the toolbar so you can put them back. Code edits still use Ctrl-Z in the editor."]
    (if (= :local (:mode state))
      (cond
        (= :gpui (:runtime state))
        [:p.muted "These files are on disk. Evalight started `clj -M:dev` (or attached to it). The GPUI window is the preview. A browser iframe cannot host that window; if the image interned gpui.runtime/preview-png, this pane can show a snapshot. Live stays off because the clj-gpui watcher already reloads on save."]
        (= :clj (:runtime state))
        [:p.muted "These files are on disk. Ctrl-Enter talks to a JVM nREPL. Preview stays hidden unless this is a clj-gpui app. You need a JDK and the Clojure CLI. SCI is only used on the hosted ClojureScript playground."]
        (:attached state)
        [:p.muted "Attached to a shadow-cljs watch you already started (`bun run evalight --attach`). Preview is that app. Evalight will not start or stop the compiler, and Live stays off so it does not fight shadow autoload."]
        :else
        [:p.muted "These files are on disk. Preview is the compiled app (shadow-cljs watch), the same heap Ctrl-Enter talks to. You need Bun, a JDK, and `bun install` once. SCI is only used on the hosted playground. Live reloads that preview after you save; off keeps the current page. `bun run evalight --attach` joins a watch you already started instead of starting one."])
      [:p.muted "Projects live in this browser and run in SCI. Export ZIP downloads them plus Evalight. Unzip and `bun run evalight` to compile for real and keep this workshop. JVM Clojure and clj-gpui need local mode on a real directory."])
    [:p.muted
     [:a.help-licenses {:href "https://github.com/violetpurpleish/evalight" :target "_blank" :rel "noopener noreferrer"}
       "Evalight on Github"]]
    [:p.muted
     [:a.help-licenses {:href "/licenses.html" :target "_blank" :rel "noopener noreferrer"}
      "Open Source Licenses"]]]])

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
                           :placeholder "Project name"
                           :value (or value "")
                           :replicant/on-mount (fn [{:keys [replicant/node]}]
                                                 (.focus node)
                                                 (.select node))})
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
          [:p "Delete " [:code path] "? You can put it back from History."]
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

(defn- pane-head [start end]
  [:header.pane-head
   (into [:div.pane-start] (remove nil? start))
   (into [:div.pane-end] (remove nil? end))])

(defn repl-pane [{:keys [repl runtime]}]
  [:section.repl {:replicant/key "repl-pane"}
     (pane-head
      [[:span "REPL"]
       [:span.ns (:ns repl)]]
      [[:button.ghost.small {:on {:click [:clear-repl]}} "Clear"]])
   [:div.repl-log
    {:replicant/on-render
     (fn [{:keys [replicant/node]}]
       (set! (.-scrollTop node) (.-scrollHeight node)))}
    (if (seq (:entries repl))
      (for [{:keys [id kind text]} (:entries repl)]
        [:div {:replicant/key id :class ["repl-line" (str "is-" (name kind))]}
         [:span.gutter (case kind :in "›" :err "!" "=")]
         [:pre text]])
      [:p.muted.empty (if (contains? #{:clj :gpui} runtime)
                        "Enter evaluates. Shift-Enter adds a line. Results come from the JVM nREPL."
                        "Enter evaluates. Shift-Enter adds a line. Results come from the live preview, so (bump) will move the lamp.")])]
   [:form.repl-input
    {:replicant/key "repl-form"
     :on {:submit [:submit-repl]}}
    [:span.gutter "›"]
    [:textarea {:name "expr"
                :rows 1
                :placeholder (if (contains? #{:clj :gpui} runtime) "(+ 1 1)" "(bump)")
                :autocomplete "off"
                :autocorrect "off"
                :autocapitalize "off"
                :spellcheck "false"
                :aria-label "REPL expression"
                :replicant/key "repl-expr"
                :on {:keydown [:repl-expr-keydown]}}]]])

(defn- native-preview-body [state]
  (let [{:keys [preview preview-frame nrepl-port app-var attached attach-label]} state]
    [:div.preview-native
     [:p.eyebrow "Native GPUI"]
     [:h2 (or app-var "GPUI window")]
     [:p.lede "The running program is the native window. It cannot live inside this browser pane. Leave that window open; Ctrl-Enter still talks to it over nREPL."]
     (when-let [err (:error preview)]
       [:pre.preview-native-error err])
     (if preview-frame
       [:img.preview-capture {:src preview-frame :alt "GPUI window"}]
       [:div.preview-native-window
        {:aria-hidden "true"}
        [:span.preview-native-chrome]])
     [:dl.preview-native-meta
      [:div [:dt "nREPL"] [:dd (str (or nrepl-port "—"))]]
      (when attached
        [:div [:dt "Attach"] [:dd (or attach-label "yes")]])]]))

(defn preview-pane [state]
  (let [{:keys [preview layout runtime preview-url attached attach-label]} state
        compiled? (= :compiled runtime)
        gpui? (or (= :gpui runtime) (= :native (:preview-kind state)))
        attached? (boolean attached)
        live-off? (or attached? gpui?)
        w (or (:preview-width layout) 360)
        src (if compiled? (or preview-url "about:blank") "/preview.html")]
    [:section.preview
     {:style {:width (str w "px")
              :flex-basis (str w "px")}}
     (pane-head
      [[:button.icon-btn.pane-hide
        {:on {:click [:toggle-preview-pane]}
         :title "Hide preview"
         :aria-label "Hide preview"}
        (icons/panel-right)]
       [:span (cond
                attached? (or attach-label "Attached")
                gpui? "Preview · GPUI"
                compiled? "Preview · compiled"
                :else "Preview")]
       (when (= :loading (:status preview))
         [:span.muted "loading"])
       (when (:error preview)
         [:span.preview-error {:title (:error preview)} "error"])]
      (when-not gpui?
        [(switch/switch
          {:class "live" :label "Live"
           :title (cond
                    attached? "shadow-cljs autoload reloads this app. Evalight Live stays off while attached."
                    compiled? "Reload Preview after you save. Off keeps this page until you reload it."
                    :else "Reload the SCI preview as you type.")
           :checked? (boolean (:live? preview)) :disabled live-off?
           :on-change [:toggle-live]})]))

     (if gpui?
       (native-preview-body state)
       [:div.preview-frame
        (when-let [err (:error preview)]
          [:div.preview-banner
           [:p "The preview did not start."]
           [:pre err]])
        [:iframe (cond-> {:src src
                          :title "Live application preview"
                          :replicant/key (if compiled? "preview-compiled" "preview-sci")
                          :replicant/on-mount preview-mount}
                   (not compiled?) (assoc :sandbox "allow-scripts"))]])]))

(defn- editor-crumbs [state]
  (let [path (:active-file state)
        pick (:pick state)
        trail (crumbs/from-path path)
        open-id (when (= :crumb (:via pick)) (:anchor pick))]
    [:div.file-path
     (ui-crumbs/breadcrumbs
      {:items trail
       :open-id open-id
       :menu (or (commands/crumb-menu state) [])
       :on-open [:crumb-open]
       :on-pick [:crumb-pick]
       :on-dismiss [:pick-close]})]))

(defn editor-pane [state]
  (let [path (:active-file state)
        media (:media state)]
    [:section.editor
     (pane-head
      [(editor-crumbs state)]
      [(when (and path (dirty? state path))
         [:span.pill "saving"])
       (when path
         [:button.icon-btn.editor-tool
          {:type "button"
           :class (when (:word-wrap? state) "is-active")
           :aria-pressed (boolean (:word-wrap? state))
           :title (if (:word-wrap? state) "Disable word wrap" "Enable word wrap")
           :aria-label (if (:word-wrap? state) "Disable word wrap" "Enable word wrap")
           :on {:click [:toggle-word-wrap]}}
          (icons/wrap)])])
     (cond
       (nil? path)
       [:div.empty-editor
        [:p "Open a file from the tree, or create one."]
        [:button.primary {:on {:click [:new-file-dialog]}} "New file"]]

       (= :image (:kind media))
       [:div.media-host
        [:img.media-image {:src (:src media)
                           :alt (paths/basename path)}]]

       (= :binary (:kind media))
       [:div.media-host.media-binary
        [:p (str (paths/basename path) " is a binary file.")]
        [:p.muted "Evalight shows pictures here. Other binary files stay on disk."]]

       :else
       [:div.editor-host
        {:replicant/key "editor-host"
         :replicant/on-mount editor-mount
         :replicant/on-unmount editor-unmount}])]))

(defn- beta-badge [state]
  (let [open? (boolean (:beta? state))]
    [:div.beta-pop
     (popover/popover {:open? open? :on-close [:close-beta]}
       [:button.beta-badge
        {:type "button"
         :aria-expanded open?
         :aria-haspopup "dialog"
         :title "Why this is beta"
         :on {:click [:toggle-beta]}}
        "BETA"]
       [:div.beta-copy
        [:p "Evalight is fully working. It is a very new project, though, so it is not yet stable. Changes can be breaking."]
        (if (= :local (:mode state))
          [:p "This copy of Evalight lives with your files, so later changes on the website do not touch it."]
          [:p "Export your project. The zip freezes this version of Evalight with your files, so you can keep editing after the website changes."])])]))

(defn- history-panel [state]
  (let [open? (boolean (:history-open? state))
        entries (or (:history state) [])
        now (.now js/Date)
        n (count entries)]
    [:div.history-pop
     (popover/popover {:open? open? :align :end :on-close [:close-history]}
       [:button.icon-btn.toolbar-tool.history-btn
        {:type "button"
         :aria-expanded open?
         :aria-haspopup "dialog"
         :title "History"
         :aria-label "History"
         :on {:click [:toggle-history]}}
        (icons/undo)
        [:span.toolbar-label "History"]
        (when (pos? n)
          [:span.history-count (if (> n 9) "9+" (str n))])]
       [:div.history-copy
        [:header.history-head
         [:h2.history-title "History"]
         [:span.muted (if (pos? n) (str n) "empty")]]
        (if (seq entries)
          [:ul.history-list
           (for [{:keys [id label ts]} entries]
             [:li.history-item {:replicant/key id}
              [:div.history-text
               [:div.history-label label]
               [:div.history-age (history/age-label ts now)]]
              (btn/button {:size :sm
                           :title "Put this back"
                           :on {:click [:undo-entry id]}}
                "Undo")])]
          [:p.muted.empty-history "Deletes, renames, and kit restores land here so you can put them back. Code edits still use Ctrl-Z."])
        (when (seq entries)
          [:div.history-foot
           (btn/button {:size :sm
                        :title "Drop every snapshot for this project"
                        :on {:click [:clear-history]}}
             "Clear history")])])]))

(defn- project-actions [s]
  [:div.project-actions
   (dropdown/dropdown
    {:open? (:project-actions-open? s) :align :start :on-close [:close-project-actions]
     :label "Project actions" :heading "Project" :menu-class "project-action-list"
     :items [{:id :new :label "New project" :icon (icons/plus) :on-select [:new-project-dialog]}
             {:id :export :label "Export ZIP" :icon (icons/download) :on-select [:export]}
             {:separator? true}
             {:id :delete :label "Delete project" :icon (icons/trash) :danger? true
              :on-select [:delete-project-dialog]}]}
    [:button.icon-btn.project-actions-trigger
     {:type "button" :aria-label "Project actions" :title "Project actions"
      :aria-haspopup "menu" :aria-expanded (boolean (:project-actions-open? s))
      :on {:click [:toggle-project-actions]}}
     (icons/more)])])

(defn header [state]
  [:header.top
   [:div.brand
    (icons/lamp)
    [:div
     [:div.wordmark "Evalight"]
     [:p.tagline
      (if (= :local (:mode state))
        "Local files"
        "Browser workshop")]]
    (beta-badge state)]
   [:div.project-context
    [:div.project
     (if (= :local (:mode state))
      [:div.project-local
       [:span.project-name (:project state)]
       (when-let [tag (case (:runtime state)
                        :gpui "GPUI"
                        :clj "Clojure"
                        :compiled "ClojureScript"
                        nil)]
         [:span.runtime-tag tag])]
      (project-picker/view state))]
    (when (= :browser (:mode state))
      (project-actions state))]
   [:nav.actions {:aria-label "Workshop tools"}
    (when (preview/iframe-runtime?)
      [:div.toolbar-group
       [:button.ghost.add-ui-btn
        {:type "button" :on {:click [:add-ui-dialog]} :title "Add UI components"}
        (icons/components) "Add UI"]])
    [:div.toolbar-group.toolbar-utilities
     (history-panel state)
     [:button.icon-btn.toolbar-tool
      {:type "button" :on {:click [:pick-open {:via :palette}]}
       :title "Command palette (Ctrl+K)"
       :aria-label "Command palette"}
      (icons/search) [:span.toolbar-label "Commands"]]
     (popover/popover
      {:open? (:help? state) :align :end :on-close [:close-help]
       :panel-attrs {:class "help-popover-panel" :aria-label "Help"}}
      [:button.icon-btn.toolbar-tool
       {:type "button" :on {:click [:toggle-help]} :title "Help" :aria-label "Help"
        :aria-expanded (boolean (:help? state))}
       (icons/help) [:span.toolbar-label "Help"]]
      (help-panel state))]

    [:button.primary.run-btn
     {:type "button" :on {:click [:run]} :title "Run project"}
     (icons/play) "Run"]]])

(defn sidebar [state]
  (let [w (or (get-in state [:layout :files-width]) 220)]
    [:aside.sidebar
     {:style {:width (str w "px")
              :flex-basis (str w "px")}}
     (pane-head
      [[:span "Files"]]
      [[:div.tree-tools
        [:button.icon-btn.sidebar-add
         {:type "button" :on {:click [:new-file-dialog]}
          :title "New file" :aria-label "New file"}
         (icons/file-plus)]
        [:button.icon-btn.sidebar-add
         {:type "button" :on {:click [:new-folder-dialog]}
          :title "New folder" :aria-label "New folder"}
         (icons/folder-plus)]
        [:button.icon-btn.pane-hide
         {:on {:click [:toggle-files]}
          :title "Hide files"
          :aria-label "Hide files"}
         (icons/panel-left)]]])
     (file-tree state)]))

(defn mobile-tabs [state]
  (let [tabs (cond-> [[:files "Files"] [:editor "Edit"]]
               (preview/preview-pane?) (conj [:preview "Preview"])
               true (conj [:repl "REPL"]))]
    (tabs/tab-list {:class "mobile-tabs" :label "Workspace"
                    :items (mapv (fn [[id label]] {:id id :label label}) tabs)
                    :value (:mobile-tab state) :on-change [:mobile-tab]})))

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
    (toast/toast {:id (:id notice) :text (:text notice)
                  :kind (if (= :err (:kind notice)) :error :success)
                  :class ["toast" (name (:kind notice))] :duration 2800
                  :on-dismiss [:dismiss-notice (:id notice)]})))

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
    (split/handle
     (merge (actions/pane-resize-props pane)
            {:replicant/key (if files? "split-files" "split-preview")
             :class ["splitter" (if files? "splitter-files" "splitter-preview")]
             :aria-label (if files? "Resize files" "Resize preview")
             :title "Drag to resize. Double-click resets the width."
             :on {:dblclick (if files? [:reset-files-width] [:reset-preview-width])}}))))


(defn workspace [state]
  (let [{:keys [files-open? preview-open? dragging?]} (:layout state)
        show-preview? (preview/preview-pane?)]
    [:div.shell {:class (str "tab-" (name (:mobile-tab state)))}
     [:div.workspace
      (header state)
      (into
       [:div.stage
        {:class [(when-not files-open? "is-files-closed")
                 (when (or (not show-preview?) (not preview-open?)) "is-preview-closed")
                 (when dragging? "is-dragging")]}
        (when-not files-open? (pane-rail :files))
        (sidebar state)
        (splitter :files)
        [:div.main
         (editor-pane state)
         (repl-pane state)]]
       (when show-preview?
         [(splitter :preview)
          (preview-pane state)
          (when-not preview-open? (pane-rail :preview))]))
      (mobile-tabs state)]

     (when (= :palette (:via (:pick state)))
       (ui-command/command
        {:open? true
         :query (or (:query (:pick state)) "")
         :active (:active (:pick state))
         :items (commands/items state)
         :placeholder "Type a command or file…"
         :on-query [:pick-query]
         :on-active commands/set-active!
         :on-close [:pick-close]}))
     (when (:dialog state)
       (dialog state))
     (notice state)]))

(defn view [state]
  (case (:fs-status state)
    :loading (loading-screen)
    :error (error-screen state)
    (workspace state)))
