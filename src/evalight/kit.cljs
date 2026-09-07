(ns evalight.kit
  "Registry of Replicant controls copied into a project as source.
  Same idea as shadcn/ui: nothing to install, the files are yours."
  (:require [cljs.reader :as reader]
            [clojure.string :as str])
  (:require-macros [evalight.kit.embed :as embed]))

(def sources
  "path -> file text, baked in at compile time."
  (embed/files))

(def catalog
  [{:id "button"
    :title "Button"
    :path "src/ui/button.cljs"
    :needs ["core"]
    :blurb "Primary, ghost, danger, and icon buttons."}
   {:id "input"
    :title "Input"
    :path "src/ui/input.cljs"
    :needs ["core"]
    :blurb "Text field and textarea."}
   {:id "field"
    :title "Field"
    :path "src/ui/field.cljs"
    :needs ["input"]
    :blurb "Label, control, and hint stacked as a form row."}
   {:id "select"
    :title "Select"
    :path "src/ui/select.cljs"
    :needs ["core"]
    :blurb "A styled native select."}
   {:id "dialog"
    :title "Dialog"
    :path "src/ui/dialog.cljs"
    :needs ["core"]
    :blurb "Modal overlay. Pass :on-close and own :open?."}
   {:id "popover"
    :title "Popover"
    :path "src/ui/popover.cljs"
    :needs ["core"]
    :blurb "A panel anchored to a trigger."}
   {:id "split"
    :title "Split"
    :path "src/ui/split.cljs"
    :needs ["core"]
    :blurb "Two panes and a drag handle. Parent owns :ratio."}
   {:id "breadcrumbs"
    :title "Breadcrumbs"
    :path "src/ui/breadcrumbs.cljs"
    :needs ["core"]
    :blurb "A path of buttons. Click a segment to open a sibling menu."}
   {:id "command"
    :title "Command"
    :path "src/ui/command.cljs"
    :needs ["input"]
    :blurb "A filtered list. Overlay for a command palette, panel for a menu."}
   {:id "tooltip" :title "Tooltip" :path "src/ui/tooltip.cljs"
    :needs ["core"] :blurb "Hover and keyboard labels, positioned within the viewport."}
   {:id "dropdown" :title "Dropdown menu" :path "src/ui/dropdown.cljs"
    :needs ["popover"] :blurb "Keyboard menu with disabled items, separators, and danger actions."}
   {:id "tabs" :title "Tabs" :path "src/ui/tabs.cljs"
    :needs ["core"] :blurb "Accessible tab lists with persistent panels."}
   {:id "toast" :title "Toast" :path "src/ui/toast.cljs"
    :needs ["core"] :blurb "Timed notices with pause, dismiss, and optional actions."}
   {:id "checkbox" :title "Checkbox" :path "src/ui/checkbox.cljs"
    :needs ["core"] :blurb "Native checkbox with a clickable label and boolean value."}
   {:id "switch" :title "Switch" :path "src/ui/switch.cljs"
    :needs ["checkbox"] :blurb "Accessible on/off switch backed by a native input."}
   {:id "disclosure" :title "Disclosure" :path "src/ui/disclosure.cljs"
    :needs ["core"] :blurb "Native expandable sections and controlled accordions."}
   {:id "tree" :title "Tree" :path "src/ui/tree.cljs"
    :needs ["core"] :blurb "Controlled file trees with expandable folders and optional row actions."}])

(def ^:private internals
  {"core" {:id "core" :path "src/ui/core.cljs" :needs []}
   "css" {:id "css" :path "public/css/ui.css" :needs []}})

