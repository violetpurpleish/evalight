/** Namespace regression: actual Ctrl-Enter against SCI, plus the nREPL HTTP
 * contract and an editor-tab switch during save. Compile app + preview first.
 * Uses an isolated Chrome profile and a disposable OPFS project.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { servePublicPath } from "../../src/evalight/embed/static.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const chrome = [process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/local/bin/google-chrome", "/usr/bin/chromium",
].filter(Boolean).find(existsSync);
assert.ok(chrome, "Set CHROME_PATH to Chrome/Chromium");
const requests = [];
const server = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/meta") return Response.json({ mode: "browser" });
    if (url.pathname === "/api/runtime/frame") return Response.json({ ok: true });
    if (url.pathname.startsWith("/api/runtime/")) {
      const body = await req.json();
      requests.push({ path: url.pathname, ...body });
      return Response.json({ ok: true, value: "2", ns: body.ns, items: [] });
    }
    return await servePublicPath(join(ROOT, "public"), url.pathname) || new Response("Not found", { status: 404 });
  },
});
let browser;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.waitForSelector(".cm-content");
  await page.waitForFunction(() => document.querySelector(".file-path")?.textContent.includes("core.cljs"));
  await page.waitForFunction(() => cljs.core.clj__GT_js(cljs.core.deref(evalight.state.app)).preview.status === "ok");
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const ws = await root.getDirectoryHandle("evalight");
    const projects = await ws.getDirectoryHandle("projects");
    const project = await projects.getDirectoryHandle("lamp");
    const src = await project.getDirectoryHandle("src");
    const app = await src.getDirectoryHandle("app");
    for (const [name, content] of [
      ["helper.cljs", "(ns app.helper)\n(defn answer [] 1)\n"],
      ["core.cljs", "(ns app.core (:require [app.helper :as helper]))\n(defn answer [] 100)\n(defn init [] nil)\n"],
    ]) {
      const file = await app.getFileHandle(name, { create: true });
      const writer = await file.createWritable();
      await writer.write(content);
      await writer.close();
    }
  });
  await page.reload();
  await page.waitForSelector(".cm-content");
  await page.waitForFunction(() => cljs.core.clj__GT_js(cljs.core.deref(evalight.state.app)).preview.status === "ok");
  const evaluate = code => page.evaluate(async code => cljs.core.clj__GT_js(await evalight.preview.eval_code(code)), code);
  const before = await evaluate("[(app.helper/answer) (app.core/answer)]");
  assert.equal(before.ok, true, JSON.stringify(before));
  assert.equal(before.value, "[1 100]");
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".tree-row")].find(r => r.querySelector(".tree-name")?.textContent === "helper.cljs");
    row.querySelector(".tree-item").click();
  });
  await page.waitForFunction(() => document.querySelector(".file-path")?.textContent.includes("helper.cljs"));
  await page.evaluate(() => {
    // Replace the buffer without autosave/reload to isolate the evaluation action.
    evalight.editor.set_doc_BANG_("src/app/helper.cljs", "(ns app.helper)\n(defn answer [] 2)\n");
    window.evalResults = [];
    window.addEventListener("message", event => {
      if (event.data?.type === "evalight/result") window.evalResults.push(event.data);
    });
  });
  await page.click(".cm-content");
  await page.keyboard.down("Control");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => window.evalResults.length > 0);
  const keyboardResult = await page.evaluate(() => window.evalResults[0]);
  assert.equal(keyboardResult.ok, true, JSON.stringify(keyboardResult));
  const after = await evaluate("[(app.helper/answer) (app.core/answer)]");
  assert.equal(after.value, "[2 100]", "Ctrl-Enter must redefine the helper var without overwriting the main var");
  assert.equal((await evaluate("(answer)")).value, "100", "subsequent REPL evaluation must still use main");
  assert.equal((await evaluate("(str (ns-name *ns*))")).value, '"app.core"');
  const sciIntel = await page.evaluate(async () => cljs.core.clj__GT_js(await evalight.preview.refresh_intel_BANG_()));
  assert.equal(sciIntel.ns, "app.core", "intel must describe main after helper evaluation");
  assert.ok(sciIntel.items.some(item => item.name === "answer" && item.ns === "app.core"),
    "main-namespace vars must remain available in intel");

  // Exercise the same editor action for every nREPL-backed runtime. The fake
  // server checks request routing; SCI above verifies real evaluation semantics.
  for (const runtime of ["compiled", "clj", "gpui"]) {
    requests.length = 0;
    await page.evaluate(async runtime => {
      cljs.core.swap_BANG_(evalight.state.app, state => cljs.core.assoc(state,
        cljs.core.keyword("runtime"), cljs.core.keyword(runtime)));
      await evalight.actions.on_editor_eval("(answer)", cljs.core.keyword("cursor"));
      await evalight.actions.submit_repl_BANG_("(answer)");
      await evalight.preview.refresh_intel_BANG_();
    }, runtime);
    assert.deepEqual(requests.filter(r => r.path === "/api/runtime/eval").map(r => r.ns),
      ["app.helper", "app.core"], `${runtime}: editor namespace and REPL namespace must remain separate`);
    assert.ok(requests.filter(r => r.path === "/api/runtime/intel").every(r => r.ns === "app.core"),
      `${runtime}: editor eval must not replace main-namespace intel`);
  }

  requests.length = 0;
  await page.evaluate(async () => {
    let finishSave;
    const originalSave = evalight.actions.save_current_BANG_.cljs$core$IFn$_invoke$arity$1;
    evalight.actions.save_current_BANG_.cljs$core$IFn$_invoke$arity$1 = () => new Promise(resolve => { finishSave = resolve; });
    try {
      const evaluating = evalight.actions.on_editor_eval("(answer)", cljs.core.keyword("cursor"));
      evalight.editor.show_BANG_("src/app/core.cljs", "(ns app.core)\n(defn answer [] 100)\n");
      finishSave();
      await evaluating;
    } finally {
      evalight.actions.save_current_BANG_.cljs$core$IFn$_invoke$arity$1 = originalSave;
    }
  });
  assert.equal(requests.find(r => r.path === "/api/runtime/eval")?.ns, "app.helper",
    "a tab switch during saving must not change the submitted expression's namespace");
  assert.deepEqual(errors, [], "browser must not report uncaught application errors");
  console.log("editor-eval: Ctrl-Enter SCI namespace, REPL/intel preservation, nREPL routing, and save/tab race passed");
} finally {
  await browser?.close();
  server.stop(true);
}
