/**
 * REPL-only (def scratch …) on the :app CLJS session must appear in the
 * compiler env intel reads. Values live in the JS heap; names and docs
 * live in analyzer state. That is normal ClojureScript, not a split.
 *
 * Ports (do not collide with playground 48721, attach-chrome, embed):
 *   app 48753, nREPL 7881, shadow HTTP 9643.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { intelForm, parseEvalightEdn } from "../../src/evalight/embed/compiled.mjs";
import { connectNrepl, pingNrepl } from "../../src/evalight/embed/nrepl.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_PORT = 48753;
const NREPL_PORT = 7881;
const SHADOW_HTTP = 9643;

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
      scripts: { dev: "shadow-cljs watch app" },
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
}

const lamp = await mkdtemp(join(tmpdir(), "evalight-repl-intel-"));
await writeLamp(lamp);
await new Promise((resolve, reject) => {
  const inst = spawn("bun", ["install"], { cwd: lamp, stdio: "inherit" });
  inst.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("bun install failed"))));
  inst.on("error", reject);
});

const watch = spawn(join(lamp, "node_modules", ".bin", "shadow-cljs"), ["watch", "app"], {
  cwd: lamp,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
watch.stderr.pipe(process.stderr);
watch.stdout.pipe(process.stdout);

let browser = null;
let client = null;
try {
  await waitForOutput(watch, /Build completed/, 120000);
  await until(() => pingNrepl(NREPL_PORT), 20000, "nREPL never came up");
  await until(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${APP_PORT}/index.html`);
      return r.ok;
    } catch {
      return false;
    }
  }, 20000, "compiled app did not serve");

  const userDataDir = await mkdtemp(join(tmpdir(), "evalight-repl-intel-chrome-"));
  browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: "new",
    userDataDir,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${APP_PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 20000 });

  client = connectNrepl(NREPL_PORT);
  const clj = await client.clone();
  const cljs = await client.clone();
  const sel = await client.eval(
    cljs,
    `(do (require '[shadow.cljs.devtools.api :as shadow]) (shadow/nrepl-select :app))`,
    20000,
  );
  assert.equal(sel.ok, true, JSON.stringify(sel));
  const ping = await client.eval(cljs, "true", 8000, "app.core");
  assert.equal(ping.ok, true, JSON.stringify(ping));

  const before = parseEvalightEdn(
    (await client.eval(clj, intelForm("app.core", ":app"), 20000)).value,
  );
  assert.equal(
    (before.items || []).some((it) => it.name === "scratch"),
    false,
    "scratch must not exist before the REPL def",
  );

  const defd = await client.eval(
    cljs,
    `(def scratch "REPL-only scratch" 1)`,
    20000,
    "app.core",
  );
  assert.equal(defd.ok, true, JSON.stringify(defd));
  assert.match(String(defd.value), /scratch/);
  const heap = await client.eval(cljs, "scratch", 8000, "app.core");
  assert.equal(heap.ok, true, JSON.stringify(heap));
  assert.equal(String(heap.value), "1");

  const intelRes = await client.eval(clj, intelForm("app.core", ":app"), 20000);
  assert.equal(intelRes.ok, true, JSON.stringify(intelRes));
  const intel = parseEvalightEdn(intelRes.value);
  const scratch = (intel.items || []).find((it) => it.name === "scratch");
  assert.ok(scratch, "intel compiler-env missing REPL-only scratch: " +
    (intel.items || []).map((it) => it.name).slice(0, 40).join(", "));
  assert.match(String(scratch.doc || ""), /REPL-only scratch/);
  const bump = (intel.items || []).find((it) => it.name === "bump");
  assert.ok(bump, "file-compiled bump should still be present");
  assert.equal(
    bump.arglists,
    "([])",
    "compiler-env arglists must drop the analyzer quote: " + JSON.stringify(bump),
  );

  const domEvent = (intel.items || []).find((it) => it.name === "ui/dom-event");
  assert.ok(
    domEvent,
    "intel missing ui/dom-event: " +
      (intel.items || []).map((it) => it.name).slice(0, 40).join(", "),
  );
  assert.equal(
    domEvent.arglists,
    "([e])",
    "ui/dom-event hover must show ([e]), not (quote ([e])): " + JSON.stringify(domEvent),
  );

  console.log("repl-intel.test.mjs ok");
} finally {
  try { client?.close(); } catch { /* ignore */ }
  if (browser) await browser.close().catch(() => {});
  killGroup(watch);
}
