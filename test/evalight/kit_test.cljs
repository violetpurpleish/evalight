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
    (is (nil? (:class (second el))))
    (is (= :span.ui-crumb-sep (first sep)))
    (is (= "/" (last sep)))))

(deftest breadcrumbs-open-mark-the-nav
  (let [el (crumbs/breadcrumbs
            {:items [{:id "src" :label "src"}]
             :open-id "src"
             :menu [{:id "src/app" :label "app"}]
             :on-dismiss [:close]})]
    (is (= "is-open" (:class (second el))))
    (is (= :div.ui-crumbs-dismiss (first (nth el 2))))))

(deftest command-closed-when-open?-is-false
  (is (nil? (cmd/command {:open? false :items [{:id :a :label "A"}]}))))

(defn- find-tag [el tag]
  (cond
    (and (vector? el) (= tag (first el))) el
    (vector? el) (some #(find-tag % tag) el)
    (sequential? el) (some #(find-tag % tag) el)
    :else nil))

(deftest command-list-children-are-elements
  (let [el (cmd/command {:open? true
                         :items [{:id :new-file
                                  :label "New file"
                                  :group "Files"
                                  :action [:go]}]})
        list (find-tag el :div.ui-command-list)
        kids (->> (if (map? (second list)) (nnext list) (next list))
                  (remove nil?))]
    (is (seq kids))
    (is (every? #(and (vector? %) (keyword? (first %))) kids))
    (is (some #{:button.ui-command-item} (map first kids)))
    (is (some #{:div.ui-command-group} (map first kids)))))

(deftest command-active-row-reveals-in-list
  (let [el (cmd/command {:open? true
                         :active :b
                         :items [{:id :a :label "A"}
                                 {:id :b :label "B"}]})
        list (find-tag el :div.ui-command-list)
        kids (->> (if (map? (second list)) (nnext list) (next list))
                  (remove nil?))
        buttons (filter #(= :button.ui-command-item (first %)) kids)
        attrs (map second buttons)]
    (is (= 2 (count buttons)))
    (is (fn? (:replicant/on-render (second attrs))))
    (is (nil? (:replicant/on-render (first attrs))))
    (is (some #{"is-active"} (:class (second attrs))))))

(deftest command-pick-closes-then-runs
  (let [log (atom [])
        dispatch (fn [_e handler] (swap! log conj handler))
        el (cmd/command {:open? true
                         :on-close [:pick-close]
                         :items [{:id :a :label "A" :action [:go]}]})
        btn (find-tag el :button.ui-command-item)
        click (:click (:on (second btn)))
        handler (:replicant.event/handler click)]
    (is (map? click))
    (is (true? (:replicant.event/wrap-handler? click)))
    (is (fn? handler))
    (handler {:replicant/dispatch dispatch})
    (is (= [[:pick-close] [:go]] @log))))

(deftest command-pick-without-on-close-keeps-the-action
  (let [el (cmd/command {:open? true
                         :items [{:id :a :label "A" :action [:go]}]})
        btn (find-tag el :button.ui-command-item)]
    (is (= [:go] (:click (:on (second btn)))))))
