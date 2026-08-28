(ns evalight.ns-graph
  (:require [cljs.reader :as reader]
            [clojure.string :as str]))

(defn- read-first-form [source]
  (try
    (reader/read-string source)
    (catch :default _
      nil)))

(defn- require-libspec-name [spec]
  (cond
    (symbol? spec) spec
    (and (vector? spec) (symbol? (first spec))) (first spec)
    :else nil))

(defn- ns-require-names [ns-form]
  (->> ns-form
       (drop 2)
       (mapcat (fn [clause]
                 (when (and (sequential? clause)
                            (#{:require :require-macros} (first clause)))
                   (keep require-libspec-name (rest clause)))))
       vec))

(defn parse-ns
  "Return {:name ns-sym :requires [ns-sym ...]} from a source string, or nil."
  [source]
  (let [form (read-first-form source)]
    (when (and (sequential? form) (= 'ns (first form)) (symbol? (second form)))
      {:name (second form)
       :requires (ns-require-names form)})))

(def ^:private def-ops #{'def 'defonce 'defn 'defn-})

(defn read-forms
  "Read every top-level form. Returns [] if the source is not readable."
  [source]
  (try
    (vec (reader/read-string (str "[\n" source "\n]")))
    (catch :default _
      [])))

(def ^:private def-head
  "Top-level def/defn/defonce. defn- before defn, defonce before def."
  #"(?m)^\s*\((?:defn-|defn|defonce|def)\s+(?:\^[^\s]+\s+)*([A-Za-z*!?+\-_$<>][\w*!?+\-_$<>]*)")

(defn- scan-def-names [source]
  (->> (re-seq def-head (or source ""))
       (mapv (comp symbol second))))

(defn top-level-defs
  "Symbols interned by top-level def/defn/defonce forms.
  Prefers the reader, then a line scan. cljs.reader cannot read
  js/document.getElementById, which the lamp template uses."
  [source]
  (let [read (into []
                   (keep (fn [form]
                           (when (and (seq? form)
                                      (contains? def-ops (first form))
                                      (symbol? (second form)))
                             (second form))))
                   (read-forms source))]
    (if (seq read)
      read
      (scan-def-names source))))

(defn- matching-paren-end
  "Index after the list that starts at `start`, or nil."
  [s start]
  (when (and (string? s) (< start (count s)) (= \( (nth s start)))
    (let [n (count s)]
      (loop [i start
             depth 0
             str? false
             esc? false
             comment? false]
        (if (>= i n)
          nil
          (let [c (nth s i)]
            (cond
              comment?
              (recur (inc i) depth false false
                     (not (or (= c \newline) (= c \return))))

              (and str? esc?)
              (recur (inc i) depth true false false)

              (and str? (= c \\))
              (recur (inc i) depth true true false)

              (and str? (= c \"))
              (recur (inc i) depth false false false)

              str?
              (recur (inc i) depth true false false)

              (= c \;)
              (recur (inc i) depth false false true)

              (= c \")
              (recur (inc i) depth true false false)

              (= c \()
              (recur (inc i) (inc depth) false false false)

              (= c \))
              (let [d (dec depth)]
                (if (zero? d)
                  (inc i)
                  (recur (inc i) d false false false)))

              :else
              (recur (inc i) depth false false false))))))))

(defn- ns-form-end
  "Index after the first (ns ...) form, or nil."
  [source]
  (let [idx (or (str/index-of source "(ns ")
                (str/index-of source "(ns\n")
                (str/index-of source "(ns\t"))]
    (when idx
      (matching-paren-end source idx))))

(defn with-forward-refs
  "Insert (declare ...) after the ns form so SCI can resolve names the
  ClojureScript compiler would intern before emitting the file."
  [source]
  (let [names (top-level-defs source)]
    (if (empty? names)
      source
      (if-let [cut (ns-form-end source)]
        (str (subs source 0 cut)
             "\n\n(declare " (str/join " " names) ")\n"
             (subs source cut))
        (str "(declare " (str/join " " names) ")\n" source)))))

(defn- path->ns-guess [path]
  (when (re-find #"\.(cljs?|cljc)$" (or path ""))
    (let [no-ext (str/replace path #"\.(cljs?|cljc)$" "")
          trimmed (str/replace no-ext #"^src/" "")]
      (symbol (str/replace trimmed "/" ".")))))

(defn load-order
  "Return files in an order that satisfies ns :require when possible.
  `files` is a seq of {:path :source}. Unknown cycles fall back to path sort
  with the main namespace last."
  [files main]
  (let [parsed (mapv (fn [{:keys [path source] :as file}]
                       (let [info (parse-ns source)
                             name (or (:name info) (path->ns-guess path))]
                         (assoc file
                                :ns name
                                :requires (or (:requires info) []))))
                     files)
        by-ns (into {} (keep (juxt :ns identity) parsed))
        known (set (keys by-ns))
        remaining (atom (set (keep :ns parsed)))
        incoming (atom
                  (into {}
                        (map (fn [{:keys [ns requires]}]
                               [ns (count (filter known requires))])
                             parsed)))
        ready (atom (->> parsed
                         (filter #(zero? (get @incoming (:ns %) 0)))
                         (map :ns)
                         (remove nil?)
                         vec))
        ordered (atom [])]
    (while (seq @ready)
      (let [ns-sym (first @ready)]
        (swap! ready subvec 1)
        (when (contains? @remaining ns-sym)
          (swap! remaining disj ns-sym)
          (when-let [file (get by-ns ns-sym)]
            (swap! ordered conj file)
            (doseq [{:keys [ns requires]} parsed
                    :when (some #{ns-sym} requires)]
              (let [n (swap! incoming update ns dec)
                    left (get n ns)]
                (when (zero? left)
                  (swap! ready conj ns))))))))
    (let [leftover (filterv #(contains? @remaining (:ns %)) parsed)
          result (into @ordered leftover)
          main-sym (when (and main (not (str/blank? (str main))))
                    (symbol main))
          without-main (vec (remove #(= main-sym (:ns %)) result))
          main-file (some #(when (= main-sym (:ns %)) %) result)]
      (cond-> without-main
        main-file (conj main-file)))))

(defn cljs-files [tree]
  (filterv (fn [{:keys [path type]}]
             (and (or (nil? type) (= :file type))
                  (re-find #"\.(cljs|cljc)$" (or path ""))))
           tree))

(defn flatten-tree [nodes]
  (mapcat (fn [node]
            (if (= :dir (:type node))
              (cons (dissoc node :children)
                    (flatten-tree (:children node)))
              [node]))
          nodes))
