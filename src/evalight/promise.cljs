(ns evalight.promise)

(defn ok
  ([] (js/Promise.resolve nil))
  ([x] (js/Promise.resolve x)))

(defn then
  ([p f] (.then p f))
  ([p f err] (.catch (.then p f) err)))

(defn catch [p f]
  (.catch p f))

(defn all [xs]
  (js/Promise.all (into-array xs)))

(defn reduce-p
  "Promise-aware reduce. `f` is (fn [acc x] promise-or-value)."
  [f init xs]
  (reduce (fn [p x]
            (.then p (fn [acc] (f acc x))))
          (js/Promise.resolve init)
          xs))
