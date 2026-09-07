(ns app.core
  (:require [replicant.dom :as r]
            [ui.button :as button]
            [ui.split :as split]
            [ui.tooltip :as tooltip]
            [ui.dropdown :as dropdown]
            [ui.tabs :as tabs]
            [ui.toast :as toast]
            [ui.checkbox :as checkbox]
            [ui.switch :as switch]
            [ui.disclosure :as disclosure]))

(defonce store (atom {:tab :first :menu? false :choice "none"
                      :checked? false :enabled? true :sections #{}}))
(declare render)
(defn set-value! [key value] (swap! store assoc key value) (render))

(defn render []
  (let [s @store]
    (r/render
     (js/document.getElementById "app")
     [:main {:style {:padding "20px" :max-width "600px" :font-family "sans-serif"}}
      [:h1 "Shared UI kit"]
      (tooltip/tooltip {:text "A helpful explanation"}
        (button/button {:id "hint-trigger"} "Hover me"))
      (dropdown/dropdown
       {:open? (:menu? s) :label "Demo actions" :on-close #(set-value! :menu? false)
        :items [{:id :first :label "First action" :on-select #(set-value! :choice "first")}
                {:id :disabled :label "Unavailable" :disabled? true :on-select #(set-value! :choice "wrong")}
                {:separator? true}
                {:id :last :label "Last action" :danger? true :on-select #(set-value! :choice "last")}]}
       (button/button {:id "menu-trigger" :on {:click #(set-value! :menu? (not (:menu? @store)))}} "Actions"))
      [:p#choice (:choice s)]
      (tabs/tabs {:id "demo" :label "Examples" :value (:tab s) :on-change #(set-value! :tab %)
                  :items [{:id :first :label "First" :content [:input {:placeholder "Draft"}]}
                          {:id :disabled :label "Unavailable tab" :disabled? true :content "Not available"}
                          {:id :second :label "Second" :content [:p "Second panel"]}]})
      [:p (checkbox/checkbox {:label "Accept terms" :checked? (:checked? s) :on-change #(set-value! :checked? %)})]
      [:p (checkbox/checkbox {:label "Disabled checkbox" :disabled true :checked? false})]
      [:p (switch/switch {:label "Enable alerts" :checked? (:enabled? s) :on-change #(set-value! :enabled? %)})]
      [:p#values (str (:checked? s) "/" (:enabled? s))]
      (disclosure/disclosure {:title "More details"} [:p "Expanded content"])
      (disclosure/accordion
       {:items [{:id :a :title "Section A" :content "Content A"}
                {:id :b :title "Section B" :content "Content B"}]
        :value (:sections s) :on-change #(set-value! :sections %)})
      [:div#row-split
       (split/split {:ratio (or (:row s) 50) :on-ratio #(set-value! :row %)}
         [:p "Left"] [:p "Right"])]
      [:div#column-split
       (split/split {:direction :column :ratio (or (:column s) 50) :on-ratio #(set-value! :column %)}
         [:p "Top"] [:p "Bottom"])]
      (button/button {:on {:click #(set-value! :notice (str (random-uuid)))}} "Notify")
      (when-let [id (:notice s)]
        (toast/toast {:id id :text "Saved changes" :duration 1500
                      :on-dismiss #(set-value! :notice nil)
                      :action {:label "Undo" :on-click #(set-value! :choice "undone")}}))])))

(defn init [] (render))
(init)
