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

The compiled workshop JS is gitignored. `git pull` does not replace `public/js`, and a normal refresh can keep old `/js/cljs-runtime` files. If the ClojureScript caret stays in the top-left while CSS still edits, you are on that old compile. The header should show `evalight-editor-v5`. If it does not, wipe the compile, restart, and hard-refresh (Ctrl-Shift-R / Cmd-Shift-R).

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
| `bun run local [dir]` | Same UI, filesystem API over a real directory |
| `bun run test` | Node tests, then Chrome layout checks |
| `bun run test:ui` | Chrome layout checks only |

## Using the workshop

A first visit creates a `lamp` project in the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). Closing the tab does not lose it.

- Edit ClojureScript with CodeMirror 6 and [Parinfer](https://github.com/shaunlebron/parinfer) in smart mode. Type like Python: indent is what you edit, parentheses follow. **Tab** indents the current line, or accepts a completion when the list is showing. **Shift-Tab** dedents. **Enter** starts a new line at this indent so Parinfer keeps owning structure.
- **Ctrl-Enter** evaluates the form at the cursor against the live preview.
- In the REPL, **Enter** evaluates and **Shift-Enter** inserts a new line.
- The preview runs in a sandboxed iframe. User code is interpreted by [SCI](https://github.com/babashka/sci), with `replicant.dom` available so the same namespaces work in the playground and in a compiled local build.
- Drag the divider between Files, the editor, and Preview to resize the columns. Double-click a divider to restore its default width. Hide Files or Preview from that pane's header; a thin rail on that edge brings it back. Hiding Preview keeps the iframe loaded, so the REPL still talks to the running program.
- **Delete project** removes the current browser project after a confirmation. Local mode has no such button, because that folder is yours on disk.
- Hover a symbol to see its docstring and arglists. Completions come from the running program, not a separate language server.
- **Add UI** in the Files pane copies a Replicant control into `src/ui`. Those files are source, not a package. If a control is already in the project, Restore writes the original file back over your edits. Delete a file you do not want. New projects already include the kit.
- **Export ZIP** from the playground downloads the project plus a freshly built Evalight. After unzip, `bun run evalight` is this workshop on those files. That copy has no Export button: you are already on disk.

Try `(bump)` in the REPL after the lamp preview has loaded.

## From playground to a real project

Export, unzip, and from the project folder:

```sh
bun run evalight
```

Open http://127.0.0.1:48721. Evalight is already in the zip. You need [Bun](https://bun.sh), a JDK, and `bun install` once. `bun run evalight` compiles the project and attaches the workshop to that running app.

`bun run dev` in that folder is only the compiled site, without the workshop. Do not run it at the same time as `bun run evalight`.

Working on Evalight itself, `bun run local /path/to/a/folder` still points this checkout at a directory on disk.

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

`bun run evalight` starts the workshop and the project's real shadow-cljs watch. Preview is that compiled page. Ctrl-Enter, completions, and hover go through nREPL into the same JS heap. It will not fall back to SCI. You need Bun, a JDK, and `bun install` once.

Do not run `bun run evalight` and `bun run dev` in the same project at once. Both would watch `:app`.

Evalight itself is also ClojureScript, so opening this repository in local mode is the first step toward editing Evalight inside Evalight.

## Tests

```sh
bun run test
```

That compiles the ClojureScript unit tests, then opens the workshop in headless Chrome and checks layout: file-row actions stay inside the sidebar, the help close control sits in the top-right of the popover, the project picker is a compact custom select rather than a stretched native widget, and the three columns can be resized or hidden without dropping the preview iframe.

`bun run test:ui` runs only the Chrome pass. It serves `public/` itself, so the IDE must already be compiled (`bun run dev` or `bun run release`). Point it at a running server with `EVALIGHT_URL=http://127.0.0.1:48721 bun run test:ui`.

The workshop UI is Replicant plus a small kit in `src/ui` (button, dialog, popover, split, and so on). The same files are copied into new projects. There is no React and no installable widget package. File actions, the help panel, and the project picker are still measured in layout tests as ordinary DOM.
