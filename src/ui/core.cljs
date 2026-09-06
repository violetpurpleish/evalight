(ns ui.core
  "Tiny helpers shared by the other ui.* controls. This is source in
  your project, not a library. Change it. Delete a control you don't
  want; leave this file if anything in src/ui still refers to it.
  MIT, Copyright (c) 2026 violetpurpleish & contributors. See LICENSE.")

(defn cx
  "Collect class names. nil, false, and \"\" are skipped."
  [& xs]
  (vec
   (keep (fn [x]
           (cond
             (or (nil? x) (false? x) (= "" x)) nil
             (keyword? x) (name x)
             (symbol? x) (name x)
             (string? x) x
             :else nil))
         (flatten xs))))

(defn dom-event
  "Replicant calls handlers with a map. Plain DOM listeners pass the event.
  This returns the real Event either way."
  [e]
  (if (and (map? e) (contains? e :replicant/dom-event))
    (:replicant/dom-event e)
    e))

(defn stop
  "Stop a click from reaching an overlay behind the panel."
  [e]
  (when-let [ev (dom-event e)]
    (when (.-stopPropagation ev)
      (.stopPropagation ev))))

(defn run
  "Invoke a Replicant :on value. Functions receive the event. Keywords
  and vectors go through :replicant/dispatch on a wrapped event."
  [e handler]
  (when handler
    (cond
      (fn? handler) (handler e)
      :else
      (when-let [dispatch (when (map? e) (:replicant/dispatch e))]
        (dispatch e handler)))))

(defn emit
  "Turn a Replicant handler plus a value into something :on can take.
  A vector becomes (conj handler value). A function is called with the
  value, not the DOM event, because the kit already knows the id."
  [handler value]
  (cond
    (nil? handler) nil
    (fn? handler) (fn [_] (handler value))
    (vector? handler) (conj handler value)
    (keyword? handler) [handler value]
    :else handler))

(defn attrs
  "Merge kit defaults with caller props. `stripped` keys are kit-only
  and never become DOM attributes."
  [base user stripped]
  (let [user (apply dissoc (or user {}) stripped)
        class (cx (:class base) (:class user))
        merged (merge base user)]
    (cond-> merged
      (seq class) (assoc :class class))))

(defn outside-dismiss-attrs
  "Lifecycle for a hidden dismissal button beside a floating panel.
  Listens in capture phase so other controls may stop bubbling without
  preventing dismissal. Listeners are removed on unmount. The trigger
  still owns its normal toggle action."
  [panel-selector trigger-selector]
  {:replicant/on-mount
   (fn [{:keys [replicant/node]}]
     (let [root (.-parentElement node)
           doc (.-ownerDocument node)
           win (.-defaultView doc)
           timer (atom nil)
           inside? (fn [selector target]
                     (when selector
                       (some #(.contains % target)
                             (array-seq (.querySelectorAll root selector)))))
           close (fn [] (when (.-isConnected node) (.click node)))
           click (fn [e]
                   (let [target (.-target e)]
                     (when-not (or (= target node)
                                   (inside? panel-selector target)
                                   (inside? trigger-selector target))
                       (close))))
           keydown (fn [e]
                     (when (and (= "Escape" (.-key e)) (not (.-isComposing e)))
                       (.preventDefault e)
                       (.stopPropagation e)
                       (let [trigger (when trigger-selector
                                       (.querySelector root trigger-selector))]
                         (close)
                         (some-> trigger .focus))))
           blur (fn [_]
                  (reset! timer
                          (.setTimeout win
                                       #(let [active (.-activeElement doc)]
                                          (when (or (not (.hasFocus doc))
                                                    (and (= "IFRAME" (some-> active .-tagName))
                                                         (not (inside? panel-selector active))))
                                            (close)))
                                       0)))]
       (.addEventListener doc "click" click true)
       (.addEventListener doc "keydown" keydown true)
       (.addEventListener win "blur" blur)
       (aset node "__uiDismissCleanup"
             (fn []
               (.removeEventListener doc "click" click true)
               (.removeEventListener doc "keydown" keydown true)
               (.removeEventListener win "blur" blur)
               (when @timer (.clearTimeout win @timer))))))
   :replicant/on-unmount
   (fn [{:keys [replicant/node]}]
     (when-let [cleanup (aget node "__uiDismissCleanup")]
       (cleanup)))})
