(ns evalight.export-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.export :as export]
            [evalight.fs :as fs]))

(deftest skip-evalight-folder
  (is (fs/skip? "evalight" "evalight"))
  (is (fs/skip? "evalight-ui" "evalight-ui"))
  (is (not (fs/skip? "evalight" "src/evalight")))
  (is (not (fs/skip? "src" "src"))))

(deftest with-evalight-script-adds-script
  (let [out (export/with-evalight-script "{\"name\":\"lamp\",\"scripts\":{\"dev\":\"x\"}}")]
    (is (re-find #"\"evalight\": \"bun evalight/server.mjs\"" out))
    (is (re-find #"\"dev\": \"x\"" out))))

(deftest with-evalight-script-keeps-broken-json
  (is (= "{not json" (export/with-evalight-script "{not json"))))
