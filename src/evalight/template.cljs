(ns evalight.template
  (:require [clojure.string :as str]
            [evalight.kit :as kit])
  (:require-macros [evalight.kit.embed :refer [gallery-source]]))

(defn gpui-evalight-edn
  "evalight.edn for a clj-gpui app. Copy into that project's template."
  [project-name main]
  (str "{:name " (pr-str project-name) "\n"
       " :main " (or main "my.app/app") "\n"
       " :runtime :gpui\n"
       " :preview {:kind :native}}\n"))

(defn clj-evalight-edn
  "evalight.edn for a generic JVM Clojure project. Preview stays hidden."
  [project-name main]
  (str "{:name " (pr-str project-name) "\n"
       " :main " (or main "user") "\n"
       " :runtime :clj}\n"))

(defn clj-package-json [project-name]
  (str "{\n"
       "  \"name\": " (pr-str project-name) ",\n"
       "  \"private\": true,\n"
       "  \"scripts\": {\n"
       "    \"evalight\": \"bun evalight/server.mjs\"\n"
       "  }\n"
       "}\n"))

(defn evalight-edn [project-name]
  (str "{:name " (pr-str project-name) "\n"
       " :main app.core\n"
       " :src-paths [\"src\"]\n"
       " :preview {:css [\"public/css/ui.css\" \"public/style.css\"]}}\n"))

(defn package-json [project-name]
  (str "{\n"
       "  \"name\": " (pr-str project-name) ",\n"
       "  \"private\": true,\n"
       "  \"scripts\": {\n"
       "    \"evalight\": \"bun evalight/server.mjs\",\n"
       "    \"dev\": \"shadow-cljs watch app\",\n"
       "    \"release\": \"shadow-cljs release app\"\n"
       "  },\n"
       "  \"devDependencies\": {\n"
       "    \"shadow-cljs\": \"2.28.23\"\n"
       "  }\n"
       "}\n"))

(defn shadow-cljs-edn []
  (str "{:source-paths [\"src\"]\n"
       " :dependencies [[no.cjohansen/replicant \"2026.07.1\"]]\n"
       " :dev-http {3456 \"public\"}\n"
       " :node-modules {:managed-by :bun}\n"
       " :builds\n"
       " {:app {:target :browser\n"
       "        :output-dir \"public/js\"\n"
       "        :asset-path \"/js\"\n"
       "        :modules {:main {:init-fn app.core/init}}}}}\n"))

(defn gitignore []
  (str "node_modules/\n"
       ".shadow-cljs/\n"
       "public/js/\n"
       ".cpcache/\n"
       ".nrepl-port\n"
       ".DS_Store\n"))

(defn license []
  (str "MIT License\n\n"
       "Copyright (c) 2026 violetpurpleish & contributors\n\n"
       "Permission is hereby granted, free of charge, to any person obtaining a copy\n"
       "of this software and associated documentation files (the \"Software\"), to deal\n"
       "in the Software without restriction, including without limitation the rights\n"
       "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n"
       "copies of the Software, and to permit persons to whom the Software is\n"
       "furnished to do so, subject to the following conditions:\n\n"
       "The above copyright notice and this permission notice shall be included in all\n"
       "copies or substantial portions of the Software.\n\n"
       "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n"
       "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n"
       "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n"
       "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n"
       "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n"
       "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n"
       "SOFTWARE.\n"))

