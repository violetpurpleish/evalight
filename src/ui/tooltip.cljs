(ns ui.tooltip
  (:require [clojure.string :as str]))

(defn install!
  "Install delegated tooltips in root; returns cleanup. Defaults to elements
  with data-ui-tooltip. Options: :selector, :text (element -> string), :id,
  :class, :delay. No app globals required. Uses the top layer to avoid clipping."
  ([root] (install! root {}))
  ([root {:keys [selector text id class delay]
          :or {selector "[data-ui-tooltip]" delay 300}}]
   (let [doc (.-ownerDocument root)
         win (.-defaultView doc)
         ^js tip (.createElement doc "div")
         active (atom nil)
         timer (atom nil)
         saved-title (atom nil)
         described (atom nil)
         id (or id (str (gensym "ui-tooltip-")))
         hide (fn []
                (.clearTimeout win @timer)
                (.hidePopover tip)
                (when-let [node @active]
                  (when @saved-title (.setAttribute node "title" @saved-title))
                  (if @described
                    (.setAttribute node "aria-describedby" @described)
                    (.removeAttribute node "aria-describedby")))
                (reset! active nil))
         find-target (fn [target]
                       (when-let [node (.closest target selector)]
                         (when (.contains root node) node)))
         show (fn [node wait]
                (when (not= node @active)
                  (hide)
                  (when-let [label (when node
                                    (if text (text node) (.getAttribute node "data-ui-tooltip")))]
                    (when (seq label)
                      (reset! active node)
                      (reset! saved-title (.getAttribute node "title"))
                      (reset! described (.getAttribute node "aria-describedby"))
                      (.removeAttribute node "title")
                      (reset! timer
                              (.setTimeout
                               win
                               (fn []
                                 (if-not (.-isConnected node)
                                   (hide)
                                   (do
                                     (set! (.-textContent tip) label)
                                     (.showPopover tip)
                                     (let [box (.getBoundingClientRect node)
                                           size (.getBoundingClientRect tip)
                                           width (.-innerWidth win)
                                           height (.-innerHeight win)]
                                       (set! (.. tip -style -left)
                                             (str (max 8 (min (+ (.-left box) (/ (- (.-width box) (.-width size)) 2))
                                                             (- width (.-width size) 8))) "px"))
                                       (set! (.. tip -style -top)
                                             (str (if (<= (+ (.-bottom box) (.-height size) 8) height)
                                                    (+ (.-bottom box) 7)
                                                    (max 8 (- (.-top box) (.-height size) 7))) "px")))
                                     (.setAttribute node "aria-describedby"
                                                    (str/join " " (remove nil? [@described id]))))))
                               wait))))))
         over (fn [e] (when (not= "touch" (.-pointerType e)) (show (find-target (.-target e)) delay)))
         out (fn [e] (when (and @active (not (.contains @active (.-relatedTarget e)))) (hide)))
         focus (fn [e] (show (find-target (.-target e)) 0))
         keydown (fn [e] (when (= "Escape" (.-key e)) (hide)))
         dismiss (fn [_] (hide))
         events [[root "pointerover" over false] [root "pointerout" out false]
                 [root "focusin" focus false] [root "focusout" out false]
                 [root "pointerdown" dismiss false] [doc "keydown" keydown false]
                 [doc "scroll" dismiss true] [win "resize" dismiss false]]]
     (set! (.-id tip) id)
     (set! (.-className tip) (str "ui-tooltip " class))
     (.setAttribute tip "role" "tooltip")
     (.setAttribute tip "popover" "manual")
     (.appendChild (.-body doc) tip)
     (doseq [[node event listener capture?] events]
       (.addEventListener node event listener capture?))
     (fn []
       (hide)
       (doseq [[node event listener capture?] events]
         (.removeEventListener node event listener capture?))
       (.remove tip)))))

(defn tooltip
  "Wrap a focusable trigger with a plain-text :text tooltip. Supports :delay
  and :id. Hover and keyboard focus reveal it; Escape/click/scroll dismiss."
  [{:keys [text] :as props} trigger]
  [:span.ui-tooltip-anchor
   {:data-ui-tooltip text
    :replicant/on-mount
    (fn [{:keys [replicant/node]}]
      (aset node "__uiTooltipCleanup" (install! node (assoc (dissoc props :text) :selector "button, a[href], input, [tabindex]" :text (fn [_] text)))))
    :replicant/on-unmount
    (fn [{:keys [replicant/node]}]
      (when-let [cleanup (aget node "__uiTooltipCleanup")] (cleanup)))}
   trigger])
