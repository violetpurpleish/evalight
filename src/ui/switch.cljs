(ns ui.switch
  (:require [ui.checkbox :as checkbox]))

(defn switch
  "On/off switch using a native checkbox. Same props as ui.checkbox/checkbox;
  :checked?, :on-change (boolean), :label and :disabled."
  [props]
  (checkbox/control :switch props))
