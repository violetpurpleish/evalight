(ns ui.popover
  (:require [ui.core :as ui]))

(defn popover
  "Anchor a panel to a trigger. The parent owns :open?. :on-close, if
  given, runs when the page around the panel is clicked. :align is
  :start (default) or :end."
  [{:keys [open? on-close align] :or {align :start}} trigger content]
  [:div.ui-popover
   trigger
   (when (and open? on-close)
     [:div.ui-popover-dismiss {:on {:click on-close}}])
   (when open?
     [:div.ui-popover-panel
      {:class (str "is-" (name align))
       :role "dialog"
       :on {:click ui/stop}}
      content])])
