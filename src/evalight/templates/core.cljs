(ns app.core
  (:require [replicant.dom :as r]
            [app.gallery :as gallery]
            [ui.api :as ui]))

;; Choose :system, :light, or :dark. System follows your device automatically.
(def theme :system)

(defn set-theme! [mode]
  (when-not (contains? #{:system :light :dark} mode)
    (throw (js/Error. "Theme must be :system, :light, or :dark")))
  (.setAttribute js/document.documentElement "data-theme" (name mode))
  mode)

(defonce store (atom {:count 0}))
(declare render bump)

(defn view [{:keys [count]}]
  [:main.app
   [:header.app-header
    [:h1 "Component gallery"]
    [:p.lede "A small collection of controls. Try them here, make them yours in the editor."]]
   [:section.counter-example
    [:div [:h2 "Counter"] [:p "A little state, a live update."]]
    (ui/button {:class "lamp" :variant :primary :on {:click (fn [_] (bump))}}
      [:span.count (str count)] "Increment")]
   (gallery/view render)])

(defn render []
  (r/render (js/document.getElementById "app") (view @store)))

(defn bump
  "Increment the counter in the running preview."
  []
  (swap! store update :count inc)
  (render)
  (:count @store))

(defn init []
  (set-theme! theme)
  (render))

(init)
