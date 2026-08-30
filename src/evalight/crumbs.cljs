(ns evalight.crumbs
  (:require [evalight.paths :as paths]))

(defn find-node
  "Tree node at `path`, or a synthetic root when path is blank."
  [tree path]
  (if (or (nil? path) (= "" path))
    {:type :dir :name "" :path "" :children (vec tree)}
    (loop [nodes tree
           parts (paths/split path)]
      (let [want (first parts)
            node (some #(when (= (:name %) want) %) nodes)]
        (cond
          (nil? node) nil
          (nil? (next parts)) node
          :else (recur (:children node) (next parts)))))))

(defn children-of
  "Direct children of `path`. Blank path is the project root."
  [tree path]
  (vec (or (:children (find-node tree path)) [])))

(defn from-path
  "Trail for the editor bar. One crumb per path segment."
  [path]
  (let [parts (paths/split path)
        n (count parts)]
    (mapv (fn [i]
            (let [p (paths/join (subvec parts 0 (inc i)))]
              {:id p
               :label (nth parts i)
               :current? (= i (dec n))}))
          (range n))))

(defn sibling-rows
  "Menu rows for the directory that contains `crumb-path`.
  Root crumbs list the project root."
  [tree crumb-path active-path]
  (let [parent (paths/dirname crumb-path)
        nodes (children-of tree parent)]
    (mapv (fn [{:keys [path name type]}]
            {:id path
             :label (if (= type :dir) (str name "/") name)
             :current? (= path active-path)})
          nodes)))

(defn child-rows
  "Menu rows for the children of `dir-path`."
  [tree dir-path active-path]
  (mapv (fn [{:keys [path name type]}]
          {:id path
           :label (if (= type :dir) (str name "/") name)
           :current? (= path active-path)})
        (children-of tree dir-path)))
