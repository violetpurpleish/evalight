(ns ui.popover
  (:require [ui.core :as ui]))

(defn popover
  "Anchor a panel to a trigger. The parent owns :open?. :on-close runs
  on outside clicks or Escape. Outside clicks still reach their target.
  :align is :start (default) or :end. :class styles the wrapper;
  :panel-attrs customizes the panel, including lifecycle and key handlers."
  [{:keys [open? on-close align class panel-attrs] :or {align :start}} trigger content]
  [:div.ui-popover {:class class}
   trigger
   (when (and open? on-close)
     [:button.ui-popover-dismiss
      (merge (ui/outside-dismiss-attrs ".ui-popover-panel" ":scope > button:not(.ui-popover-dismiss)")
             {:type "button" :hidden true :tabindex -1 :on {:click on-close}})])
   (when open?
     [:div
      (ui/attrs {:class ["ui-popover-panel" (str "is-" (name align))]
                 :role "dialog"}
                panel-attrs [])
      content])])
