(ns ui.tree
  "A controlled hierarchical tree.

  `:nodes` (or the `:items` alias) contains nodes with `:id` (or `:path`),
  `:name` (or `:label`), `:type` (`:dir` or `:file`), and optional
  `:children`. `:expanded` is the set of expanded directory ids. `:on-toggle`
  and `:on-select` receive an id and accept a function, keyword, or dispatch
  vector. `:render-icon`, `:render-trailing`, and `:render-actions` are
  optional functions receiving the node; they keep application-specific
  visuals and controls out of the shared tree. Arrow keys navigate visible
  rows; Right and Left expand, collapse, or move to the parent."
  (:require [ui.core :as ui]))

(defn- node-id [node]
  (or (:id node) (:path node) (:name node) (:label node)))

(defn- node-label [node]
  (or (:label node) (:name node) (str (:id node))))

(defn- directory? [node]
  (= :dir (:type node)))

(defn- visible-ids [nodes expanded]
  (mapcat (fn [node]
            (let [id (node-id node)]
              (if (and (directory? node) (contains? expanded id))
                (cons id (visible-ids (:children node) expanded))
                [id])))
          nodes))

(defn- node-id-map [nodes]
  (reduce (fn [result node]
            (let [id (node-id node)
                  result (assoc result (str id) id)]
              (if (directory? node)
                (merge result (node-id-map (:children node)))
                result)))
          {}
          nodes))

(defn- disclosure-chevron []
  [:svg.tree-chevron
   {:viewBox "0 0 12 12"
    :width "14"
    :height "14"
    :fill "none"
    :stroke "currentColor"
    :stroke-width "1.8"
    :stroke-linecap "round"
    :stroke-linejoin "round"
    :aria-hidden "true"}
   [:path {:d "M3 2.25 8.75 6 3 9.75"}]])

(defn- item-button [node {:keys [expanded selected focus-id on-toggle on-select
                                render-icon render-trailing]}]
  (let [id (node-id node)
        dir? (directory? node)
        open? (contains? expanded id)
        handler (if dir? on-toggle on-select)]
    [:button.tree-item
     {:type "button"
      :role "treeitem"
      :class (when (and (not dir?) (= id selected)) "is-active")
      :aria-expanded (when dir? (boolean open?))
      :aria-selected (when-not dir? (= id selected))
      :tabindex (if (= id focus-id) 0 -1)
      :data-tree-has-children (when dir? (boolean (seq (:children node))))
      :on {:click (ui/emit handler id)}}
     (if dir?
       [:span.twisty {:class (when open? "is-open")}
        (disclosure-chevron)]
       [:span.twisty.tree-leaf {:aria-hidden "true"}
        (disclosure-chevron)])
     (when render-icon (render-icon node))
     [:span.tree-name (node-label node)]
     (when render-trailing (render-trailing node))]))

(defn- child-elements [value]
  (cond
    (nil? value) []
    (and (vector? value) (keyword? (first value))) [value]
    (sequential? value) value
    :else [value]))

(declare tree-node)
(declare tree-buttons)

(defn- focus! [button]
  (when button
    (when-let [root (.closest button ".ui-tree")]
      (doseq [item (tree-buttons root)]
        (.setAttribute item "tabindex" "-1"))
      (.setAttribute button "tabindex" "0"))
    (.focus button)))

(defn- tree-buttons [root]
  (vec (array-seq (.querySelectorAll root "[role=treeitem]"))))

(defn- first-child-button [dir]
  (some-> dir (.querySelector ":scope > .tree-children [role=treeitem]")))

(defn- parent-button [button]
  (when-let [group (.closest button ".tree-children")]
    (some-> group .-parentElement
            (.querySelector ":scope > .tree-row > [role=treeitem]"))))

(defn- find-dir [root id]
  (some (fn [dir]
          (when (= (.getAttribute dir "data-tree-id") (str id))
            dir))
        (array-seq (.querySelectorAll root ".tree-dir"))))

