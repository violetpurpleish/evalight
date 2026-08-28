(ns ui.dialog
  (:require [ui.core :as ui]))

(defn dialog
  "Modal overlay. Omit :open? (or pass true) to show it. :on-close is
  a Replicant handler, either a function or an action vector. The
  panel stops clicks so a click on the dimmed page can close it."
  [{:keys [open? on-close title] :as props} & children]
  (when (or (not (contains? props :open?)) open?)
    [:div.ui-overlay
     (cond-> {:role "presentation"}
       on-close (assoc :on {:click on-close}))
     (into
      [:div.ui-dialog
       {:role "dialog"
        :aria-modal "true"
        :on {:click ui/stop}}
       (when title [:h2.ui-dialog-title title])]
      children)]))

(defn actions
  "Right-aligned row for Cancel / OK."
  [& children]
  (into [:div.ui-dialog-actions] children))
