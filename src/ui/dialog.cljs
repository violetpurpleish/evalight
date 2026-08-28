(ns ui.dialog)

(defn dialog
  "Modal overlay. Omit :open? (or pass true) to show it. :on-close is
  a Replicant handler, either a function or an action vector. The
  dimmed backdrop is a sibling behind the panel, so clicks on Cancel
  never have to stopPropagation to reach the button."
  [{:keys [open? on-close title] :as props} & children]
  (when (or (not (contains? props :open?)) open?)
    [:div.ui-overlay {:role "presentation"}
     (when on-close
       [:div.ui-backdrop {:on {:click on-close}}])
     (into
      [:div.ui-dialog
       {:role "dialog"
        :aria-modal "true"}
       (when title [:h2.ui-dialog-title title])]
      children)]))

(defn actions
  "Right-aligned row for Cancel / OK."
  [& children]
  (into [:div.ui-dialog-actions] children))
