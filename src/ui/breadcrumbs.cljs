(ns ui.breadcrumbs
  (:require [ui.core :as ui]))

(defn breadcrumbs
  "A path of buttons with an optional menu under one of them.
  Parent owns :open-id and :menu. :items is [{:id :label :current?}].
  :menu is [{:id :label :current?}]. :on-open, :on-pick, and :on-dismiss
  are Replicant handlers (vector or fn). The kit appends the item id
  to :on-open and :on-pick."
  [{:keys [items open-id menu on-open on-pick on-dismiss]}]
  (let [items (vec items)
        n (count items)]
    (into
     (cond-> [:nav.ui-crumbs {:aria-label "Breadcrumb"
                              :class (when open-id "is-open")}]
       (and open-id on-dismiss)
       (conj [:div.ui-crumbs-dismiss {:on {:click on-dismiss}}]))
     (if (zero? n)
       [[:span.ui-crumb-empty "No file open"]]
       (mapv
        (fn [i {:keys [id label current?]}]
          (let [open? (= id open-id)]
            [:span.ui-crumb-wrap
             {:replicant/key (str id)}
             (when (pos? i)
               [:span.ui-crumb-sep "/"])
             [:button.ui-crumb
              {:type "button"
               :aria-current (when current? "page")
               :aria-expanded (boolean open?)
               :aria-haspopup (when on-open "menu")
               :class (ui/cx (when current? "is-current")
                             (when open? "is-open"))
               :on {:click (ui/emit on-open id)}}
              label]
             (when (and open? (seq menu))
               [:div.ui-crumb-menu
                {:role "menu"
                 :on {:click ui/stop}}
                (for [m menu]
                  [:button.ui-crumb-option
                   {:type "button"
                    :role "menuitem"
                    :replicant/key (str (:id m))
                    :class (when (:current? m) "is-current")
                    :on {:click (ui/emit on-pick (:id m))}}
                   (:label m)])])]))
        (range n)
        items)))))
