(ns evalight.kit-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.export :as export]
            [evalight.kit :as kit]
            [evalight.template :as template]
            [ui.button :as btn]
            [ui.command :as cmd]
            [ui.core :as ui]
            [ui.dialog :as dialog]
            [ui.breadcrumbs :as crumbs]))

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

(deftest dialog-close-hits-a-backdrop-not-the-panel
  (let [[tag attrs backdrop panel] (dialog/dialog {:on-close [:close] :title "Hi"} "body")]
    (is (= :div.ui-overlay tag))
    (is (nil? (:on attrs)))
    (is (= :ui-dialog (:replicant/key attrs)))
    (is (= :div.ui-backdrop (first backdrop)))
    (is (= {:on {:click [:close]}} (select-keys (second backdrop) [:on])))
    (is (= :div.ui-dialog (first panel)))
    (is (nil? (:on (second panel))))))

(deftest template-ships-evalight-in-the-project
  (let [files (template/files "lamp")
        pkg (get files "package.json")
        readme (get files "README.md")]
    (is (re-find #"\"evalight\": \"bun evalight/server.mjs\"" pkg))
    (is (re-find #"bun run evalight" readme))
    (is (nil? (re-find #"bun run local /path" readme)))
    (is (not (template/stale-evalight-readme? readme)))
    (is (re-find #"Copyright \(c\) 2026 violetpurpleish" (get files "LICENSE")))
    (is (re-find #"evalight/public/licenses.html" readme))))

(deftest stale-readme-is-the-old-clone-evalight-copy
  (let [old (str "# lamp\n\n"
                 "A ClojureScript project created in Evalight.\n\n"
                 "## Keep editing in Evalight\n\n"
                 "From a checkout of Evalight:\n\n"
                 "```sh\n"
                 "bun install\n"
                 "bun run local /path/to/lamp\n"
                 "```\n")
        out (export/rewrite-docs {"README.md" old "package.json" "{\"scripts\":{}}"} "lamp")]
    (is (template/stale-evalight-readme? old))
    (is (not (template/stale-evalight-readme? (template/readme "lamp"))))
    (is (not (template/stale-evalight-readme? "# Evalight\n\nbun run local /path/to/a/folder\n")))
    (is (re-find #"bun run evalight" (get out "README.md")))
    (is (nil? (re-find #"bun run local /path" (get out "README.md"))))
    (is (re-find #"\"evalight\": \"bun evalight/server.mjs\"" (get out "package.json")))
    (is (re-find #"violetpurpleish" (get out "LICENSE")))))

(deftest template-ships-the-kit
  (let [files (template/files "lamp")]
    (is (re-find #"\(ns ui.button" (get files "src/ui/button.cljs")))
    (is (re-find #"\.ui-btn" (get files "public/css/ui.css")))
    (is (re-find #"ui.button" (get files "src/app/core.cljs")))
    (is (re-find #"public/css/ui.css" (get files "evalight.edn")))))

(deftest lamp-rename-save-is-a-click-not-a-submit
  (let [src (get (template/files "lamp") "src/app/core.cljs")]
    (is (re-find #":type \"button\".*Save" src))
    (is (nil? (re-find #"type \"submit\"" src)))
    (is (re-find #"ui.core :as ui" src))))

(deftest files-for-button-includes-core-and-css
  (let [paths (set (map :path (kit/files-for "button")))]
    (is (contains? paths "src/ui/core.cljs"))
    (is (contains? paths "src/ui/button.cljs"))
    (is (contains? paths "public/css/ui.css"))))

(deftest with-ui-css-inserts-href
  (is (re-find #"public/css/ui.css"
               (kit/with-ui-css "{:name \"x\" :main app.core :preview {:css [\"public/style.css\"]}}"))))

(deftest present-ids-from-paths
  (is (= #{"button" "dialog"}
         (kit/present-ids ["src/ui/button.cljs" "src/ui/dialog.cljs" "src/app/core.cljs"])))
  (is (= #{} (kit/present-ids [])))
  (is (not (contains? (kit/present-ids ["src/ui/core.cljs"]) "button"))))

(deftest files-for-command-includes-input-and-css
  (let [paths (set (map :path (kit/files-for "command")))]
    (is (contains? paths "src/ui/core.cljs"))
    (is (contains? paths "src/ui/input.cljs"))
    (is (contains? paths "src/ui/command.cljs"))
    (is (contains? paths "public/css/ui.css"))))

(deftest files-for-breadcrumbs-includes-core-and-css
  (let [paths (set (map :path (kit/files-for "breadcrumbs")))]
    (is (contains? paths "src/ui/core.cljs"))
    (is (contains? paths "src/ui/breadcrumbs.cljs"))
    (is (contains? paths "public/css/ui.css"))))

(deftest template-ships-new-kit-controls
  (let [files (template/files "lamp")]
    (is (re-find #"\(ns ui.breadcrumbs" (get files "src/ui/breadcrumbs.cljs")))
    (is (re-find #"\(ns ui.command" (get files "src/ui/command.cljs")))))

(deftest breadcrumbs-hiccup-joins-with-slash-text
  (let [el (crumbs/breadcrumbs
            {:items [{:id "src" :label "src"}
                     {:id "src/app" :label "app" :current? true}]})
        wrap (nth el 3)
        sep (nth wrap 2)]
    (is (= :nav.ui-crumbs (first el)))
    (is (= :span.ui-crumb-sep (first sep)))
    (is (= "/" (last sep)))))

(deftest command-closed-when-open?-is-false
  (is (nil? (cmd/command {:open? false :items [{:id :a :label "A"}]}))))
