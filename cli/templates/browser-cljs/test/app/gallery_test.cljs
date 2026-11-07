(ns app.gallery-test
  (:require [app.gallery :as gallery]
            [cljs.test :refer [deftest is]]))

(deftest labels-an-example
  (is (= [:section.example
          [:h2 "Example"]
          [:div.example-preview [:p "Content"]]]
         (gallery/example "Example" [:p "Content"]))))
