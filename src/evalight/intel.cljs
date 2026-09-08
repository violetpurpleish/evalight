(ns evalight.intel
  "Completions and hover docs from the live image, with a source index
  as a fallback before the image is ready. Nightlight asked the JVM it
  lived in. The playground asks SCI. An exported ClojureScript project
  asks the compiled app through nREPL. JVM Clojure / clj-gpui ask that
  same nREPL client without nrepl-select."
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

(defn unwrap-arglists
  "Compiler env prints :arglists as (quote ([e])). SCI prints ([e]).
  Hover and completions should show ([e])."
  [a]
  (when (seq a)
    (let [s (str/trim (str a))]
      (if-let [[_ inner] (re-find #"^\(quote\s+(.+)\)$" s)]
        inner
        s))))

(defn- clean-item [it]
  (if-let [a (unwrap-arglists (:arglists it))]
    (assoc it :arglists a)
    (dissoc it :arglists)))

(defn enrich-live-item
  "Restore metadata fields from a resolved SCI Var when the live listing
  only supplied the callable's arglists."
  [it metadata]
  (cond-> it
    (and (not (seq (:doc it))) (seq (:doc metadata)))
    (assoc :doc (:doc metadata))
    (and (not (seq (:arglists it))) (seq (:arglists metadata)))
    (assoc :arglists (pr-str (:arglists metadata)))))

(defn set-live!
  ([items] (set-live! items nil))
  ([items ns-name]
   (swap! !catalog assoc
          :live (mapv clean-item (or items []))
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

;; Def aliases retain function identity but do not inherit the source Var metadata.
;; Index only function values, and preserve each alias's explicit metadata.
(def sci-intel-form
  "(let [n (ns-name *ns*)
         interned (try (ns-interns n) (catch :default _ {}))
         referred (try (ns-refers n) (catch :default _ {}))
         aliases (try (ns-aliases n) (catch :default _ {}))
         nss (try (all-ns) (catch :default _ []))
         function-meta
         (reduce (fn [index v]
                   (try
                     (let [value @v
                           m (meta v)]
                       (if (and (fn? value) (seq (:arglists m)))
                         (update index value
                                 (fn [old]
                                   (merge old (into {} (filter (fn [[_ value]] (seq value))
                                                              (select-keys m [:doc :arglists]))))))
                         index))
                     (catch :default _ index)))
                 {} (mapcat (fn [n] (vals (ns-interns n))) nss))
         pack (fn [s v kind]
                (let [own (or (meta v) {})
                      inherited (try (get function-meta @v) (catch :default _ nil))
                      m (reduce (fn [m k]
                                  (if (seq (get m k)) m
                                    (assoc m k (get inherited k))))
                                own [:doc :arglists])]
                  {:name (str s)
                   :kind kind
                   :ns (str (or (:ns m) n))
                   :arglists (when-let [a (:arglists m)] (pr-str a))
                   :doc (:doc m)
                   :macro (boolean (:macro m))}))]
     {:ns (str n)
      :items
      (vec
       (concat
        (map (fn [[s v]] (pack s v \"var\")) interned)
        (keep (fn [[s v]]
                (when-not (contains? interned s)
                  (pack s v \"core\")))
              referred)
        (mapcat
         (fn [[a t]]
           (let [target (try (ns-interns t) (catch :default _ {}))
                 nsn (str (try (ns-name t) (catch :default _ a)))]
             (cons {:name (str a) :kind \"alias\" :ns nsn}
                   (map (fn [[s v]]
                          (assoc (pack s v \"var\") :name (str a \"/\" s)))
                        target))))
         aliases)
        (map (fn [x] {:name (str (ns-name x)) :kind \"ns\"}) nss)))})")
