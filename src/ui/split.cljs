(ns ui.split
  (:require [ui.core :as ui]))

(defn- drag! [ev _start-ratio on-ratio column?]
  (let [e (ui/dom-event ev)
        handle (or (and e (.-currentTarget e))
                   (when-let [t (and e (.-target e))]
                     (.closest t ".ui-split-handle")))
        root (when handle (.-parentElement handle))
        rect (when root (.getBoundingClientRect root))]
    (when (and e rect)
      (let [move (fn [e2]
                   (.preventDefault e2)
                   (let [p (if column?
                              (/ (- (.-clientY e2) (.-top rect)) (max 1 (.-height rect)))
                              (/ (- (.-clientX e2) (.-left rect)) (max 1 (.-width rect))))
                         pct (* 100 (min 0.8 (max 0.2 p)))]
                     (when on-ratio (on-ratio pct))))
            up (atom nil)]
        (reset! up (fn [_]
                     (.removeEventListener js/window "pointermove" move)
                     (.removeEventListener js/window "pointerup" @up)
                     (.removeEventListener js/window "pointercancel" @up)))
        (.preventDefault e)
        (.addEventListener js/window "pointermove" move)
        (.addEventListener js/window "pointerup" @up)
        (.addEventListener js/window "pointercancel" @up)))))

(defn split
  "Two panes and a drag handle. :direction is :row (default) or :column.
  :ratio is a percent for the first pane (20–80). :on-ratio receives
  the new number; the parent should put it in an atom and re-render."
  [{:keys [ratio on-ratio direction] :or {ratio 50 direction :row}} a b]
  (let [column? (= direction :column)]
    [:div.ui-split
     {:class (if column? "is-col" "is-row")}
     [:div.ui-split-pane {:style {:flex-grow ratio}} a]
     [:div.ui-split-handle
      {:role "separator"
       :aria-orientation (if column? "horizontal" "vertical")
       :on {:pointerdown (fn [e] (drag! e ratio on-ratio column?))}}]
     [:div.ui-split-pane {:style {:flex-grow (- 100 ratio)}} b]]))
