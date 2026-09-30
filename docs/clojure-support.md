# Clojure and native GPUI projects

JVM Clojure and native GPUI applications run in **local mode** (`bun run local`
from this checkout, or `bun run evalight` from a project containing a packed
`evalight/` folder). The hosted playground continues to use ClojureScript + SCI.

| Project | Evaluation | Preview |
| --- | --- | --- |
| Browser ClojureScript | shadow-cljs nREPL into the browser app | iframe |
| GPUI with JVM Clojure | JVM nREPL, `clj -M:dev` | native window snapshots |
| GPUI with ClojureScript | shadow-cljs nREPL into the Bun app | native window snapshots |
| Other JVM Clojure | JVM nREPL | hidden |

The editor supports `.clj`, `.cljs`, `.cljc` and `.edn` with the same Clojure mode
and Parinfer. Native previews show PNG snapshots of the real OS window. Keep the
native window open to interact with it. Evalight refreshes snapshots after
loading, Run, evaluation and saves; it does not stream the window.

## ClojureScript GPUI

Evalight recognizes `gpui.edn` with `:backend :cljs`, or a shadow-cljs
`:node-script` build alongside a clj-gpui dependency/source path. It uses the
`:cljs-build` selected in `evalight.edn` or `gpui.edn`. Otherwise it picks the
`:app` node-script build, or the only node-script build. Multiple builds without
an `:app` need an explicit selection.

The current clj-gpui ClojureScript template needs no extra Evalight configuration:

```sh
bun install --frozen-lockfile
# From the Evalight checkout:
bun run local /path/to/my-app
```

Evalight runs the project's shadow-cljs CLI with Bun, waits for the first
successful compile, and starts the build's `:output-to` script with Bun in the
original project directory. The compiler gets a temporary configuration and
cache, isolated ports, and paths resolved against the real project. Project
configuration files are not rewritten. The project's `:after-load` hook and
shadow autoload remain enabled, so saves reload into the same Bun process and
native window. `defonce` state survives. Compiler errors keep the last successful
UI; diagnostics appear in the compiler's output. Evalight Live stays off.

To select a custom build or starting REPL namespace:

```clojure
;; evalight.edn
{:name "my-app"
 :runtime :gpui
 :cljs-build :desktop
 :main my.app/app
 :preview {:kind :native}}
```

Requirements: Bun, a JDK for compilation, project dependencies, and the native
GPUI host (`CLJ_GPUI_BIN`, or Cargo for the library's automatic host build).
Projects using shadow-cljs `:deps` also need the Clojure CLI, including the current
clj-gpui CLJS template. Evalight does not require a Node binary for this backend.

Ctrl-Enter uses `shadow/nrepl-select` for the selected build and evaluates in the
live Bun process. Hover and completions use that build's compiler environment,
including definitions entered in the REPL. The native host's `nREPL=disabled`
means there is no application JVM nREPL; shadow-cljs provides the REPL connection.

To attach to an existing compiler and application:

```sh
# In the app project, start watch and the Bun app in separate terminals first.
bun run watch
bun run start
# Then, from the Evalight checkout:
bun run local --attach /path/to/my-app
```

Attach reads `.shadow-cljs/nrepl.port`, `.nrepl-port`, or `:nrepl {:port ...}` in
`shadow-cljs.edn`. You can override it with `--nrepl-port=7888`. A browser preview
URL is unnecessary. Evalight stops both processes when it owns them, stops the
compiler if its Bun app exits, and never stops processes it attached to.

`gpui.runtime/preview-png` returns a Promise on ClojureScript. Evalight waits for
its PNG asynchronously and cleans up the temporary capture result on success,
nil, error or timeout. An unavailable capture leaves the native status pane
usable. macOS captures need Screen Recording permission; other platforms need a
supported display/capture environment.

## JVM GPUI and other Clojure projects

`gpui.edn`, a clj-gpui dependency, `gpui.dev`, or `:runtime :gpui` identifies JVM
GPUI projects when no CLJS backend is selected. Evalight starts `clj -M:dev` or
attaches to its JVM nREPL. Other `deps.edn` / `project.clj` projects start a generic
JVM nREPL and hide Preview. Explicit `:runtime :clj` selects JVM Clojure.

```clojure
;; evalight.edn for a JVM GPUI app
{:name "my-app" :main my.app/app :runtime :gpui :preview {:kind :native}}
```

JVM GPUI snapshots use the synchronous `gpui.runtime/preview-png` hook. A cold
host build can exceed Evalight's startup timeout; build the host first or attach
after a manual launch. `--attach` never stops the existing JVM application.

## Bundling Evalight

Copy a packed `evalight/` folder next to the application's sources and add this
script to its existing `package.json`, retaining its dependencies and other
scripts:

```json
{"scripts": {"evalight": "bun evalight/server.mjs"}}
```

Both runtimes use the same bundled workshop UI. Local mode serves the release
workshop, avoiding the IDE's shadow watch reconnect overlay. The native host and
application remain separate from the browser workshop.