(defn readme [project-name]
  (str "# " project-name "\n\n"
       "A ClojureScript project created in Evalight.\n\n"
       "The starter is a widget gallery. Try the controls in Preview and use the editor\n"
       "to explore them. `src/app/gallery.cljs` contains the live examples;\n"
       "`src/app/core.cljs` demonstrates the counter, popover, and rename dialog.\n\n"
       "Evalight is already in this folder. The rest is a normal project\n"
       "directory: source, shadow-cljs, a README. Keep using this workshop,\n"
       "or open the files in any other editor.\n\n"
       "Controls under `src/ui` are ordinary ClojureScript. They are not an\n"
       "installed package. Edit a button, delete a popover, or copy another\n"
       "control from Evalight's **Add UI** dialog.\n\n"
       "## Keep using Evalight\n\n"
       "You need [Bun](https://bun.sh), a JDK, and `bun install` once so\n"
       "shadow-cljs can compile this project. `bun run evalight` starts the\n"
       "workshop *and* that compile. Preview is the compiled app. Ctrl-Enter\n"
       "talks to that heap, not SCI.\n\n"
       "```sh\n"
       "bun install\n"
       "bun run evalight\n"
       "```\n\n"
       "Open http://127.0.0.1:48721. Evalight starts its own `shadow-cljs watch :app`.\n"
       "Do not also run `bun run dev` in this folder; they would both write `public/js`.\n\n"
       "To join a watch you already started:\n\n"
       "```sh\n"
       "bun run evalight --attach\n"
       "```\n\n"
       "That uses the running nREPL and does not stop it on exit. If Preview cannot\n"
       "tell the app URL, pass `--preview-url=http://127.0.0.1:3456/`. If there is\n"
       "no `.nrepl-port` file, attach reads `:nrepl {:port ...}` from shadow-cljs.edn.\n\n"
       "## Compiled site without the workshop\n\n"
       "```sh\n"
       "bun run dev\n"
       "```\n\n"
       "Open http://localhost:3456. Use `--attach` if you want the workshop on that\n"
       "same running image.\n\n"
       "## Licenses\n\n"
       "This project, including the copied `src/ui` kit, is MIT. See `LICENSE`.\n"
       "The workshop UI under `evalight/` bundles third-party code. Notices for\n"
       "that bundle are in `evalight/public/licenses.html`. shadow-cljs and\n"
       "replicant in this folder's config are installed later by `bun install`;\n"
       "they are not copied into the ZIP.\n"))

(defn stale-lamp-css?
  "True for a lamp stylesheet that still lets the title wrap at hyphens."
  [text]
  (and (str/includes? (or text "")
                      "h1 { font-family: var(--ui-serif); font-weight: 560; font-size: 2.4rem;")
       (not (str/includes? (or text "") "text-overflow: ellipsis"))))

(defn with-title-wrap
  [css]
  (if (stale-lamp-css? css)
    (str/replace
     css
     #"h1 \{ font-family: var\(--ui-serif\); font-weight: 560; font-size: 2\.4rem; margin: 0 0 0\.6rem; \}"
     (str "h1 {\n"
          "  font-family: var(--ui-serif);\n"
          "  font-weight: 560;\n"
          "  font-size: clamp(1.5rem, 7vw, 2.4rem);\n"
          "  line-height: 1.18;\n"
          "  margin: 0 0 0.6rem;\n"
          "  overflow-wrap: break-word;\n"
          "  hyphens: none;\n"
          "  white-space: nowrap;\n"
          "  overflow: hidden;\n"
          "  text-overflow: ellipsis;\n"
          "}"))
    css))

(defn stale-evalight-readme?
  "True for a lamp README that still tells you to clone Evalight."
  [text]
  (let [t (or text "")]
    (and (str/includes? t "created in Evalight")
         (or (str/includes? t "From a checkout of Evalight")
             (str/includes? t "from an Evalight checkout")
             (str/includes? t "Keep editing in Evalight")
             (str/includes? t "bun run local /path")
             (str/includes? t "interprets this source with SCI")
             (str/includes? t "You do not need `bun install` for this")))))

(defn public-html [project-name]
  (str "<!DOCTYPE html>\n"
       "<html lang=\"en\">\n"
       "<head>\n"
       "  <meta charset=\"utf-8\">\n"
       "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
       "  <title>" project-name "</title>\n"
       "  <link rel=\"stylesheet\" href=\"/css/ui.css\">\n"
       "  <link rel=\"stylesheet\" href=\"/style.css\">\n"
       "</head>\n"
       "<body>\n"
       "  <div id=\"app\"></div>\n"
       "  <script src=\"/js/main.js\"></script>\n"
       "</body>\n"
       "</html>\n"))

