(ns evalight.intel-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.intel :as intel]
            [evalight.ns-graph :as ns-graph]
            [evalight.template :as template]
            [sci.core :as sci]))

(deftest def-docs-reads-lamp-bump
  (let [docs (ns-graph/def-docs (template/core-cljs "lamp"))]
    (is (re-find #"counter" (get docs 'bump)))))

(deftest parse-ns-aliases
  (is (= {'greet 'app.greet 'r 'replicant.dom}
         (:aliases (ns-graph/parse-ns
                    "(ns app.core\n  (:require [app.greet :as greet]\n            [replicant.dom :as r]))")))))

(deftest source-index-completes-project-vars
  (intel/set-live! [] "app.core")
  (intel/index-sources!
   [{:path "src/app/core.cljs" :source "(ns app.core (:require [app.greet :as greet])) (defn bump [] 1)"}
    {:path "src/app/greet.cljs" :source (template/greet-cljs)}]
   "app.core")
  (is (some #(= "bump" (:name %)) (intel/candidates "bum")))
  (is (some #(= "greet/greet" (:name %)) (intel/candidates "greet/")))
  (is (re-find #"tiny helper" (:doc (intel/lookup "greet/greet")))))

(deftest live-intel-wins-over-source
  (intel/index-sources!
   [{:path "src/app/core.cljs" :source "(ns app.core)\n(defn bump \"from source\" [] 1)"}]
   "app.core")
  (intel/set-live! [{:name "bump" :kind "var" :ns "app.core" :doc "from SCI"}] "app.core")
  (is (= "from SCI" (:doc (intel/lookup "bump")))))

(deftest live-intel-keeps-source-docs
  (intel/index-sources!
   [{:path "src/app/core.cljs" :source "(ns app.core)\n(defn bump \"Increment the lamp.\" [] 1)"}]
   "app.core")
  (intel/set-live! [{:name "bump" :kind "var" :ns "app.core"}] "app.core")
  (is (re-find #"Increment" (:doc (intel/lookup "bump")))))

(deftest live-intel-hovers-referred-core
  (intel/index-sources! [] "todomvc.app")
  (intel/set-live!
   [{:name "toggle-item" :kind "var" :ns "todomvc.app" :doc "Flip one todo."}
    {:name "defn" :kind "core" :ns "clojure.core" :macro true
     :arglists "([name doc-string? attr-map? [params*] prepost-map? body*] [name doc-string? attr-map? ([params*] prepost-map? body*)+])"
     :doc "Same as (def name (fn [params*] exprs*)) …"}
    {:name "swap!" :kind "core" :ns "clojure.core"
     :arglists "([atom f] [atom f x] [atom f x y] [atom f x y & args])"
     :doc "Atomically swaps the value of atom to be (apply f current-value-of-atom args)."}]
   "todomvc.app")
  (is (re-find #"def name" (:doc (intel/lookup "defn"))))
  (is (re-find #"Atomically swaps" (:doc (intel/lookup "swap!"))))
  (is (= "clojure.core" (:ns (intel/lookup "swap!"))))
  (is (some #(= "swap!" (:name %)) (intel/candidates "swa")))
  (is (not (some #(= "swap!" (:name %)) (intel/candidates "")))
      "blank completions stay on project vars, not the whole of clojure.core"))

(deftest live-intel-unwraps-quoted-arglists
  (intel/index-sources! [] "app.core")
  (intel/set-live!
   [{:name "ui/dom-event" :kind "var" :ns "ui.core"
     :arglists "(quote ([e]))"
     :doc "Replicant calls handlers with a map."}
    {:name "bump" :kind "var" :ns "app.core" :arglists "([])"}
    {:name "swap!" :kind "var" :ns "cljs.core"
     :arglists "(quote ([a f] [a f x] [a f x y] [a f x y & zs]))"}]
   "app.core")
  (is (= "([e])" (:arglists (intel/lookup "ui/dom-event"))))
  (is (= "([])" (:arglists (intel/lookup "bump"))))
  (is (= "([a f] [a f x] [a f x y] [a f x y & zs])"
         (:arglists (intel/lookup "swap!"))))
  (is (nil? (re-find #"quote" (or (:arglists (intel/lookup "ui/dom-event")) "")))))

(deftest sci-intel-form-sees-bump
  (let [ctx (sci/init {})]
    (sci/eval-string* ctx "(ns app.core)\n(defn bump \"Increment the lamp counter.\" [] 1)")
    (sci/eval-string* ctx "(in-ns 'app.core)")
    (is (contains? (set (keys (sci/eval-string* ctx "(ns-interns 'app.core)"))) 'bump))
    (is (re-find #"lamp counter"
                 (or (:doc (meta (get (sci/eval-string* ctx "(ns-interns 'app.core)") 'bump)))
                     "")))))

(deftest sci-built-in-metadata-restores-docstring
  (let [ctx (sci/init {})
        _ (sci/eval-string* ctx "(ns app.core)")
        metadata (meta (sci/resolve ctx 'defn))
        item (intel/enrich-live-item
              {:name "defn" :kind "core"
               :arglists "([name doc-string? attr-map? [params*] prepost-map? body])"}
              metadata)]
    (is (re-find #"Same as" (:doc item)))
    (is (= "([name doc-string? attr-map? [params*] prepost-map? body])"
           (:arglists item)))))
