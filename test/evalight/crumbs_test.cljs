(ns evalight.crumbs-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.crumbs :as crumbs]
            [ui.command :as cmd]
            [ui.core :as ui]))

(def tree
  [{:type :dir :name "src" :path "src"
    :children [{:type :dir :name "app" :path "src/app"
                :children [{:type :file :name "core.cljs" :path "src/app/core.cljs"}
                           {:type :file :name "greet.cljs" :path "src/app/greet.cljs"}]}
               {:type :dir :name "ui" :path "src/ui"
                :children [{:type :file :name "button.cljs" :path "src/ui/button.cljs"}]}]}
   {:type :file :name "README.md" :path "README.md"}])

(deftest trail-is-one-crumb-per-segment
  (let [trail (crumbs/from-path "src/app/core.cljs")]
    (is (= ["src" "app" "core.cljs"] (mapv :label trail)))
    (is (= ["src" "src/app" "src/app/core.cljs"] (mapv :id trail)))
    (is (true? (:current? (last trail))))
    (is (not (:current? (first trail))))))

(deftest siblings-of-a-file-are-the-parent-children
  (let [rows (crumbs/sibling-rows tree "src/app/core.cljs" "src/app/core.cljs")
        labels (mapv :label rows)]
    (is (= ["core.cljs" "greet.cljs"] labels))
    (is (true? (:current? (first rows))))))

(deftest children-of-src-include-app
  (let [rows (crumbs/child-rows tree "src" nil)]
    (is (= ["app/" "ui/"] (mapv :label rows)))))

(deftest find-node-walks-the-tree
  (is (= :file (:type (crumbs/find-node tree "src/app/greet.cljs"))))
  (is (= :dir (:type (crumbs/find-node tree "src/ui"))))
  (is (nil? (crumbs/find-node tree "nope"))))

(deftest command-visible-filters-by-substring
  (let [items [{:id :a :label "New file" :group "Files"}
               {:id :b :label "Run" :hint "preview" :group "Preview"}]]
    (is (= [:a :b] (mapv :id (cmd/visible items ""))))
    (is (= [:a] (mapv :id (cmd/visible items "FILE"))))
    (is (= [:b] (mapv :id (cmd/visible items "prev"))))
    (is (= [] (cmd/visible items "xyzzy")))))

(deftest emit-appends-to-action-vectors
  (is (= [:open "src/app"] (ui/emit [:open] "src/app")))
  (is (= [:open "src/app"] (ui/emit :open "src/app")))
  (is (nil? (ui/emit nil "x"))))
