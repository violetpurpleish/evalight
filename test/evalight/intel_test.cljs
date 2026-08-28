(ns evalight.intel-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.intel :as intel]
            [evalight.ns-graph :as ns-graph]
            [evalight.template :as template]
            [sci.core :as sci]))

(deftest def-docs-reads-lamp-bump
  (let [docs (ns-graph/def-docs (template/core-cljs "lamp"))]
    (is (re-find #"lamp counter" (get docs 'bump)))))

(deftest parse-ns-aliases
  (is (= {'greet 'app.greet 'r 'replicant.dom}
         (:aliases (ns-graph/parse-ns
                    "(ns app.core\n  (:require [app.greet :as greet]\n            [replicant.dom :as r]))")))))

(deftest source-index-completes-project-vars
  (intel/set-live! [] "app.core")
  (intel/index-sources!
   [{:path "src/app/core.cljs" :source (template/core-cljs "lamp")}
    {:path "src/app/greet.cljs" :source (template/greet-cljs)}]
   "app.core")
  (is (some #(= "bump" (:name %)) (intel/candidates "bum")))
  (is (some #(= "greet/greet" (:name %)) (intel/candidates "greet/")))
  (is (re-find #"tiny helper" (:doc (intel/lookup "greet/greet")))))

(deftest live-intel-wins-over-source
  (intel/index-sources!
   [{:path "src/app/core.cljs" :source "(ns app.core)\n(defn bump [])"}]
   "app.core")
  (intel/set-live! [{:name "bump" :kind "var" :ns "app.core" :doc "from SCI"}] "app.core")
  (is (= "from SCI" (:doc (intel/lookup "bump")))))

(deftest sci-intel-form-sees-bump
  (let [ctx (sci/init {})]
    (sci/eval-string* ctx "(ns app.core)\n(defn bump \"Increment the lamp counter.\" [] 1)")
    (sci/eval-string* ctx "(in-ns 'app.core)")
    (is (contains? (set (keys (sci/eval-string* ctx "(ns-interns 'app.core)"))) 'bump))
    (is (re-find #"lamp counter"
                 (or (:doc (meta (get (sci/eval-string* ctx "(ns-interns 'app.core)") 'bump)))
                     "")))))
