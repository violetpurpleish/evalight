import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const UI_ROOT = join(ROOT, "public");
const PORT = Number(process.env.UI_TEST_PORT || 0);

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error("No Chrome/Chromium found. Set CHROME_PATH.");
  }
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

function within(inner, outer, slop = 0.75) {
  return (
    inner.left >= outer.left - slop &&
    inner.right <= outer.right + slop &&
    inner.top >= outer.top - slop &&
    inner.bottom <= outer.bottom + slop &&
    inner.width > 0 &&
    inner.height > 0
  );
}

const failures = [];
function check(name, cond, detail) {
  if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
}

const { url, stop } = await startServer();
const userDataDir = await mkdtemp(join(tmpdir(), "evalight-layout-"));
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
  await page.waitForSelector("#project-select, .project-name", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1500));

  const names = await page.$$eval(".tree-name", (els) => els.map((e) => e.textContent));
  const fileIdx = names.findIndex((n) => n === "core.cljs" || n.endsWith(".cljs"));
  assert.ok(fileIdx >= 0, `expected a cljs file in the tree, got ${names.join(", ")}`);
  const rows = await page.$$(".tree-row");
  await rows[fileIdx].hover();
  await new Promise((r) => setTimeout(r, 120));

  const tree = await page.evaluate((idx) => {
    const sidebar = document.querySelector(".sidebar");
    const row = document.querySelectorAll(".tree-row")[idx];
    const ops = row.querySelector(".tree-ops");
    const s = sidebar.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return {
      name: row.querySelector(".tree-name")?.textContent,
      sidebar: s.toJSON(),
      row: r.toJSON(),
      buttons: [...ops.querySelectorAll("button")].map((b) => ({
        label: b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent.trim(),
        box: b.getBoundingClientRect().toJSON(),
      })),
    };
  }, fileIdx);

  check(
    "file row has rename and delete",
    tree.buttons.length >= 2,
    `got ${tree.buttons.map((b) => b.label).join(", ")}`
  );
  for (const b of tree.buttons) {
    check(
      `file op "${b.label}" is fully visible in the sidebar`,
      within(b.box, tree.sidebar),
      `button right ${b.box.right.toFixed(1)} vs sidebar ${tree.sidebar.right.toFixed(1)}`
    );
    check(
      `file op "${b.label}" is fully visible in its row`,
      within(b.box, tree.row),
      `button ${JSON.stringify(b.box)} row ${JSON.stringify(tree.row)}`
    );
    check(`file op "${b.label}" is large enough to click`, b.box.width >= 16 && b.box.height >= 16);
  }

  const project = await page.evaluate(() => {
    const wrap = document.querySelector(".project");
    const select = document.querySelector("#project-select, .project select");
    if (!wrap || !select) return { missing: true };
    const cs = getComputedStyle(select);
    return {
      wrap: wrap.getBoundingClientRect().toJSON(),
      select: select.getBoundingClientRect().toJSON(),
      appearance: cs.appearance || cs.webkitAppearance,
      radius: cs.borderRadius,
    };
  });
  check("project select is present", !project.missing);
  if (!project.missing) {
    check(
      "project select uses custom appearance, not the native widget",
      project.appearance === "none",
      project.appearance
    );
    const radius = parseFloat(project.radius);
    check(
      "project select is not a pill",
      Number.isFinite(radius) && radius > 0 && radius < 20,
      project.radius
    );
    check(
      "project control does not stretch across the header",
      project.wrap.width < 280,
      `width ${project.wrap.width}`
    );
    check(
      "project wrapper hugs the select",
      project.wrap.width <= project.select.width + 24,
      `wrap ${project.wrap.width} select ${project.select.width}`
    );
  }

  const helpBtn = await page.$("button.icon-btn[title='Help']");
  assert.ok(helpBtn, "help button missing");
  await helpBtn.click();
  await page.waitForSelector(".help", { timeout: 3000 });

  const help = await page.evaluate(() => {
    const panel = document.querySelector(".help");
    const close = panel?.querySelector(".help-close, [aria-label='Close help'], [title='Close']");
    const pr = panel.getBoundingClientRect();
    const cr = close.getBoundingClientRect();
    return {
      panel: pr.toJSON(),
      close: cr.toJSON(),
      fromRight: pr.right - cr.right,
      fromTop: cr.top - pr.top,
    };
  });
  check(
    "help close sits in the top-right of the popover",
    help.fromRight >= 4 && help.fromRight <= 20 && help.fromTop >= 4 && help.fromTop <= 20,
    `fromRight=${help.fromRight.toFixed(1)} fromTop=${help.fromTop.toFixed(1)}`
  );
  check("help close is inside the popover", within(help.close, help.panel));
} finally {
  await browser.close();
  await stop();
}

if (failures.length) {
  console.error("Layout tests failed:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log("Layout tests passed.");
