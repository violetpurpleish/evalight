(ns ui.select
  (:require [ui.core :as ui]))

(defn select
  "A native <select>, styled. Children are [:option ...] hiccup."
  [props & children]
  (into [:select
         (ui/attrs {:class ["ui-select"]} props [])]
        children))
