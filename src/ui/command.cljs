(ns ui.command
  (:require [clojure.string :as str]
            [ui.core :as ui]
            [ui.input :as input]))

(defn- needle [query]
  (str/lower-case (str/trim (or query ""))))

(defn- haystack [{:keys [label hint]}]
  (str/lower-case (str (or label "") " " (or hint ""))))

(defn visible
  "Rows whose :label or :hint contain query, case-insensitive.
  Blank query keeps every row. Order is unchanged."
  [items query]
  (let [q (needle query)]
    (vec
     (filter (fn [item]
               (and (:id item)
                    (seq (str (:label item)))
                    (or (= "" q) (str/includes? (haystack item) q))))
             items))))

(defn- enabled [items]
  (vec (remove :disabled? items)))

(defn- step-id [items active dir]
  (let [ids (mapv :id (enabled items))
        n (count ids)]
    (when (pos? n)
      (let [idx (or (first (keep-indexed (fn [i id] (when (= id active) i)) ids))
                    (if (pos? dir) -1 0))
            next (mod (+ idx dir) n)]
        (nth ids next)))))

(defn- click-active [root active]
  (when (and root active)
    (let [want (str active)
          nodes (.querySelectorAll root "[data-ui-cmd]")
          n (.-length nodes)]
      (loop [i 0]
        (when (< i n)
          (let [el (aget nodes i)]
            (if (= want (.getAttribute el "data-ui-cmd"))
              (.click el)
              (recur (inc i)))))))))

(defn- on-keydown [props e]
  (let [ev (ui/dom-event e)
        {:keys [items query active on-active]} props
        vis (visible items query)
        key (when ev (.-key ev))
        target (when ev (.-target ev))]
    (when (and ev key)
      (case key
        "ArrowDown"
        (do (.preventDefault ev)
            (when on-active (on-active (step-id vis active 1))))
        "ArrowUp"
        (do (.preventDefault ev)
            (when on-active (on-active (step-id vis active -1))))
        "Enter"
        (do (.preventDefault ev)
            (click-active (.closest target ".ui-command")
                          (or active (:id (first (enabled vis))))))
        "Escape"
        (do (.preventDefault ev)
            (when-let [btn (some-> target (.closest ".ui-command")
                                   (.querySelector ".ui-command-dismiss"))]
              (.click btn)))
        nil))))

(defn- item-el [active on-active {:keys [id label hint action disabled?]}]
  [:button.ui-command-item
   {:type "button"
    :role "option"
    :data-ui-cmd (str id)
    :aria-selected (= id active)
    :aria-disabled (boolean disabled?)
    :disabled (boolean disabled?)
    :class (ui/cx (when (= id active) "is-active"))
    :on {:click action
         :mouseenter (when (and on-active (not disabled?))
                       (fn [_] (on-active id)))}}
   [:span.ui-command-label label]
   (when hint [:span.ui-command-hint hint])])

(defn- grouped [items]
  (reduce (fn [acc item]
            (let [g (or (:group item) "")
                  last-g (:group (peek acc))]
              (if (and (seq acc) (= g last-g))
                (update acc (dec (count acc)) update :rows conj item)
                (conj acc {:group g :rows [item]}))))
          []
          items))

(defn- list-el [{:keys [active on-active]} vis]
  (if (seq vis)
    (into [:div.ui-command-list {:role "listbox" :id "ui-command-list"}]
          (mapcat (fn [{:keys [group rows]}]
                    (let [els (mapv #(item-el active on-active %) rows)]
                      (if (seq group)
                        (into [[:div.ui-command-group group]] els)
                        els)))
                  (grouped vis)))
    [:div.ui-command-empty "No matches"]))

(defn command
  "Filtered list. Omit :open? or pass true to show, same as ui.dialog.
  :frame is :overlay (default) or :panel. Parent owns :query and :active.
  Pass the unfiltered :items every time. Each item is
  {:id :label :hint :group :action :disabled?}.

  :on-query  Replicant handler. Read the input's value from the event.
  :on-close  Replicant handler. Backdrop and Escape.
  :on-active (fn [id]) for highlight. Keyboard needs a function.
  :placeholder optional."
  [{:keys [open? query active items frame on-query on-close on-active
           placeholder]
    :as props}]
  (when (or (not (contains? props :open?)) open?)
    (let [vis (visible items query)
          body [:div.ui-command
                {:class (when (= frame :panel) "is-panel")
                 :role "dialog"
                 :aria-label (or placeholder "Commands")
                 :on {:click ui/stop
                      :keydown (fn [e] (on-keydown props e))}}
                [:button.ui-command-dismiss
                 {:type "button"
                  :tabIndex -1
                  :aria-hidden "true"
                  :on {:click on-close}}]
                (input/input
                 {:class "ui-command-input"
                  :type "text"
                  :role "combobox"
                  :aria-expanded "true"
                  :aria-controls "ui-command-list"
                  :placeholder (or placeholder "Type a command…")
                  :value (or query "")
                  :autocomplete "off"
                  :spellcheck "false"
                  :replicant/on-mount (fn [{:keys [replicant/node]}]
                                        (.focus node)
                                        (.select node))
                  :on {:input on-query}})
                (list-el {:active active :on-active on-active} vis)]]
      (if (= frame :panel)
        body
        [:div.ui-overlay {:role "presentation"
                          :replicant/key :ui-command}
         (when on-close
           [:div.ui-backdrop {:on {:click on-close}}])
         body]))))
