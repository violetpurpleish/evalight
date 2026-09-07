(ns ui.dropdown
  (:require [ui.core :as ui]
            [ui.popover :as popover]))

(defn- keydown [on-close e]
  (let [ev (ui/dom-event e)
        root (.-currentTarget ev)
        buttons (vec (array-seq (.querySelectorAll root "[role=menuitem]:not(:disabled)")))
        i (.indexOf (to-array buttons) (.-target ev))
        n (count buttons)
        key (.-key ev)]
    (when (= key "Tab")
      (let [trigger (some-> root (.closest ".ui-popover") (.querySelector ":scope > button"))]
        (ui/run e on-close)
        (some-> trigger .focus)))
    (when (and (pos? n) (not (.-isComposing ev))
               (contains? #{"ArrowDown" "ArrowUp" "Home" "End"} key))
      (.preventDefault ev)
      (let [next (case key
                   "Home" 0
                   "End" (dec n)
                   "ArrowDown" (mod (inc i) n)
                   (if (neg? i) (dec n) (mod (dec i) n)))]
        (.focus (nth buttons next))))))

(defn dropdown
  "Controlled menu over ui.popover. :items contain :id, :label, optional
  :icon, :disabled?, :danger?, :on-select; {:separator? true} divides groups.
  :on-close and :on-select accept functions or Replicant actions."
  [{:keys [items label heading on-close menu-class] :as props} trigger]
  (popover/popover
   (assoc props :panel-attrs {:role "presentation" :class "ui-dropdown-panel"})
   trigger
   (into [:div {:class (ui/cx "ui-dropdown" menu-class)
                :role "menu" :aria-label label
                :on {:keydown (ui/wrapped #(keydown on-close %))}
                :replicant/on-mount
                (fn [{:keys [replicant/node]}]
                  (some-> (.querySelector node "[role=menuitem]:not(:disabled)") .focus))}
          (when heading [:div.ui-dropdown-heading heading])]
         (map-indexed
          (fn [i {:keys [id label icon disabled? danger? on-select separator?]}]
            (if separator?
              [:div.ui-dropdown-separator {:role "separator" :replicant/key (str "separator-" i)}]
              [:button.ui-dropdown-item
               {:type "button" :role "menuitem" :aria-label label :replicant/key (or id i)
                :disabled (boolean disabled?) :tabindex -1
                :class (when danger? "is-danger")
                :on {:click (ui/wrapped (fn [e]
                              (when-not disabled?
                                (ui/run e on-close)
                                (ui/run e on-select))))}}
               icon [:span label]]))
          items))))
