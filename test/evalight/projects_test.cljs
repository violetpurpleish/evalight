(ns evalight.projects-test
  (:require [cljs.test :refer [async deftest is]]
            [evalight.fs :as fs]
            [evalight.fs.protocol :as proto]
            [evalight.projects :as projects]))

(deftest project-order-and-search
  (is (= ["new" "a" "b" "unknown"]
         (projects/ordered ["unknown" "b" "a" "new"]
                           {"a" {:edited-at 10} "b" {:edited-at 10} "new" {:edited-at 20}})))
  (is (= ["My Lamp"] (projects/matching ["My Lamp" "counter"] " LAMP "))))

(deftest project-time-labels
  (let [now 2000000000000]
    (is (= "Edited just now" (projects/time-ago now now)))
    (is (= "Edited just now" (projects/time-ago (+ now 5000) now)))
    (is (= "Edited 1 minute ago" (projects/time-ago (- now 60000) now)))
    (is (= "Edited 2 hours ago" (projects/time-ago (- now 7200000) now)))
    (is (= "Edited 3 days ago" (projects/time-ago (- now 259200000) now)))
    (is (= "Creation date unavailable" (projects/creation-label nil)))))

(defrecord MemoryFS [files fail?]
  proto/FileSystem
  (-list-dir [_ _] (js/Promise.resolve []))
  (-exists [_ path] (js/Promise.resolve (contains? @files path)))
  (-read-file [_ path] (js/Promise.resolve (get @files path)))
  (-write-file [_ path text]
    (if @fail?
      (js/Promise.reject (js/Error. "write failed"))
      (do (swap! files assoc path text) (js/Promise.resolve path))))
  (-mkdir [_ path] (js/Promise.resolve path))
  (-rename [_ from to]
    (swap! files #(-> % (assoc to (get % from)) (dissoc from)))
    (js/Promise.resolve to))
  (-delete [_ path]
    (swap! files dissoc path)
    (js/Promise.resolve path)))

(deftest edits-persist-without-changing-creation-or-touching-reads
  (async done
    (let [ws (->MemoryFS (atom {}) (atom false))
          disk (->MemoryFS (atom {"a.txt" "a"}) (atom false))
          touches (atom 0)
          tracked (projects/->TrackedFS disk #(do (swap! touches inc) (projects/touch! ws "lamp")))]
      (-> (projects/save! ws "lamp" {:created-at 100 :edited-at 100})
          (.then (fn [_] (fs/read-file tracked "a.txt")))
          (.then (fn [_] (fs/list-dir tracked "")))
          (.then (fn [_] (fs/exists? tracked "a.txt")))
          (.then (fn [_]
                   (is (zero? @touches))
                   (fs/write-file tracked "a.txt" "new")))
          (.then (fn [_] (fs/mkdir tracked "folder")))
          (.then (fn [_] (fs/rename tracked "a.txt" "b.txt")))
          (.then (fn [_] (fs/delete tracked "b.txt")))
          (.then (fn [_] (projects/load! ws "lamp")))
          (.then (fn [m]
                   (is (= 4 @touches))
                   (is (= 100 (:created-at m)))
                   (is (> (:edited-at m) 100))
                   (is (empty? @(:files disk)))
                   (reset! (:fail? disk) true)
                   (-> (fs/write-file tracked "failed.txt" "bad")
                       (.then (fn [_] (is false "Write should fail")))
                       (.catch (fn [_] (is (= 4 @touches)))))))
          (.then (fn [_] (done)))
          (.catch (fn [e] (is false (str e)) (done)))))))
