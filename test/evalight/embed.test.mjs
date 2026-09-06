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

async function openTreeFile(page, { name, dir }) {
  const needle = dir ? `${dir}/${name}` : name;
  const clicked = await page.evaluate(({ name, dir, needle }) => {
    const path = document.querySelector(".file-path")?.textContent ?? "";
    if (path.includes(needle)) return true;
    const row = [...document.querySelectorAll(".tree-row")].find((el) => {
      if (el.querySelector(".tree-name")?.textContent !== name) return false;
      const parent = el
        .closest(".tree-children")
        ?.previousElementSibling
        ?.querySelector(".tree-name")
        ?.textContent;
      return !dir || parent === dir;
    });
    if (!row) return false;
    row.querySelector(".tree-item")?.click();
    return true;
  }, { name, dir, needle });
  if (!clicked) throw new Error(`no tree row for ${needle}`);
  await page.waitForFunction(
    (n) => (document.querySelector(".file-path")?.textContent ?? "").includes(n),
    { timeout: 8000 },
    needle,
  );
}

async function cmPoint(page, { includes, clickText, avoid = [], atParen = false, file = "core.cljs", dir = "app" }) {
  await openTreeFile(page, { name: file, dir });
  let found = null;
  for (let top = 0; top <= 5000 && !found; top += 140) {
    await page.evaluate((y) => {
      const s = document.querySelector(".editor .cm-scroller")
        || document.querySelector(".cm-scroller");
      if (s) s.scrollTop = y;
    }, top);
    await sleep(40);
    found = await page.evaluate(({ includes, clickText, avoid, atParen }) => {
      const root = document.querySelector(".cm-content");
      if (!root) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      const needle = clickText || includes;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf(needle);
        if (i < 0) continue;
        const line = node.parentElement?.closest(".cm-line");
        const lineText = line?.textContent || "";
        if (!lineText.includes(includes)) continue;
        if (avoid.some((s) => lineText.includes(s))) continue;
        line.scrollIntoView({ block: "center" });
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, Math.min(i + needle.length, node.textContent.length));
        const r = range.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        let x = atParen ? r.x - 5 : r.x + r.width / 2;
        const y = r.y + r.height / 2;
        const overEl = document.elementFromPoint(x, y)?.closest(".cm-editor");
        if (!overEl && atParen) {
          x = r.x + 1;
        }
        const over = document.elementFromPoint(x, y)?.closest(".cm-editor") != null;
        if (!over) continue;
        return { x, y, line: lineText };
      }
      return null;
    }, { includes, clickText: clickText || includes, avoid, atParen: Boolean(atParen) });
  }
  if (!found) {
    const dump = await page.evaluate(() => {
      const s = document.querySelector(".editor .cm-scroller")
        || document.querySelector(".cm-scroller");
      if (s) s.scrollTop = 0;
      return {
        path: document.querySelector(".file-path")?.textContent,
        bumpLines: [...document.querySelectorAll(".cm-line")]
          .map((el) => el.textContent)
          .filter((t) => /bump/i.test(t)),
        doc: document.querySelector(".cm-content")?.innerText || "",
      };
    });
    throw new Error(`cm line ${JSON.stringify(includes)} not found ${JSON.stringify(dump)}`);
  }
  return found;
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
    `{:source-paths ["src"]\n :dependencies [[no.cjohansen/replicant "2026.07.1"]]\n :dev-http {3456 "public"}\n :node-modules {:managed-by :bun}\n :builds\n {:app {:target :browser\n        :output-dir "public/js"\n        :asset-path "/js"\n        :modules {:main {:init-fn app.core/init}}}}}\n`,
  );
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
  assert.ok(
    (files["evalight/public/js/main.js"] || "").includes("COMPILED=!0"),
    "packed workshop UI must be a release build",
  );
  assert.ok(files["evalight/compiled.mjs"], "packed Evalight must include compiled.mjs");
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
const APP_PORT = 48751;
await new Promise((resolve, reject) => {
  const inst = spawn("bun", ["install"], { cwd: lamp, stdio: "inherit" });
  inst.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("bun install failed"))));
  inst.on("error", reject);
});
const child = spawn("bun", ["evalight/server.mjs"], {
  cwd: lamp,
  env: {
    ...process.env,
    PORT: String(PORT),
    EVALIGHT_APP_PORT: String(APP_PORT),
    EVALIGHT_NREPL_PORT: "7878",
    EVALIGHT_SHADOW_HTTP: "9641",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stderr.pipe(process.stderr);
child.stdout.pipe(process.stdout);
try {
  await waitForOutput(child, /Evalight  http/, 120000);
  const userDataDir = await mkdtemp(join(tmpdir(), "evalight-embed-chrome-"));
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: "new",
    userDataDir,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
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
    const runtime = await until(
      async () => {
        const st = await fetch(`http://127.0.0.1:${PORT}/api/runtime`).then((r) => r.json());
        return st.connected ? st : null;
      },
      120000,
      "compiled runtime never connected",
    );
    assert.equal(runtime.runtime, "compiled");
    assert.equal(runtime.attached, false, "default evalight must own the watch, not sniff .nrepl-port");
    const sciPreview = page.frames().find((f) => (f.url() || "").includes("preview.html"));
    assert.equal(sciPreview, undefined, "exported Evalight must not load the SCI preview.html");
    const preview = await until(
      async () => {
        const f = page.frames().find((fr) => (fr.url() || "").includes(String(APP_PORT)));
        if (!f) return null;
        const t = await f.$eval("h1", (el) => el.textContent).catch(() => "");
        return t.includes("Lamp") ? f : null;
      },
      30000,
      "compiled preview iframe never rendered lamp",
    );
    const sciFlag = await preview.evaluate(() => window.EVALIGHT_SCI);
    assert.equal(sciFlag, undefined, "compiled preview must not set EVALIGHT_SCI");
    const banner = await page.$eval(".preview-banner", (el) => el.innerText).catch(() => null);
    const dump = {
      h1: await preview.$eval("h1", (el) => el.textContent),
      banner,
      count: await preview.$eval(".count", (el) => el.textContent).catch(() => null),
      runtime,
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
      "(bump) via nREPL did not mutate the compiled app",
    );
    assert.equal(afterEval, "2");
    const stats = await page.evaluate(async () => {
      await fetch("/api/runtime/eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "(app.stats/record!)", ns: "app.core" }),
      }).then((r) => r.json());
      const tally = await fetch("/api/runtime/eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "(app.stats/tally)", ns: "app.core" }),
      }).then((r) => r.json());
      const intel = await fetch("/api/runtime/intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ns: "app.core" }),
      }).then((r) => r.json());
      return { tally, intel };
    });
    assert.match(String(stats.tally.value), /1/, JSON.stringify(stats.tally));
    const intelNames = (stats.intel.items || []).map((it) => it.name);
    assert.ok(
      intelNames.some((n) => n === "stats/record!" || n === "record!"),
      "live intel should include app.stats/record!: " + intelNames.slice(0, 30).join(", "),
    );
    const replOnly = await page.evaluate(async () => {
      const defd = await fetch("/api/runtime/eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: `(def scratch "REPL-only scratch" 1)`,
          ns: "app.core",
        }),
      }).then((r) => r.json());
      const intel = await fetch("/api/runtime/intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ns: "app.core" }),
      }).then((r) => r.json());
      return { defd, intel };
    });
    assert.equal(replOnly.defd.ok, true, JSON.stringify(replOnly.defd));
    const scratch = (replOnly.intel.items || []).find((it) => it.name === "scratch");
    assert.ok(scratch, "HTTP intel missing REPL-only scratch: " +
      (replOnly.intel.items || []).map((it) => it.name).slice(0, 40).join(", "));
    assert.match(String(scratch.doc || ""), /REPL-only scratch/);
    await page.$eval("textarea[name=expr]", (el) => {
      el.scrollIntoView({ block: "center" });
      el.focus();
    });
    await page.keyboard.type("(bump)");
    await page.keyboard.press("Enter");
    const afterRepl = await until(
      async () => {
        const t = await preview.$eval(".count", (el) => el.textContent).catch(() => "");
        return t === "3" ? t : null;
      },
      8000,
      "REPL Enter (bump) did not mutate the compiled app",
    );
    assert.equal(afterRepl, "3");
    const live = await page.$(".live input[type=checkbox]");
    if (live && await live.evaluate((el) => el.checked)) {
      await live.click();
    }
    const bumpDef = await cmPoint(page, { includes: "(defn bump", clickText: "bump" });
    await page.mouse.move(bumpDef.x, bumpDef.y);
    const hover = await until(
      async () => {
        const tip = await page.$eval(".cm-evalight-doc", (el) => el.textContent).catch(() => "");
        return /bump/i.test(tip) ? tip : null;
      },
      4000,
      "hover docs did not appear over bump",
    );
    assert.match(hover, /lamp counter|Increment/i);
    assert.equal(
      /quote/i.test(hover),
      false,
      "hover must not print analyzer (quote …) arglists: " + hover,
    );
    assert.match(hover, /\(\[\]\)/);
    await page.keyboard.press("Escape");

    const domEventCall = await cmPoint(page, {
      includes: "ui/dom-event",
      clickText: "dom-event",
    });
    await page.mouse.move(domEventCall.x, domEventCall.y);
    const hoverDom = await until(
      async () => {
        const tip = await page.$eval(".cm-evalight-doc", (el) => el.textContent).catch(() => "");
        return /dom-event/i.test(tip) ? tip : null;
      },
      4000,
      "hover docs did not appear over ui/dom-event",
    );
    assert.equal(
      /quote/i.test(hoverDom),
      false,
      "ui/dom-event hover must not show (quote ([e])): " + hoverDom,
    );
    assert.match(hoverDom, /\(\[e\]\)/);
    assert.match(hoverDom, /Replicant|real Event/i);
    await page.keyboard.press("Escape");

    // Ctrl-Enter must eval the (bump) *call*. The defn only redefines it.
    const bumpCall = await cmPoint(page, {
      includes: "(bump)",
      clickText: "bump",
      avoid: ["Evaluate", "defn"],
      atParen: true,
    });
    await page.mouse.click(bumpCall.x, bumpCall.y);
    await page.keyboard.down("Control");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Control");
    const afterCtrl = await until(
      async () => {
        const t = await preview.$eval(".count", (el) => el.textContent).catch(() => "");
        return t === "4" ? t : null;
      },
      8000,
      "Ctrl-Enter (bump) did not mutate the compiled app",
    ).catch(async (e) => {
      const extra = await page.evaluate(() => ({
        count: document.querySelector("iframe")?.contentDocument?.querySelector(".count")?.textContent,
        repl: [...document.querySelectorAll(".repl-line")].slice(-6).map((el) => el.innerText),
      })).catch(() => null);
      e.message += " " + JSON.stringify(extra);
      throw e;
    });
    assert.equal(afterCtrl, "4");
    await page.click(".cm-content");
    await page.keyboard.down("Control");
    await page.keyboard.press("End");
    await page.keyboard.up("Control");
    await page.keyboard.press("Enter");
    await page.keyboard.type("bum");
    const labels = await until(
      async () => {
        const tips = await page.$$eval(".cm-tooltip-autocomplete li", (els) =>
          els.map((e) => e.textContent),
        ).catch(() => []);
        return tips.some((t) => /bump/i.test(t)) ? tips : null;
      },
      8000,
      "compiled completions did not include bump",
    );
    assert.ok(labels.some((t) => /bump/i.test(t)));
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    await page.evaluate(() => {
      const s = document.querySelector(".editor .cm-scroller")
        || document.querySelector(".cm-scroller");
      if (s) s.scrollTop = 0;
    });
    await sleep(80);
    const beforeCursor = await page.evaluate(() => {
      const r = document.querySelector(".cm-cursor")?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y } : null;
    });
    const clickAt = await page.evaluate(() => {
      const scroller = document.querySelector(".editor .cm-scroller")
        || document.querySelector(".cm-scroller");
      const box = scroller?.getBoundingClientRect();
      const lines = [...document.querySelectorAll(".editor .cm-line, .cm-line")];
      const line = lines.find((el) => {
        const r = el.getBoundingClientRect();
        if (!box) return r.height > 4;
        return r.height > 4 && r.top >= box.top + 8 && r.bottom < box.bottom - 8;
      }) || lines[0];
      line?.scrollIntoView({ block: "center" });
      const r = line.getBoundingClientRect();
      return { x: r.x + Math.min(90, r.width / 2), y: r.y + r.height / 2 };
    });
    await page.mouse.click(clickAt.x, clickAt.y);
    const afterCursor = await until(
      async () => {
        const r = await page.evaluate(() => {
          const c = document.querySelector(".cm-cursor")?.getBoundingClientRect();
          return c ? { x: c.x, y: c.y } : null;
        });
        if (!r || !beforeCursor) return null;
        const moved = Math.abs(r.x - beforeCursor.x) > 4 || Math.abs(r.y - beforeCursor.y) > 4;
        return moved ? r : null;
      },
      3000,
      "cljs caret did not move on click",
    );
    assert.ok(afterCursor, "cljs caret should move");
    await page.keyboard.type("QQQ");
    const typed = await until(
      async () => {
        const t = await page.$eval(".cm-content", (el) => el.innerText);
        return t.includes("QQQ") ? t : null;
      },
      3000,
      "typed QQQ did not appear",
    );
    assert.ok(!typed.startsWith("QQQ"), "QQQ should not land at the start of the file");
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    await until(
      async () => {
        const t = await page.$eval(".cm-content", (el) => el.innerText);
        return t.includes("QQQ") ? null : true;
      },
      3000,
      "Ctrl-Z did not undo QQQ",
    );

    const liveOn = await page.$(".live input[type=checkbox]");
    if (liveOn && !(await liveOn.evaluate((el) => el.checked))) {
      await liveOn.click();
    }
    const hello = await cmPoint(page, {
      includes: "Hello,",
      clickText: "Hello",
      file: "greet.cljs",
    });
    await page.mouse.click(hello.x, hello.y, { clickCount: 2 });
    await page.keyboard.type("LIVE-SAVE");
    await until(
      async () => {
        const t = await page.$eval(".cm-content", (el) => el.innerText).catch(() => "");
        return t.includes("LIVE-SAVE") ? t : null;
      },
      4000,
      "LIVE-SAVE did not land in greet.cljs",
    );
    const lede = await until(
      async () => {
        const f = page.frames().find((fr) => (fr.url() || "").includes(String(APP_PORT)));
        if (!f) return null;
        const t = await f.$eval(".lede", (el) => el.textContent).catch(() => "");
        return /LIVE-SAVE/.test(t) ? t : null;
      },
      30000,
      "Live save did not refresh compiled preview",
    );
    assert.match(lede, /LIVE-SAVE/);

    const chrome = await page.evaluate(() => ({
      exportZip: [...document.querySelectorAll("nav.actions button")].map((b) => b.textContent.trim()),
      help: null,
    }));
    assert.equal(
      chrome.exportZip.some((t) => /export/i.test(t)),
      false,
      "exported Evalight should not offer Export ZIP: " + chrome.exportZip.join(", "),
    );
    await page.click("button.icon-btn[aria-label='Help']");
    await page.waitForSelector(".help", { timeout: 3000 });
    const helpFit = await page.evaluate(() => {
      const panel = document.querySelector(".help");
      const r = panel.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        innerHeight: window.innerHeight,
        clipped: r.bottom > window.innerHeight + 1,
      };
    });
    assert.equal(helpFit.clipped, false, JSON.stringify(helpFit));
    await page.click(".help-close");
    console.log("embed.test.mjs ok", dump);
  } finally {
    await browser.close();
  }
} finally {
  child.kill("SIGTERM");
}
