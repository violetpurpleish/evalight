(ns app.core
  (:require [app.greet :as greet]
            [app.stats :as stats]
            [app.gallery :as gallery]
            [replicant.dom :as r]
            [ui.button :as btn]
            [ui.core :as ui]
            [ui.dialog :as dialog]
            [ui.field :as field]
            [ui.input :as input]
            [ui.popover :as popover]))

(defonce store
  (atom {:title "Lamp · lamp"
         :count 0
         :about? false
         :rename? false
         :notes ["Edit src/app/core.cljs — the preview follows."
                 "Evaluate (bump) in the REPL to touch the live app."
                 "Evaluate (stats/record!) — that lives in app.stats."
                 "The controls live in src/ui. Change them, or delete a file you don't want."]}))

(declare render bump toggle-about open-rename close-rename save-title retitle)

(defn view [{:keys [title count notes about? rename?]}]
  [:div.app
   [:p.eyebrow "Live ClojureScript"]
   [:h1 title]
   [:p.lede (greet/greet "Evalight") " This page is the running program, not a build artifact."]
   [:div.toolbar
    (btn/button {:class "lamp" :on {:click (fn [_e] (bump))}}
      [:span.count (str count)]
      "Light another lamp")
    (popover/popover {:open? about? :on-close (fn [_e] (toggle-about false))}
      (btn/button {:on {:click (fn [_e] (toggle-about))}} "About the kit")
      [:p.about-copy "src/ui is copied into this project. Evalight's Add UI dialog can put a control back if you delete it."])
    (btn/button {:on {:click (fn [_e] (open-rename))}} "Rename")]
   (dialog/dialog {:open? rename? :on-close (fn [_e] (close-rename)) :title "Rename the lamp"}
     [:form {:on {:submit (fn [e] (save-title e))}}
      (field/field {:label "Title" :hint "Shown in the heading."}
        (input/input {:name "title"
                      :on {:keydown (fn [e]
                                      (let [ev (ui/dom-event e)]
                                        (when (and ev (= "Enter" (.-key ev)))
                                          (save-title e))))}
                      :replicant/on-mount (fn [{:keys [replicant/node]}]
                                            (set! (.-value node) (:title @store))
                                            (.focus node)
                                            (.select node))}))
      (dialog/actions
        (btn/button {:type "button" :on {:click (fn [_e] (close-rename))}} "Cancel")
        (btn/button {:variant :primary :type "button" :on {:click (fn [e] (save-title e))}} "Save"))])
   (gallery/view render)
   [:ul.notes
    (for [n notes]
      [:li n])]])

(defn render []
  (r/render (js/document.getElementById "app")
            (view @store)))

(defn bump
  "Increment the lamp counter in the running preview."
  []
  (swap! store update :count inc)
  (render)
  (:count @store))

(defn toggle-about
  "Show or hide the kit popover. Pass false to close."
  ([] (toggle-about (not (:about? @store))))
  ([open?]
   (swap! store assoc :about? (boolean open?))
   (render)))

(defn open-rename
  "Open the title dialog."
  []
  (swap! store assoc :rename? true)
  (render))

(defn close-rename
  "Close the title dialog."
  []
  (swap! store assoc :rename? false)
  (render))

(defn save-title
  "Read the rename field and set the heading."
  [e]
  (let [ev (ui/dom-event e)
        node (when (and ev (.-target ev)) (.-target ev))
        field (when node
                (if (= "INPUT" (.-tagName node))
                  node
                  (let [root (when (.-closest node)
                               (or (.closest node "form")
                                   (.closest node ".ui-dialog")))]
                    (when root (.querySelector root "input[name=title]")))))
        s (if field (.-value field) "")]
    (when (and ev (.-preventDefault ev))
      (.preventDefault ev))
    (retitle s)
    (close-rename)
    s))

(defn retitle [s]
  (swap! store assoc :title s)
  (render)
  s)

(defn init []
  (stats/tally)
  (render))

(init)
