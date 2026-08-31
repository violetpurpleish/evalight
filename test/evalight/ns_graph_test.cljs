(ns evalight.ns-graph-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.ns-graph :as ns-graph]
            [evalight.paths :as paths]
            [evalight.template :as template]
            [sci.core :as sci]))

(deftest def-docs-ignores-non-string-source
  (is (= {} (ns-graph/def-docs {:path "src/app/core.cljs" :content "(defn foo [] \"x\")"}))))

(deftest parse-ns-reads-requires
  (is (= {:name 'app.core
          :requires ['app.greet 'replicant.dom]
          :aliases {'greet 'app.greet 'r 'replicant.dom}}
         (ns-graph/parse-ns
          "(ns app.core\n  (:require [app.greet :as greet]\n            [replicant.dom :as r]))\n\n(defn init [])"))))

(deftest top-level-defs-reads-interned-names
  (is (= '[store render bump view init]
         (ns-graph/top-level-defs
          "(ns app.core)\n(defonce store (atom {}))\n(defn render [])\n(defn bump [])\n(defn view [m] m)\n(defn init [])"))))

(deftest forward-refs-eval-like-cljs
  (let [src "(ns app.demo)\n(defn render [] (view))\n(defn view [] :ok)\n(render)"]
    (is (nil? (try
                (sci/eval-string* (sci/init {}) src)
                (catch :default _
                  nil))))
    (is (= :ok (sci/eval-string* (sci/init {}) (ns-graph/with-forward-refs src))))))

(deftest with-forward-refs-covers-nested-fn
  (let [src (str "(ns app.core)\n"
                 "(defn view [] (fn [] (bump)))\n"
                 "(defn bump [] :lit)\n"
                 "((view))")
        out (ns-graph/with-forward-refs src)]
    (is (re-find #"\(declare view bump\)" out))
    (is (= :lit (sci/eval-string* (sci/init {}) out)))))

(deftest lamp-template-declares-forward-refs
  (let [src (template/core-cljs "lamp")
        out (ns-graph/with-forward-refs src)]
    (is (= '[store view render bump toggle-about open-rename close-rename save-title retitle init]
           (ns-graph/top-level-defs src)))
    (is (re-find #"\(declare bump toggle-about open-rename close-rename save-title retitle\)" src))
    (is (re-find #"\(declare store view render bump toggle-about open-rename close-rename save-title retitle init\)" out))))

(deftest load-order-puts-dependencies-first
  (let [files [{:path "src/app/core.cljs"
                :source "(ns app.core (:require [app.greet :as g]))"}
               {:path "src/app/greet.cljs"
                :source "(ns app.greet)"}]
        ordered (map :path (ns-graph/load-order files "app.core"))]
    (is (= ["src/app/greet.cljs" "src/app/core.cljs"] ordered))))

(deftest path-helpers
  (is (= "evalight/projects/lamp" (paths/join ["evalight" "projects" "lamp"])))
  (is (= "evalight/projects/lamp" (paths/join "evalight" "projects" "lamp")))
  (is (= "core.cljs" (paths/basename "src/app/core.cljs")))
  (is (= "src/app" (paths/dirname "src/app/core.cljs")))
  (is (= "cljs" (paths/ext "src/app/core.cljs")))
  (is (paths/clojure-file? "src/app/core.cljs"))
  (is (= "amber-counter" (paths/slug "Amber Counter!")))
  (is (= "src/app/hello.cljs" (paths/remap-under "src/app/greet.cljs" "src/app/greet.cljs" "src/app/hello.cljs")))
  (is (= "src/foo/greet.cljs" (paths/remap-under "src/app/greet.cljs" "src/app" "src/foo")))
  (is (= "src/ui/button.cljs" (paths/remap-under "src/ui/button.cljs" "src/app" "src/foo"))))

(deftest path->ns-strips-src
  (is (= 'app.greet (ns-graph/path->ns "src/app/greet.cljs")))
  (is (= 'app.hello (ns-graph/path->ns "src/app/hello.cljs"))))

(deftest rewrite-ns-sym-updates-require-and-declaration
  (let [core "(ns app.core\n  (:require [app.greet :as greet]\n            [app.stats :as stats]))\n\n(defn init [] (greet/greet \"x\"))\n"
        greet "(ns app.greet)\n\n(defn greet [name] name)\n"]
    (is (= "(ns app.core\n  (:require [app.hello :as greet]\n            [app.stats :as stats]))\n\n(defn init [] (greet/greet \"x\"))\n"
           (ns-graph/rewrite-ns-sym core 'app.greet 'app.hello)))
    (is (= "(ns app.hello)\n\n(defn greet [name] name)\n"
           (ns-graph/rewrite-ns-sym greet 'app.greet 'app.hello)))
    (is (= core (ns-graph/rewrite-ns-sym core 'app.greet.extra 'app.x)))
    (let [both "(ns app.core (:require [app.greet.extra :as x] [app.greet :as g]))"
          out (ns-graph/rewrite-ns-sym both 'app.greet 'app.hello)]
      (is (re-find #"app\.greet\.extra" out))
      (is (re-find #"app\.hello" out)))))

(deftest requiring-finds-callers
  (let [files [{:path "src/app/core.cljs"
                :source "(ns app.core (:require [app.greet :as g] [app.stats :as s]))"}
               {:path "src/app/greet.cljs"
                :source "(ns app.greet)"}]]
    (is (= ["src/app/core.cljs"] (mapv :path (ns-graph/requiring files 'app.greet))))
    (is (= [] (ns-graph/requiring files 'app.missing)))))

(deftest conventional-move-follows-path
  (is (= ['app.greet 'app.hello]
         (ns-graph/conventional-move
          "src/app/greet.cljs"
          "(ns app.greet)\n"
          "src/app/hello.cljs")))
  (is (nil? (ns-graph/conventional-move
             "src/app/greet.cljs"
             "(ns weird.custom)\n"
             "src/app/hello.cljs"))))
