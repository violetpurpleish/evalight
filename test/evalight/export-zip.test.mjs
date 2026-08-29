/**
 * Chrome-drive Export ZIP on the hosted playground (SCI / OPFS).
 *
 * pack.test.mjs locks the Node packer. This test clicks the button, catches
 * the JSZip blob, and asserts the unzipped tree: lamp source plus Evalight.
 *
 * Isolated from layout.test.mjs. That mini server has no /api/evalight-pack.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import JSZip from "jszip";
import {
  copyEmbedServer,
  fallbackManifest,
  handlePackRequest,
  packEvalight,
} from "../../scripts/evalight-pack.mjs";
import { EVALIGHT_BUILD, servePublicPath } from "../../scripts/static-ui.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const UI_ROOT = join(ROOT, "public");
const PORT = Number(process.env.EXPORT_ZIP_TEST_PORT || 0);

function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
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

async function startServer() {
  const mainJs = join(UI_ROOT, "js/main.js");
  if (!existsSync(mainJs)) {
    throw new Error("public/js/main.js is missing. Run bun run dev or bun run release first.");
  }
  await copyEmbedServer(ROOT);
  await packEvalight(ROOT, { compileIfMissing: true, requireJs: true });
  const server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/meta") {
        return Response.json({ mode: "browser", build: EVALIGHT_BUILD });
      }
      if (url.pathname === "/api/evalight-pack" && req.method === "GET") {
        return handlePackRequest(ROOT);
      }
      const served = await servePublicPath(UI_ROOT, url.pathname);
      if (served) return served;
      return new Response("Not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: async () => server.stop(true),
  };
}

function bytesFromBase64(b64) {
  return Buffer.from(b64, "base64");
}

const { url, stop } = await startServer();
const userDataDir = await mkdtemp(join(tmpdir(), "evalight-export-zip-"));
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: "new",
  userDataDir,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => {
    window.__evalightBlobs = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      if (blob && typeof blob.size === "number" && blob.size > 0) {
        window.__evalightBlobs.push(blob);
      }
      return orig(blob);
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tree-row", { timeout: 20000 });
  await page.waitForSelector("#project-select", { timeout: 10000 });
  await page.waitForFunction(
    () => {
      const path = document.querySelector(".file-path")?.textContent ?? "";
      const project = document.querySelector("#project-select")?.value ?? "";
      return project === "lamp" && /core\.cljs/.test(path);
    },
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => [...document.querySelectorAll("nav.actions button")]
      .some((b) => /Export ZIP/.test(b.textContent)),
    { timeout: 8000 },
  );

  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("nav.actions button")]
      .find((b) => /Export ZIP/.test(b.textContent));
    if (!btn) return false;
    btn.click();
    return true;
  });
  assert.equal(clicked, true, "Export ZIP was not in the toolbar");

  const packing = await until(
    async () => {
      const t = await page.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
      return /Packing|Exported lamp\.zip|could not be packed|Missing /.test(t) ? t : null;
    },
    15000,
    "no packing toast",
  );
  if (/could not be packed|Missing /.test(packing)) {
    throw new Error("export failed in the UI: " + packing);
  }

  const b64 = await until(
    async () => page.evaluate(async () => {
      const blobs = window.__evalightBlobs || [];
      if (!blobs.length) return null;
      const blob = blobs[blobs.length - 1];
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const step = 0x4000;
      let binary = "";
      for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
      }
      return btoa(binary);
    }),
    120000,
    "no zip blob from URL.createObjectURL",
  );

  await until(
    async () => {
      const t = await page.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
      return /Exported lamp\.zip/.test(t) ? t : null;
    },
    15000,
    "no Exported lamp.zip toast",
  );

  const zip = await JSZip.loadAsync(bytesFromBase64(b64));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const files = {};
  for (const name of names) {
    files[name] = await zip.file(name).async("string");
  }

  assert.ok(
    files["src/app/core.cljs"]?.includes("(defn bump"),
    "zip is missing lamp src/app/core.cljs",
  );
  const pkg = JSON.parse(files["package.json"]);
  assert.equal(pkg.scripts.evalight, "bun evalight/server.mjs");
  assert.equal(pkg.name, "lamp");

  assert.ok(files["evalight/server.mjs"], "missing evalight/server.mjs");
  assert.ok(
    files["evalight/compiled.mjs"]?.includes("resolveAttachTarget"),
    "compiled.mjs missing resolveAttachTarget",
  );
  assert.ok(
    files["evalight/compiled.mjs"]?.includes("nrepl-select"),
    "compiled.mjs missing nrepl-select",
  );
  assert.ok(files["evalight/static.mjs"]?.includes("servePublicPath"));
  assert.ok(files["evalight/fs-http.mjs"]?.includes("SKIP_ROOT"));
  assert.ok(files["evalight/build-id.mjs"]?.includes("evalight-editor-v5"));
  assert.ok(
    files["evalight/public/index.html"]?.includes("/js/main.js?v=evalight-editor-v5"),
    "stamped index.html missing from zip",
  );
  assert.ok(
    files["evalight/public/js/main.js"]?.includes("evalight-editor-v5"),
    "packed workshop UI must include evalight-editor-v5",
  );
  assert.ok(
    files["evalight/public/js/main.js"].includes("COMPILED=!0"),
    "zip packed a watch build, not the workshop release",
  );
  assert.equal(
    files["evalight/public/js/main.js"].includes("SHADOW_ENV.evalLoad"),
    false,
    "zip packed public/js (watch) instead of evalight-ui/js",
  );
  assert.equal(
    names.some((k) => k.includes("cljs-runtime")),
    false,
    "zip paths include cljs-runtime",
  );
  assert.equal(files["evalight/public/preview.css"], undefined);

  const zips = new Set(fallbackManifest().files.map((f) => f.zip));
  for (const zipPath of zips) {
    assert.ok(files[zipPath] != null, `download missing ${zipPath}`);
  }

  console.log("export-zip.test.mjs ok", { files: names.length, bytes: bytesFromBase64(b64).length });
} finally {
  await browser.close().catch(() => {});
  await stop();
}
