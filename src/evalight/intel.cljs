(ns evalight.intel
  "Completions and hover docs from the live preview, with a source index
  as a fallback before the SCI image is ready. Nightlight asked the JVM
  it lived in; Evalight asks the SCI iframe that is the program."
  (:require [clojure.string :as str]
            [evalight.ns-graph :as ns-graph]))

(defonce !catalog (atom {:source [] :live [] :ns "user"}))

(defn- item
  [name kind & {:keys [ns arglists doc macro]}]
  (cond-> {:name (str name) :kind (or kind "var")}
    ns (assoc :ns (str ns))
    arglists (assoc :arglists arglists)
    (seq doc) (assoc :doc doc)
    macro (assoc :macro true)))

(defn index-sources!
  "Build a name index from project files so completions work before the
  preview answers. Live intel replaces this once SCI has interned vars."
  [files main]
  (let [parsed (mapv (fn [{:keys [path source]}]
                         (let [ns-info (ns-graph/parse-ns source)
                               defs (ns-graph/top-level-defs source)
                               docs (ns-graph/def-docs source)]
                           {:path path
                            :ns (some-> ns-info :name)
                            :aliases (:aliases ns-info)
                            :defs defs
                            :docs docs}))
                     files)
        by-ns (into {} (keep (fn [p] (when (:ns p) [(:ns p) p])) parsed))
        items (vec
               (concat
                (mapcat (fn [{:keys [ns defs docs]}]
                          (when ns
                            (cons (item ns "ns")
                                  (map (fn [s]
                                         (item s "var"
                                               :ns ns
                                               :doc (get docs s)))
                                       defs))))
                        parsed)
                (mapcat (fn [{:keys [aliases]}]
                          (mapcat (fn [[a lib]]
                                    (let [target (get by-ns lib)
                                          docs (:docs target)]
                                      (cons (item a "alias" :ns lib)
                                            (map (fn [s]
                                                   (item (str a "/" s) "var"
                                                         :ns lib
                                                         :doc (get docs s)))
                                                 (:defs target)))))
                                  aliases))
                        parsed)))]
    (swap! !catalog assoc :source items :ns (or main "user"))
    items))

(defn set-live!
  ([items] (set-live! items nil))
  ([items ns-name]
   (swap! !catalog assoc
          :live (vec items)
          :ns (or ns-name (:ns @!catalog)))))

(defn- blend [live source]
  (if-not live
    source
    (cond-> live
      (and (not (seq (:doc live))) (seq (:doc source))) (assoc :doc (:doc source))
      (and (not (seq (:arglists live))) (seq (:arglists source))) (assoc :arglists (:arglists source)))))

(defn- merged-items []
  (let [{:keys [live source]} @!catalog
        live-by (into {} (map (juxt :name identity) live))
        source-by (into {} (map (juxt :name identity) source))]
    (vec
     (concat
      (map (fn [item] (blend item (get source-by (:name item)))) live)
      (remove #(contains? live-by (:name %)) source)))))

(defn candidates
  "Up to 50 names that start with `prefix` (case-insensitive)."
  [prefix]
  (let [p (str/lower-case (or prefix ""))
        items (merged-items)
        matched (if (str/blank? p)
                  (filter #(= "var" (:kind %)) items)
                  (filter #(str/starts-with? (str/lower-case (str (:name %))) p) items))]
    (->> matched
         (sort-by (fn [{:keys [kind name]}]
                    [(case kind "var" 0 "alias" 1 "ns" 2 3)
                     (count name)
                     name]))
         (take 50)
         vec)))

(defn lookup
  "Docs for a symbol, including `alias/name`."
  [sym]
  (let [s (str sym)
        local (last (str/split s #"/"))
        items (merged-items)]
    (or (some #(when (= (:name %) s) %) items)
        (when (and local (not= local s))
          (some #(when (= (:name %) local) %) items)))))

(defn- cm-type [{:keys [kind macro arglists]}]
  (cond
    macro "function"
    (= kind "ns") "namespace"
    (= kind "alias") "namespace"
    (seq arglists) "function"
    (= kind "core") "function"
    :else "variable"))

(defn cm-options
  "CodeMirror completion objects for `prefix`."
  [prefix]
  (mapv (fn [{:keys [name ns arglists doc] :as it}]
          (cond-> {:label name
                   :type (cm-type it)
                   :detail (or arglists ns)
                   :boost (if (= "var" (:kind it)) 1 0)}
            (seq doc) (assoc :info doc)))
        (candidates prefix)))
