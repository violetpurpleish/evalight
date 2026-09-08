(ns evalight.core
  (:require [evalight.actions :as actions]
            [evalight.state :as state]
            [evalight.ui :as ui]
            [replicant.dom :as r]
            [ui.tooltip :as tooltips]
            [clojure.string :as str]))

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
    (reset! !tooltips (tooltips/install!
                        el {:id "workshop-icon-tooltip" :selector "button"
                            :text (fn [button]
                                    (when (.querySelector button "svg")
                                      (let [copy (.cloneNode button true)]
                                        ;; Inspect the attached elements: clone textContent
                                        ;; includes labels hidden by responsive CSS.
                                        (doseq [[node clone] (map vector
                                                                 (array-seq (.querySelectorAll button "*"))
                                                                 (array-seq (.querySelectorAll copy "*")))]
                                          (let [style (.getComputedStyle js/window node)]
                                            (when (or (.matches node "svg, .history-count")
                                                      (= "none" (.-display style))
                                                      (= "hidden" (.-visibility style)))
                                              (.remove clone))))
                                        (when (str/blank? (.-textContent copy))
                                          (.-title button)))))}))
    (r/set-dispatch! actions/handle)
    (add-watch state/app ::render
               (fn [_ _ old next]
                 (when (not= old next)
                   (render next))))
    (render)
    (actions/boot!)))

(defn ^:dev/after-load reload []
  (render))
