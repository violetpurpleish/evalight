(ns evalight.template-test
  (:require [cljs.test :refer [deftest is]]
            [evalight.template :as template]
            ["fs" :as fs]
            ["path" :as path]))

(deftest lamp-fixture-matches-template
  (let [p (.join path "test" "evalight" "fixtures" "lamp-core.cljs")
        disk (.readFileSync fs p "utf8")]
    (is (= (template/core-cljs "lamp") disk))))
