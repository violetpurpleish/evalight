(ns evalight.projects
  "Browser project metadata lives beside projects, never in exported source."
  (:require [clojure.string :as str]
            [evalight.fs :as fs]
            [evalight.fs.protocol :as proto]
            [evalight.promise :as p]))

(defn metadata-path [project]
  (str "project-meta/" project ".json"))

(defn valid-time [x]
  (when (and (number? x) (js/Number.isFinite x) (pos? x)) x))

(defn parse [raw]
  (try
    (let [m (js->clj (js/JSON.parse raw) :keywordize-keys true)]
      {:created-at (valid-time (:created-at m))
       :edited-at (valid-time (:edited-at m))})
    (catch :default _ nil)))

(defn load! [ws project]
  (-> (fs/read-file ws (metadata-path project))
      (.then parse)
      (.catch (fn [_] nil))))

(defn save! [ws project metadata]
  (-> (fs/write-file ws (metadata-path project)
                     (js/JSON.stringify (clj->js metadata)))
      (.then (fn [_] metadata))))

(defonce !writes (atom (p/ok nil)))

(defn touch! [ws project]
  (let [now (.now js/Date)
        saved (-> @!writes
                  (.catch (fn [_] nil))
                  (.then (fn [_] (load! ws project)))
                  (.then (fn [m]
                           (save! ws project
                                  (assoc m :edited-at (max now (or (:edited-at m) 0)))))))]
    (reset! !writes saved)
    saved))

(defn ordered [names details]
  (vec (sort-by (fn [name] [(- (or (get-in details [name :edited-at]) 0)) name]) names)))

(defn matching [names query]
  (let [q (str/lower-case (str/trim (or query "")))]
    (filterv #(str/includes? (str/lower-case %) q) names)))

(defn time-ago [timestamp now]
  (if-not (valid-time timestamp)
    "Edit time unavailable"
    (let [seconds (max 0 (/ (- now timestamp) 1000))
          [n unit] (cond
                     (< seconds 60) [0 nil]
                     (< seconds 3600) [(js/Math.floor (/ seconds 60)) "minute"]
                     (< seconds 86400) [(js/Math.floor (/ seconds 3600)) "hour"]
                     (< seconds (* 86400 30)) [(js/Math.floor (/ seconds 86400)) "day"]
                     (< seconds (* 86400 365)) [(js/Math.floor (/ seconds (* 86400 30))) "month"]
                     :else [(js/Math.floor (/ seconds (* 86400 365))) "year"])]
      (if (zero? n) "Edited just now"
          (str "Edited " n " " unit (when (not= n 1) "s") " ago")))))

(defn creation-label [timestamp]
  (if (valid-time timestamp)
    (str "Created " (.toLocaleDateString (js/Date. timestamp) "en"
                                        #js {:year "numeric" :month "short" :day "numeric"}))
    "Creation date unavailable"))

(defn- changed [operation on-change]
  (.then operation (fn [result]
                     (.then (on-change) (fn [_] result)))))

(defrecord TrackedFS [delegate on-change]
  proto/FileSystem
  (-list-dir [_ path] (fs/list-dir delegate path))
  (-read-file [_ path] (fs/read-file delegate path))
  (-exists [_ path] (fs/exists? delegate path))
  (-write-file [_ path content] (changed (fs/write-file delegate path content) on-change))
  (-mkdir [_ path] (changed (fs/mkdir delegate path) on-change))
  (-rename [_ from to] (changed (fs/rename delegate from to) on-change))
  (-delete [_ path] (changed (fs/delete delegate path) on-change)))
