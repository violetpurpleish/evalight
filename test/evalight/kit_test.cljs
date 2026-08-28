(ns evalight.kit-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.kit :as kit]
            [evalight.template :as template]
            [ui.button :as btn]
            [ui.core :as ui]))

(deftest cx-drops-blank-and-names-keywords
  (is (= ["ui-btn" "ui-btn-primary"]
         (ui/cx ["ui-btn" nil false] :ui-btn-primary ""))))

(deftest button-hiccup
  (let [el (btn/button {:variant :primary :class "lamp"} "Go")
        tag (first el)
        attrs (second el)]
    (is (= :button tag))
    (is (some #{"ui-btn"} (:class attrs)))
    (is (some #{"ui-btn-primary"} (:class attrs)))
    (is (some #{"lamp"} (:class attrs)))
    (is (= "Go" (last el)))))

(deftest template-ships-the-kit
  (let [files (template/files "lamp")]
    (is (re-find #"\(ns ui.button" (get files "src/ui/button.cljs")))
    (is (re-find #"\.ui-btn" (get files "public/css/ui.css")))
    (is (re-find #"ui.button" (get files "src/app/core.cljs")))
    (is (re-find #"public/css/ui.css" (get files "evalight.edn")))))

(deftest files-for-button-includes-core-and-css
  (let [paths (set (map :path (kit/files-for "button")))]
    (is (contains? paths "src/ui/core.cljs"))
    (is (contains? paths "src/ui/button.cljs"))
    (is (contains? paths "public/css/ui.css"))))

(deftest with-ui-css-inserts-href
  (is (re-find #"public/css/ui.css"
               (kit/with-ui-css "{:name \"x\" :main app.core :preview {:css [\"public/style.css\"]}}"))))
