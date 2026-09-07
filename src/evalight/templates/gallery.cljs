(ns app.gallery
  "Live component examples. Edit this source to explore each control."
  (:require [ui.button :as button]
            [ui.tooltip :as tooltip]
            [ui.dropdown :as dropdown]
            [ui.tabs :as tabs]
            [ui.toast :as toast]
            [ui.checkbox :as checkbox]
            [ui.switch :as switch]
            [ui.disclosure :as disclosure]
            [ui.select :as select]
            [ui.field :as field]
            [ui.input :as input]
            [ui.breadcrumbs :as breadcrumbs]
            [ui.split :as split]
            [ui.command :as command]))

(defonce state (atom {:tab :preview :checked? false :enabled? true
                      :sections #{} :ratio 50 :choice "No action yet"}))

(defn example [title & children]
  [:section.example
   [:h2 title]
   (into [:div.example-preview] children)])

(defn view [render]
  (let [s @state
        put! (fn [key value] (swap! state assoc key value) (render))]
    [:div.gallery
     [:header [:p.eyebrow "Component gallery"]
      [:h2 "Small pieces, ready to change."]
      [:p.lede "Try each control, then edit src/app/gallery.cljs in the code editor. Every component is source in src/ui."]]
     (example "Popover & dialog"
       [:p "Try About the kit and Rename above. Their complete event handlers live in app.core."])
     (example "Buttons & tooltips"
       [:div.gallery-row
        (tooltip/tooltip {:text "Save your work"}
          (button/button {:variant :primary :on {:click (fn [_] (put! :notice (str (random-uuid))))}} "Save"))
        (button/button {} "Default")
        (button/button {:variant :danger} "Danger")
        (button/button {:disabled true} "Disabled")])
     (example "Fields & selection"
       (field/field {:label "Name" :hint "A public display name."}
         (input/input {:placeholder "Ada"}))
       (field/field {:label "Workspace"}
         (select/select {} [:option "Personal"] [:option "Team"])))
     (example "Checkbox & switch"
       [:div.gallery-row
        (checkbox/checkbox {:label "Remember me" :checked? (:checked? s) :on-change #(put! :checked? %)})
        (switch/switch {:label "Notifications" :checked? (:enabled? s) :on-change #(put! :enabled? %)})])
     (example "Dropdown menu"
       (dropdown/dropdown
        {:open? (:menu? s) :on-close (fn [_] (put! :menu? false)) :label "Gallery actions"
         :items [{:id :copy :label "Copy" :on-select (fn [_] (put! :choice "Copied"))}
                 {:id :archive :label "Archive" :on-select (fn [_] (put! :choice "Archived"))}
                 {:id :disabled :label "Unavailable" :disabled? true}]}
        (button/button {:on {:click (fn [_] (put! :menu? (not (:menu? s))))}} "Actions"))
       [:p (:choice s)])
     (example "Tabs"
       (tabs/tabs {:id "gallery-tabs" :label "Tab example" :value (:tab s) :on-change #(put! :tab %)
                   :items [{:id :preview :label "Preview" :content [:p "Hello from the first panel."]}
                           {:id :details :label "Details" :content [:p "Panels stay mounted when you switch tabs."]}]}))
     (example "Disclosure & accordion"
       (disclosure/disclosure {:title "More information"} [:p "Native details: click or press Enter to expand."])
       (disclosure/accordion {:value (:sections s) :on-change #(put! :sections %)
                             :items [{:id :a :title "Section A" :content "Opening another section closes this one."}
                                     {:id :b :title "Section B" :content "Use :multiple? true to keep several open."}]}))
     (example "Breadcrumbs"
       (breadcrumbs/breadcrumbs {:items [{:id :src :label "src"} {:id :app :label "app" :current? true}]
                                 :on-open #(put! :path %)})
       [:p (str "Selected: " (name (or (:path s) :app)))])
     (example "Split panes"
       (split/split {:ratio (:ratio s) :on-ratio #(put! :ratio %)}
         [:p "Drag the divider"] [:p "Resize this pane"]))
     (example "Command palette"
       (button/button {:on {:click (fn [_] (put! :commands? true))}} "Search commands"))
     (command/command {:open? (:commands? s) :query (:query s)
                       :on-query (fn [e] (put! :query (.. e -target -value)))
                       :on-close (fn [_] (put! :commands? false))
                       :active (:active s) :on-active #(put! :active %)
                       :items [{:id :save :label "Save" :action (fn [_] (put! :notice (str (random-uuid))))}]})
     (example "Toast"
       (button/button {:on {:click (fn [_] (put! :notice (str (random-uuid))))}} "Show notification"))
     (when-let [id (:notice s)]
       (toast/toast {:id id :text "Saved. Hover or focus to pause dismissal."
                     :on-dismiss (fn [_] (put! :notice nil))}))]))
