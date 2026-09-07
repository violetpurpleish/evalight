(ns evalight.template-test
  (:require [cljs.test :refer [deftest is]]
            [evalight.template :as template]
            ["fs" :as fs]
            ["path" :as path]))

(deftest starter-sources-match-files
  (let [files (template/files "lamp")]
    (is (= (template/core-cljs "lamp") (.readFileSync fs "src/evalight/templates/core.cljs" "utf8")))
    (is (= (get files "src/app/gallery.cljs") (.readFileSync fs "src/evalight/templates/gallery.cljs" "utf8")))
    (is (nil? (get files "src/app/greet.cljs")))
    (is (nil? (get files "src/app/stats.cljs")))))

(deftest gpui-evalight-edn-declares-native-preview
  (let [edn (template/gpui-evalight-edn "counter" "my.app/app")]
    (is (re-find #":runtime :gpui" edn))
    (is (re-find #":preview \{:kind :native\}" edn))
    (is (re-find #"my.app/app" edn))))

(deftest clj-evalight-edn-hides-preview
  (let [edn (template/clj-evalight-edn "lib" "my.lib")]
    (is (re-find #":runtime :clj" edn))
    (is (not (re-find #":preview" edn)))))
