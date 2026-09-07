(ns app.gallery
  "Live component examples. Edit this source to explore each control."
  (:require [ui.api :as ui]))

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
     (example "Popover"
       (ui/popover {:open? (:about? s) :on-close (fn [_] (put! :about? false))}
         (ui/button {:on {:click (fn [_] (put! :about? (not (:about? s))))}} "About the kit")
         [:p "These components are ordinary ClojureScript in src/ui. Change them to fit your project."]))
     (example "Dialog"
       (ui/button {:on {:click (fn [_] (put! :dialog? true))}} "Edit profile")
       [:p (str "Name: " (or (:name s) "Ada"))]
       (ui/dialog {:open? (:dialog? s) :title "Edit profile"
                   :on-close (fn [_] (put! :dialog? false))}
         (ui/field {:label "Name"}
           (ui/input {:value (or (:draft s) (:name s) "Ada")
                      :on {:input (fn [e] (put! :draft (.. e -target -value)))}}))
         (ui/dialog-actions
           (ui/button {:on {:click (fn [_] (put! :dialog? false))}} "Cancel")
           (ui/button {:variant :primary
                       :on {:click (fn [_] (swap! state assoc :name (or (:draft s) (:name s) "Ada") :dialog? false) (render))}}
             "Save"))))
     (example "Buttons & tooltips"
       [:div.gallery-row
        (ui/tooltip {:text "Save your work"}
          (ui/button {:variant :primary :on {:click (fn [_] (put! :notice (str (random-uuid))))}} "Save"))
        (ui/button {} "Default")
        (ui/button {:variant :danger} "Danger")
        (ui/button {:disabled true} "Disabled")])
     (example "Fields & selection"
       (ui/field {:label "Name" :hint "A public display name."}
         (ui/input {:placeholder "Ada"}))
       (ui/field {:label "Workspace"}
         (ui/select {} [:option "Personal"] [:option "Team"])))
     (example "Checkbox & switch"
       [:div.gallery-row
        (ui/checkbox {:label "Remember me" :checked? (:checked? s) :on-change #(put! :checked? %)})
        (ui/switch {:label "Notifications" :checked? (:enabled? s) :on-change #(put! :enabled? %)})])
     (example "Dropdown menu"
       (ui/dropdown
        {:open? (:menu? s) :on-close (fn [_] (put! :menu? false)) :label "Gallery actions"
         :items [{:id :copy :label "Copy" :on-select (fn [_] (put! :choice "Copied"))}
                 {:id :archive :label "Archive" :on-select (fn [_] (put! :choice "Archived"))}
                 {:id :disabled :label "Unavailable" :disabled? true}]}
        (ui/button {:on {:click (fn [_] (put! :menu? (not (:menu? s))))}} "Actions"))
       [:p (:choice s)])
     (example "Tabs"
       (ui/tabs {:id "gallery-tabs" :label "Tab example" :value (:tab s) :on-change #(put! :tab %)
                   :items [{:id :preview :label "Preview" :content [:p "Hello from the first panel."]}
                           {:id :details :label "Details" :content [:p "Panels stay mounted when you switch tabs."]}]}))
     (example "Disclosure & accordion"
       (ui/disclosure {:title "More information"} [:p "Native details: click or press Enter to expand."])
       (ui/accordion {:value (:sections s) :on-change #(put! :sections %)
                             :items [{:id :a :title "Section A" :content "Opening another section closes this one."}
                                     {:id :b :title "Section B" :content "Use :multiple? true to keep several open."}]}))
     (example "Breadcrumbs"
       (ui/breadcrumbs {:items [{:id :src :label "src"} {:id :app :label "app" :current? true}]
                                 :on-open #(put! :path %)})
       [:p (str "Selected: " (name (or (:path s) :app)))])
     (example "Tree"
       (ui/tree {:aria-label "Example files"
                 :nodes [{:id :src :name "src" :type :dir
                          :children [{:id :core :name "core.cljs" :type :file}
                                     {:id :gallery :name "gallery.cljs" :type :file}]}]
                 :expanded (or (:folders s) #{:src}) :selected (:file s)
                 :on-toggle (fn [id] (put! :folders ((if (contains? (or (:folders s) #{:src}) id) disj conj) (or (:folders s) #{:src}) id)))
                 :on-select #(put! :file %)}))
     (example "Split panes"
       (ui/split {:ratio (:ratio s) :on-ratio #(put! :ratio %)}
         [:p "Drag the divider"] [:p "Resize this pane"]))
     (example "Command palette"
       (ui/button {:on {:click (fn [_] (put! :commands? true))}} "Search commands"))
     (ui/command {:open? (:commands? s) :query (:query s)
                       :on-query (fn [e] (put! :query (.. e -target -value)))
                       :on-close (fn [_] (put! :commands? false))
                       :active (:active s) :on-active #(put! :active %)
                       :items [{:id :save :label "Save" :action (fn [_] (put! :notice (str (random-uuid))))}]})
     (example "Toast"
       (ui/button {:on {:click (fn [_] (put! :notice (str (random-uuid))))}} "Show notification"))
     (when-let [id (:notice s)]
       (ui/toast {:id id :text "Saved. Hover or focus to pause dismissal."
                     :on-dismiss (fn [_] (put! :notice nil))}))]))
