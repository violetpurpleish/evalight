(ns evalight.core
  (:require [evalight.actions :as actions]
            [evalight.build :as build]
            [evalight.state :as state]
            [evalight.ui :as ui]
            [replicant.dom :as r]))

(defonce !root (atom nil))

(defn render
  ([] (render @state/app))
  ([st]
   (when-let [el @!root]
     (r/render el (ui/view st)))))

(defn ^:export init []
  (set! (.-EVALIGHT_BUILD js/window) build/id)
  (set! (.. js/document -documentElement -dataset -evalightBuild) build/id)
  (js/console.info "Evalight" build/id)
  (let [el (.getElementById js/document "root")]
    (reset! !root el)
    (r/set-dispatch! actions/handle)
    (add-watch state/app ::render
               (fn [_ _ _ next]
                 (render next)))
    (render)
    (actions/boot!)))

(defn ^:dev/after-load reload []
  (render))
