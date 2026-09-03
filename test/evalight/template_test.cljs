(ns evalight.template-test
  (:require [cljs.test :refer [deftest is]]
            [evalight.template :as template]
            ["fs" :as fs]
            ["path" :as path]))

(deftest lamp-fixture-matches-template
  (let [p (.join path "test" "evalight" "fixtures" "lamp-core.cljs")
        disk (.readFileSync fs p "utf8")]
    (is (= (template/core-cljs "lamp") disk))))

(deftest gpui-evalight-edn-declares-native-preview
  (let [edn (template/gpui-evalight-edn "counter" "my.app/app")]
    (is (re-find #":runtime :gpui" edn))
    (is (re-find #":preview \{:kind :native\}" edn))
    (is (re-find #"my.app/app" edn))))

(deftest clj-evalight-edn-hides-preview
  (let [edn (template/clj-evalight-edn "lib" "my.lib")]
    (is (re-find #":runtime :clj" edn))
    (is (not (re-find #":preview" edn)))))
