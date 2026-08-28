(ns evalight.paths
  (:require [clojure.string :as str]))

(defn split [path]
  (->> (str/split (or path "") #"/")
       (remove str/blank?)
       vec))

(defn join [& parts]
  (->> parts
       (mapcat split)
       (str/join "/")))

(defn normalize [path]
  (let [parts (split path)
        out (reduce (fn [acc p]
                      (cond
                        (= p ".") acc
                        (= p "..") (if (seq acc) (pop acc) acc)
                        :else (conj acc p)))
                    []
                    parts)]
    (str/join "/" out)))

(defn basename [path]
  (or (last (split path)) ""))

(defn dirname [path]
  (let [parts (split path)]
    (str/join "/" (butlast parts))))

(defn ext [path]
  (let [name (basename path)
        i (str/last-index-of name ".")]
    (if (and i (pos? i))
      (str/lower-case (subs name (inc i)))
      "")))

(defn clojure-file? [path]
  (contains? #{"clj" "cljs" "cljc" "edn"} (ext path)))

(defn parent-segments [path]
  (let [parts (split path)]
    (mapv #(str/join "/" (subvec parts 0 %))
          (range 1 (count parts)))))

(defn starts-with-path? [path prefix]
  (or (= path prefix)
      (str/starts-with? (str path "/") (str prefix "/"))))

(defn slug [s]
  (-> (or s "")
      str/lower-case
      (str/replace #"[^a-z0-9]+" "-")
      (str/replace #"^-+|-+$" "")))
