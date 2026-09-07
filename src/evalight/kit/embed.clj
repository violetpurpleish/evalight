(ns evalight.kit.embed
  "Compile-time slurp of src/ui and public/css/ui.css so the browser
  playground can copy those files into a project without a filesystem."
  (:require [clojure.string :as str]
            [shadow.resource :as resource]))

(def paths
  ["src/ui/core.cljs"
   "src/ui/button.cljs"
   "src/ui/input.cljs"
   "src/ui/field.cljs"
   "src/ui/select.cljs"
   "src/ui/dialog.cljs"
   "src/ui/popover.cljs"
   "src/ui/split.cljs"
   "src/ui/breadcrumbs.cljs"
   "src/ui/command.cljs"
   "src/ui/tooltip.cljs"
   "src/ui/dropdown.cljs"
   "src/ui/tabs.cljs"
   "src/ui/toast.cljs"
   "src/ui/checkbox.cljs"
   "src/ui/switch.cljs"
   "src/ui/disclosure.cljs"
   "public/css/ui.css"])

(defmacro files
  []
  (into {}
        (for [p paths]
          [p (resource/slurp-resource &env (str/replace p #"^(src/|public/css/)" ""))])))

(defmacro gallery-source []
  (resource/slurp-resource &env "evalight/templates/gallery.cljs"))
