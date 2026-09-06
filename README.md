# Evalight

A small, live ClojureScript environment that starts in the browser.

Open the site and write ClojureScript immediately. There is no account, no project wizard, and no local toolchain required for the first session. The running preview *is* the program: evaluate a form and it talks to that live image, in the spirit of Nightlight, Lisp machines, and Smalltalk.

When a project outgrows the playground, export it as a ZIP. The zip is a normal directory: source, `shadow-cljs.edn`, `package.json`, a README, and Evalight itself. Extract it and `bun run evalight` to keep using this workshop on those files, or open the folder in any other editor.

## Run it

Evalight uses [Bun](https://bun.sh) and a JDK (for shadow-cljs).

```sh
bun install
bun run dev
```

`bun install` must finish before `bun run dev`. It collapses nested `@codemirror` copies; without that, the editor fails to start (`multiple instances of @codemirror/state`) and files will not open. If you already have `node_modules` from an older checkout:

```sh
rm -rf node_modules public/js .shadow-cljs
bun install
bun run dev
```

Then open [http://127.0.0.1:48721](http://127.0.0.1:48721). `bun run dev` starts shadow-cljs in watch mode and serves the UI from `public/`. Wait until `:app` compiles before using the editor.

The compiled workshop JS is gitignored. `git pull` does not replace `public/js`, and a normal refresh can keep old `/js/cljs-runtime` files. If the ClojureScript caret stays in the top-left while CSS still edits, wipe the compile, restart, and hard-refresh (Ctrl-Shift-R / Cmd-Shift-R).

```sh
rm -rf public/js .shadow-cljs
bun install
bun run dev
```

| Script | What it does |
| --- | --- |
| `bun run dev` | Watch-compile the IDE and the preview runtime |
| `bun run release` | Production build into `public/js` |
| `bun run embed` | Release-compile the UI that Export puts in the zip |
| `bun run local [dir]` | Same UI over a real directory. Serves the **release** workshop JS (`evalight-ui/js`), not leftover `public/js` from `bun run dev`. |
| `bun run test` | Node tests, then Chrome layout checks |
| `bun run test:ui` | Chrome layout checks only |
| `bun run test:projects` | Project metadata unit tests and Chrome switcher checks |
| `bun run licenses` | Regenerate `THIRD_PARTY_LICENSES.md` and `public/licenses.html` |
| `bun run licenses:check` | Fail if a shipped license is off the allowlist, or if those files are stale |

## Using the workshop

A first visit creates a `lamp` project in the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). Closing the tab does not lose it.

- Edit ClojureScript with CodeMirror 6 and [Parinfer](https://github.com/shaunlebron/parinfer) in smart mode. Type like Python: indent is what you edit, parentheses follow. **Tab** indents the current line, or accepts a completion when the list is showing. **Shift-Tab** dedents. **Enter** starts a new line at this indent so Parinfer keeps owning structure.
- **Ctrl-Enter** evaluates the form at the cursor against the live preview.
- In the REPL, **Enter** evaluates and **Shift-Enter** inserts a new line.
- The preview runs in a sandboxed iframe. User code is interpreted by [SCI](https://github.com/babashka/sci), with `replicant.dom` available so the same namespaces work in the playground and in a compiled local build.
- Drag the divider between Files, the editor, and Preview to resize the columns. Double-click a divider to restore its default width. Hide Files or Preview from that pane's header; a thin rail on that edge brings it back. Hiding Preview keeps the iframe loaded, so the REPL still talks to the running program. The editor bar is a breadcrumb trail: click a folder or file name to switch without opening Files. **Ctrl+K** (or **Ctrl+Shift+P**) opens the command palette for actions that are not on the toolbar.
- The **Project actions** menu (•••) beside the switcher contains New project, Export ZIP, and Delete project. **Delete project** removes the current browser project after a confirmation. Local mode has no such button, because that folder is yours on disk.
- The **project switcher** lists browser projects by last edited, with relative edit times and creation dates. Search by name, use the arrow keys and Enter to switch, or create a project from the menu. Opening a project does not change its edit time. Dates are stored beside the projects in browser storage and are excluded from ZIP exports.
- Hover a symbol to see its docstring and arglists. Completions come from the running program, not a separate language server.
- **Add UI** in the toolbar copies a Replicant control into `src/ui`. Those files are source, not a package. If a control is already in the project, Restore writes the original file back over your edits. Delete a file you do not want. New projects already include the kit.
- **Export ZIP** from the playground downloads the project plus a freshly built Evalight. After unzip, `bun run evalight` is this workshop on those files. That copy has no Export button: you are already on disk.

Try `(bump)` in the REPL after the lamp preview has loaded.

## From playground to a real project

Export, unzip, and from the project folder:

```sh
bun run evalight
```

Open http://127.0.0.1:48721. Evalight is already in the zip. You need [Bun](https://bun.sh), a JDK, and `bun install` once. `bun run evalight` compiles the project and attaches the workshop to that running app.

`bun run dev` in that folder is only the compiled site, without the workshop. Do not run it at the same time as `bun run evalight`.

Working on Evalight itself, `bun run local /path/to/a/folder` still points this checkout at a directory on disk. That command builds (or reuses) the release workshop UI so a leftover `shadow-cljs watch` of `:app` cannot paint the **shadow-cljs – Reconnecting…** overlay on the IDE. `bun run dev` is the watch HUD; do not use that JS for local mode.

## Architecture

One UI, two filesystem backends.

```
evalight.fs.protocol
  ├─ evalight.fs.opfs     browser playground
  └─ evalight.fs.http     local mode (`scripts/local-server.mjs`)
```

The rest of the application (tree, editor, preview, export) talks only to the protocol: list, read, write, mkdir, rename, delete. Export also asks the server for a release build of this UI and writes it into `evalight/` in the zip so `bun run evalight` works from the unzipped folder.

Two runtimes, one UI.

```
evalight.preview
  ├─ SCI iframe          hosted playground (OPFS)
  └─ compiled app        bun run evalight / bun run local
                          shadow-cljs watch :app + nREPL into that heap
```

The hosted playground still interprets source with SCI inside a sandboxed `preview.html`. There is no compiler in the browser.

`bun run evalight` starts the workshop and a dedicated `shadow-cljs watch :app` (its own nREPL and HTTP ports, so it does not collide with another shadow server on this machine). Preview is that compiled page. Ctrl-Enter, completions, and hover go through nREPL into the same JS heap. It will not fall back to SCI. You need Bun, a JDK, and `bun install` once.

Do not also run `bun run dev` in the same project. Two watches of `:app` fight over `public/js`.

To join a watch you already started:

```sh
bun run evalight --attach
```

That uses the running shadow nREPL and does not stop it. Evalight Live stays off so it does not fight shadow autoload. If the app URL cannot be read from `:dev-http`, pass `--preview-url=http://127.0.0.1:3456/`. If there is no `.nrepl-port` file, attach reads `:nrepl {:port ...}` from `shadow-cljs.edn`. A leftover `.nrepl-port` file is ignored unless you pass `--attach`.

Evalight itself is also ClojureScript, so opening this repository in local mode is the first step toward editing Evalight inside Evalight.

## JVM Clojure and clj-gpui (experimental)

Local mode can open a real Clojure directory. Detection lives in
`src/evalight/embed/project.mjs`. clj-gpui apps get a JVM nREPL and a
native-window preview pane; other Clojure projects get the editor and
REPL with Preview hidden. The hosted playground stays ClojureScript.

See [docs/clojure-support.md](docs/clojure-support.md). To put Evalight
next to a [clj-gpui](https://github.com/gitwyrm/clj-gpui) template:

```clojure
;; evalight.edn
{:name "my-app"
 :main my.app/app
 :runtime :gpui
 :preview {:kind :native}}
```

Then `bun run evalight` from that folder (after copying a packed
`evalight/` tree). First run still needs `clj -M:dev`'s host build.

## Tests

```sh
bun run test
```

That compiles the ClojureScript unit tests, then opens the workshop in headless Chrome and checks layout: file-row actions stay inside the sidebar, the help close control sits in the top-right of the popover, the project switcher opens a custom menu, and the three columns can be resized or hidden without dropping the preview iframe.

`bun run test:ui` runs only the Chrome pass. It serves `public/` itself, so the IDE must already be compiled (`bun run dev` or `bun run release`). Point it at a running server with `EVALIGHT_URL=http://127.0.0.1:48721 bun run test:ui`.

The workshop UI is Replicant plus a small kit in `src/ui` (button, dialog, popover, split, and so on). The same files are copied into new projects. There is no React and no installable widget package. File actions, the help panel, and the project picker are still measured in layout tests as ordinary DOM.

Evalight, including that kit, is MIT. Copyright (c) 2026 violetpurpleish & contributors. See `LICENSE`.

## Third-party licenses

`bun run licenses` walks the npm modules the editor actually imports, plus the Clojure libraries compiled into the browser JS (Replicant, SCI, edamame, cljs.core, Google Closure Library). It writes `THIRD_PARTY_LICENSES.md` for the repo and `public/licenses.html` for the hosted app. Help, at the bottom of the popover, links to that page as **Open Source Licenses**.

`bun run licenses --check` (also the first step of `bun run test`) fails if a shipped package uses an SPDX id that is not in `scripts/licenses-allowlist.json`, or if the generated files are stale. `OR` is allowed when any option is on the list. `AND` requires every part. JSZip is `(MIT OR GPL-3.0-or-later)`; Evalight elects MIT.

Add a future license to `allowed` in `scripts/licenses-allowlist.json` only when you mean to ship it. If a POM or `package.json` is wrong, put the real text in `scripts/license-overrides/` and name it in `overrides`. Replicant's published POM says EPL but the GitHub LICENSE is MIT; that override is the example.

An Export ZIP puts Evalight's MIT `LICENSE` at the project root (copied `src/ui`, lamp source, `evalight/*.mjs`). Third-party notices for the compiled workshop JS go in `evalight/public/licenses.html`. shadow-cljs and replicant listed in the exported `package.json` / `shadow-cljs.edn` are not bundled in the ZIP, so they are not dumped there.
