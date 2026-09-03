/**
 * Opening a PNG in the playground must show a picture, not PNG bytes in CodeMirror.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const UI_ROOT = join(ROOT, "public");
const PORT = Number(process.env.MEDIA_TEST_PORT || 0);
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

function contentType(p) {
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
  return "application/octet-stream";
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
  if (process.env.EVALIGHT_URL) {
    return { url: process.env.EVALIGHT_URL, stop: async () => {} };
  }
  const mainJs = join(UI_ROOT, "js/main.js");
  if (!existsSync(mainJs)) {
    throw new Error("public/js/main.js is missing. Run bun run dev or bun run release first.");
  }
  const server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/meta") {
        return Response.json({ mode: "browser" });
      }
      const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const file = Bun.file(join(UI_ROOT, rel));
      if (await file.exists()) {
        return new Response(file, { headers: { "Content-Type": contentType(rel) } });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: async () => server.stop(true),
  };
}

const { url, stop } = await startServer();
const userDataDir = await mkdtemp(join(tmpdir(), "evalight-media-"));
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: "new",
  userDataDir,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tree-row", { timeout: 20000 });
  await until(
    () => page.evaluate(() => /core\.cljs/.test(document.querySelector(".file-path")?.textContent ?? "")),
    20000,
    "lamp core.cljs did not open",
  );

  await page.evaluate(async (b64) => {
    const root = await navigator.storage.getDirectory();
    const evalight = await root.getDirectoryHandle("evalight");
    const projects = await evalight.getDirectoryHandle("projects");
    const lamp = await projects.getDirectoryHandle("lamp");
    const resources = await lamp.getDirectoryHandle("resources", { create: true });
    const fh = await resources.getFileHandle("icon.png", { create: true });
    const w = await fh.createWritable();
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await w.write(bin);
    await w.close();
  }, PNG_B64);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tree-row", { timeout: 20000 });
  await until(
    () => page.evaluate(() => [...document.querySelectorAll(".tree-name")].some((el) => el.textContent.trim() === "resources")),
    15000,
    "resources folder missing after reload",
  );

  await page.evaluate(() => {
    const name = [...document.querySelectorAll(".tree-name")].find((el) => el.textContent.trim() === "resources");
    name?.closest(".tree-item")?.click();
  });
  await until(
    () => page.evaluate(() => [...document.querySelectorAll(".tree-name")].some((el) => el.textContent.trim() === "icon.png")),
    8000,
    "icon.png did not appear in the tree",
  );

  await page.evaluate(() => {
    const name = [...document.querySelectorAll(".tree-name")].find((el) => el.textContent.trim() === "icon.png");
    name?.closest(".tree-item")?.click();
  });

  const media = await until(
    () => page.evaluate(() => {
      const img = document.querySelector(".media-image");
      const cm = document.querySelector(".cm-content")?.innerText ?? "";
      if (!img) return null;
      return {
        alt: img.getAttribute("alt") || "",
        src: img.getAttribute("src") || "",
        naturalWidth: img.naturalWidth,
        editorHasPng: /IHDR|^\uFFFDPNG/.test(cm),
      };
    }).then((v) => (v && v.src.startsWith("data:image/png") ? v : null)),
    8000,
    "image preview did not render",
  );

  assert.match(media.src, /^data:image\/png;base64,/);
  assert.equal(media.alt, "icon.png");
  assert.equal(media.editorHasPng, false);

  await until(
    () => page.evaluate(() => {
      const img = document.querySelector(".media-image");
      return img && img.naturalWidth > 0;
    }),
    4000,
    "PNG did not decode",
  );

  await page.evaluate(() => {
    const name = [...document.querySelectorAll(".tree-name")].find((el) => el.textContent.trim() === "core.cljs");
    name?.closest(".tree-item")?.click();
  });
  await until(
    () => page.evaluate(() => {
      const path = document.querySelector(".file-path")?.textContent ?? "";
      const img = document.querySelector(".media-image");
      const cm = document.querySelector(".cm-content")?.innerText ?? "";
      return /core\.cljs/.test(path) && !img && /\(ns app\.core/.test(cm);
    }),
    8000,
    "did not return to core.cljs editor",
  );

  console.log("media chrome: PNG opens as an image");
} finally {
  await browser.close();
  await stop();
}
