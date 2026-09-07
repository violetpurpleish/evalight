(ns evalight.template
  (:require [clojure.string :as str]
            [evalight.kit :as kit])
  (:require-macros [evalight.kit.embed :refer [gallery-source starter-source starter-css]]))

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
       "`src/app/core.cljs` contains the counter and the theme setting.\n\n"
       "Evalight is already in this folder. The rest is a normal project\n"
       "directory: source, shadow-cljs, a README. Keep using this workshop,\n"
       "or open the files in any other editor.\n\n"
       "Set `theme` in `app.core` to `:system`, `:light`, or `:dark`.\n"
       "Use `[ui.api :as ui]` for components such as `ui/button` and `ui/popover`.\n"
       "The generated `src/ui/api.cljs` exports follow Add UI and file removal.\n\n"
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

(defn public-css [] (starter-css))

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

(defn core-cljs [_project-name] (starter-source))

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
      "src/app/core.cljs" (core-cljs name)})))
