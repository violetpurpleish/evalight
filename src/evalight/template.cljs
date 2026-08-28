(ns evalight.template)

(defn evalight-edn [project-name]
  (str "{:name " (pr-str project-name) "\n"
       " :main app.core\n"
       " :src-paths [\"src\"]\n"
       " :preview {:css [\"public/style.css\"]}}\n"))

(defn package-json [project-name]
  (str "{\n"
       "  \"name\": " (pr-str project-name) ",\n"
       "  \"private\": true,\n"
       "  \"scripts\": {\n"
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

(defn readme [project-name]
  (str "# " project-name "\n\n"
       "A ClojureScript project created in Evalight.\n\n"
       "The files in this zip are a normal project directory. They are not an\n"
       "Evalight-specific storage format. You can keep editing them in the browser,\n"
       "or extract this archive and continue locally.\n\n"
       "## Run the app locally\n\n"
       "Install [Bun](https://bun.sh) and a JDK, then:\n\n"
       "```sh\n"
       "bun install\n"
       "bun run dev\n"
       "```\n\n"
       "Open http://localhost:3456 — shadow-cljs compiles `src/app/core.cljs`\n"
       "into `public/js`.\n\n"
       "## Keep editing in Evalight\n\n"
       "From a checkout of Evalight:\n\n"
       "```sh\n"
       "bun install\n"
       "bun run local /path/to/" project-name "\n"
       "```\n\n"
       "That serves the same Evalight UI, but the filesystem backend talks to\n"
       "these real files instead of the browser's Origin Private File System.\n\n"
       "In the browser playground, Evalight interprets this source with SCI so\n"
       "you can evaluate forms against the live preview. Locally, the same\n"
       "source is compiled by shadow-cljs. The namespaces (`replicant.dom`,\n"
       "`app.core`, …) are the same in both modes.\n"))

(defn public-html [project-name]
  (str "<!DOCTYPE html>\n"
       "<html lang=\"en\">\n"
       "<head>\n"
       "  <meta charset=\"utf-8\">\n"
       "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
       "  <title>" project-name "</title>\n"
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
       "}\n\n"
       "* { box-sizing: border-box; }\n"
       "html, body { margin: 0; height: 100%; }\n"
       "body {\n"
       "  font-family: \"Figtree\", \"Source Sans 3\", system-ui, sans-serif;\n"
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
       "h1 { font-family: \"Fraunces\", Georgia, serif; font-weight: 560; font-size: 2.4rem; margin: 0 0 0.6rem; }\n"
       ".lede { color: var(--muted); line-height: 1.5; margin: 0 0 1.8rem; }\n"
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
       ".lamp:hover { border-color: var(--gold); }\n"
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
       "code { font-family: \"IBM Plex Mono\", ui-monospace, monospace; font-size: 0.92em; color: var(--ink); }\n"))

(defn greet-cljs []
  (str "(ns app.greet)\n\n"
       "(defn greet\n"
       "  \"A tiny helper so the project has more than one namespace.\"\n"
       "  [name]\n"
       "  (str \"Hello, \" name \".\"))\n"))

(defn core-cljs [project-name]
  (str "(ns app.core\n"
       "  (:require [app.greet :as greet]\n"
       "            [replicant.dom :as r]))\n\n"
       "(defonce store\n"
       "  (atom {:title " (pr-str (str "Lamp · " project-name)) "\n"
       "         :count 0\n"
       "         :notes [\"Edit src/app/core.cljs — the preview follows.\"\n"
       "                 \"Evaluate (bump) in the REPL to touch the live app.\"\n"
       "                 \"Parinfer will keep the parentheses on your side.\"]}))\n\n"
       "(defn view [{:keys [title count notes]}]\n"
       "  [:div.app\n"
       "   [:p.eyebrow \"Live ClojureScript\"]\n"
       "   [:h1 title]\n"
       "   [:p.lede (greet/greet \"Evalight\") \" This page is the running program, not a build artifact.\"]\n"
       "   [:button.lamp {:on {:click (fn [_e] (bump))}}\n"
       "    [:span.count (str count)]\n"
       "    [:span \"Light another lamp\"]]\n"
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
       "(defn retitle [s]\n"
       "  (swap! store assoc :title s)\n"
       "  (render)\n"
       "  s)\n\n"
       "(defn init []\n"
       "  (render))\n\n"
       "(init)\n"))

(defn files
  "Return an ordered map of relative path -> content for a new project."
  [project-name]
  (let [name (or (not-empty project-name) "lamp")]
    {"evalight.edn" (evalight-edn name)
     "package.json" (package-json name)
     "shadow-cljs.edn" (shadow-cljs-edn)
     ".gitignore" (gitignore)
     "README.md" (readme name)
     "public/index.html" (public-html name)
     "public/style.css" (public-css)
     "src/app/greet.cljs" (greet-cljs)
     "src/app/core.cljs" (core-cljs name)}))
