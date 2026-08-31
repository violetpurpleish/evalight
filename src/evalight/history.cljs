(ns evalight.history
  "Persistent, per-project undo log for destructive file actions.

  Code edits stay with CodeMirror (Ctrl/Cmd-Z). This log is for things
  the editor cannot put back: deletes, renames, and kit Restore overwrites."
  (:require [clojure.string :as str]
            [evalight.fs :as fs]
            [evalight.paths :as paths]
            [evalight.promise :as p]))

(def max-entries 40)

(defn store-path
  "OPFS path under the workspace root, namespaced by mode and project."
  [mode project]
  (let [mode-name (name (or mode :browser))
        slug (let [s (paths/slug (or project "project"))]
               (if (str/blank? s) "project" s))]
    (paths/join "history" mode-name (str slug ".json"))))

(defn make-entry
  [kind fields]
  (merge {:id (str (random-uuid))
          :ts (.now js/Date)
          :kind kind}
         fields))

(defn push
  "Newest first. Drops the oldest past `max-entries`."
  [entries entry]
  (vec (take max-entries (cons entry (or entries [])))))

(defn without
  [entries id]
  (vec (remove #(= id (:id %)) (or entries []))))

(defn clear [_entries]
  [])

(defn age-label
  ([ts] (age-label ts (.now js/Date)))
  ([ts now]
   (let [s (/ (- (or now 0) (or ts 0)) 1000.0)]
     (cond
       (or (js/isNaN s) (neg? s) (< s 45)) "just now"
       (< s 90) "1m ago"
       (< s 3600) (str (js/Math.round (/ s 60)) "m ago")
       (< s 5400) "1h ago"
       (< s 86400) (str (js/Math.round (/ s 3600)) "h ago")
       (< s 172800) "1d ago"
       :else (str (js/Math.round (/ s 86400)) "d ago")))))

(defn- compact [m]
  (into {} (remove (fn [[_ v]] (or (nil? v) (and (coll? v) (empty? v)))) m)))

(defn entry->json [entry]
  (compact
   {:id (:id entry)
    :ts (:ts entry)
    :kind (name (:kind entry))
    :label (:label entry)
    :path (:path entry)
    :from (:from entry)
    :to (:to entry)
    :content (:content entry)
    :files (:files entry)
    :dirs (vec (:dirs entry))}))

(defn json->entry [m]
  (when (map? m)
    (let [kind (keyword (or (get m "kind") (:kind m)))
          files (or (get m "files") (:files m))
          dirs (or (get m "dirs") (:dirs m))
          str-files (when (map? files)
                      (into {} (map (fn [[k v]] [(str k) (str v)]) files)))]
      (compact
       {:id (or (get m "id") (:id m))
        :ts (or (get m "ts") (:ts m))
        :kind kind
        :label (or (get m "label") (:label m))
        :path (or (get m "path") (:path m))
        :from (or (get m "from") (:from m))
        :to (or (get m "to") (:to m))
        :content (or (get m "content") (:content m))
        :files str-files
        :dirs (when dirs (mapv str dirs))}))))

(defn stringify [entries]
  (js/JSON.stringify
   (clj->js {:version 1
             :entries (mapv entry->json entries)})))

(defn parse [raw]
  (try
    (let [data (js->clj (js/JSON.parse (or raw "{}")))
          rows (or (get data "entries") [])]
      (vec (keep json->entry rows)))
    (catch :default _ [])))

(defn load
  [hfs path]
  (if-not hfs
    (p/ok [])
    (-> (fs/exists? hfs path)
        (.then (fn [exists]
                 (if-not exists
                   []
                   (.then (fs/read-file hfs path) parse))))
        (.catch (fn [_] [])))))

(defn save
  [hfs path entries]
  (if-not hfs
    (p/ok nil)
    (fs/write-file hfs path (stringify entries))))

(defn drop-store
  [hfs path]
  (if-not hfs
    (p/ok nil)
    (-> (fs/exists? hfs path)
        (.then (fn [exists]
                 (if exists
                   (fs/delete hfs path)
                   nil)))
        (.catch (fn [_] nil)))))

(defn- tree-ops [dirs files]
  (into (mapv (fn [d] {:op :mkdir :path d})
              (sort-by (comp count paths/split) (or dirs [])))
        (map (fn [[p c]] {:op :write :path p :content c})
             (sort-by key (or files {})))))

(defn restore-ops
  "Filesystem steps that put this entry back. Does not touch the log."
  [entry]
  (case (:kind entry)
    :delete
    (tree-ops (:dirs entry) (:files entry))

    :rename
    ;; Prefer a pre-rename snapshot so undoing also reverts ns/require
    ;; rewrites that happened on other files. Older entries only stored
    ;; the two paths and fall back to a filesystem rename.
    (if (seq (:files entry))
      (into [{:op :delete :path (:to entry)}]
            (tree-ops (:dirs entry) (:files entry)))
      [{:op :rename :from (:to entry) :to (:from entry)}])

    :overwrite
    [{:op :write :path (:path entry) :content (or (:content entry) "")}]

    []))

(defn- overlay [path disk overlays]
  (if (contains? overlays path)
    (get overlays path)
    disk))

(defn- snapshot-file [fs path overlays]
  (-> (fs/read-file fs path)
      (.then (fn [content]
               {:type :file
                :path path
                :files {path (overlay path content overlays)}
                :dirs []}))
      (.catch (fn [_]
                (if (contains? overlays path)
                  {:type :file
                   :path path
                   :files {path (get overlays path)}
                   :dirs []}
                  nil)))))

(defn- collect-dirs [path nodes]
  (letfn [(walk [xs]
            (mapcat (fn [n]
                      (if (= :dir (:type n))
                        (cons (:path n) (walk (:children n)))
                        []))
                    xs))]
    (vec (cons path (walk nodes)))))

(defn- read-files [fs files overlays]
  (p/reduce-p
   (fn [acc {:keys [path]}]
     (-> (fs/read-file fs path)
         (.then (fn [content]
                  (assoc acc path (overlay path content overlays))))
         (.catch (fn [_]
                   (if (contains? overlays path)
                     (assoc acc path (get overlays path))
                     acc)))))
   {}
   files))

(defn- snapshot-tree [fs path overlays]
  (-> (fs/read-tree fs path)
      (.then (fn [nodes]
               (let [files (fs/flatten-files nodes)
                     dirs (collect-dirs path nodes)]
                 (.then (read-files fs files overlays)
                        (fn [file-map]
                          {:type :dir
                           :path path
                           :files file-map
                           :dirs dirs})))))))

(defn snapshot-path
  "Read `path` (file or directory) for a :delete payload.
  `overlays` is path->text from unsaved editor buffers."
  [fs path overlays]
  (let [overlays (or overlays {})]
    (if (str/blank? path)
      (p/ok nil)
      (-> (snapshot-file fs path overlays)
          (.then (fn [file-snap]
                   (if file-snap
                     file-snap
                     (snapshot-tree fs path overlays))))
          (.catch (fn [_] (snapshot-tree fs path overlays)))))))

(defn delete-entry
  [snap]
  (when snap
    (let [path (:path snap)
          n (count (:files snap))
          label (if (and (= :dir (:type snap)) (not= 1 n))
                  (str "Deleted " path " (" n " files)")
                  (str "Deleted " path))]
      (make-entry :delete {:label label
                           :path path
                           :files (:files snap)
                           :dirs (:dirs snap)}))))

(defn rename-entry
  ([from to] (rename-entry from to nil))
  ([from to snap]
   (make-entry :rename
               (cond-> {:label (str "Renamed " from " → " to)
                        :from from
                        :to to}
                 (map? snap) (assoc :files (:files snap)
                                    :dirs (vec (or (:dirs snap) [])))))))

(defn overwrite-entry [path content]
  (make-entry :overwrite {:label (str "Replaced " path)
                          :path path
                          :content (or content "")}))
