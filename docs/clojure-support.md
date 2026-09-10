# Clojure and clj-gpui in Evalight

Feasibility spike. The hosted playground stays ClojureScript + SCI. JVM
Clojure is **local mode only** (`bun run evalight` / `bun run local`).

## What already worked

- The editor maps `.clj` / `.cljs` / `.cljc` / `.edn` to the same
  CodeMirror Clojure mode and Parinfer.
- Local Evalight already speaks nREPL (bencode TCP client). Compiled
  ClojureScript uses a Clojure session plus `shadow/nrepl-select`.
- Preview is an iframe of either SCI (`preview.html`) or the compiled
  app HTTP server. Hiding Preview is already a first-class layout mode.

## What was missing

SCI cannot load JVM Clojure (interop, macros, `clj-gpui`).
`project-payload` only sent `.cljs` / `.cljc` to the sandbox.
`isUserProject` treated any `evalight.edn` with `:main` as a
shadow-cljs app, so dropping Evalight into a clj-gpui template would
try to start `shadow-cljs watch` and fail.

GPUI is a native window (Rust process, Vulkan). It is not HTML. An
iframe cannot contain it.

## Runtime split (this branch)

| Kind | How we detect it | Eval | Preview |
| --- | --- | --- | --- |
| ClojureScript lamp / export | `shadow-cljs.edn` `:app`, or `evalight.edn` `:main` without `:runtime` | SCI (playground) or shadow nREPL (local) | iframe |
| Evalight checkout | `:workshop` in `shadow-cljs.edn` | SCI | iframe of workshop |
| **clj-gpui** | `evalight.edn` `:runtime :gpui`, `gpui.edn`, or `clj-gpui` / `gpui.dev` in `deps.edn` | JVM nREPL (`clj -M:dev` or `--attach`) | native window + status pane |
| **JVM Clojure** | `deps.edn` / `project.clj` without the above | JVM nREPL (`nrepl.cmdline` or `--attach`) | **hidden** |

`evalight.edn` `:runtime` always wins. `:preview {:kind :native|:iframe|:none}`
overrides the default.

## Can Preview show the GPUI window?

**Not inside the iframe.** The running program is the OS window that
`gpui.dev` already opens. That is the honest preview.

This branch:

1. Spawns or attaches to `clj -M:dev` so that window still appears.
2. Replaces the iframe with a **Preview · GPUI** pane (nREPL port, app
   var, status). Live stays off: clj-gpui's file watcher already reloads.
3. Asks `GET /api/runtime/frame` after nREPL connects, after Run, after
   a successful eval, and shortly after a save. That evals
   `(gpui.runtime/preview-png)` when the var exists. Not a poll, and
   Live stays off.

**clj-gpui does not intern `preview-png` today.** There is no screenshot
or offscreen capture in the host protocol (v5 is UI-tree JSON). To put
pixels in the Evalight pane, add something like:

```clojure
;; in clj-gpui, later
(defn preview-png
  "Return a base64 PNG of the current native window, or nil."
  []
  ...)
```

The host would capture the GPUI framebuffer (or an OS window shot) and
Clojure would return the bytes. Evalight already displays a `data:image/png`
when that call succeeds. Reconstructing the UI tree as HTML would not
be the GPUI window; this spike does not do that.

## Bundling with the clj-gpui template

Evalight's export zip already vendors `evalight/` (workshop JS +
`server.mjs`). A clj-gpui app should do the same, **without**
shadow-cljs:

```clojure
;; template/evalight.edn
{:name "my-app"
 :main my.app/app
 :runtime :gpui
 :preview {:kind :native}}
```

```json
{
  "name": "my-app",
  "private": true,
  "scripts": {
    "evalight": "bun evalight/server.mjs"
  }
}
```

`evalight.template/gpui-evalight-edn` and `clj-package-json` emit those
files. Copy a packed `evalight/` folder next to `src/` (from
`bun run embed` + pack, or `bun run evalight` after placing it).

Then, from the app directory:

```sh
bun run evalight
```

Needs Bun (workshop server), a JDK, the Clojure CLI, and a GPUI host
binary (`CLJ_GPUI_BIN` or Cargo on first `clj -M:dev`). It does **not**
need `bun install` of shadow-cljs.

`--attach` joins an already-running `clj -M:dev` nREPL and does not
kill it. `--preview-url` is a ClojureScript flag and is unused here.

From an Evalight checkout:

```sh
bun run local /path/to/clj-gpui/examples/todomvc
```

That serves the **`:workshop` release** (`evalight-ui/js`), never
`public/js` from `bun run dev`. A watch build of the IDE injects the
shadow HUD. Local mode does not start that websocket, so the old path
showed **shadow-cljs – Reconnecting…** over a SCI preview while
`clj -M:dev` still opened the native window.

If Preview still says Live / `(bump)` / `app.core`, the browser is not
on this local server (wrong port), or it is caching `/js/main.js`.
Hard-refresh (Ctrl-Shift-R). The header should read **GPUI** next to
the project name, and Preview should be **Preview · GPUI**.

## Generic Clojure (not clj-gpui)

Same editor, REPL, hover, completions. No preview column (and no
mobile Preview tab). Evalight is then a small Nightlight-style
workshop on disk, not a browser image.

The hosted playground will not grow a JVM. SCI-in-the-browser is the
wrong interpreter for real Clojure.

## Risks

- First `clj -M:dev` compiles the Rust host. Evalight waits up to 120s
  for nREPL. A cold Cargo build can exceed that; `--attach` after a
  manual first run is the workaround.
- Linux GPUI needs a display and Vulkan (lavapipe is enough). Headless
  Cloud Agent VMs will connect nREPL and show the status pane, not a
  window.
- `nrepl.cmdline` for generic Clojure ignores project `:nrepl` aliases.
  `evalight.edn` can grow `{:nrepl {:cmd [...]}}` later.
- Windows: process-group kill matches the compiled runtime (Unix-first).

## What this repo still will not do

- SCI eval of `.clj` in the playground.
- A second interpreter, LSP, or generic IDE.
- Embedding a native window in Chromium.
- Changing clj-gpui itself (that is a follow-up in violetpurpleish/clj-gpui).