(defn public-css []
  (str ":root {\n"
       "  --paper: #f4ecd8;\n"
       "  --ink: #1c1610;\n"
       "  --gold: #c4922a;\n"
       "  --muted: #7a6a52;\n"
       "  --line: #e0d4b8;\n"
       "  --ui-fg: var(--ink);\n"
       "  --ui-bg: #fffaf0;\n"
       "  --ui-muted: var(--muted);\n"
       "  --ui-line: var(--line);\n"
       "  --ui-accent: var(--gold);\n"
       "  --ui-accent-fg: #1c1610;\n"
       "  --ui-danger: #c44b2a;\n"
       "  --ui-danger-fg: #fff;\n"
       "  --ui-overlay: rgba(28, 22, 16, 0.4);\n"
       "  --ui-shadow: 0 18px 50px rgba(28, 22, 16, 0.18);\n"
       "  --ui-font: \"Figtree\", \"Source Sans 3\", system-ui, sans-serif;\n"
       "  --ui-serif: \"Fraunces\", Georgia, serif;\n"
       "}\n\n"
       "* { box-sizing: border-box; }\n"
       "html, body { margin: 0; height: 100%; }\n"
       "body {\n"
       "  font-family: var(--ui-font);\n"
       "  background: radial-gradient(1200px 600px at 20% -10%, #fff6e3, var(--paper));\n"
       "  color: var(--ink);\n"
       "}\n"
       "#app { min-height: 100%; }\n"
       ".app { max-width: 36rem; margin: 0 auto; padding: 3.5rem 1.5rem 4rem; }\n"
       ".eyebrow {\n"
       "  letter-spacing: 0.18em;\n"
       "  text-transform: uppercase;\n"
       "  font-size: 0.7rem;\n"
       "  color: var(--gold);\n"
       "  margin: 0 0 0.6rem;\n"
       "}\n"
       "h1 {\n"
       "  font-family: var(--ui-serif);\n"
       "  font-weight: 560;\n"
       "  font-size: clamp(1.5rem, 7vw, 2.4rem);\n"
       "  line-height: 1.18;\n"
       "  margin: 0 0 0.6rem;\n"
       "  overflow-wrap: break-word;\n"
       "  hyphens: none;\n"
       "  white-space: nowrap;\n"
       "  overflow: hidden;\n"
       "  text-overflow: ellipsis;\n"
       "}\n"
       ".lede { color: var(--muted); line-height: 1.5; margin: 0 0 1.8rem; }\n"
       ".toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0 0 1.25rem; }\n"
       ".lamp {\n"
       "  display: flex; align-items: center; gap: 1rem;\n"
       "  border: 1px solid var(--line);\n"
       "  background: #fffaf0;\n"
       "  border-radius: 999px;\n"
       "  padding: 0.55rem 1.1rem 0.55rem 0.55rem;\n"
       "  cursor: pointer;\n"
       "  font: inherit;\n"
       "  color: inherit;\n"
       "}\n"
       ".ui-btn.lamp { background: #fffaf0; color: var(--ink); font-weight: 500; }\n"
       ".lamp:hover, .ui-btn.lamp:hover { border-color: var(--gold); }\n"
       ".count {\n"
       "  width: 2.4rem; height: 2.4rem; border-radius: 999px;\n"
       "  display: grid; place-items: center;\n"
       "  background: var(--ink); color: var(--paper);\n"
       "  font-family: \"IBM Plex Mono\", ui-monospace, monospace;\n"
       "}\n"
       ".notes { list-style: none; padding: 0; margin: 2rem 0 0; }\n"
       ".notes li {\n"
       "  padding: 0.65rem 0;\n"
       "  border-top: 1px solid var(--line);\n"
       "  color: var(--muted);\n"
       "}\n"
       ".about-copy { margin: 0; color: var(--muted); line-height: 1.45; font-size: 0.9rem; }\n"
       ".gallery { margin-top: 2rem; } .example { border-top: 1px solid var(--line); padding: 1.4rem 0; } .example h2 { font-size: 1.1rem; } .example-preview { display: grid; gap: .8rem; margin-bottom: 1rem; } .gallery-row { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; } .example pre { overflow: auto; max-width: 100%; font-size: .75rem; line-height: 1.6; } .example .ui-split { min-height: 6rem; } .gallery > .ui-toast { position: fixed; bottom: 1rem; right: 1rem; max-width: calc(100vw - 2rem); z-index: 100; }\n"
       "code { font-family: \"IBM Plex Mono\", ui-monospace, monospace; font-size: 0.92em; color: var(--ink); }\n"))