(defn- focus-first-child-later [root id]
  (when-let [win (some-> root .-ownerDocument .-defaultView)]
    (.requestAnimationFrame
     win
     (fn [_]
       (some-> (find-dir root id) first-child-button focus!)))))

(defn- tree-keydown [{:keys [on-toggle node-id-map]} wrapped]
  (let [event (ui/dom-event wrapped)
        root (.-currentTarget event)
        target (some-> (.-target event) (.closest "[role=treeitem]"))
        key (.-key event)
        buttons (tree-buttons root)
        i (.indexOf (to-array buttons) target)
        next-button (fn [offset]
                      (when (and (<= 0 i)
                                 (<= 0 (+ i offset))
                                 (< (+ i offset) (count buttons)))
                        (nth buttons (+ i offset))))]
    (when target
      (case key
        "ArrowDown"
        (do
          (.preventDefault event)
          (focus! (next-button 1)))

        "ArrowUp"
        (do
          (.preventDefault event)
          (focus! (next-button -1)))

        "Home"
        (do
          (.preventDefault event)
          (focus! (first buttons)))

        "End"
        (do
          (.preventDefault event)
          (focus! (last buttons)))

        "ArrowRight"
        (let [dir (.closest target ".tree-dir")
              open? (= "true" (.getAttribute target "aria-expanded"))
              has-children? (= "true" (.getAttribute target "data-tree-has-children"))]
          (.preventDefault event)
          (when (and dir has-children?)
            (if open?
              (focus! (first-child-button dir))
              (let [id (.getAttribute dir "data-tree-id")]
                (ui/run wrapped (ui/emit on-toggle (get node-id-map id id)))
                (focus-first-child-later root id)))))

        "ArrowLeft"
        (let [dir (.closest target ".tree-dir")
              open? (= "true" (.getAttribute target "aria-expanded"))]
          (.preventDefault event)
          (if (and dir open?)
            (ui/run wrapped (ui/emit on-toggle
                                     (let [id (.getAttribute dir "data-tree-id")]
                                       (get node-id-map id id))))
            (focus! (parent-button target))))

        nil))))

(defn- tree-node [node {:keys [expanded render-actions] :as options}]
  (let [id (node-id node)
        open? (contains? expanded id)
        dir? (directory? node)
        actions (when render-actions (render-actions node))]
    (if dir?
      [:div.tree-dir {:replicant/key id :data-tree-id (str id)}
       [:div.tree-row
        (item-button node options)
        (when actions (into [:div.tree-ops] (child-elements actions)))]
       (when open?
         [:div.tree-children {:role "group"}
          (for [child (:children node)]
            (tree-node child options))])]
      [:div.tree-row {:replicant/key id}
       (item-button node options)
       (when actions (into [:div.tree-ops] (child-elements actions)))])))

(defn tree
  "Render a controlled tree.

  Required: `:nodes`, `:expanded`, `:on-toggle`, and `:on-select` (the
  handlers may be nil for read-only trees). Optional: `:selected`, `:items`,
  `:render-icon`, `:render-trailing`, `:render-actions`, `:empty`, and normal
  root DOM props such as `:class` and `:aria-label`. The tree uses roving
  tabindex with ArrowUp/Down, Home/End, Right/Left, and native Enter."
  [{:keys [nodes items expanded selected selected-id empty]
    :as props}]
  (let [nodes (or nodes items)
        expanded (set expanded)
        selected (or selected selected-id)
        ids (visible-ids nodes expanded)
        focus-id (or (some #(when (= selected %) %) ids) (first ids))
        options (assoc props :expanded expanded :selected selected :focus-id focus-id
                       :node-id-map (node-id-map nodes))]
    (into
     [:div (ui/attrs {:class ["tree" "ui-tree"]
                      :role "tree"
                      :on {:keydown (ui/wrapped #(tree-keydown options %))}}
                     props
                     [:nodes :items :expanded :selected :selected-id :on-toggle
                      :on-select :render-icon :render-trailing :render-actions
                      :empty :on])]
     (if (seq nodes)
       (map #(tree-node % options) nodes)
       [[:p.muted.empty-tree (or empty "Nothing here yet.")]]))))
