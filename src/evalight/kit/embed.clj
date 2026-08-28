(ns evalight.kit.embed
  "Compile-time slurp of src/ui and public/css/ui.css so the browser
  playground can copy those files into a project without a filesystem."
  (:require [clojure.java.io :as io]))

(def paths
  ["src/ui/core.cljs"
   "src/ui/button.cljs"
   "src/ui/input.cljs"
   "src/ui/field.cljs"
   "src/ui/select.cljs"
   "src/ui/dialog.cljs"
   "src/ui/popover.cljs"
   "src/ui/split.cljs"
   "public/css/ui.css"])

(defmacro files
  []
  (into {}
        (for [p paths]
          [p (slurp (io/file p))])))
