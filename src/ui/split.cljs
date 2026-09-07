(ns ui.split
  (:require [ui.core :as ui]))

(defn- start-drag! [props event]
  (let [e (ui/dom-event event)
        node (.-currentTarget e)
        win (.. node -ownerDocument -defaultView)
        {:keys [value direction reverse? scale clamp on-input on-change on-dragging]} props
        column? (= direction :column)
        coordinate (fn [ev] (if column? (.-clientY ev) (.-clientX ev)))
        start (coordinate e)
        factor (if scale (scale node) 1)
        pointer-id (.-pointerId e)
        current (atom value)
        cleanup (atom nil)
        move (fn [ev]
               (when (= pointer-id (.-pointerId ev))
                 (.preventDefault ev)
                 (let [v (+ value (* (if reverse? -1 1) factor (- (coordinate ev) start)))
                       v (if clamp (clamp v) v)]
                   (reset! current v)
                   (when on-input (on-input v)))))
        finish (fn [ev]
                 (when (or (nil? ev) (= pointer-id (.-pointerId ev)))
                   (when-let [f @cleanup] (f))
                   (when on-change (on-change @current))
                   (when on-dragging (on-dragging false))))]
    (when (= 0 (.-button e))
      (when-let [previous (aget node "__uiSplitCleanup")] (previous))
      (reset! cleanup
              (fn []
                (.removeEventListener win "pointermove" move)
                (.removeEventListener win "pointerup" finish)
                (.removeEventListener win "pointercancel" finish)
                (when (.hasPointerCapture node pointer-id)
                  (.releasePointerCapture node pointer-id))
                (aset node "__uiSplitCleanup" nil)))
      (aset node "__uiSplitCleanup" #(finish nil))
      (.setPointerCapture node pointer-id)
      (.addEventListener win "pointermove" move)
      (.addEventListener win "pointerup" finish)
      (.addEventListener win "pointercancel" finish)
      (when on-dragging (on-dragging true)))))

(defn handle
  "Shared divider for custom pane layouts. :value is the initial size;
  :on-input receives sizes during dragging, :on-change commits on release.
  Optional :clamp, :reverse?, :direction, :scale (units per pixel from node),
  and :on-dragging (boolean). Callbacks are functions. Other props style the
  separator or add events such as :dblclick."
  [{:keys [direction] :as props}]
  [:div
   (ui/attrs
    {:class "ui-split-handle" :role "separator"
     :aria-orientation (if (= direction :column) "horizontal" "vertical")
     :replicant/on-unmount (fn [{:keys [replicant/node]}]
                             (when-let [cleanup (aget node "__uiSplitCleanup")] (cleanup)))}
    (assoc props :on (assoc (:on props) :pointerdown #(start-drag! props %)))
    [:value :direction :reverse? :scale :clamp :on-input :on-change :on-dragging])])

(defn split
  "Two panes and a drag handle. :direction is :row (default) or :column.
  :ratio is a percent for the first pane (20–80). :on-ratio receives
  the new number; the parent should put it in an atom and re-render."
  [{:keys [ratio on-ratio direction] :or {ratio 50 direction :row}} a b]
  (let [column? (= direction :column)]
    [:div.ui-split
     {:class (if column? "is-col" "is-row")}
     [:div.ui-split-pane {:style {:flex-grow ratio}} a]
     (handle {:value ratio :direction direction :on-input on-ratio
              :clamp #(min 80 (max 20 %))
              :scale (fn [node]
                       (let [root (.-parentElement node)]
                         (/ 100 (max 1 (- (if column? (.-clientHeight root) (.-clientWidth root))
                                          (if column? (.-offsetHeight node) (.-offsetWidth node)))))))})
     [:div.ui-split-pane {:style {:flex-grow (- 100 ratio)}} b]]))
