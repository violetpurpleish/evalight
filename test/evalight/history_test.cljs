(ns evalight.history-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.history :as history]
            [evalight.paths :as paths]))

(deftest store-path-is-per-project-and-mode
  (is (= "history/browser/lamp.json" (history/store-path :browser "lamp")))
  (is (= "history/local/lamp.json" (history/store-path :local "lamp")))
  (is (= "history/browser/amber-counter.json" (history/store-path :browser "Amber Counter")))
  (is (not= (history/store-path :browser "lamp")
            (history/store-path :browser "amber"))))

(deftest push-keeps-newest-and-caps
  (let [old (vec (map (fn [i] {:id (str i)}) (range 40)))
        nxt (history/push old {:id "new"})]
    (is (= "new" (:id (first nxt))))
    (is (= 40 (count nxt)))
    (is (nil? (some #(= "39" (:id %)) nxt)))
    (is (= "38" (:id (last nxt))))))

(deftest without-and-clear
  (let [xs [{:id "a"} {:id "b"} {:id "c"}]]
    (is (= [{:id "a"} {:id "c"}] (history/without xs "b")))
    (is (= [] (history/clear xs)))))

(deftest json-roundtrip-keeps-file-path-keys
  (let [entry {:id "e1"
               :ts 1
               :kind :delete
               :label "Deleted src/ui/split.cljs"
               :path "src/ui/split.cljs"
               :files {"src/ui/split.cljs" "(ns ui.split)"}
               :dirs []}
        out (history/parse (history/stringify [entry]))
        back (first out)]
    (is (= 1 (count out)))
    (is (= :delete (:kind back)))
    (is (= "(ns ui.split)" (get (:files back) "src/ui/split.cljs")))
    (is (not (contains? (:files back) (keyword "src/ui/split.cljs"))))))

(deftest json-roundtrip-rename-and-overwrite
  (let [rename {:id "r" :ts 2 :kind :rename :label "Renamed a → b" :from "a" :to "b"
                :files {"src/ui/foo.cljs" "(ns ui.foo)"} :dirs []}
        over {:id "o" :ts 3 :kind :overwrite :label "Replaced x" :path "x" :content "old"}
        out (history/parse (history/stringify [rename over]))]
    (is (= :rename (:kind (first out))))
    (is (= "a" (:from (first out))))
    (is (= "b" (:to (first out))))
    (is (= "(ns ui.foo)" (get (:files (first out)) "src/ui/foo.cljs")))
    (is (= :overwrite (:kind (second out))))
    (is (= "old" (:content (second out))))))

(deftest json-roundtrip-keeps-binary-payloads
  (let [png {:encoding :base64
             :mime "image/png"
             :content "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}
        entry {:id "p"
               :ts 4
               :kind :delete
               :label "Deleted resources/icon.png"
               :path "resources/icon.png"
               :files {"resources/icon.png" png}
               :dirs []}
        back (first (history/parse (history/stringify [entry])))]
    (is (= :delete (:kind back)))
    (is (= png (get (:files back) "resources/icon.png")))))

(deftest parse-bad-json-is-empty
  (is (= [] (history/parse "{not json")))
  (is (= [] (history/parse nil)))
  (is (= [] (history/parse "{}"))))

(deftest restore-ops-delete-writes-files-and-mkdirs-parents-first
  (let [entry {:kind :delete
               :path "src/ui"
               :dirs ["src/ui" "src/ui/extra"]
               :files {"src/ui/button.cljs" "(ns ui.button)"
                       "src/ui/extra/x.cljs" "x"}}
        ops (history/restore-ops entry)
        mkdirs (filter #(= :mkdir (:op %)) ops)
        writes (filter #(= :write (:op %)) ops)]
    (is (= ["src/ui" "src/ui/extra"] (mapv :path mkdirs)))
    (is (= 2 (count writes)))
    (is (some #(= "src/ui/button.cljs" (:path %)) writes))))

(deftest restore-ops-rename-swaps-paths
  (is (= [{:op :rename :from "b" :to "a"}]
         (history/restore-ops {:kind :rename :from "a" :to "b"}))))

(deftest restore-ops-rename-with-snapshot-preserves-current-files
  (let [ops (history/restore-ops {:kind :rename
                                  :from "src/a.cljs"
                                  :to "src/b.cljs"
                                  :files {"src/a.cljs" "(ns a)"
                                          "src/app/core.cljs" "(ns app.core (:require [a]))"}
                                  :dirs []})]
    (is (= [{:op :rename :from "src/b.cljs" :to "src/a.cljs"}] ops))))

(deftest reverse-rename-mapping-uses-legacy-snapshot-without-restoring-it
  (let [entry {:kind :rename :from "src/a.cljs" :to "src/b.cljs"
               :files {"src/a.cljs" "(ns a)\n(def x 1)"
                       "src/app/core.cljs" "(ns app.core (:require [a]))"}}
        restored (first (history/parse (history/stringify [entry])))]
    (is (= [['b 'a]] (history/reverse-rename-mapping entry)))
    (is (= [['b 'a]] (history/reverse-rename-mapping restored))))
  (is (= [] (history/reverse-rename-mapping {:from "a.txt" :to "b.txt"}))))

(deftest restore-ops-overwrite-writes-previous-text
  (is (= [{:op :write :path "src/ui/button.cljs" :content "(ns old)"}]
         (history/restore-ops {:kind :overwrite
                               :path "src/ui/button.cljs"
                               :content "(ns old)"}))))

(deftest age-label-buckets
  (let [now 1.0e12]
    (is (= "just now" (history/age-label now now)))
    (is (= "1m ago" (history/age-label (- now 60000) now)))
    (is (= "5m ago" (history/age-label (- now 300000) now)))
    (is (= "1h ago" (history/age-label (- now 3600000) now)))
    (is (= "3h ago" (history/age-label (- now (* 3 3600000)) now)))
    (is (= "1d ago" (history/age-label (- now 86400000) now)))))

(deftest delete-entry-labels-file-and-folder
  (let [file (history/delete-entry {:type :file
                                    :path "src/app/core.cljs"
                                    :files {"src/app/core.cljs" "x"}
                                    :dirs []})
        folder (history/delete-entry {:type :dir
                                      :path "src/ui"
                                      :files {"src/ui/a.cljs" "a"
                                              "src/ui/b.cljs" "b"}
                                      :dirs ["src/ui"]})]
    (is (= "Deleted src/app/core.cljs" (:label file)))
    (is (= :delete (:kind file)))
    (is (= "Deleted src/ui (2 files)" (:label folder)))))

(deftest rename-entry-keeps-both-paths
  (let [e (history/rename-entry "src/a.cljs" "src/b.cljs")
        with-snap (history/rename-entry "src/a.cljs" "src/b.cljs"
                                        {:files {"src/a.cljs" "(ns a)"}
                                         :dirs []})]
    (is (= :rename (:kind e)))
    (is (= "src/a.cljs" (:from e)))
    (is (= "src/b.cljs" (:to e)))
    (is (nil? (:files e)))
    (is (= "(ns a)" (get (:files with-snap) "src/a.cljs")))
    (is (re-find #"src/a\.cljs" (:label e)))
    (is (re-find #"src/b\.cljs" (:label e)))))

(deftest path-prefix-helpers-still-hold
  (is (paths/starts-with-path? "src/ui/button.cljs" "src/ui"))
  (is (not (paths/starts-with-path? "src/ui-kit/x.cljs" "src/ui"))))
