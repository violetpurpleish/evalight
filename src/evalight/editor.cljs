(ns evalight.editor
  (:require ["@codemirror/autocomplete" :as ac]
            ["@codemirror/commands" :as commands]
            ["@codemirror/lang-css" :as lang-css]
            ["@codemirror/lang-html" :as lang-html]
            ["@codemirror/lang-javascript" :as lang-js]
            ["@codemirror/lang-json" :as lang-json]
            ["@codemirror/lang-markdown" :as lang-md]
            ["@codemirror/language" :as language]
            ["@codemirror/search" :as search]
            ["@codemirror/state" :as cm-state]
            ["@codemirror/view" :as view]
            ["@lezer/highlight" :as lezer-hl]
            ["./cm6_parinfer.js" :as parinfer]
            ["@nextjournal/clojure-mode" :as clj-mode]
            ["@nextjournal/clojure-mode/extensions/eval-region" :as eval-region]
            [evalight.intel :as intel]
            [evalight.paths :as paths]))

(defonce !view (atom nil))
(defonce !path (atom nil))
(defonce !states (atom {}))
(defonce !handlers (atom {}))

(defn- mac? []
  (boolean (re-find #"Mac|iPhone|iPad" (or (.-platform js/navigator) ""))))

(defn eval-modifier []
  (if (mac?) "Meta" "Control"))

(defn- language-for [path]
  (case (paths/ext path)
    ("clj" "cljs" "cljc" "edn") :clojure
    "css" :css
    ("html" "htm") :html
    "js" :javascript
    "json" :json
    ("md" "markdown") :markdown
    :plain))

(def theme
  (.theme view/EditorView
          (clj->js
           {"&" {:background "transparent"
                 :color "#efe6d6"
                 :height "100%"}
            ".cm-content" {:caret-color "#e4b34c"
                           :font-family "\"IBM Plex Mono\", ui-monospace, monospace"
                           :font-size "13.5px"
                           :line-height "1.65"
                           :padding "12px 0 48px"}
            ".cm-gutters" {:background "transparent"
                           :border "none"
                           :color "#7d705c"
                           :min-width "2.4rem"}
            ".cm-activeLine" {:background "rgba(228, 179, 76, 0.07)"}
            ".cm-activeLineGutter" {:background "transparent"
                                     :color "#e4b34c"}
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground"
            {:background "rgba(228, 179, 76, 0.22) !important"}
            ".cm-cursor" {:border-left-color "#e4b34c"}
            ".cm-matchingBracket" {:outline "1px solid #e4b34c"
                                     :background "transparent"}
            ".cm-scroller" {:overflow "auto"}
            "&.cm-focused" {:outline "none"}})))

(def highlight-style
  "Highlight colors for the dark workshop background. CodeMirror's
  defaultHighlightStyle is a light-theme palette and disappears here."
  (let [t (.-tags lezer-hl)]
    (.define language/HighlightStyle
             #js [#js {:tag (.-keyword t) :color "#f0c674"}
                  #js {:tag #js [(.-atom t) (.-null t) (.-bool t)] :color "#ffb086"}
                  #js {:tag (.-string t) :color "#9dcf7a"}
                  #js {:tag (.-number t) :color "#ffd27a"}
                  #js {:tag #js [(.-comment t) (.-lineComment t) (.-blockComment t)]
                       :color "#b09f85"
                       :fontStyle "italic"}
                  #js {:tag (.-emphasis t) :color "#b8d39a" :fontStyle "italic"}
                  #js {:tag (.definition t (.-variableName t)) :color "#c5e4ff"}
                  #js {:tag (.-variableName t) :color "#efe6d6"}
                  #js {:tag #js [(.-typeName t) (.-tagName t) (.-className t)] :color "#7ec8e3"}
                  #js {:tag #js [(.-propertyName t) (.-attributeName t)] :color "#e4c99a"}
                  #js {:tag (.-regexp t) :color "#7eb8c9"}
                  #js {:tag #js [(.-operator t) (.-punctuation t)] :color "#d8ccb4"}
                  #js {:tag #js [(.-bracket t) (.-paren t) (.-squareBracket t) (.-brace t)]
                       :color "#cbbfa6"}
                  #js {:tag (.-heading t) :color "#f0c674" :fontWeight "bold"}
                  #js {:tag #js [(.-link t) (.-url t)] :color "#7ec8e3"}
                  #js {:tag (.-invalid t) :color "#ff8a78"}
                  #js {:tag (.-meta t) :color "#c4b496"}])))

(defn- flatten-exts [xs]
  (let [out #js []]
    (letfn [(walk [x]
              (cond
                (nil? x) nil
                (array? x) (dotimes [i (alength x)] (walk (aget x i)))
                (vector? x) (doseq [y x] (walk y))
                (list? x) (doseq [y x] (walk y))
                :else (.push out x)))]
      (walk xs)
      out)))

(defn- on-change-ext [handler]
  (.. view/EditorView -updateListener
      (of (fn [^js update]
            (when (and handler (.-docChanged update))
              (handler (.toString (.-doc (.-state update)))))))))

(defn- eval-keymap [on-eval]
  (let [cursor-str (.-cursor_node_string eval-region)
        top-str (.-top_level_string eval-region)
        run-cursor (fn [^js view]
                     (when-let [code (cursor-str (.-state view))]
                       (on-eval code :cursor))
                     true)
        run-top (fn [^js view]
                  (when-let [code (top-str (.-state view))]
                    (on-eval code :top-level))
                  true)
        run-cell (fn [^js view]
                   (on-eval (.toString (.-doc (.-state view))) :file)
                   true)]
    (.highest cm-state/Prec
             (.of view/keymap
                  #js [#js {:key "Mod-Enter" :run run-cursor :shift run-top}
                       #js {:key "Ctrl-Enter" :run run-cursor :shift run-top}
                       #js {:key "Alt-Enter" :run run-cell}]))))

(defn- symbol-at [^js state pos]
  (let [line (.lineAt (.-doc state) pos)
        text (.-text line)
        from (.-from line)
        off (- pos from)
        re (js/RegExp. "[A-Za-z*!?+\\-_$<>][\\w*!?+\\-_$<>./:-]*" "g")]
    (loop []
      (if-let [m (.exec re text)]
        (let [start (.-index m)
              s (aget m 0)
              end (+ start (count s))]
          (if (and (<= start off) (>= end off))
            {:from (+ from start) :to (+ from end) :text s}
            (recur)))
        nil))))

(defn- doc-el [{:keys [name ns arglists doc]}]
  (let [root (js/document.createElement "div")]
    (set! (.-className root) "cm-evalight-doc")
    (let [head (js/document.createElement "div")]
      (set! (.-className head) "cm-evalight-doc-head")
      (set! (.-textContent head) (str name (when arglists (str "  " arglists))))
      (.appendChild root head))
    (when (seq ns)
      (let [sub (js/document.createElement "div")]
        (set! (.-className sub) "cm-evalight-doc-ns")
        (set! (.-textContent sub) ns)
        (.appendChild root sub)))
    (when (seq doc)
      (let [body (js/document.createElement "pre")]
        (set! (.-textContent body) doc)
        (.appendChild root body)))
    root))

(defn- complete-source [^js context]
  (let [w (.matchBefore context #"[A-Za-z*!?+\-_$<>][\w*!?+\-_$<>./:-]*")]
    (when (and w (or (.-explicit context) (pos? (count (.-text w)))))
      (let [opts (intel/cm-options (.-text w))]
        (when (seq opts)
          #js {:from (.-from w)
               :validFor #"[A-Za-z*!?+\-_$<>./:-]*"
               :options (clj->js opts)})))))

(defn- hover-source [^js view pos _side]
  (when-let [tok (symbol-at (.-state view) pos)]
    (when-let [info (intel/lookup (:text tok))]
      (when (or (seq (:doc info)) (seq (:arglists info)))
        #js {:pos (:from tok)
             :end (:to tok)
             :above true
             :create (fn [_] #js {:dom (doc-el info)})}))))

(defn- lang-ext [lang]
  (case lang
    :css (.css lang-css)
    :html (.html lang-html)
    :javascript (.javascript lang-js)
    :json (.json lang-json)
    :markdown (.markdown lang-md)
    nil))

(defn- clojure-exts [on-eval]
  (flatten-exts
   [(.-default_extensions clj-mode)
    (.of view/keymap (.-complete_keymap clj-mode))
    (.extension eval-region #js {:modifier (eval-modifier)})
    (eval-keymap on-eval)
    (ac/autocompletion #js {:override #js [complete-source]
                            :activateOnTyping true
                            :icons true})
    (.of view/keymap ac/completionKeymap)
    (view/hoverTooltip hover-source #js {:hoverTime 380})
    (.parinferExtension parinfer)]))

(defn extensions [{:keys [path on-change on-eval]}]
  (let [lang (language-for path)]
    (flatten-exts
     [theme
      (commands/history)
      (view/lineNumbers)
      (view/highlightActiveLine)
      (view/highlightActiveLineGutter)
      (view/drawSelection)
      (language/foldGutter)
      (language/syntaxHighlighting highlight-style #js {:fallback true})
      (.of view/keymap (.-historyKeymap commands))
      (.of view/keymap (.-defaultKeymap commands))
      (.of view/keymap (.-searchKeymap search))
      (on-change-ext on-change)
      (when (= lang :clojure) (clojure-exts on-eval))
      (lang-ext lang)])))

(defn- make-state [path content]
  (let [{:keys [on-change on-eval]} @!handlers]
    (.create cm-state/EditorState
             #js {:doc (or content "")
                  :extensions (extensions {:path path
                                            :on-change on-change
                                            :on-eval on-eval})})))

(defn set-handlers! [handlers]
  (reset! !handlers handlers))

(defn current-path []
  @!path)

(defn current-text []
  (when-let [^js v @!view]
    (.toString (.-doc (.-state v)))))

(defn create! [el]
  (when-let [^js old @!view]
    (.destroy old)
    (reset! !view nil))
  (try
    (let [state (make-state (or @!path "untitled.cljs") "")
          v (view/EditorView. #js {:state state :parent el})]
      (reset! !view v)
      v)
    (catch :default e
      (js/console.error "CodeMirror failed to start" e)
      nil)))

(defn destroy! []
  (when-let [^js v @!view]
    (.destroy v))
  (reset! !view nil)
  (reset! !path nil))

(defn clear-buffers! []
  (reset! !states {})
  (reset! !path nil))

(defn save-current-state! []
  (when (and @!view @!path)
    (swap! !states assoc @!path (.-state ^js @!view))))

(defn drop-path! [path]
  (swap! !states dissoc path)
  (when (= path @!path)
    (reset! !path nil)))

(defn rename-path! [from to]
  (when-let [st (get @!states from)]
    (swap! !states dissoc from)
    (swap! !states assoc to st))
  (when (= @!path from)
    (reset! !path to)))

(defn show!
  "Swap the editor to `path`, restoring prior undo state when we have it."
  [path content]
  (when-let [^js v @!view]
    (save-current-state!)
    (let [state (or (get @!states path)
                     (make-state path content))]
      (reset! !path path)
      (swap! !states assoc path state)
      (.setState v state)
      (when (and content (not (get @!states path)))
        nil)
      ;; If we restored a cached state, keep it. If the file on disk differs
      ;; because it was rewritten elsewhere, replace the doc.
      (let [current (.toString (.-doc (.-state v)))]
        (when (and content (not= current content) (not (contains? @!states path)))
          (.setState v (make-state path content)))))))

(defn load-fresh!
  "Always replace editor contents from disk (used when opening a file)."
  [path content]
  (when-let [^js v @!view]
    (save-current-state!)
    (let [cached (get @!states path)
          same? (and cached (= content (.toString (.-doc cached))))
          state (if same? cached (make-state path content))]
      (reset! !path path)
      (swap! !states assoc path state)
      (.setState v state))))

(defn focus! []
  (when-let [^js v @!view]
    (.focus v)))
