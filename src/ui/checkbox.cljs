(ns ui.checkbox
  (:require [ui.core :as ui]))

(defn control
  "Shared native checkbox primitive for checkbox and switch."
  [kind {:keys [label checked? on-change input-attrs class] :as props}]
  [:label {:class (ui/cx "ui-check" (when (= kind :switch) "ui-switch") class)}
   [:input (ui/attrs
            {:type "checkbox" :role (when (= kind :switch) "switch")
             :checked (boolean checked?)
             :on {:change (ui/wrapped (fn [e]
                            (ui/run e (ui/emit on-change (.. (ui/dom-event e) -target -checked)))))}}
            (merge (dissoc props :class) input-attrs)
            [:label :checked? :on-change :input-attrs])]
   (when label [:span label])])

(defn checkbox
  "Native checkbox with a clickable :label, controlled :checked? and
  :on-change receiving a boolean. Supports :disabled, :name, :id,
  :required and other input attributes; :class styles the label."
  [props]
  (control :checkbox props))
