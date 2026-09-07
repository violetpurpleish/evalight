/**
 * Chrome-drive bun run evalight --attach.
 *
 * Starts shadow-cljs watch :app in a lamp, then Evalight with only --attach.
 * Joins that nREPL, does not start an overlay watch, turns Live off, and
 * leaves the compiler running after Evalight exits.
 *
 * Ports (do not collide with the playground on 48721, or embed.test):
 *   workshop UI 48732, compiled app 48752, nREPL 7880, shadow HTTP 9642.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { packEvalight } from "../../scripts/evalight-pack.mjs";
import { pingNrepl } from "../../src/evalight/embed/nrepl.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 48732;
const APP_PORT = 48752;
const NREPL_PORT = 7880;
const SHADOW_HTTP = 9642;
const OWNED_APP_PORT = 48741;

function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean).find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome/Chromium found. Set CHROME_PATH.");
  return found;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function until(fn, ms, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await sleep(200);
  }
  throw new Error(label + " last=" + JSON.stringify(last));
}

function waitForOutput(child, pattern, ms = 8000) {
  return new Promise((resolve, reject) => {
    let acc = "";
    const t = setTimeout(() => {
      reject(new Error(`timed out waiting for ${pattern}: ${acc.slice(-2500)}`));
    }, ms);
    const onData = (buf) => {
      acc += String(buf);
      if (pattern.test(acc)) {
        clearTimeout(t);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        resolve(acc);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
  });
}

function killGroup(proc) {
  if (!proc?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-proc.pid, "SIGTERM");
    else proc.kill("SIGTERM");
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

async function writeLamp(dir) {
  await mkdir(join(dir, "src/app"), { recursive: true });
  await mkdir(join(dir, "public/css"), { recursive: true });
  await cp(join(REPO, "src/ui"), join(dir, "src/ui"), { recursive: true });
  await cp(join(REPO, "public/css/ui.css"), join(dir, "public/css/ui.css"));
  await writeFile(join(dir, "evalight.edn"),
    `{:name "lamp"\n :main app.core\n :src-paths ["src"]\n :preview {:css ["public/css/ui.css" "public/style.css"]}}\n`);
  await writeFile(join(dir, "package.json"),
    `${JSON.stringify({
      name: "lamp",
      private: true,
      scripts: { evalight: "bun evalight/server.mjs", dev: "shadow-cljs watch app" },
      devDependencies: { "shadow-cljs": "2.28.23" },
    }, null, 2)}\n`);
  await writeFile(
    join(dir, "shadow-cljs.edn"),
    `{:source-paths ["src"]\n` +
      ` :dependencies [[no.cjohansen/replicant "2026.07.1"]]\n` +
      ` :nrepl {:port ${NREPL_PORT}}\n` +
      ` :http {:host "127.0.0.1" :port ${SHADOW_HTTP}}\n` +
      ` :dev-http {${APP_PORT} "public"}\n` +
      ` :node-modules {:managed-by :bun}\n` +
      ` :builds\n` +
      ` {:app {:target :browser\n` +
      `        :output-dir "public/js"\n` +
      `        :asset-path "/js"\n` +
      `        :modules {:main {:init-fn app.core/init}}}}}\n`,
  );
  await writeFile(join(dir, "src/app/gallery.cljs"),
    await readFile(join(REPO, "src/evalight/templates/gallery.cljs"), "utf8"));
  await writeFile(join(dir, "src/app/greet.cljs"),
    `(ns app.greet)\n(defn greet [name] (str "Hello, " name "."))\n`);
  await writeFile(
    join(dir, "src/app/stats.cljs"),
    `(ns app.stats)\n(defonce !tally (atom 0))\n(defn tally [] @!tally)\n(defn record! [] (swap! !tally inc) @!tally)\n`,
  );
  await writeFile(
    join(dir, "src/app/core.cljs"),
    await readFile(join(HERE, "fixtures/lamp-core.cljs"), "utf8"),
  );
  await writeFile(join(dir, "public/style.css"),
    `.app { padding: 2rem; } h1 { font-family: sans-serif; }\n`);
  await writeFile(join(dir, "public/index.html"),
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>lamp</title>\n  <link rel="stylesheet" href="/css/ui.css">\n  <link rel="stylesheet" href="/style.css">\n</head>\n<body>\n  <div id="app"></div>\n  <script src="/js/main.js"></script>\n</body>\n</html>\n`);
  const files = await packEvalight(REPO, { compileIfMissing: true, requireJs: true });
  for (const [path, text] of Object.entries(files)) {
    const dest = join(dir, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, text);
  }
}

async function bunInstall(dir) {
  await new Promise((resolve, reject) => {
    const inst = spawn("bun", ["install"], { cwd: dir, stdio: "inherit" });
    inst.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("bun install failed"))));
    inst.on("error", reject);
  });
}

async function httpOk(url) {
  try {
    const res = await fetch(url, { headers: { Accept: "text/html" } });
    return res.ok;
  } catch {
    return false;
  }
}

async function httpReachable(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

const lamp = await mkdtemp(join(tmpdir(), "evalight-attach-"));
await writeLamp(lamp);
await bunInstall(lamp);

const watchBin = join(lamp, "node_modules", ".bin", "shadow-cljs");
const watch = spawn(watchBin, ["watch", "app"], {
  cwd: lamp,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
watch.stderr.pipe(process.stderr);
watch.stdout.pipe(process.stdout);

let evalight = null;
let browser = null;
try {
  await waitForOutput(watch, /Build completed/, 120000);
  await until(() => pingNrepl(NREPL_PORT), 20000, "user nREPL never came up");
  await until(
    () => httpOk(`http://127.0.0.1:${APP_PORT}/`),
    20000,
    "user :dev-http never served the app",
  );

  evalight = spawn("bun", ["evalight/server.mjs", "--attach"], {
    cwd: lamp,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  evalight.stderr.pipe(process.stderr);
  evalight.stdout.pipe(process.stdout);
  const bootLog = await waitForOutput(evalight, /Evalight  http/, 60000);
  assert.match(bootLog, /will not be stopped/);
  assert.match(bootLog, /Attached · :app · localhost:48752/);

  const userDataDir = await mkdtemp(join(tmpdir(), "evalight-attach-chrome-"));
  browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: "new",
    userDataDir,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tree-row", { timeout: 20000 });
  await until(
    async () => {
      const t = await page.$eval(".cm-content", (el) => el.innerText).catch(() => "");
      return t.includes("app.core") ? t : null;
    },
    15000,
    "editor never loaded app.core",
  );

  const meta = await fetch(`http://127.0.0.1:${PORT}/api/meta`).then((r) => r.json());
  assert.equal(meta.runtime, "compiled");
  assert.equal(meta.attached, true);
  assert.equal(meta["attach-label"], "Attached · :app · localhost:48752");
  assert.equal(meta["preview-url"], `http://127.0.0.1:${APP_PORT}/`);
  assert.equal(meta["runtime-error"], null);

  const runtime = await until(
    async () => {
      const st = await fetch(`http://127.0.0.1:${PORT}/api/runtime`).then((r) => r.json());
      return st.connected ? st : null;
    },
    120000,
    "attached runtime never connected",
  );
  assert.equal(runtime.attached, true);
  assert.equal(runtime.runtime, "compiled");

  const sciPreview = page.frames().find((f) => (f.url() || "").includes("preview.html"));
  assert.equal(sciPreview, undefined, "attached Evalight must not load SCI preview.html");

  const preview = await until(
    async () => {
      const f = page.frames().find((fr) => (fr.url() || "").includes(String(APP_PORT)));
      if (!f) return null;
      const t = await f.$eval("h1", (el) => el.textContent).catch(() => "");
      return t.includes("Lamp") ? f : null;
    },
    30000,
    "attached preview iframe never rendered lamp",
  );
  const sciFlag = await preview.evaluate(() => window.EVALIGHT_SCI);
  assert.equal(sciFlag, undefined, "attached preview must not set EVALIGHT_SCI");

  const head = await page.$eval(".preview .pane-head", (el) => el.innerText);
  assert.match(head, /attached/i);
  assert.match(head, /localhost:48752/i);
  const live = await page.$(".live input[type=checkbox]");
  assert.ok(live, "Live checkbox missing");
  assert.equal(await live.evaluate((el) => el.disabled), true, "Live must be disabled while attached");
  assert.equal(await live.evaluate((el) => el.checked), false, "Live must start off while attached");

  assert.equal(
    await httpReachable(`http://127.0.0.1:${OWNED_APP_PORT}/`),
    false,
    "attach must not start the owned overlay watch on :48741",
  );

  const banner = await page.$eval(".preview-banner", (el) => el.innerText).catch(() => null);
  assert.equal(banner, null, banner);

  await preview.evaluate(() => {
    const btn = document.querySelector("button.lamp");
    if (!btn) throw new Error("no lamp button");
    btn.click();
  });
  const count = await until(
    async () => {
      const t = await preview.$eval(".count", (el) => el.textContent).catch(() => "");
      return t === "1" ? t : null;
    },
    8000,
    "lamp click did not increment",
  );
  assert.equal(count, "1");

  const evalBump = await page.evaluate(async () => {
    const res = await fetch("/api/runtime/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "(bump)", ns: "app.core" }),
    });
    return res.json();
  });
  assert.equal(evalBump.ok, true, JSON.stringify(evalBump));
  const afterEval = await until(
    async () => {
      const t = await preview.$eval(".count", (el) => el.textContent).catch(() => "");
      return t === "2" ? t : null;
    },
    8000,
    "(bump) via attached nREPL did not mutate the compiled app",
  );
  assert.equal(afterEval, "2");

  const chrome = await page.evaluate(() => ({
    exportZip: [...document.querySelectorAll("nav.actions button")].map((b) => b.textContent.trim()),
  }));
  assert.equal(
    chrome.exportZip.some((t) => /export/i.test(t)),
    false,
    "attached Evalight should not offer Export ZIP: " + chrome.exportZip.join(", "),
  );

  await page.click("button.icon-btn[aria-label='Help']");
  await page.waitForSelector(".help", { timeout: 3000 });
  const help = await page.$eval(".help", (el) => el.innerText);
  assert.match(help, /will not start or stop the compiler/);
  assert.doesNotMatch(help, /experimental/);
  await page.click(".brand");

  await browser.close();
  browser = null;

  const exited = new Promise((resolve) => evalight.once("exit", () => resolve(true)));
  evalight.kill("SIGTERM");
  const died = await Promise.race([exited, sleep(8000).then(() => false)]);
  assert.equal(died, true, "Evalight did not exit after SIGTERM");
  evalight = null;

  assert.equal(await pingNrepl(NREPL_PORT), true, "attach must not stop the user's nREPL");
  assert.equal(
    await httpOk(`http://127.0.0.1:${APP_PORT}/`),
    true,
    "attach must not stop the user's :dev-http",
  );

  console.log("attach-chrome.test.mjs ok");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (evalight) evalight.kill("SIGTERM");
  killGroup(watch);
}
