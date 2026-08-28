(ns evalight.fs.opfs
  (:require [clojure.string :as str]
            [evalight.fs.protocol :as proto]
            [evalight.paths :as paths]
            [evalight.promise :as p]))

(defn- parts [path]
  (paths/split path))

(defn- get-dir
  [root path create?]
  (p/reduce-p
   (fn [dir name]
     (.getDirectoryHandle dir name #js {:create (boolean create?)}))
   root
   (parts path)))

(defn- get-file-handle
  [root path create?]
  (-> (get-dir root (paths/dirname path) create?)
      (.then (fn [dir]
               (.getFileHandle dir (paths/basename path) #js {:create (boolean create?)})))))

(defn- parent-and-name [root path create-parent?]
  (-> (get-dir root (paths/dirname path) create-parent?)
      (.then (fn [dir]
               {:dir dir :name (paths/basename path)}))))

(defn- entry-type [handle]
  (if (= "directory" (.-kind handle)) :dir :file))

(defn- rel-path [root-path]
  (if (sequential? root-path)
    (apply paths/join root-path)
    (str root-path)))

(defn- list-entries [dir path]
  (let [iter (cond
                (fn? (.-entries dir)) (.entries dir)
                (fn? (.-values dir)) (.values dir)
                :else nil)]
    (if (nil? iter)
      (p/ok [])
      (letfn [(step [acc]
                (.then (.next iter)
                       (fn [result]
                         (if (.-done result)
                           acc
                           (let [v (.-value result)
                                 handle (if (and v (.-kind v)) v (aget v 1))
                                 name (or (.-name handle) (aget v 0))]
                             (step (conj acc {:name name
                                              :type (entry-type handle)
                                              :path (paths/join path name)})))))))]
        (step [])))))

(defrecord OpfsFS [root]
  proto/FileSystem
  (-list-dir [_ path]
    (-> (get-dir root path false)
        (.then (fn [dir] (list-entries dir path)))
        (.then (fn [entries]
                 (vec (sort-by (juxt :type :name) entries))))))
  (-read-file [_ path]
    (-> (get-file-handle root path false)
        (.then (fn [fh] (.getFile fh)))
        (.then (fn [file] (.text file)))))
  (-write-file [_ path content]
    (-> (get-file-handle root path true)
        (.then (fn [fh] (.createWritable fh)))
        (.then (fn [w]
                 (-> (.write w content)
                     (.then (fn [_] (.close w)))
                     (.then (fn [_] path)))))))
  (-mkdir [_ path]
    (-> (get-dir root path true)
        (.then (fn [_] path))))
  (-rename [_ from to]
    (-> (get-file-handle root from false)
        (.then (fn [fh] (.getFile fh)))
        (.then (fn [file] (.text file)))
        (.then (fn [content]
                 (-> (get-file-handle root to true)
                     (.then (fn [fh] (.createWritable fh)))
                     (.then (fn [w]
                              (-> (.write w content)
                                  (.then (fn [_] (.close w)))))))))
        (.then (fn [_] (parent-and-name root from false)))
        (.then (fn [{:keys [dir name]}]
                 (.removeEntry dir name)))
        (.then (fn [_] to))))
  (-delete [_ path]
    (-> (parent-and-name root path false)
        (.then (fn [{:keys [dir name]}]
                 (.removeEntry dir name #js {:recursive true})))
        (.then (fn [_] path))))
  (-exists [_ path]
    (if (str/blank? path)
      (p/ok true)
      (-> (get-dir root (paths/dirname path) false)
          (.then (fn [dir]
                   (-> (.getFileHandle dir (paths/basename path))
                       (.then (fn [_] true))
                       (.catch (fn [_]
                                 (.then (.getDirectoryHandle dir (paths/basename path))
                                        (fn [_] true)))))))
          (.catch (fn [_] false))))))

(defn available? []
  (boolean (some-> js/navigator .-storage .-getDirectory)))

(defn open
  "Open (or create) an OPFS directory at `root-path` parts, e.g. [\"evalight\" \"projects\" \"lamp\"]."
  [root-path]
  (when-not (available?)
    (throw (js/Error. "Origin Private File System is not available in this browser.")))
  (-> (.getDirectory js/navigator.storage)
      (.then (fn [root]
               (get-dir root (rel-path root-path) true)))
      (.then (fn [dir]
               (->OpfsFS dir)))))

(defn workspace-root []
  (when-not (available?)
    (throw (js/Error. "Origin Private File System is not available in this browser.")))
  (-> (.getDirectory js/navigator.storage)
      (.then (fn [root]
               (get-dir root "evalight" true)))
      (.then (fn [dir]
               (->OpfsFS dir)))))
