(ns ui.input
  (:require [ui.core :as ui]))

(defn input
  "A text field. Pass :type, :name, :value, :placeholder, :on, etc."
  [props]
  [:input
   (ui/attrs
    {:class ["ui-input"]
     :type (or (:type props) "text")}
    props
    [])])

(defn textarea
  "A multiline field. Rows default to 3."
  [props]
  [:textarea
   (ui/attrs
    {:class ["ui-textarea"]
     :rows (or (:rows props) 3)}
    props
    [])])
