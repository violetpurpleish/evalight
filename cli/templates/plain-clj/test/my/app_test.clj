(ns my.app-test
  (:require [clojure.test :refer [deftest is]]
            [my.app :as app]))

(deftest greets-by-name
  (is (= "Hello, Ada!" (app/greet "Ada"))))
