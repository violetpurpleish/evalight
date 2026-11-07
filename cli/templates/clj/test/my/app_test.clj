(ns my.app-test
  (:require [clojure.test :refer [deftest is]]
            [my.app :as app]))

(deftest starts-with-zero-clicks
  (is (= 0 (:n @app/!state))))
