# Evalight follow-ups

Findings from the v1 review after the SCI / compiled split. Check items off when they are done, not when they are “probably fine.”

## Done in this pass

- [x] **One pack file list.** Zip contents used to live in both `src/evalight/export.cljs` (`static-pack`) and `scripts/evalight-pack.mjs`. The Node packer is the source of truth. It writes `public/evalight-embed/manifest.json`. Browser export fallback fetches that manifest instead of a second hardcoded list.
- [x] **One filesystem HTTP handler.** `evalight/server.mjs` and `scripts/local-server.mjs` both used a copied `/api/fs` implementation. That lives in `src/evalight/embed/fs-http.mjs`.
- [x] **One build stamp.** `src/evalight/build.cljs` is the id. `src/evalight/embed/build-id.mjs` is generated from it on pack/copy. HTML is stamped at serve and pack time. A test fails if cljs and the mjs copy disagree.
- [x] **Lamp fixture lock.** The embed test lamp must match `template/core-cljs`. A cljs test compares the fixture file to the template.
- [x] **Compiled Live.** Saving always writes to disk, so shadow watch still compiles. The overlay disables shadow’s own iframe reload (`:devtools {:enabled false}`). Live on reloads the preview iframe after save. Live off keeps the current page. Help and the checkbox title say that.
- [x] **Watch process group.** `stopCompiledRuntime` kills the shadow-cljs process group (Unix), not only the node wrapper, so Java does not leak after SIGTERM.
- [x] **Intel EDN reader tests.** The tiny reader used for compiler-env intel has unit cases (maps, keywords, vectors, strings, nil).
- [x] **Evalight checkout is SCI.** `isUserProject` is false for this repo (`:workshop` in `shadow-cljs.edn`). Covered by a unit test.
- [x] **Compiled editor keys.** Embed Chrome test presses Ctrl-Enter, opens hover on `bump`, and checks completions. Previously it only called `/api/runtime/*`.
- [x] **`with-evalight-script` stays in two languages.** Browser zip rewrite cannot import the Node helper. Both copies are locked by the same fixture cases (cljs test + pack.test).

## Still open

### Tests that are still thin

- [ ] **Save then compiled preview.** Edit a `.cljs` file with Live on and assert the iframe updates (shadow rebuild + iframe reload). Ctrl-Enter already mutates the current heap; this would catch “save did not refresh Preview.”
- [ ] **Attach to an existing watch.** If `bun run dev` is already running in the project, `bun run evalight` should attach to that nREPL instead of starting a second watch. Untested.
- [ ] **Export ZIP from the playground UI.** Pack tests the Node packer. The JSZip path in `export.cljs` (`fetch-evalight-pack` + merge) is not driven in Chrome.

### Known product caveats (not bugs)

- [ ] **Completions vs REPL-only defs.** Ctrl-Enter evals in the JS heap. Hover/completions in an export come from shadow’s `:app` compiler env. A `def` that exists only in the REPL will not show until the file is saved and rebuilt. Do not add a second interpreter to “fix” this. Document in Help if people trip on it.
- [ ] **`stripTopKey` is a brace matcher.** Fine for the lamp `shadow-cljs.edn`. A real config with `:http` in a string or a nested comment can break the overlay. If that shows up, parse EDN properly instead of growing the regex.
- [ ] **Watch overlay uses directory symlinks.** Correct on macOS/Linux. Windows export users may need a copy-based overlay.
- [ ] **`isUserProject` is a heuristic.** `:main` in `evalight.edn`, or `:app` and not `:workshop`. Opening this Evalight checkout with `bun run evalight` would be wrong; `bun run local` is the path. The unit test covers the checkout. Odd third-party `shadow-cljs.edn` files may still be classified wrong.

### Do not do

- Nested export-of-export (Export is already hidden in local mode).
- Ripping SCI out of the hosted playground.
- A generic IDE, LSP, or second interpreter.
- Unifying `with-evalight-script` into one file that both the browser and Node import.