(defn greet-cljs []
  (str "(ns app.greet)\n\n"
       "(defn greet\n"
       "  \"A tiny helper so the project has more than one namespace.\"\n"
       "  [name]\n"
       "  (str \"Hello, \" name \".\"))\n"))

(defn stats-cljs []
  (str "(ns app.stats)\n\n"
       "(defonce !tally (atom 0))\n\n"
       "(defn tally\n"
       "  \"How many times record! has been called in this image.\"\n"
       "  []\n"
       "  @!tally)\n\n"
       "(defn record!\n"
       "  \"Bump the stats tally. Independent of the lamp count.\"\n"
       "  []\n"
       "  (swap! !tally inc)\n"
       "  @!tally)\n"))

(defn core-cljs [project-name]
  (str "(ns app.core\n"
       "  (:require [app.greet :as greet]\n"
       "            [app.stats :as stats]\n"
       "            [app.gallery :as gallery]\n"
       "            [replicant.dom :as r]\n"
       "            [ui.button :as btn]\n"
       "            [ui.core :as ui]\n"
       "            [ui.dialog :as dialog]\n"
       "            [ui.field :as field]\n"
       "            [ui.input :as input]\n"
       "            [ui.popover :as popover]))\n\n"
       "(defonce store\n"
       "  (atom {:title " (pr-str (str "Lamp · " project-name)) "\n"
       "         :count 0\n"
       "         :about? false\n"
       "         :rename? false\n"
       "         :notes [\"Edit src/app/core.cljs — the preview follows.\"\n"
       "                 \"Evaluate (bump) in the REPL to touch the live app.\"\n"
       "                 \"Evaluate (stats/record!) — that lives in app.stats.\"\n"
       "                 \"The controls live in src/ui. Change them, or delete a file you don't want.\"]}))\n\n"
       "(declare render bump toggle-about open-rename close-rename save-title retitle)\n\n"
       "(defn view [{:keys [title count notes about? rename?]}]\n"
       "  [:div.app\n"
       "   [:p.eyebrow \"Live ClojureScript\"]\n"
       "   [:h1 title]\n"
       "   [:p.lede (greet/greet \"Evalight\") \" This page is the running program, not a build artifact.\"]\n"
       "   [:div.toolbar\n"
       "    (btn/button {:class \"lamp\" :on {:click (fn [_e] (bump))}}\n"
       "      [:span.count (str count)]\n"
       "      \"Light another lamp\")\n"
       "    (popover/popover {:open? about? :on-close (fn [_e] (toggle-about false))}\n"
       "      (btn/button {:on {:click (fn [_e] (toggle-about))}} \"About the kit\")\n"
       "      [:p.about-copy \"src/ui is copied into this project. Evalight's Add UI dialog can put a control back if you delete it.\"])\n"
       "    (btn/button {:on {:click (fn [_e] (open-rename))}} \"Rename\")]\n"
       "   (dialog/dialog {:open? rename? :on-close (fn [_e] (close-rename)) :title \"Rename the lamp\"}\n"
       "     [:form {:on {:submit (fn [e] (save-title e))}}\n"
       "      (field/field {:label \"Title\" :hint \"Shown in the heading.\"}\n"
       "        (input/input {:name \"title\"\n"
       "                      :on {:keydown (fn [e]\n"
       "                                      (let [ev (ui/dom-event e)]\n"
       "                                        (when (and ev (= \"Enter\" (.-key ev)))\n"
       "                                          (save-title e))))}\n"
       "                      :replicant/on-mount (fn [{:keys [replicant/node]}]\n"
       "                                            (set! (.-value node) (:title @store))\n"
       "                                            (.focus node)\n"
       "                                            (.select node))}))\n"
       "      (dialog/actions\n"
       "        (btn/button {:type \"button\" :on {:click (fn [_e] (close-rename))}} \"Cancel\")\n"
       "        (btn/button {:variant :primary :type \"button\" :on {:click (fn [e] (save-title e))}} \"Save\"))])\n"
       "   (gallery/view render)\n"
       "   [:ul.notes\n"
       "    (for [n notes]\n"
       "      [:li n])]])\n\n"
       "(defn render []\n"
       "  (r/render (js/document.getElementById \"app\")\n"
       "            (view @store)))\n\n"
       "(defn bump\n"
       "  \"Increment the lamp counter in the running preview.\"\n"
       "  []\n"
       "  (swap! store update :count inc)\n"
       "  (render)\n"
       "  (:count @store))\n\n"
       "(defn toggle-about\n"
       "  \"Show or hide the kit popover. Pass false to close.\"\n"
       "  ([] (toggle-about (not (:about? @store))))\n"
       "  ([open?]\n"
       "   (swap! store assoc :about? (boolean open?))\n"
       "   (render)))\n\n"
       "(defn open-rename\n"
       "  \"Open the title dialog.\"\n"
       "  []\n"
       "  (swap! store assoc :rename? true)\n"
       "  (render))\n\n"
       "(defn close-rename\n"
       "  \"Close the title dialog.\"\n"
       "  []\n"
       "  (swap! store assoc :rename? false)\n"
       "  (render))\n\n"
       "(defn save-title\n"
       "  \"Read the rename field and set the heading.\"\n"
       "  [e]\n"
       "  (let [ev (ui/dom-event e)\n"
       "        node (when (and ev (.-target ev)) (.-target ev))\n"
       "        field (when node\n"
       "                (if (= \"INPUT\" (.-tagName node))\n"
       "                  node\n"
       "                  (let [root (when (.-closest node)\n"
       "                               (or (.closest node \"form\")\n"
       "                                   (.closest node \".ui-dialog\")))]\n"
       "                    (when root (.querySelector root \"input[name=title]\")))))\n"
       "        s (if field (.-value field) \"\")]\n"
       "    (when (and ev (.-preventDefault ev))\n"
       "      (.preventDefault ev))\n"
       "    (retitle s)\n"
       "    (close-rename)\n"
       "    s))\n\n"
       "(defn retitle [s]\n"
       "  (swap! store assoc :title s)\n"
       "  (render)\n"
       "  s)\n\n"
       "(defn init []\n"
       "  (stats/tally)\n"
       "  (render))\n\n"
       "(init)\n"))

(defn files
  "Return an ordered map of relative path -> content for a new project."
  [project-name]
  (let [name (or (not-empty project-name) "lamp")]
    (merge
     kit/sources
     {"evalight.edn" (evalight-edn name)
      "package.json" (package-json name)
      "shadow-cljs.edn" (shadow-cljs-edn)
      ".gitignore" (gitignore)
      "LICENSE" (license)
      "README.md" (readme name)
      "public/index.html" (public-html name)
      "public/style.css" (public-css)
      "src/app/gallery.cljs" (gallery-source)
      "src/app/greet.cljs" (greet-cljs)
      "src/app/stats.cljs" (stats-cljs)
      "src/app/core.cljs" (core-cljs name)})))
