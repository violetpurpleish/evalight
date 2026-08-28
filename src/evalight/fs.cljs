(ns evalight.fs
  (:refer-clojure :exclude [exists?])
  (:require [evalight.fs.protocol :as proto]
            [evalight.promise :as p]))

(def list-dir proto/list-dir)
(def read-file proto/read-file)
(def write-file proto/write-file)
(def mkdir proto/mkdir)
(def rename proto/rename)
(def delete proto/delete)
(def exists? proto/exists?)

(def skip-names
  #{"node_modules" ".git" ".shadow-cljs" ".cpcache" ".nrepl-port"
    ".cljs_node_repl" "out" ".DS_Store"})

(defn skip? [name]
  (contains? skip-names name))

(defn read-tree
  "Recursively list a directory as [{:type :file|:dir :name :path :children?}]."
  [fs path]
  (-> (list-dir fs path)
      (.then (fn [entries]
               (let [entries (->> entries
                                  (remove #(skip? (:name %)))
                                  (sort-by (juxt (fn [e] (if (= :dir (:type e)) 0 1)) :name))
                                  vec)]
                 (p/reduce-p
                  (fn [acc e]
                    (if (= :dir (:type e))
                      (.then (read-tree fs (:path e))
                             (fn [children]
                               (conj acc (assoc e :children children))))
                      (p/ok (conj acc e))))
                  []
                  entries))))))

(defn flatten-files [nodes]
  (mapcat (fn [node]
            (if (= :dir (:type node))
              (flatten-files (:children node))
              [node]))
          nodes))

(defn write-tree
  "Write a map of path->content into `fs`."
  [fs files]
  (p/reduce-p
   (fn [_ [path content]]
     (write-file fs path content))
   nil
   files))

(defn read-all-files [fs]
  (-> (read-tree fs "")
      (.then (fn [tree]
               (p/reduce-p
                (fn [acc {:keys [path]}]
                  (.then (read-file fs path)
                         (fn [content]
                           (assoc acc path content))))
                {}
                (flatten-files tree))))))
