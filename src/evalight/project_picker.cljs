(ns evalight.project-picker
  (:require [evalight.actions :as actions]
            [evalight.icons :as icons]
            [evalight.projects :as projects]
            [evalight.state :as state]
            [ui.core :as ui]
            [ui.popover :as popover]))

(defonce !clock (atom nil))
(defonce !position (atom nil))

(defn- mount-panel [{:keys [replicant/node]}]
  (let [position (fn []
                   (let [trigger (.getBoundingClientRect (.getElementById js/document "project-select"))
                         width (min 360 (- (.-innerWidth js/window) 24))
                         top (+ (.-bottom trigger) 8)]
                     (set! (.. node -style -left) (str (max 12 (min (.-left trigger) (- (.-innerWidth js/window) width 12))) "px"))
                     (set! (.. node -style -top) (str top "px"))
                     (set! (.. node -style -maxHeight) (str "calc(100dvh - " (+ top 12) "px)"))))]
    (position)
    (reset! !position position)
    (.addEventListener js/window "resize" position))
  (some-> (.querySelector node "input") .focus)
  (reset! !clock (js/setInterval #(swap! state/app assoc :project-clock (.now js/Date)) 30000)))

(defn- unmount-panel [_]
  (when-let [position @!position] (.removeEventListener js/window "resize" position))
  (reset! !position nil)
  (when-let [timer @!clock] (js/clearInterval timer))
  (reset! !clock nil))

(defn- keydown [wrapped]
  (let [e (ui/dom-event wrapped)
        key (.-key e)
        panel (.-currentTarget e)
        target (.-target e)
        options (vec (array-seq (.querySelectorAll panel ".project-option")))
        index (.indexOf (to-array options) target)
        input? (= "INPUT" (.-tagName target))]
    (when (and (not (.-isComposing e))
               (or (contains? #{"ArrowDown" "ArrowUp"} key)
                   (and (not input?) (contains? #{"Home" "End"} key))
                   (and input? (= key "Enter"))))
      (.preventDefault e)
      (when (seq options)
        (if (= key "Enter")
          (.click (first options))
          (let [next (case key
                       "Home" 0
                       "End" (dec (count options))
                       "ArrowUp" (if (neg? index) (dec (count options)) (max 0 (dec index)))
                       (min (dec (count options)) (inc index)))]
            (.focus (nth options next))))))))

(defn view [s]
  (let [open? (:project-picker-open? s)
        names (projects/matching (:projects s) (:project-query s))
        now (or (:project-clock s) (.now js/Date))]
    (popover/popover
     {:open? open? :on-close [:close-project-picker] :class "project-picker"
      :panel-attrs {:id "project-menu" :class "project-menu" :aria-label "Switch project"
                    :replicant/on-mount mount-panel :replicant/on-unmount unmount-panel
                    :on {:keydown keydown}}}
     [:button.project-trigger
      {:id "project-select" :type "button" :value (:project s)
       :aria-label (str "Switch project, " (:project s))
       :aria-haspopup "dialog" :aria-expanded (boolean open?)
       :aria-controls (when open? "project-menu")
       :on {:click [:toggle-project-picker]}}
      (icons/folder)
      [:span.project-trigger-name (:project s)]
      (icons/svg {:class "project-chevron"}
                 [:path {:d "m8 10 4 4 4-4" :stroke-linecap "round" :stroke-linejoin "round"}])]
     [:div.project-menu-content
        [:div.project-menu-heading
         [:h2 "Projects"]
         [:span (str (count (:projects s)) " in this browser")]]
        [:div.project-search
         (icons/svg {} [:circle {:cx "10.5" :cy "10.5" :r "6"}]
                    [:path {:d "m15 15 5 5" :stroke-linecap "round"}])
         [:input {:type "search" :aria-label "Find a project" :placeholder "Find a project…"
                  :value (or (:project-query s) "")
                  :on {:input [:project-query]}}]]
        [:div.project-sort-label "Most recently edited"]
        (if (seq names)
          [:ul.project-options
           (for [name names
                 :let [metadata (get-in s [:project-details name])
                       current? (= name (:project s))]]
             [:li {:replicant/key name}
              [:button.project-option
               {:type "button" :class (when current? "is-current")
                :aria-current (when current? "true") :data-project name
                :on {:click [:switch-project name]}}
               [:span.project-option-top
                [:span.project-option-name name]
                (when current?
                  [:span.project-current
                   (icons/svg {} [:path {:d "m5 12 4 4L19 6" :stroke-linecap "round" :stroke-linejoin "round"}])
                   "Current"])]
               [:span.project-edited (projects/time-ago (:edited-at metadata) now)]
               [:span.project-created (projects/creation-label (:created-at metadata))]]])]
          [:p.project-empty "No matching projects"])
        [:div.project-menu-footer
         [:button {:type "button" :on {:click [:new-project-dialog]}}
          (icons/plus) "New project"]]])))
