# Evalight follow-ups

Findings from the v1 review after the SCI / compiled split. Check items off when they are done, not when they are "probably fine."

## Map of the two runtimes

Keep this straight. A lot of the debt came from treating them as one thing.

- **Hosted playground** (`bun run dev`, this repo). SCI in a sandboxed iframe (`preview.html`). Files live in OPFS. Completions, hover, Ctrl-Enter, and Preview all talk to SCI. Do not rip SCI out.
- **Exported project** (`bun run evalight` after unzip). The iframe is the compiled app (`shadow-cljs watch :app`). Ctrl-Enter, completions, and hover talk to that JS heap over nREPL. No SCI fallback. Intel is shadow's **compiler env**, not a live `ns-interns` scrape. A `def` that exists only in the REPL will not show until save + rebuild.

The Evalight checkout itself is **not** a user project (`:workshop` in `shadow-cljs.edn`). `bun run evalight` here would be wrong; `bun run local` is the path for a real directory.

Ports when Evalight starts its own watch (export / local):

- `EVALIGHT_APP_PORT` default 48741
- `EVALIGHT_NREPL_PORT` default 7879
- `EVALIGHT_SHADOW_HTTP` default 9640

`--config-merge` only merges into the **build** map. Overlay config + isolated watch (`--force-spawn`, dedicated ports) is required so we do not steal this repo's playground nREPL.

## Done

- [x] **One pack file list.** Zip contents used to live in both `src/evalight/export.cljs` (`static-pack`) and `scripts/evalight-pack.mjs`. The Node packer is the source of truth. It writes `public/evalight-embed/manifest.json`. Browser export fallback fetches that manifest instead of a second hardcoded list.
- [x] **One filesystem HTTP handler.** `evalight/server.mjs` and `scripts/local-server.mjs` both used a copied `/api/fs` implementation. That lives in `src/evalight/embed/fs-http.mjs`.
- [x] **One static file helper.** HTML stamping, content types, and `servePublicPath` lived in `scripts/static-ui.mjs` and again in `src/evalight/embed/server.mjs`. They now live in `src/evalight/embed/static.mjs`. Pack copies that file into the zip. `scripts/static-ui.mjs` re-exports it for `dev` / `local`.
- [x] **One build stamp.** `src/evalight/build.cljs` is the id. `src/evalight/embed/build-id.mjs` is generated from it on pack/copy. HTML is stamped at serve and pack time. A test fails if cljs and the mjs copy disagree.
- [x] **Lamp fixture lock.** The embed test lamp must match `template/core-cljs`. A cljs test compares the fixture file to the template.
- [x] **Compiled Live.** Saving always writes to disk, so shadow watch still compiles. The overlay sets `:devtools {:autoload false}` so shadow does not reload the iframe itself. `:enabled false` dropped the shadow JS client, so nREPL eval succeeded on a heap that was **not** the preview iframe. Autoload false keeps the websocket; Evalight Live reloads the iframe after save (`schedule-live-reload!`, 1400ms when compiled). Live off keeps the current page. Help and the checkbox title say that.
- [x] **Watch process group.** `stopCompiledRuntime` kills the shadow-cljs process group (Unix), not only the node wrapper, so Java does not leak after SIGTERM.
- [x] **Intel EDN reader tests.** The tiny reader used for compiler-env intel has unit cases (maps, keywords, vectors, strings, nil).
- [x] **Evalight checkout is SCI.** `isUserProject` is false for this repo (`:workshop` in `shadow-cljs.edn`). Covered by a unit test.
- [x] **Compiled editor keys.** Embed Chrome test hovers `bump`, Ctrl-Enters the **`(bump)` call** (not the `defn`), and checks completions. Ctrl-Enter on `(defn bump …)` only redefines the var; the lamp count does not change. Previously the test only called `/api/runtime/*`.
- [x] **Save then compiled preview.** After the count assertions, Live goes back on. The test replaces `Hello` in `app.greet` with `LIVE-SAVE` and waits for that string in the preview lede. That is the Nightlight loop (save, shadow rebuild, iframe reload). Do not assert the lamp count across a Live reload. The atom resets.
- [x] **No implicit attach.** `bun run evalight` always starts its own overlay watch. `--attach` is the only way to join an existing nREPL. A leftover `.nrepl-port` does not change the default.
- [x] **`with-evalight-script` stays in two languages.** Browser zip rewrite cannot import the Node helper. Both copies are locked by the same fixture cases (cljs test + pack.test).

## Still duplicated on purpose

Do not "unify" these unless the constraint changes.

- **`with-evalight-script` (cljs) and `withEvalightScript` (Node).** Browser export cannot import the packer. Tests lock both.
- **`evalight/server.mjs` vs `scripts/local-server.mjs` / `scripts/dev.mjs` fetch loops.** Same routes, different roots (embed folder vs repo `public/`). The handlers they share are already modules. A shared "tiny HTTP app" would hide more than it would save.
- **`packSelf` in the embed server.** Nested export from an already-exported project is not a product. Export is hidden in local mode. Leave `packSelf` as a cheap same-folder walk.

## Still open

### Tests that are still thin

- [ ] **Attach is opt-in.** `bun run evalight --attach` joins a watch you started. It verifies shadow `nrepl-select` for `:app`, does not kill that process, and turns Evalight Live off. Implicit `.nrepl-port` sniffing is gone. Unit tests lock the flag parser. There is still no Chrome test that starts `bun run dev` first, then `--attach`.
- [ ] **Export ZIP from the playground UI.** Pack tests the Node packer. The JSZip path in `export.cljs` (`fetch-evalight-pack` + merge) is not driven in Chrome.

### Known product caveats (not bugs)

- [ ] **Completions vs REPL-only defs.** Ctrl-Enter evals in the JS heap. Hover/completions in an export come from shadow's `:app` compiler env. A `def` that exists only in the REPL will not show until the file is saved and rebuilt. Do not add a second interpreter to "fix" this. Document in Help if people trip on it.
- [ ] **`stripTopKey` is a brace matcher.** Fine for the lamp `shadow-cljs.edn`. A real config with `:http` in a string or a nested comment can break the overlay. If that shows up, parse EDN properly instead of growing the regex.
- [ ] **Watch overlay uses directory symlinks.** Correct on macOS/Linux. Windows export users may need a copy-based overlay.
- [ ] **`isUserProject` is a heuristic.** `:main` in `evalight.edn`, or `:app` and not `:workshop`. Odd third-party `shadow-cljs.edn` files may still be classified wrong.

### Do not do

- Nested export-of-export (Export is already hidden in local mode).
- Ripping SCI out of the hosted playground.
- A generic IDE, LSP, or second interpreter.
- Unifying `with-evalight-script` into one file that both the browser and Node import.
- Turning `:devtools {:enabled false}` back on to "disable reload." That drops the shadow client and nREPL evals into the wrong heap.

## Next steps (once this base holds)

These are product, not cleanup.

1. Chrome-drive Export ZIP from the playground if we care about the JSZip path.
2. Help copy for compiler-env vs REPL-only defs, if people hit it.
3. A Chrome test for `--attach` (start `watch :app`, then Evalight with the flag) if attach leaves experimental.
