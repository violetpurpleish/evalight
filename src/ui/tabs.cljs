(ns ui.tabs
  (:require [ui.core :as ui]))

(defn- keydown [orientation e]
  (let [ev (ui/dom-event e)
        key (.-key ev)
        vertical? (= orientation :vertical)
        previous (if vertical? "ArrowUp" "ArrowLeft")
        next-key (if vertical? "ArrowDown" "ArrowRight")
        buttons (vec (array-seq (.querySelectorAll (.-currentTarget ev) "[role=tab]:not(:disabled)")))
        i (.indexOf (to-array buttons) (.-target ev))
        n (count buttons)]
    (when (and (pos? n) (not (.-isComposing ev))
               (contains? #{previous next-key "Home" "End"} key))
      (.preventDefault ev)
      (let [next (cond (= key "Home") 0
                       (= key "End") (dec n)
                       (= key next-key) (mod (inc i) n)
                       :else (mod (dec i) n))
            button (nth buttons next)]
        (.focus button)
        (.click button)))))

(defn tab-list
  "Controlled tabs: :items [{:id :label :disabled? :panel-id :tab-id}],
  :value, :on-change (receives id), :label, optional :orientation.
  Panel associations are optional for navigation-only uses."
  [{:keys [items value on-change label orientation] :as props}]
  (let [enabled (remove :disabled? items)
        focus-id (if (some #(= value (:id %)) enabled) value (:id (first enabled)))]
    (into [:div (ui/attrs
                 {:class "ui-tab-list" :role "tablist" :aria-label label
                  :aria-orientation (name (or orientation :horizontal))
                  :on {:keydown #(keydown orientation %)}}
                 props [:items :value :on-change :label :orientation])]
          (for [{:keys [id label disabled? panel-id tab-id]} items]
            [:button.ui-tab
             {:type "button" :role "tab" :replicant/key id :id tab-id
              :aria-controls panel-id :aria-selected (= id value)
              :disabled (boolean disabled?)
              :tabindex (if (= id focus-id) 0 -1)
              :class (when (= id value) "is-active")
              :on {:click (ui/emit on-change id)}}
             label]))))

(defn tabs
  "Tab list and persistent panels. Supply a unique :id, :value, :on-change
  and :items [{:id :label :content :disabled?}]. Inactive panels stay mounted."
  [{:keys [id items value] :as props}]
  (let [items (mapv (fn [i item]
                      (assoc item :tab-id (str id "-tab-" i)
                                  :panel-id (str id "-panel-" i)))
                    (range) items)]
    [:div.ui-tabs
     (tab-list (assoc (dissoc props :id) :items items))
     (for [{:keys [id content tab-id panel-id]} items]
       [:div.ui-tab-panel {:replicant/key id :id panel-id :role "tabpanel"
                           :aria-labelledby tab-id :tabindex 0 :hidden (not= value id)}
        content])]))
