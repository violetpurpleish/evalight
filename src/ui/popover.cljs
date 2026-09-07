(ns ui.popover
  (:require [ui.core :as ui]))

(defn- position-panel! [node align]
  (let [win (.. node -ownerDocument -defaultView)
        viewport (.-visualViewport win)
        edge 12
        left (+ edge (if viewport (.-offsetLeft viewport) 0))
        top (+ edge (if viewport (.-offsetTop viewport) 0))
        right (- (+ (if viewport (.-offsetLeft viewport) 0)
                    (if viewport (.-width viewport) (.-innerWidth win))) edge)
        bottom (- (+ (if viewport (.-offsetTop viewport) 0)
                     (if viewport (.-height viewport) (.-innerHeight win))) edge)
        anchor (.getBoundingClientRect (.-parentElement node))
        style (.-style node)
        width (.-width (.getBoundingClientRect node))
        below (- bottom (.-bottom anchor) 6)
        above (- (.-top anchor) top 6)
        flip? (and (< below 180) (> above below))
        available (max 0 (if flip? above below))]
    (set! (.-position style) "fixed")
    (set! (.-right style) "auto")
    (set! (.-left style)
          (str (max left (min (- right width)
                             (if (= align :end) (- (.-right anchor) width) (.-left anchor)))) "px"))
    (set! (.-maxHeight style) (str available "px"))
    (let [y (max top (if flip?
                      (- (.-top anchor) 6 (min available (.-height (.getBoundingClientRect node))))
                      (+ (.-bottom anchor) 6)))]
      (set! (.-top style) (str y "px"))
      (set! (.-maxHeight style) (str "min(" available "px, calc(100dvh - " (+ y 12) "px))")))))

(defn- panel-lifecycle [align attrs]
  (assoc attrs
         :replicant/on-mount
         (fn [{:keys [replicant/node] :as e}]
           (let [win (.. node -ownerDocument -defaultView)
                 viewport (.-visualViewport win)
                 position (fn [& _] (position-panel! node align))
                 observer (js/ResizeObserver. position)]
             (position)
             (.observe observer node)
             (.addEventListener win "resize" position)
             (.addEventListener win "scroll" position true)
             (when viewport
               (.addEventListener viewport "resize" position)
               (.addEventListener viewport "scroll" position))
             (aset node "__uiPopoverCleanup"
                   (fn []
                     (.disconnect observer)
                     (.removeEventListener win "resize" position)
                     (.removeEventListener win "scroll" position true)
                     (when viewport
                       (.removeEventListener viewport "resize" position)
                       (.removeEventListener viewport "scroll" position))))
             (when-let [mount (:replicant/on-mount attrs)] (mount e))))
         :replicant/on-unmount
         (fn [{:keys [replicant/node] :as e}]
           (when-let [cleanup (aget node "__uiPopoverCleanup")] (cleanup))
           (when-let [unmount (:replicant/on-unmount attrs)] (unmount e)))))

(defn popover
  "Anchor a panel to a trigger. The parent owns :open?. :on-close runs
  on outside clicks or Escape. Outside clicks still reach their target.
  :align is :start (default) or :end. :class styles the wrapper;
  :panel-attrs customizes the panel, including lifecycle and key handlers."
  [{:keys [open? on-close align class panel-attrs] :or {align :start}} trigger content]
  [:div.ui-popover {:class class}
   trigger
   (when (and open? on-close)
     [:button.ui-popover-dismiss
      (merge (ui/outside-dismiss-attrs ".ui-popover-panel" ":scope > button:not(.ui-popover-dismiss)")
             {:type "button" :hidden true :tabindex -1 :on {:click on-close}})])
   (when open?
     [:div
      (ui/attrs {:class ["ui-popover-panel" (str "is-" (name align))]
                 :role "dialog"}
                (panel-lifecycle align panel-attrs) [])
      content])])
