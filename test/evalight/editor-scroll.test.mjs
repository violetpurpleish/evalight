/**
 * Switching files scrolls a newly opened buffer to the top and restores
 * the last position for files already visited this session.
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
const PORT = Number(process.env.SCROLL_TEST_PORT || 0);
const PAD = "\n" + ";; pad-line-for-scroll-test\n".repeat(160);

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
    await sleep(50);
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

function scrollerInfo(page) {
  return page.evaluate(() => {
    const s = document.querySelector(".cm-scroller");
    if (!s) return null;
    return {
      top: Math.round(s.scrollTop),
      left: Math.round(s.scrollLeft),
      height: Math.round(s.scrollHeight),
      client: Math.round(s.clientHeight),
      max: Math.max(0, Math.round(s.scrollHeight - s.clientHeight)),
      path: document.querySelector(".file-path")?.textContent ?? "",
    };
  });
}

async function openTreeFile(page, name) {
  const clicked = await page.evaluate((name) => {
    const row = [...document.querySelectorAll(".tree-row")].find((el) => {
      if (el.querySelector(".tree-name")?.textContent !== name) return false;
      const dir = el
        .closest(".tree-children")
        ?.previousElementSibling
        ?.querySelector(".tree-name")
        ?.textContent;
      return dir === "app";
    });
    row?.querySelector(".tree-item")?.click();
    return Boolean(row);
  }, name);
  assert.equal(clicked, true, "missing tree row " + name);
  await until(
    async () => {
      const info = await scrollerInfo(page);
      return info && info.path.includes(name) ? info : null;
    },
    8000,
    name + " did not become the active file",
  );
}

async function waitScroll(page, pred, label) {
  return until(
    async () => {
      const info = await scrollerInfo(page);
      return info && pred(info) ? info : null;
    },
    4000,
    label,
  );
}

async function setScrollTop(page, top) {
  await page.evaluate((y) => {
    const s = document.querySelector(".cm-scroller");
    if (s) s.scrollTop = y;
  }, top);
  return waitScroll(
    page,
    (info) => Math.abs(info.top - top) <= 4,
    "scroller did not accept scrollTop=" + top,
  );
}

const { url, stop } = await startServer();
const userDataDir = await mkdtemp(join(tmpdir(), "evalight-editor-scroll-"));
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: "new",
  userDataDir,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 640 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tree-row", { timeout: 20000 });
  await until(
    () => page.evaluate(() => /core\.cljs/.test(document.querySelector(".file-path")?.textContent ?? "")),
    20000,
    "lamp core.cljs did not open",
  );
  await page.waitForSelector(".cm-scroller", { timeout: 10000 });

  await page.evaluate(async (pad) => {
    const root = await navigator.storage.getDirectory();
    const evalight = await root.getDirectoryHandle("evalight");
    const projects = await evalight.getDirectoryHandle("projects");
    const lamp = await projects.getDirectoryHandle("lamp");
    const src = await lamp.getDirectoryHandle("src");
    const app = await src.getDirectoryHandle("app");
    const fh = await app.getFileHandle("gallery.cljs");
    const text = await (await fh.getFile()).text();
    const w = await fh.createWritable();
    await w.write(text + pad);
    await w.close();
  }, PAD);

  let core = await scrollerInfo(page);
  assert.ok(core.max > 120, "core.cljs should be taller than the editor, got " + JSON.stringify(core));
  const corePos = Math.min(420, core.max - 40);
  assert.ok(corePos > 80, "need room to scroll core.cljs, got " + JSON.stringify(core));
  core = await setScrollTop(page, corePos);

  await openTreeFile(page, "core.cljs");
  const stillCore = await waitScroll(
    page,
    (info) => info.path.includes("core.cljs") && Math.abs(info.top - corePos) <= 24,
    "re-clicking the open file should keep its scroll",
  );
  assert.ok(
    Math.abs(stillCore.top - corePos) <= 24,
    "active-file click jumped scroll " + JSON.stringify(stillCore),
  );

  await openTreeFile(page, "gallery.cljs");
  const galleryOpen = await waitScroll(
    page,
    (info) => info.path.includes("gallery.cljs") && info.top <= 16,
    "first open of gallery.cljs should start at the top",
  );
  assert.ok(galleryOpen.max > 120, "padded gallery.cljs should scroll, got " + JSON.stringify(galleryOpen));
  assert.ok(galleryOpen.top <= 16, "new file should be at top, got " + JSON.stringify(galleryOpen));

  const galleryPos = Math.min(360, galleryOpen.max - 40);
  await setScrollTop(page, galleryPos);

  await openTreeFile(page, "core.cljs");
  const coreBack = await waitScroll(
    page,
    (info) => info.path.includes("core.cljs") && Math.abs(info.top - corePos) <= 24,
    "returning to core.cljs should restore its scroll",
  );
  assert.ok(
    Math.abs(coreBack.top - corePos) <= 24,
    "core.cljs scroll was not restored " + JSON.stringify({ corePos, coreBack }),
  );

  await openTreeFile(page, "gallery.cljs");
  const galleryBack = await waitScroll(
    page,
    (info) => info.path.includes("gallery.cljs") && Math.abs(info.top - galleryPos) <= 24,
    "returning to gallery.cljs should restore its scroll",
  );
  assert.ok(
    Math.abs(galleryBack.top - galleryPos) <= 24,
    "gallery.cljs scroll was not restored " + JSON.stringify({ galleryPos, galleryBack }),
  );

  console.log("editor scroll chrome: new files start at top, opened files restore");
} finally {
  await browser.close();
  await stop();
}
