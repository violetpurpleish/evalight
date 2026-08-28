(ns evalight.fs.protocol
  (:refer-clojure :exclude [exists?]))

(defprotocol FileSystem
  "Filesystem-agnostic project storage. Implementations return JS promises
  and treat paths as `/`-separated strings relative to the project root."
  (-list-dir [this path])
  (-read-file [this path])
  (-write-file [this path content])
  (-mkdir [this path])
  (-rename [this from to])
  (-delete [this path])
  (-exists [this path]))

(defn list-dir [fs path]
  (-list-dir fs (or path "")))

(defn read-file [fs path]
  (-read-file fs path))

(defn write-file [fs path content]
  (-write-file fs path (or content "")))

(defn mkdir [fs path]
  (-mkdir fs path))

(defn rename [fs from to]
  (-rename fs from to))

(defn delete [fs path]
  (-delete fs path))

(defn exists? [fs path]
  (-exists fs path))
