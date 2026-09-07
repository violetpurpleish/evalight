(ns ui.disclosure
  (:require [ui.core :as ui]))

(defn disclosure
  "Native details/summary. :title is the trigger, children are content.
  Optional controlled :open? and :on-toggle (boolean); without them the
  browser owns expansion. :name enables a native exclusive details group."
  [{:keys [title open? on-toggle] :as props} & children]
  [:details
   (ui/attrs {:class "ui-disclosure"
              :open (boolean open?)
              :on {:toggle (ui/wrapped (fn [e]
                             (ui/run e (ui/emit on-toggle (.. (ui/dom-event e) -target -open)))))}}
             props [:title :open? :on-toggle])
   [:summary.ui-disclosure-title title]
   (into [:div.ui-disclosure-body] children)])

(defn accordion
  "Controlled disclosures. :value is a set of open ids. :multiple? allows
  several open sections. :on-change receives the new set. :items are
  [{:id :title :content}]."
  [{:keys [items value multiple? on-change]}]
  [:div.ui-accordion
   (for [{:keys [id title content]} items]
     (disclosure
      {:replicant/key id :title title :open? (contains? (set value) id)
       :on {:toggle
            (ui/wrapped (fn [e]
              (let [open? (.. (ui/dom-event e) -target -open)]
                (when (not= open? (contains? (set value) id))
                  (ui/run e (ui/emit on-change
                                     (if open?
                                       (if multiple? (conj (set value) id) #{id})
                                       (disj (set value) id))))))))}}
      content))])
