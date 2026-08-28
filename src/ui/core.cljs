(ns ui.core
  "Tiny helpers shared by the other ui.* controls. This is source in
  your project, not a library. Change it. Delete a control you don't
  want; leave this file if anything in src/ui still refers to it.")

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

(defn attrs
  "Merge kit defaults with caller props. `stripped` keys are kit-only
  and never become DOM attributes."
  [base user stripped]
  (let [user (apply dissoc (or user {}) stripped)
        class (cx (:class base) (:class user))
        merged (merge base user)]
    (cond-> merged
      (seq class) (assoc :class class))))
