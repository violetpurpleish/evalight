(ns ui.button
  (:require [ui.core :as ui]))

(defn button
  "A button. :variant is :primary, :ghost (default), :danger, or :icon.
  :size is :sm or :lg. All other keys are DOM attributes, including :on."
  [props & children]
  (let [variant (or (:variant props) :ghost)
        size (:size props)]
    (into [:button
           (ui/attrs
            {:type (or (:type props) "button")
             :class ["ui-btn"
                     (str "ui-btn-" (name variant))
                     (when size (str "ui-btn-" (name size)))]}
            props
            [:variant :size])]
          children)))
