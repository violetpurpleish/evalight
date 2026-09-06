(ns evalight.core
  (:require [evalight.actions :as actions]
            [evalight.state :as state]
            [evalight.ui :as ui]
            [replicant.dom :as r]
            ["./icon_tooltips.js" :as tooltips]))

(defonce !root (atom nil))
(defonce !tooltips (atom nil))

(defn render
  ([] (render @state/app))
  ([st]
   (when-let [el @!root]
     (r/render el (ui/view st)))))

(defn ^:export init []
  (let [el (.getElementById js/document "root")]
    (reset! !root el)
    (when-let [dispose @!tooltips] (dispose))
    (reset! !tooltips (tooltips/installIconTooltips el))
    (r/set-dispatch! actions/handle)
    (add-watch state/app ::render
               (fn [_ _ old next]
                 (when (not= old next)
                   (render next))))
    (render)
    (actions/boot!)))

(defn ^:dev/after-load reload []
  (render))
