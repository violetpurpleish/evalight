(ns evalight.commands-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.commands :as commands]))

(defn- by-id [state id]
  (some #(when (= id (:id %)) %) (commands/items state)))

(deftest palette-includes-word-wrap
  (let [off (by-id {:runtime :sci :tree [] :word-wrap? false} :toggle-word-wrap)
        on (by-id {:runtime :sci :tree [] :word-wrap? true} :toggle-word-wrap)]
    (is (= "Toggle word wrap" (:label off)))
    (is (= "View" (:group off)))
    (is (= [:toggle-word-wrap] (:action off)))
    (is (= "Off" (:hint off)))
    (is (= "On" (:hint on)))))
