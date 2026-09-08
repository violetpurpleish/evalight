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

(deftest starter-declares-forward-refs
  (let [src (template/core-cljs "lamp")
        out (ns-graph/with-forward-refs src)]
    (is (= '[theme set-theme! store view render bump init] (ns-graph/top-level-defs src)))
    (is (re-find #"\(declare render bump\)" src))
    (is (re-find #"\(declare theme set-theme! store view render bump init\)" out))))

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
  (is (paths/image-file? "resources/icon.png"))
  (is (paths/image-file? "public/og.JPG"))
  (is (not (paths/image-file? "logo.svg")))
  (is (paths/binary-file? "resources/icon.png"))
  (is (paths/binary-file? "fonts/app.woff2"))
  (is (not (paths/binary-file? "src/app/core.cljs")))
  (is (= "image/png" (paths/mime "resources/icon.png")))
  (is (= "application/octet-stream" (paths/mime "secret.bin")))
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

(deftest rewrite-namespace-references-preserves-literals-and-boundaries
  (let [source (str "; (ns app.greet) and app.greet/answer stay in the comment\n"
                    "(ns app.core\n"
                    "  \"Documentation mentions app.greet and \\\"app.greet/answer\\\".\"\n"
                    "  (:require [app.greet :as g] [app.greet.extra :as extra]))\n"
                    "(app.greet/answer) #'app.greet/answer 'app.greet/answer\n"
                    "[app.greet.extra/answer other.app.greet/answer g/answer app.greet']\n"
                    "[:app.greet/answer ::app.greet/answer \"app.greet/answer\" #\"app.greet/answer\"]\n"
                    "[\\; \\\" \\newline] app.greet/answer\n")
        expected (str "; (ns app.greet) and app.greet/answer stay in the comment\n"
                      "(ns app.core\n"
                      "  \"Documentation mentions app.greet and \\\"app.greet/answer\\\".\"\n"
                      "  (:require [app.hello :as g] [app.greet.extra :as extra]))\n"
                      "(app.hello/answer) #'app.hello/answer 'app.hello/answer\n"
                      "[app.greet.extra/answer other.app.greet/answer g/answer app.greet']\n"
                      "[:app.greet/answer ::app.greet/answer \"app.greet/answer\" #\"app.greet/answer\"]\n"
                      "[\\; \\\" \\newline] app.hello/answer\n")]
    (is (= expected (ns-graph/rewrite-ns-sym source 'app.greet 'app.hello)))))

(deftest rewrite-namespaces-is-simultaneous-and-reversible
  (let [source "(ns app.a (:require [app.b :as b] [app.a.extra :as x]))\n[app.a/f app.b/f app.a.extra/f]"
        mapping {'app.a 'app.b 'app.b 'app.c 'app.a.extra 'app.b.extra}
        rewritten (ns-graph/rewrite-ns-syms source mapping)]
    (is (= "(ns app.b (:require [app.c :as b] [app.b.extra :as x]))\n[app.b/f app.c/f app.b.extra/f]"
           rewritten))
    (is (= source (ns-graph/rewrite-ns-syms rewritten
                                          {'app.b 'app.a 'app.c 'app.b 'app.b.extra 'app.a.extra})))
    (is (= source (ns-graph/rewrite-ns-syms source {nil 'app.invalid 'app.a ""}))))
  (is (= "(app.hello/answer)"
         (ns-graph/rewrite-ns-sym "(app.greet/answer)" 'app.greet 'app.hello))))

(deftest renamed-fully-qualified-calls-can-reload
  (let [mapping {'app.helper 'app.utility}
        helper (ns-graph/rewrite-ns-syms "(ns app.helper) (defn answer [] 42)" mapping)
        core (ns-graph/rewrite-ns-syms
              "(ns app.core (:require [app.helper :as helper])) (app.helper/answer)"
              mapping)
        ctx (sci/init {})]
    (sci/eval-string* ctx helper)
    (is (= 42 (sci/eval-string* ctx core)))))

(deftest rewrite-config-entry-points-preserves-formatting
  (let [mapping {'app.core 'app.main}]
    (is (= "{:name \"app.core\", :main app.main ; app.core stays in comment\n :preview :browser}"
           (ns-graph/rewrite-config-ns-syms
            "{:name \"app.core\", :main app.core ; app.core stays in comment\n :preview :browser}"
            mapping)))
    (is (= "{:builds {:app {:modules {:main {:init-fn app.main/init}}\n :devtools {:after-load app.main/reload} :entries [app.main app.core.extra]}}}"
           (ns-graph/rewrite-config-ns-syms
            "{:builds {:app {:modules {:main {:init-fn app.core/init}}\n :devtools {:after-load app.core/reload} :entries [app.core app.core.extra]}}}"
            mapping)))))

(deftest conventional-move-understands-munged-clojure-paths
  (is (= 'app.my-helper (ns-graph/path->ns "src/app/my_helper.cljs")))
  (is (= ['app.my-helper 'app.new-helper]
         (ns-graph/conventional-move "src/app/my_helper.cljs"
                                     "(ns app.my-helper)"
                                     "src/app/new_helper.cljs"))))

(deftest namespace-renames-preserve-local-names-and-aliases
  (is (= "(ns b)\n(def a 1) (let [a 2] a) (b/f)"
         (ns-graph/rewrite-ns-sym "(ns a)\n(def a 1) (let [a 2] a) (a/f)" 'a 'b)))
  (is (= "(ns core (:require [b :as a :refer [a]]))\n(def a 1) (let [a 2] a) (a/f)"
         (ns-graph/rewrite-ns-sym
          "(ns core (:require [a :as a :refer [a]]))\n(def a 1) (let [a 2] a) (a/f)"
          'a 'b)))
  (is (= "(ns ^{:doc \"a\"} b (:require [other :as a]) (:refer-clojure :exclude [a]))\n(def a 1) (a/f)"
         (ns-graph/rewrite-ns-sym
          "(ns ^{:doc \"a\"} a (:require [other :as a]) (:refer-clojure :exclude [a]))\n(def a 1) (a/f)"
          'a 'b)))
  (is (= "{:main b :init-fn b/f}"
         (ns-graph/rewrite-config-ns-syms "{:main a :init-fn a/f}" {'a 'b}))))
