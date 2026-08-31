(ns evalight.ns-graph
  (:require [cljs.reader :as reader]
            [clojure.string :as str]))

(defn- read-first-form [source]
  (try
    (reader/read-string source)
    (catch :default _
      nil)))

(defn- require-libspec [spec]
  (cond
    (symbol? spec) {:name spec}
    (and (vector? spec) (symbol? (first spec)))
    (let [opts (try (apply hash-map (rest spec))
                    (catch :default _ {}))]
      {:name (first spec)
       :as (:as opts)})
    :else nil))

(defn- ns-require-specs [ns-form]
  (->> ns-form
       (drop 2)
       (mapcat (fn [clause]
                 (when (and (sequential? clause)
                            (#{:require :require-macros} (first clause)))
                   (keep require-libspec (rest clause)))))
       vec))

(defn parse-ns
  "Return {:name ns-sym :requires [ns-sym ...] :aliases {alias lib}} from source, or nil."
  [source]
  (let [form (read-first-form source)]
    (when (and (sequential? form) (= 'ns (first form)) (symbol? (second form)))
      (let [specs (ns-require-specs form)]
        {:name (second form)
         :requires (mapv :name specs)
         :aliases (into {}
                        (keep (fn [{:keys [name as]}]
                                (when as [as name]))
                              specs))}))))

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

(defn- source-text [source]
  (if (string? source) source ""))

(defn- scan-def-names [source]
  (->> (re-seq def-head (source-text source))
       (mapv (comp symbol second))))

(def ^:private defn-doc-re
  #"(?m)\((?:defn-|defn|defonce|def)\s+([A-Za-z*!?+\-_$<>][\w*!?+\-_$<>]*)\s+(?:\^[^\s()]+\s+)*\"((?:\\.|[^\"\\])*)\"")

(defn def-docs
  "Map of interned name (symbol) to docstring, when the def has one."
  [source]
  (into {}
        (for [[_ nam doc] (re-seq defn-doc-re (source-text source))]
          [(symbol nam) doc])))

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

(defn path->ns
  "Namespace symbol implied by a source path, or nil."
  [path]
  (when (re-find #"\.(cljs?|cljc)$" (or path ""))
    (let [no-ext (str/replace path #"\.(cljs?|cljc)$" "")
          trimmed (str/replace no-ext #"^src/" "")]
      (symbol (str/replace trimmed "/" ".")))))

(defn- re-quote [s]
  (str/replace (str s) #"([.*+?^${}()|\[\]\\])" (fn [[_ ch]] (str "\\" ch))))

(defn rewrite-ns-sym
  "Replace namespace symbol `from` with `to` inside the first (ns ...) form."
  [source from to]
  (let [from (str from)
        to (str to)]
    (if (or (str/blank? from) (str/blank? to) (= from to))
      source
      (if-let [end (ns-form-end source)]
        (let [pat (re-pattern (str "(?<![A-Za-z0-9*+!?_\\-])"
                                   (re-quote from)
                                   "(?![A-Za-z0-9*+!?_\\-.])"))]
          (str (str/replace (subs source 0 end) pat to)
               (subs source end)))
        source))))

(defn rewrite-ns-syms
  "Apply from→to namespace replacements, longest name first."
  [source mapping]
  (reduce (fn [s [from to]]
            (rewrite-ns-sym s from to))
          source
          (->> mapping
               (remove (fn [[from to]] (= (str from) (str to))))
               (sort-by (fn [[from]] (- (count (str from))))))))

(defn ns-name-of
  "Declared ns, or the path guess, or nil."
  [{:keys [path source]}]
  (or (:name (parse-ns source))
      (path->ns path)))

(defn requiring
  "Files whose ns form requires `ns-sym`."
  [files ns-sym]
  (let [want (symbol (str ns-sym))]
    (filterv (fn [{:keys [source]}]
               (when-let [info (parse-ns source)]
                 (some #{want} (:requires info))))
             files)))

(defn conventional-move
  "If this file's ns matches its path, the ns that should follow a rename."
  [path source new-path]
  (let [guessed (path->ns path)
        actual (or (:name (parse-ns source)) guessed)
        next (path->ns new-path)]
    (when (and guessed next actual
               (= (str actual) (str guessed))
               (not= (str actual) (str next)))
      [actual next])))

(defn load-order
  "Return files in an order that satisfies ns :require when possible.
  `files` is a seq of {:path :source}. Unknown cycles fall back to path sort
  with the main namespace last."
  [files main]
  (let [parsed (mapv (fn [{:keys [path source] :as file}]
                       (let [info (parse-ns source)
                             name (or (:name info) (path->ns path))]
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
