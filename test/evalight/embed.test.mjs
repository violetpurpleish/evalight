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
    (files["evalight/public/js/main.js"] || "").includes("evalight-editor-v5"),
    "packed workshop UI must include evalight-editor-v5",
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
    const build = await page.evaluate(() => window.EVALIGHT_BUILD);
    assert.equal(build, "evalight-editor-v5");
    const stamp = await page.$eval(".brand .build-stamp", (el) => el.textContent.trim());
    assert.equal(stamp, "evalight-editor-v5");
    const runtime = await until(
      async () => {
        const st = await fetch(`http://127.0.0.1:${PORT}/api/runtime`).then((r) => r.json());
        return st.connected ? st : null;
      },
      120000,
      "compiled runtime never connected",
    );
    assert.equal(runtime.runtime, "compiled");
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
      build,
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
    let bumpDef = null;
    for (let top = 0; top <= 4000 && !bumpDef; top += 160) {
      await page.evaluate((y) => {
        const scroller = document.querySelector(".cm-scroller");
        if (scroller) scroller.scrollTop = y;
      }, top);
      bumpDef = await page.evaluate(() => {
        for (const node of document.querySelectorAll(".cm-line")) {
          if (!/\(defn\s+bump/.test(node.textContent || "")) continue;
          const r = node.getBoundingClientRect();
          if (r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) continue;
          return { x: r.x + 48, y: r.y + r.height / 2 };
        }
        return null;
      });
    }
    assert.ok(bumpDef, "defn bump not visible");
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
    await page.keyboard.press("Escape");

    // Ctrl-Enter must eval the (bump) *call*. The defn only redefines it.
    let bumpCall = null;
    for (let top = 0; top <= 4000 && !bumpCall; top += 160) {
      await page.evaluate((y) => {
        const scroller = document.querySelector(".cm-scroller");
        if (scroller) scroller.scrollTop = y;
      }, top);
      bumpCall = await page.evaluate(() => {
        for (const line of document.querySelectorAll(".cm-line")) {
          if (!(line.textContent || "").includes("(fn [_e] (bump))")) continue;
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const i = node.textContent.indexOf("(bump)");
            if (i < 0) continue;
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, Math.min(i + 6, node.textContent.length));
            const r = range.getBoundingClientRect();
            if (r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) continue;
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
        }
        return null;
      });
    }
    assert.ok(bumpCall, "(bump) call not visible");
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
    );
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
    const beforeCursor = await page.evaluate(() => {
      const r = document.querySelector(".cm-cursor")?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y } : null;
    });
    const clickAt = await page.evaluate(() => {
      const lines = [...document.querySelectorAll(".cm-line")];
      const line = lines[Math.min(6, lines.length - 1)] || lines[0];
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
    const chrome = await page.evaluate(() => ({
      exportZip: [...document.querySelectorAll("nav.actions button")].map((b) => b.textContent.trim()),
      help: null,
    }));
    assert.equal(
      chrome.exportZip.some((t) => /export/i.test(t)),
      false,
      "exported Evalight should not offer Export ZIP: " + chrome.exportZip.join(", "),
    );
    await page.click("button.icon-btn[title='Help']");
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
