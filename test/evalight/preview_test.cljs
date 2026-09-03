(ns evalight.preview-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.preview :as preview]))

(deftest coerce-runtime-keeps-cljs-editing
  (is (= :sci (preview/coerce-runtime nil)))
  (is (= :sci (preview/coerce-runtime "sci")))
  (is (= :sci (preview/coerce-runtime :sci)))
  (is (= :sci (preview/coerce-runtime "workshop"))
      "Evalight checkout kind must stay on SCI, not a mystery runtime")
  (is (= :compiled (preview/coerce-runtime "compiled")))
  (is (= :compiled (preview/coerce-runtime :compiled))
      "keywords stored on state must round-trip; (keyword (str :compiled)) does not")
  (is (= :compiled (preview/coerce-runtime "cljs"))
      "detectProject kind cljs is compiled local mode, not a third runtime")
  (is (= :clj (preview/coerce-runtime "clj")))
  (is (= :clj (preview/coerce-runtime :clj)))
  (is (= :gpui (preview/coerce-runtime "gpui")))
  (is (= :gpui (preview/coerce-runtime :gpui)))
  (is (contains? preview/known-runtimes (preview/coerce-runtime "cljs")))
  (is (contains? preview/known-runtimes (preview/coerce-runtime "workshop"))))
