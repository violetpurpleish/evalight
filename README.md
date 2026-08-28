# Evalight

A small, live ClojureScript environment that starts in the browser.

Open the site and write ClojureScript immediately. There is no account, no project wizard, and no local toolchain required for the first session. The running preview *is* the program: evaluate a form and it talks to that live image, in the spirit of Nightlight, Lisp machines, and Smalltalk.

When a project outgrows the playground, export it as a ZIP. The zip is a normal directory — source, `shadow-cljs.edn`, `package.json`, a README — not an Evalight-specific document. Extract it, then keep editing the same files either with shadow-cljs or by pointing Evalight's local mode at the folder.

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

Then open [http://127.0.0.1:48721](http://127.0.0.1:48721). `bun run dev` starts shadow-cljs in watch mode and serves the UI from `public/`.

| Script | What it does |
| --- | --- |
| `bun run dev` | Watch-compile the IDE and the preview runtime |
| `bun run release` | Production build into `public/js` |
| `bun run local [dir]` | Same UI, filesystem API over a real directory |
| `bun run test` | Node tests, then Chrome layout checks |
| `bun run test:ui` | Chrome layout checks only |

## Using the workshop

A first visit creates a `lamp` project in the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). Closing the tab does not lose it.

- Edit ClojureScript with CodeMirror 6, [clojure-mode](https://github.com/nextjournal/clojure-mode), and [Parinfer](https://github.com/jurjanpaul/codemirror6-parinfer). Indentation drives the parentheses.
- **Ctrl-Enter** evaluates the form at the cursor against the live preview. **Ctrl-Shift-Enter** evaluates the top-level form. **Alt-Enter** evaluates the file.
- In the REPL, **Enter** evaluates and **Shift-Enter** inserts a new line.
- The preview runs in a sandboxed iframe. User code is interpreted by [SCI](https://github.com/babashka/sci), with `replicant.dom` available so the same namespaces work in the playground and in a compiled local build.
- Drag the divider between Files, the editor, and Preview to resize the columns. Double-click a divider to restore its default width. The header can hide Files or Preview, and each of those panes has the same control. Hiding Preview keeps the iframe loaded, so the REPL still talks to the running program.
- **Delete project** removes the current browser project after a confirmation. Local mode has no such button, because that folder is yours on disk.
- Ctrl-Space asks the live preview for completions. Hover a symbol to see its docstring and arglists. Both come from the running program, not a separate language server.
- **Export ZIP** downloads the project tree as it exists on disk.

Try `(bump)` in the REPL after the lamp preview has loaded.

## From playground to a real project

Export, unzip, then:

```sh
cd lamp
bun install
bun run dev
```

That compiles the app with shadow-cljs at http://localhost:3456.

To keep using Evalight on those files:

```sh
# from this Evalight checkout
bun run local /path/to/lamp
```

The UI is the same. The filesystem protocol is implemented by a tiny Bun server instead of OPFS.

## Architecture

One UI, two filesystem backends.

```
evalight.fs.protocol
  ├─ evalight.fs.opfs     browser playground
  └─ evalight.fs.http     local mode (`scripts/local-server.mjs`)
```

The rest of the application (tree, editor, preview, export) talks only to the protocol: list, read, write, mkdir, rename, delete.

The preview is a second shadow-cljs build (`:preview`). It hosts an SCI interpreter and a copy of Replicant. The iframe is sandboxed with `allow-scripts` only, so user code cannot reach the IDE. That also means the shadow-cljs watch client has to stay off for this build: it would try to reload `preview.html` from a unique origin, the browser would block the navigation, and the lamp would never appear.

Evalight itself is also ClojureScript, so opening this repository in local mode is the first step toward editing Evalight inside Evalight.

## Tests

```sh
bun run test
```

That compiles the ClojureScript unit tests, then opens the workshop in headless Chrome and checks layout: file-row actions stay inside the sidebar, the help close control sits in the top-right of the popover, the project picker is a compact custom select rather than a stretched native widget, and the three columns can be resized or hidden without dropping the preview iframe.

`bun run test:ui` runs only the Chrome pass. It serves `public/` itself, so the IDE must already be compiled (`bun run dev` or `bun run release`). Point it at a running server with `EVALIGHT_URL=http://127.0.0.1:48721 bun run test:ui`.

The workshop UI is handwritten CSS on [Replicant](https://github.com/cjohansen/replicant). There is no React and no component library. File actions, the help popover, and the project picker are ordinary DOM plus CSS, which is why the layout tests measure bounding boxes instead of asserting against a design system.
