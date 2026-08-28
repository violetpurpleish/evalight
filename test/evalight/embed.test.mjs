import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { packEvalight } from "../../scripts/evalight-pack.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HERE = dirname(fileURLToPath(import.meta.url));

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

async function writeLamp(dir) {
  await mkdir(join(dir, "src/app"), { recursive: true });
  await mkdir(join(dir, "public/css"), { recursive: true });
  await cp(join(REPO, "src/ui"), join(dir, "src/ui"), { recursive: true });
  await cp(join(REPO, "public/css/ui.css"), join(dir, "public/css/ui.css"));
  await writeFile(join(dir, "evalight.edn"),
    `{:name "lamp"\n :main app.core\n :src-paths ["src"]\n :preview {:css ["public/css/ui.css" "public/style.css"]}}\n`);
  await writeFile(join(dir, "package.json"),
    `{"name":"lamp","private":true,"scripts":{"evalight":"bun evalight/server.mjs"}}\n`);
  await writeFile(join(dir, "src/app/greet.cljs"),
    `(ns app.greet)\n(defn greet [name] (str "Hello, " name "."))\n`);
  await writeFile(
    join(dir, "src/app/core.cljs"),
    await readFile(join(HERE, "fixtures/lamp-core.cljs"), "utf8"),
  );
  await writeFile(join(dir, "public/style.css"),
    `.app { padding: 2rem; } h1 { font-family: sans-serif; }\n`);
  await writeFile(join(dir, "public/index.html"),
    `<!DOCTYPE html><html><body><div id="app"></div></body></html>\n`);
  const files = await packEvalight(REPO, { compileIfMissing: true, requireJs: true });
  assert.ok(
    (files["evalight/public/js/main.js"] || "").includes("evalight-fs-v3"),
    "packed workshop UI must include evalight-fs-v3 (export rebuilt after the http FS fix)",
  );
  for (const [path, text] of Object.entries(files)) {
    const dest = join(dir, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, text);
  }
}

function waitForOutput(child, pattern, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), ms);
    const onData = (buf) => {
      if (pattern.test(String(buf))) {
        clearTimeout(t);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
  });
}

const lamp = await mkdtemp(join(tmpdir(), "evalight-embed-"));
await writeLamp(lamp);
const PORT = 48731;
const child = spawn("bun", ["evalight/server.mjs"], {
  cwd: lamp,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stderr.pipe(process.stderr);
try {
  await waitForOutput(child, /Evalight/);
  const userDataDir = await mkdtemp(join(tmpdir(), "evalight-embed-chrome-"));
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: "new",
    userDataDir,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push("console:" + msg.text());
    });
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
    const build = await page.evaluate(() => window.EVALIGHT_BUILD);
    assert.equal(build, "evalight-fs-v3");
    const preview = page.frames().find((f) => (f.url() || "").includes("preview.html"));
    assert.ok(preview, "preview iframe missing");
    const h1 = await until(
      async () => {
        const t = await preview.$eval("h1", (el) => el.textContent).catch(() => "");
        return t.includes("Lamp") ? t : null;
      },
      20000,
      "preview h1 never rendered",
    );
    const banner = await page.$eval(".preview-banner", (el) => el.innerText).catch(() => null);
    const dump = {
      h1,
      build,
      banner,
      count: await preview.$eval(".count", (el) => el.textContent).catch(() => null),
      errors,
    };
    await writeFile("/tmp/evalight-embed-dump.json", JSON.stringify(dump, null, 2));
    const split = errors.filter((e) => /split is not a function|re-seq must match/.test(e));
    assert.equal(split.join("\n"), "", split.join("\n"));
    assert.equal(banner, null, JSON.stringify(dump));
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
    console.log("embed.test.mjs ok", dump);
  } finally {
    await browser.close();
  }
} finally {
  child.kill("SIGTERM");
}
