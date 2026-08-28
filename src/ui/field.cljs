(ns ui.field)

(defn field
  "Label + control + optional hint. `control` is hiccup from ui.input
  or ui.select. :error, when set, replaces :hint and marks the row."
  [{:keys [label hint error]} control]
  [:label.ui-field
   (when label [:span.ui-field-label label])
   control
   (when (or error hint)
     [:span.ui-field-hint {:class (when error "is-error")}
      (or error hint)])])
