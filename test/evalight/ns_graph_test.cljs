(ns evalight.ns-graph-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.ns-graph :as ns-graph]
            [evalight.paths :as paths]))

(deftest parse-ns-reads-requires
  (is (= {:name 'app.core
          :requires ['app.greet 'replicant.dom]}
         (ns-graph/parse-ns
          "(ns app.core\n  (:require [app.greet :as greet]\n            [replicant.dom :as r]))\n\n(defn init [])"))))

(deftest load-order-puts-dependencies-first
  (let [files [{:path "src/app/core.cljs"
                :source "(ns app.core (:require [app.greet :as g]))"}
               {:path "src/app/greet.cljs"
                :source "(ns app.greet)"}]
        ordered (map :path (ns-graph/load-order files "app.core"))]
    (is (= ["src/app/greet.cljs" "src/app/core.cljs"] ordered))))

(deftest path-helpers
  (is (= "src/app/core.cljs" (paths/join "src" "app/core.cljs")))
  (is (= "core.cljs" (paths/basename "src/app/core.cljs")))
  (is (= "src/app" (paths/dirname "src/app/core.cljs")))
  (is (= "cljs" (paths/ext "src/app/core.cljs")))
  (is (paths/clojure-file? "src/app/core.cljs"))
  (is (= "amber-counter" (paths/slug "Amber Counter!"))))