(defn by-id [id]
  (or (some #(when (= id (:id %)) %) catalog)
      (get internals (str id))))

(defn- needed
  [id seen]
  (if (contains? seen id)
    []
    (let [item (by-id id)
          seen (conj seen id)
          deps (mapcat #(needed % seen) (:needs item))]
      (cond-> (vec deps)
        item (conj item)))))

(defn files-for
  "Source files for `id` plus dependencies, css last if missing from the list."
  [id]
  (let [items (needed (str id) #{})
        with-css (if (some #(= "public/css/ui.css" (:path %)) items)
                   items
                   (conj (vec items) (internals "css")))]
    (mapv (fn [item]
            {:path (:path item)
             :content (get sources (:path item))})
          (filter #(get sources (:path %)) with-css))))

(defn own-file
  "The catalog file for `id`, without dependencies."
  [id]
  (when-let [item (by-id (str id))]
    (when-let [content (get sources (:path item))]
      {:path (:path item)
       :content content
       :title (:title item)
       :id (:id item)})))

(defn present-ids
  "Catalog ids whose own file is in `paths`."
  [paths]
  (let [paths (set paths)]
    (into #{}
          (keep (fn [{:keys [id path]}]
                  (when (contains? paths path) id))
                catalog))))

(defn css-hrefs [edn-text]
  (let [paths (or (when (seq edn-text)
                    (try
                      (get-in (reader/read-string edn-text) [:preview :css])
                      (catch :default _ nil)))
                  [])]
    (vec paths)))

(defn with-ui-css
  "Ensure public/css/ui.css is listed before the app stylesheet."
  [edn-text]
  (let [form (try (reader/read-string (or edn-text "{}"))
                  (catch :default _ {:main 'app.core}))
        css (or (get-in form [:preview :css]) ["public/style.css"])
        css (if (some #{"public/css/ui.css"} css)
              css
              (into ["public/css/ui.css"] css))]
    (str "{:name " (pr-str (or (:name form) "lamp")) "\n"
         " :main " (pr-str (or (:main form) 'app.core)) "\n"
         " :src-paths [\"src\"]\n"
         " :preview {:css [" (str/join " " (map pr-str css)) "]}}\n")))

(def facade-path "src/ui/api.cljs")
(def facade-header ";; Generated by Evalight. Add/remove controls through Add UI or the file tree.")

(def facade-exports
  {"button" [["button" "button"]]
   "input" [["input" "input"] ["textarea" "textarea"]]
   "field" [["field" "field"]]
   "select" [["select" "select"]]
   "dialog" [["dialog" "dialog"] ["dialog-actions" "actions"]]
   "popover" [["popover" "popover"]]
   "split" [["split" "split"] ["split-handle" "handle"]]
   "breadcrumbs" [["breadcrumbs" "breadcrumbs"]]
   "command" [["command" "command"]]
   "tooltip" [["tooltip" "tooltip"] ["install-tooltips!" "install!"]]
   "dropdown" [["dropdown" "dropdown"]]
   "tabs" [["tabs" "tabs"] ["tab-list" "tab-list"]]
   "toast" [["toast" "toast"]]
   "checkbox" [["checkbox" "checkbox"]]
   "switch" [["switch" "switch"]]
   "disclosure" [["disclosure" "disclosure"] ["accordion" "accordion"]]
   "tree" [["tree" "tree"]]})

(defn facade-source
  "Re-export only components whose source and dependencies are installed."
  [paths]
  (let [paths (set paths)
        available? (fn available? [id]
                     (when-let [item (by-id id)]
                       (and (contains? paths (:path item))
                            (every? available? (:needs item)))))
        ids (filter available? (map :id catalog))
        core? (contains? paths "src/ui/core.cljs")]
    (str facade-header "\n"
         ";; Put custom code in another namespace; remove this header to manage exports yourself.\n"
         (if core? "(ns ui.api\n  (:require [ui.core :as core]" "(ns ui.api")
         (apply str (for [id ids] (str "\n            [ui." id " :as " id "]")))
         (if core? "))\n\n" ")\n\n")
         (apply str (for [helper (when core? ["cx" "dom-event" "stop" "run" "emit" "attrs" "wrapped"])]
                      (str "(def " helper " core/" helper ")\n")))
         (apply str (for [id ids [public local] (get facade-exports id)]
                      (str "(def " public " " id "/" local ")\n"))))))
