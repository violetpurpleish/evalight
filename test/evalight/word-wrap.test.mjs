/**
 * Command palette "Toggle word wrap" turns CodeMirror line wrapping on and off.
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
const PORT = Number(process.env.WRAP_TEST_PORT || 0);

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

async function paletteRun(page, query) {
  await page.click("[aria-label='Command palette']");
  await page.waitForSelector(".ui-command-input", { timeout: 4000 });
  await page.click(".ui-command-input");
  await page.keyboard.type(query);
  await until(
    () => page.evaluate(() => {
      const item = document.querySelector(".ui-command-item.is-active");
      return /word wrap/i.test(item?.textContent ?? "");
    }),
    4000,
    "word wrap command was not the active palette row",
  );
  await page.keyboard.press("Enter");
  await until(
    () => page.evaluate(() => !document.querySelector(".ui-command")),
    4000,
    "palette did not close",
  );
}

function wrapState(page) {
  return page.evaluate(() => {
    const content = document.querySelector(".cm-content");
    const lines = [...document.querySelectorAll(".cm-line")];
    const probe = [...lines].reverse().find((el) => /wrap-probe/.test(el.textContent || ""));
    return {
      wrapping: Boolean(content?.classList.contains("cm-lineWrapping")),
      toast: document.querySelector(".toast")?.textContent ?? "",
      probeHeight: probe ? Math.round(probe.getBoundingClientRect().height) : 0,
      hint: [...document.querySelectorAll(".ui-command-item")]
        .find((el) => /word wrap/i.test(el.textContent || ""))
        ?.querySelector(".ui-command-hint")?.textContent ?? "",
    };
  });
}

const { url, stop } = await startServer();
const userDataDir = await mkdtemp(join(tmpdir(), "evalight-word-wrap-"));
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: "new",
  userDataDir,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tree-row", { timeout: 20000 });
  await until(
    () => page.evaluate(() => /core\.cljs/.test(document.querySelector(".file-path")?.textContent ?? "")),
    20000,
    "lamp core.cljs did not open",
  );
  await page.waitForSelector(".cm-content", { timeout: 10000 });

  await page.click(".cm-content");
  await page.keyboard.down("Control");
  await page.keyboard.press("End");
  await page.keyboard.up("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.type(";; wrap-probe " + "abcdefghij ".repeat(40));
  await sleep(400);

  const before = await wrapState(page);
  assert.equal(before.wrapping, false, "word wrap should start off");
  assert.ok(before.probeHeight > 0, "probe line missing");

  await paletteRun(page, "word wrap");
  const on = await until(
    async () => {
      const s = await wrapState(page);
      return s.wrapping ? s : null;
    },
    4000,
    "cm-lineWrapping did not turn on",
  );
  assert.match(on.toast, /Word wrap on/i);
  assert.ok(
    on.probeHeight > before.probeHeight + 8,
    `wrapped line should be taller, before=${before.probeHeight} after=${on.probeHeight}`,
  );

  await page.click("[aria-label='Command palette']");
  await page.waitForSelector(".ui-command", { timeout: 4000 });
  const onHint = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".ui-command-item")]
      .find((el) => /Toggle word wrap/i.test(el.textContent || ""));
    return item?.querySelector(".ui-command-hint")?.textContent ?? "";
  });
  assert.equal(onHint, "On");
  await page.keyboard.press("Escape");
  await until(
    () => page.evaluate(() => !document.querySelector(".ui-command")),
    4000,
    "palette stayed open after Escape",
  );

  await paletteRun(page, "word wrap");
  const off = await until(
    async () => {
      const s = await wrapState(page);
      return !s.wrapping ? s : null;
    },
    4000,
    "cm-lineWrapping did not turn off",
  );
  assert.match(off.toast, /Word wrap off/i);
  assert.ok(
    Math.abs(off.probeHeight - before.probeHeight) <= 4,
    `unwrapped height should return, before=${before.probeHeight} off=${off.probeHeight}`,
  );

  console.log("word wrap chrome: palette toggles wrapping");
} finally {
  await browser.close();
  await stop();
}
