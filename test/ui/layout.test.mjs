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

function paletteActiveHit(page) {
  return page.evaluate(() => {
    const list = document.querySelector(".ui-command-list");
    const item = document.querySelector(".ui-command-item.is-active");
    if (!list || !item) return { missing: true };
    const box = list.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const x = r.left + Math.min(24, Math.max(8, r.width / 2));
    const y = r.top + Math.min(10, Math.max(6, r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return {
      missing: false,
      id: item.getAttribute("data-ui-cmd"),
      scrollH: list.scrollHeight,
      clientH: list.clientHeight,
      scrollTop: list.scrollTop,
      overflowed: list.scrollHeight > list.clientHeight + 1,
      inView: r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
      hitActive: Boolean(hit?.closest(".ui-command-item.is-active")),
      hit: hit && `${hit.tagName}.${String(hit.className).slice(0, 60)}`,
    };
  });
}

function crumbMenuHit(page) {
  return page.evaluate(() => {
    const menu = document.querySelector(".ui-crumb-menu");
    if (!menu) return { missing: true };
    const r = menu.getBoundingClientRect();
    const x = r.left + Math.min(24, Math.max(8, r.width / 2));
    const y = r.top + Math.min(16, Math.max(8, r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return {
      w: r.width,
      h: r.height,
      top: r.top,
      hit: hit && `${hit.tagName}.${String(hit.className).slice(0, 60)}`,
      hitMenu: Boolean(hit?.closest(".ui-crumb-menu")),
      hitDismiss: Boolean(hit?.closest(".ui-crumbs-dismiss")),
    };
  });
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

function replPromptMetrics(page) {
  return page.evaluate(() => {
    const gutter = document.querySelector(".repl-input .gutter");
    const ta = document.querySelector(".repl-input textarea");
    if (!gutter || !ta) return { missing: true };
    const range = document.createRange();
    range.selectNodeContents(gutter);
    const gLine = range.getClientRects()[0];
    const tBox = ta.getBoundingClientRect();
    const csG = getComputedStyle(gutter);
    const csT = getComputedStyle(ta);
    const lineH = parseFloat(csT.lineHeight);
    return {
      missing: false,
      gutterFont: csG.fontSize,
      textareaFont: csT.fontSize,
      gutterLineH: csG.lineHeight,
      textareaLineH: csT.lineHeight,
      textareaH: tBox.height,
      lineH,
      topDelta: gLine ? Math.abs(gLine.top - tBox.top) : 99,
    };
  });
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

  const meta = await page.evaluate(() => ({
    description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "",
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "",
    twitterCard: document.querySelector('meta[name="twitter:card"]')?.getAttribute("content") ?? "",
  }));
  check(
    "index.html has a meta description",
    /live ClojureScript/i.test(meta.description),
    meta.description
  );
  check("index.html has Open Graph title", meta.ogTitle === "Evalight", meta.ogTitle);
  check("index.html has an Open Graph image", /og\.png/.test(meta.ogImage), meta.ogImage);
  check("index.html has a Twitter card", meta.twitterCard === "summary_large_image", meta.twitterCard);

  const pageScroll = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const shell = document.querySelector(".shell");
    return {
      htmlOverflow: getComputedStyle(html).overflow,
      bodyOverflow: getComputedStyle(body).overflow,
      scrollHeight: Math.max(html.scrollHeight, body.scrollHeight),
      bodyScroll: body.scrollHeight,
      innerHeight: window.innerHeight,
      shellHeight: shell?.getBoundingClientRect().height ?? 0,
    };
  });
  check(
    "the workshop is not a scrolling document",
    pageScroll.htmlOverflow.includes("hidden") &&
      pageScroll.bodyOverflow.includes("hidden") &&
      pageScroll.scrollHeight <= pageScroll.innerHeight + 2 &&
      Math.abs(pageScroll.shellHeight - pageScroll.innerHeight) <= 2,
    JSON.stringify(pageScroll)
  );

  const names = await page.$$eval(".tree-name", (els) => els.map((e) => e.textContent));
  const fileIdx = names.findIndex((n) => n === "core.cljs" || n.endsWith(".cljs"));
  assert.ok(fileIdx >= 0, `expected a cljs file in the tree, got ${names.join(", ")}`);

  const indent = await page.evaluate(() => {
    const lefts = {};
    for (const el of document.querySelectorAll(".tree-name")) {
      lefts[el.textContent] = el.getBoundingClientRect().left;
    }
    return lefts;
  });
  const step = (child, parent, min = 14) => {
    const a = indent[child];
    const b = indent[parent];
    check(
      `${child} is indented under ${parent}`,
      Number.isFinite(a) && Number.isFinite(b) && a - b >= min,
      `${child}=${a} ${parent}=${b} delta=${(a - b).toFixed(1)}`
    );
  };
  step("index.html", "public");
  step("app", "src");
  step("ui", "src");
  step("core.cljs", "app");
  step("button.cljs", "ui");
  step("core.cljs", "src", 28);
  if (Number.isFinite(indent[".gitignore"]) && Number.isFinite(indent.public)) {
    check(
      "root files align with root folders",
      Math.abs(indent[".gitignore"] - indent.public) < 10,
      `gitignore=${indent[".gitignore"]} public=${indent.public}`
    );
  }

  const headHs = await page.evaluate(() => {
    const h = (sel) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0;
    return {
      files: h(".sidebar .pane-head"),
      editor: h(".editor .pane-head"),
      preview: h("section.preview .pane-head"),
    };
  });
  check(
    "Files, editor, and preview heads share a height",
    Math.abs(headHs.files - headHs.editor) < 1.5 &&
      Math.abs(headHs.editor - headHs.preview) < 1.5 &&
      headHs.files > 20,
    JSON.stringify(headHs)
  );

  const bannerContrast = await page.evaluate(() => {
    const host = document.querySelector(".preview-frame") || document.body;
    const el = document.createElement("div");
    el.className = "preview-banner";
    el.innerHTML = "<p>The preview did not start.</p><pre>err</pre>";
    host.appendChild(el);
    const p = el.querySelector("p");
    const bg = getComputedStyle(el).backgroundColor;
    const fg = getComputedStyle(p).color;
    el.remove();
    const parse = (c) => {
      const m = String(c).match(/(\d+),\s*(\d+),\s*(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
    };
    const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return { bg, fg, bgLum: lum(parse(bg)), fgLum: lum(parse(fg)) };
  });
  check(
    "preview error heading is dark on paper",
    bannerContrast.fgLum < 0.45 && bannerContrast.bgLum > 0.7,
    JSON.stringify(bannerContrast)
  );

  const crumbClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".ui-crumb")].find((el) => el.textContent.trim() === "core.cljs");
    const r = b?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  check("core.cljs crumb is on screen", Boolean(crumbClick));
  if (crumbClick) {
    await page.mouse.click(crumbClick.x, crumbClick.y);
    await page.waitForSelector(".ui-crumb-menu", { timeout: 4000 });
    const menuHit = await crumbMenuHit(page);
    check(
      "crumb menu is the hit target",
      !menuHit.missing && menuHit.h > 8 && menuHit.hitMenu && !menuHit.hitDismiss,
      JSON.stringify(menuHit)
    );
    await page.evaluate(() => document.querySelector(".ui-crumbs-dismiss")?.click());
    await page.waitForSelector(".ui-crumb-menu", { hidden: true, timeout: 4000 });
  }

  const nameClip = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".tree-row")].find(
      (el) => el.querySelector(".tree-name")?.textContent === "breadcrumbs.cljs"
    );
    if (!row) return { missing: true };
    const name = row.querySelector(".tree-name");
    const item = row.querySelector(".tree-item");
    const ops = row.querySelector(".tree-ops");
    const prev = name.textContent;
    name.textContent = "extraordinarily-long-filename.cljs";
    const nameBox = name.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const opsCs = getComputedStyle(ops);
    const itemCs = getComputedStyle(item);
    const measured = {
      truncated: name.scrollWidth > name.clientWidth + 1,
      gap: itemBox.right - nameBox.right,
      padRight: parseFloat(itemCs.paddingRight),
      opsOpacity: parseFloat(opsCs.opacity),
      opsEvents: opsCs.pointerEvents,
    };
    name.textContent = prev;
    return { missing: false, ...measured };
  });
  check("breadcrumbs.cljs is in the tree", !nameClip.missing, JSON.stringify(nameClip));
  if (!nameClip.missing) {
    check(
      "a long file name fills the row instead of stopping short of the actions",
      nameClip.truncated,
      JSON.stringify(nameClip)
    );
    check(
      "hidden file-row actions do not reserve layout space",
      nameClip.padRight < 12 && nameClip.gap < 12,
      JSON.stringify(nameClip)
    );
    check(
      "file-row actions are not the hit target until hover",
      nameClip.opsOpacity === 0 && nameClip.opsEvents === "none",
      JSON.stringify(nameClip)
    );
    const crumbIdx = await page.evaluate(() =>
      [...document.querySelectorAll(".tree-row")].findIndex(
        (el) => el.querySelector(".tree-name")?.textContent === "breadcrumbs.cljs"
      )
    );
    const crumbRow = (await page.$$(".tree-row"))[crumbIdx];
    const widthBefore = await crumbRow.$eval(".tree-name", (el) => el.getBoundingClientRect().width);
    await crumbRow.hover();
    await new Promise((r) => setTimeout(r, 80));
    const hoverClip = await page.evaluate(() => {
      const row = [...document.querySelectorAll(".tree-row")].find(
        (el) => el.querySelector(".tree-name")?.textContent === "breadcrumbs.cljs"
      );
      const name = row.querySelector(".tree-name");
      const ops = row.querySelector(".tree-ops");
      const nameBox = name.getBoundingClientRect();
      const opsBox = ops.getBoundingClientRect();
      return {
        nameW: nameBox.width,
        opsOpacity: parseFloat(getComputedStyle(ops).opacity),
        opsLeft: opsBox.left,
        nameRight: nameBox.right,
      };
    });
    check(
      "hovering a file row does not shrink the name for the actions",
      Math.abs(widthBefore - hoverClip.nameW) < 1 && hoverClip.opsOpacity === 1,
      JSON.stringify({ widthBefore, ...hoverClip })
    );
  }

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

  const toolAlign = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".tree-tools .tiny")]
      .find((el) => el.textContent.trim() === "File");
    if (!btn) return { missing: true };
    const br = btn.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(btn);
    const tr = range.getBoundingClientRect();
    return {
      dx: (tr.left + tr.right) / 2 - (br.left + br.right) / 2,
      dy: (tr.top + tr.bottom) / 2 - (br.top + br.bottom) / 2,
      hasSvg: Boolean(btn.querySelector("svg")),
    };
  });
  check("File tool button is present", !toolAlign.missing);
  if (!toolAlign.missing) {
    check("File tool has no leading icon", !toolAlign.hasSvg);
    check(
      "File label is centered in its pill",
      Math.abs(toolAlign.dx) <= 1.5 && Math.abs(toolAlign.dy) <= 1.5,
      `dx=${toolAlign.dx.toFixed(2)} dy=${toolAlign.dy.toFixed(2)}`
    );
  }

  await page.evaluate(() => {
    [...document.querySelectorAll(".tree-tools .tiny")]
      .find((el) => el.textContent.trim() === "UI")
      ?.click();
  });
  await page.waitForSelector(".ui-dialog", { timeout: 4000 });
  const kitDialog = await page.evaluate(() => {
    const panel = document.querySelector(".ui-dialog");
    const rows = [...panel.querySelectorAll("li")].map((li) => ({
      title: li.querySelector(".kit-title")?.textContent ?? "",
      action: li.querySelector(".ui-btn")?.textContent?.trim() ?? "",
    }));
    return {
      title: panel?.querySelector("h2")?.textContent ?? "",
      items: rows.map((r) => r.title),
      actions: Object.fromEntries(rows.map((r) => [r.title, r.action])),
    };
  });
  check("Add UI dialog title", kitDialog.title === "Add UI", kitDialog.title);
  check("Add UI lists Button", kitDialog.items.includes("Button"), kitDialog.items.join(", "));
  check("Add UI lists Split", kitDialog.items.includes("Split"), kitDialog.items.join(", "));
  check("Add UI lists Breadcrumbs", kitDialog.items.includes("Breadcrumbs"), kitDialog.items.join(", "));
  check("Add UI lists Command", kitDialog.items.includes("Command"), kitDialog.items.join(", "));
  check(
    "installed Button is Restore, not Add",
    kitDialog.actions.Button === "Restore",
    JSON.stringify(kitDialog.actions)
  );
  check(
    "installed Split is Restore, not Add",
    kitDialog.actions.Split === "Restore",
    JSON.stringify(kitDialog.actions)
  );
  check(
    "Add UI has no Add buttons on a fresh lamp",
    Object.values(kitDialog.actions).every((a) => a === "Restore"),
    JSON.stringify(kitDialog.actions)
  );
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".kit-list li")];
    const button = rows.find((li) => li.querySelector(".kit-title")?.textContent === "Button");
    [...(button?.querySelectorAll(".ui-btn") ?? [])]
      .find((b) => b.textContent.trim() === "Restore")
      ?.click();
  });
  await page.waitForFunction(
    () => (document.querySelector(".toast")?.textContent ?? "").includes("Restored Button"),
    { timeout: 4000 }
  );
  check(
    "Restore keeps the Add UI dialog open",
    Boolean(await page.$(".ui-dialog")),
    "dialog closed after Restore"
  );
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".ui-dialog .ui-btn")];
    buttons.find((b) => b.textContent.trim() === "Done")?.click();
  });
  await page.waitForSelector(".ui-dialog", { hidden: true, timeout: 4000 });

  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".tree-row")].find(
      (el) => el.querySelector(".tree-name")?.textContent === "split.cljs"
    );
    row?.querySelector('[aria-label="Delete"]')?.click();
  });
  await page.waitForSelector(".ui-dialog .ui-btn-danger", { timeout: 4000 });
  await page.click(".ui-dialog .ui-btn-danger");
  await page.waitForSelector(".ui-dialog", { hidden: true, timeout: 4000 });
  await page.waitForFunction(
    () => ![...document.querySelectorAll(".tree-name")].some((el) => el.textContent === "split.cljs"),
    { timeout: 6000 }
  );

  await page.evaluate(() => {
    [...document.querySelectorAll(".tree-tools .tiny")]
      .find((el) => el.textContent.trim() === "UI")
      ?.click();
  });
  await page.waitForSelector(".ui-dialog .kit-list", { timeout: 4000 });
  const afterKitDelete = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".kit-list li")].map((li) => ({
      title: li.querySelector(".kit-title")?.textContent ?? "",
      action: li.querySelector(".ui-btn")?.textContent?.trim() ?? "",
    }));
    return Object.fromEntries(rows.map((r) => [r.title, r.action]));
  });
  check("deleted Split shows Add", afterKitDelete.Split === "Add", JSON.stringify(afterKitDelete));
  check("Button stays Restore after Split is gone", afterKitDelete.Button === "Restore", JSON.stringify(afterKitDelete));
  await page.evaluate(() => {
    [...document.querySelectorAll(".ui-dialog .ui-btn")]
      .find((b) => b.textContent.trim() === "Done")
      ?.click();
  });
  await page.waitForSelector(".ui-dialog", { hidden: true, timeout: 4000 });

  const iframeEl = await page.$("section.preview iframe");
  const lampFrame = iframeEl ? await iframeEl.contentFrame() : null;
  const previewSrc = iframeEl
    ? await page.$eval("section.preview iframe", (el) => el.getAttribute("src") || "")
    : "";
  const previewSandbox = iframeEl
    ? await page.$eval("section.preview iframe", (el) => el.getAttribute("sandbox"))
    : "";
  check(
    "playground preview is the SCI iframe",
    previewSrc.includes("preview.html"),
    previewSrc,
  );
  check(
    "playground preview is sandboxed",
    previewSandbox === "allow-scripts",
    String(previewSandbox),
  );
  if (!lampFrame) {
    check("preview iframe is reachable for lamp Rename", false, "contentFrame() was null");
  } else {
    const sciFlag = await lampFrame.evaluate(() => window.EVALIGHT_SCI).catch(() => null);
    check("playground preview sets EVALIGHT_SCI", sciFlag === true, String(sciFlag));
    await lampFrame.waitForSelector("h1, .ui-btn", { timeout: 20000 });
    const beforeTitle = await lampFrame.$eval("h1", (el) => el.textContent);
    await lampFrame.evaluate(() => {
      [...document.querySelectorAll(".ui-btn")]
        .find((b) => (b.textContent || "").includes("Rename"))
        ?.click();
    });
    await lampFrame.waitForSelector(".ui-dialog input[name=title]", { timeout: 6000 });
    await lampFrame.evaluate(() => {
      const input = document.querySelector(".ui-dialog input[name=title]");
      if (input) {
        input.value = "Beacon";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await lampFrame.evaluate(() => {
      [...document.querySelectorAll(".ui-dialog .ui-btn")]
        .find((b) => (b.textContent || "").trim() === "Save")
        ?.click();
    });
    try {
      await lampFrame.waitForFunction(
        () => document.querySelector("h1")?.textContent === "Beacon",
        { timeout: 5000 }
      );
    } catch {
      const dump = await lampFrame.evaluate(() => ({
        h1: document.querySelector("h1")?.textContent,
        dialog: Boolean(document.querySelector(".ui-dialog")),
        save: [...document.querySelectorAll(".ui-dialog .ui-btn")].map((b) => b.textContent),
      }));
      check("lamp Rename Save updates the heading", false, JSON.stringify(dump));
    }
    const afterTitle = await lampFrame.$eval("h1", (el) => el.textContent).catch(() => "");
    check(
      "lamp Rename Save updates the heading",
      afterTitle === "Beacon",
      `before=${beforeTitle} after=${afterTitle}`
    );
    check(
      "lamp Rename dialog closes after Save",
      !(await lampFrame.$(".ui-dialog")),
      "dialog still open"
    );
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

  const beta = await page.evaluate(() => {
    const brand = document.querySelector(".brand");
    const badge = document.querySelector("button.beta-badge");
    const projectEl = document.querySelector(".project");
    const wrap = badge?.closest(".beta-pop");
    if (!brand || !badge || !projectEl || !wrap) return { missing: true };
    const kids = [...brand.parentElement.children];
    const brandKids = [...brand.children];
    const bg = getComputedStyle(badge).backgroundColor;
    const rgb = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const r = rgb ? Number(rgb[1]) : 0;
    const g = rgb ? Number(rgb[2]) : 0;
    const b = rgb ? Number(rgb[3]) : 0;
    return {
      missing: false,
      text: badge.textContent.trim(),
      inBrand: brand.contains(badge),
      afterWordmark: brandKids.indexOf(wrap) === brandKids.length - 1,
      beforeProject: kids.indexOf(brand) < kids.indexOf(projectEl),
      red: r > 140 && r > g + 40 && r > b + 40,
      bg,
    };
  });
  check("beta badge is in the header", !beta.missing);
  if (!beta.missing) {
    check("beta badge says BETA", beta.text === "BETA", beta.text);
    check(
      "beta badge sits between the wordmark and the project switcher",
      beta.inBrand && beta.afterWordmark && beta.beforeProject,
      JSON.stringify(beta)
    );
    check("beta badge is red", beta.red, beta.bg);
  }

  await page.click("button.beta-badge");
  await page.waitForSelector(".beta-pop .ui-popover-panel", { timeout: 3000 });
  const betaOpen = await page.evaluate(() => {
    const panel = document.querySelector(".beta-pop .ui-popover-panel");
    const text = panel?.textContent || "";
    return {
      expanded: document.querySelector("button.beta-badge")?.getAttribute("aria-expanded") === "true",
      text,
      mentionsExport: /export/i.test(text),
      mentionsFreeze: /freez/i.test(text),
      mentionsBreaking: /break/i.test(text),
    };
  });
  check("beta popover opens on click", betaOpen.expanded, JSON.stringify(betaOpen));
  check(
    "beta popover explains export freezes Evalight",
    betaOpen.mentionsExport && betaOpen.mentionsFreeze && betaOpen.mentionsBreaking,
    betaOpen.text
  );

  await page.$eval(".beta-pop .ui-popover-dismiss", (el) => el.click());
  await page.waitForSelector(".beta-pop .ui-popover-panel", { hidden: true, timeout: 3000 });
  const betaClosed = await page.evaluate(() => ({
    expanded: document.querySelector("button.beta-badge")?.getAttribute("aria-expanded") === "true",
    panel: Boolean(document.querySelector(".beta-pop .ui-popover-panel")),
  }));
  check(
    "clicking outside closes the beta popover",
    !betaClosed.expanded && !betaClosed.panel,
    JSON.stringify(betaClosed)
  );

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

  const helpCopy = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".help .shortcuts li")].map((li) => ({
      keys: [...li.querySelectorAll("kbd")].map((k) => k.textContent).join("+"),
    }));
    return {
      keys: items.map((i) => i.keys),
      text: document.querySelector(".help")?.innerText ?? "",
    };
  });
  check("help lists five shortcuts", helpCopy.keys.length === 5, helpCopy.keys.join(", "));
  check("help lists Tab", helpCopy.keys.includes("Tab"));
  check("help lists Shift+Tab", helpCopy.keys.includes("Shift+Tab"));
  check("help lists Enter", helpCopy.keys.includes("Enter"));
  check("help lists Ctrl+Enter", helpCopy.keys.includes("Ctrl+Enter"));
  check("help lists Ctrl+K", helpCopy.keys.includes("Ctrl+K"));
  check("help links Open Source Licenses", /Open Source Licenses/.test(helpCopy.text));
  const licenseHref = await page.evaluate(() => document.querySelector(".help-licenses")?.getAttribute("href"));
  check("help licenses href is /licenses.html", licenseHref === "/licenses.html");
  check("help does not teach Ctrl-Space", !/Ctrl.?Space/.test(helpCopy.text));
  check("help does not teach Ctrl-.", !/Ctrl.?\./.test(helpCopy.text));
  check("help does not teach Alt-/", !/Alt.?\//.test(helpCopy.text));
  check("help does not teach Alt-Enter", !/Alt.?Enter/.test(helpCopy.text));
  check("help does not teach Ctrl-Shift-Enter", !/Ctrl.?Shift.?Enter/.test(helpCopy.text));
  check("help does not teach Escape then Tab", !/Escape/.test(helpCopy.text));

  const helpBox = await page.evaluate(() => {
    const panel = document.querySelector(".help");
    const r = panel.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      innerHeight: window.innerHeight,
      overflow: getComputedStyle(panel).overflow,
      bodyOverflow: getComputedStyle(panel.querySelector(".help-body")).overflow,
    };
  });
  check(
    "help popover stays in the viewport",
    helpBox.top >= 0 && helpBox.bottom <= helpBox.innerHeight + 1,
    JSON.stringify(helpBox)
  );
  check(
    "help body can scroll if the copy is long",
    /auto|scroll/.test(helpBox.bodyOverflow),
    helpBox.bodyOverflow
  );

  await page.setViewport({ width: 900, height: 560 });
  const helpShort = await page.evaluate(() => {
    const panel = document.querySelector(".help");
    const r = panel.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      height: r.height,
      innerHeight: window.innerHeight,
    };
  });
  check(
    "help popover stays in a short viewport",
    helpShort.top >= 0 && helpShort.bottom <= helpShort.innerHeight + 1,
    JSON.stringify(helpShort)
  );
  await page.setViewport({ width: 1440, height: 900 });

  await page.click(".help-close");
  await page.waitForSelector(".help", { hidden: true, timeout: 3000 });

  await page.click("button.icon-btn[title='Help']");
  await page.waitForSelector(".help", { timeout: 3000 });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".help", { hidden: true, timeout: 3000 });
  check(
    "Escape closes Help",
    !(await page.$(".help")),
    "help still open after Escape"
  );

  await page.click("button.beta-badge");
  await page.waitForSelector(".beta-pop .ui-popover-panel", { timeout: 3000 });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".beta-pop .ui-popover-panel", { hidden: true, timeout: 3000 });
  const betaEsc = await page.evaluate(() => ({
    expanded: document.querySelector("button.beta-badge")?.getAttribute("aria-expanded") === "true",
    panel: Boolean(document.querySelector(".beta-pop .ui-popover-panel")),
  }));
  check(
    "Escape closes the beta popover",
    !betaEsc.expanded && !betaEsc.panel,
    JSON.stringify(betaEsc)
  );

  await page.waitForSelector("textarea[name=expr]", { timeout: 5000 });
  await page.waitForFunction(
    () => {
      const head = document.querySelector("section.preview .pane-head");
      return head && !/loading|error/i.test(head.innerText);
    },
    { timeout: 20000 }
  );

  const emptyPrompt = await replPromptMetrics(page);
  check("REPL prompt is in the page", !emptyPrompt.missing, JSON.stringify(emptyPrompt));
  check(
    "REPL prompt uses the same type as the field",
    emptyPrompt.gutterFont === emptyPrompt.textareaFont &&
      emptyPrompt.gutterLineH === emptyPrompt.textareaLineH,
    JSON.stringify(emptyPrompt)
  );
  check(
    "REPL prompt sits on the field's first line",
    emptyPrompt.topDelta <= 2.5,
    JSON.stringify(emptyPrompt)
  );
  check(
    "empty REPL field is one line tall",
    emptyPrompt.textareaH <= emptyPrompt.lineH * 1.35 + 2,
    JSON.stringify(emptyPrompt)
  );

  await page.focus("textarea[name=expr]");
  await page.evaluate(() => {
    const el = document.querySelector("textarea[name=expr]");
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.type("(defn squared [n]");
  const typedPrompt = await replPromptMetrics(page);
  check(
    "REPL prompt still sits on the first typed line",
    typedPrompt.topDelta <= 2.5,
    JSON.stringify(typedPrompt)
  );
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.type("(* n n))");

  const drafted = await page.$eval("textarea[name=expr]", (el) => el.value);
  assert.match(drafted, /\(defn squared \[n\]\n/, `expected a newline in the REPL draft, got ${JSON.stringify(drafted)}`);
  const linesBefore = await page.$$eval(".repl-line", (els) => els.length);
  check("Shift-Enter does not add a REPL result", linesBefore === 0, `lines=${linesBefore}`);

  await page.keyboard.press("Enter");
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll(".repl-line.is-out, .repl-line.is-err")].length > 0,
      { timeout: 10000 }
    );
  } catch (err) {
    const dump = await page.evaluate(() => ({
      field: document.querySelector("textarea[name=expr]")?.value,
      log: document.querySelector(".repl-log")?.innerText,
      active: document.activeElement && document.activeElement.tagName,
    }));
    throw new Error(`REPL did not evaluate after Enter: ${JSON.stringify(dump)}`);
  }
  const afterSubmit = await page.evaluate(() => ({
    field: document.querySelector("textarea[name=expr]")?.value ?? "",
    log: document.querySelector(".repl-log")?.innerText ?? "",
  }));
  check("Enter evaluates and clears the field", afterSubmit.field.trim() === "", JSON.stringify(afterSubmit.field));
  check(
    "multiline defn did not error",
    !/unable to resolve|error in/i.test(afterSubmit.log),
    afterSubmit.log.slice(0, 400)
  );

  await page.focus("textarea[name=expr]");
  await page.keyboard.type("(squared 12)");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => (document.querySelector(".repl-log")?.innerText ?? "").includes("144"),
    { timeout: 8000 }
  );
  const squaredLog = await page.$eval(".repl-log", (el) => el.innerText);
  check("(squared 12) is 144", squaredLog.includes("144"), squaredLog.slice(0, 400));

  const paneCount = await page.evaluate(() => ({
    sidebars: document.querySelectorAll(".sidebar").length,
    previews: document.querySelectorAll("section.preview").length,
    filesSplit: Boolean(document.querySelector(".splitter-files")),
    previewSplit: Boolean(document.querySelector(".splitter-preview")),
    hideFiles: Boolean(document.querySelector(".sidebar [aria-label='Hide files']")),
    hidePreview: Boolean(document.querySelector("section.preview [aria-label='Hide preview']")),
    hideInToolbar: Boolean(document.querySelector(".top [aria-label='Hide files'], .top [aria-label='Hide preview']")),
  }));
  check("files pane is a single sidebar", paneCount.sidebars === 1, `count=${paneCount.sidebars}`);
  check("preview pane is a single section", paneCount.previews === 1, `count=${paneCount.previews}`);
  check("files splitter is present", paneCount.filesSplit);
  check("preview splitter is present", paneCount.previewSplit);
  check("files pane can hide files", paneCount.hideFiles);
  check("preview pane can hide preview", paneCount.hidePreview);
  check("toolbar does not hide the sidebars", !paneCount.hideInToolbar);

  const filesBefore = await page.$eval(".sidebar", (el) => el.getBoundingClientRect().width);
  const filesSplit = await page.$(".splitter-files");
  const filesBox = await filesSplit.boundingBox();
  check("files splitter has a hit area", Boolean(filesBox) && filesBox.width > 0);
  if (filesBox) {
    await page.mouse.move(filesBox.x + filesBox.width / 2, filesBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(filesBox.x + filesBox.width / 2 + 90, filesBox.y + 80, { steps: 12 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 80));
    const filesAfter = await page.$eval(".sidebar", (el) => el.getBoundingClientRect().width);
    check(
      "files pane grows when the splitter is dragged right",
      filesAfter >= filesBefore + 50,
      `before=${filesBefore.toFixed(1)} after=${filesAfter.toFixed(1)}`
    );
  }

  const previewBefore = await page.$eval("section.preview", (el) => el.getBoundingClientRect().width);
  const previewSplit = await page.$(".splitter-preview");
  const previewBox = await previewSplit.boundingBox();
  check("preview splitter has a hit area", Boolean(previewBox) && previewBox.width > 0);
  if (previewBox) {
    await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(previewBox.x + previewBox.width / 2 - 90, previewBox.y + 80, { steps: 12 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 80));
    const previewAfter = await page.$eval("section.preview", (el) => el.getBoundingClientRect().width);
    check(
      "preview pane grows when the splitter is dragged left",
      previewAfter >= previewBefore + 50,
      `before=${previewBefore.toFixed(1)} after=${previewAfter.toFixed(1)}`
    );
  }

  await page.click(".sidebar [aria-label='Hide files']");
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".sidebar");
      return !el || el.offsetWidth === 0 || getComputedStyle(el).display === "none";
    },
    { timeout: 4000 }
  );
  const filesHidden = await page.evaluate(() => {
    const el = document.querySelector(".sidebar");
    return {
      width: el ? el.offsetWidth : 0,
      display: el ? getComputedStyle(el).display : "missing",
      canShow: Boolean(document.querySelector(".pane-rail[aria-label='Show files']")),
    };
  });
  check(
    "hiding files collapses the sidebar",
    filesHidden.width === 0 || filesHidden.display === "none",
    JSON.stringify(filesHidden)
  );
  check("a files rail can show the pane again", filesHidden.canShow);

  await page.waitForFunction(
    () => /core\.cljs/.test(document.querySelector(".file-path")?.textContent ?? ""),
    { timeout: 15000 }
  );
  const crumbPath = await page.$eval(".file-path", (el) => el.textContent);
  check(
    "breadcrumb trail still reads the file path",
    /src\/app\/core\.cljs/.test(crumbPath),
    crumbPath
  );
  const hiddenCrumb = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".ui-crumb")].find((el) => el.textContent.trim() === "core.cljs");
    const r = b?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  check("core.cljs crumb is on screen with Files hidden", Boolean(hiddenCrumb));
  if (hiddenCrumb) {
    await page.mouse.click(hiddenCrumb.x, hiddenCrumb.y);
  }
  await page.waitForSelector(".ui-crumb-menu", { timeout: 4000 });
  const hiddenMenu = await crumbMenuHit(page);
  check(
    "crumb menu is the hit target with Files hidden",
    !hiddenMenu.missing && hiddenMenu.h > 8 && hiddenMenu.hitMenu && !hiddenMenu.hitDismiss,
    JSON.stringify(hiddenMenu)
  );
  const greetOpt = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".ui-crumb-option")].find((el) =>
      (el.textContent || "").includes("greet.cljs")
    );
    const r = b?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  check("greet.cljs is a visible crumb option", Boolean(greetOpt));
  if (greetOpt) {
    await page.mouse.click(greetOpt.x, greetOpt.y);
  }
  await page.waitForFunction(
    () => /app\/greet\.cljs/.test(document.querySelector(".file-path")?.textContent ?? ""),
    { timeout: 8000 }
  );
  check(
    "breadcrumbs switch files while Files is hidden",
    /greet\.cljs/.test(await page.$eval(".file-path", (el) => el.textContent))
  );

  await page.click(".pane-rail[aria-label='Show files']");
  await page.waitForFunction(
    () => (document.querySelector(".sidebar")?.offsetWidth ?? 0) > 100,
    { timeout: 4000 }
  );

  await page.click("[aria-label='Command palette']");
  await page.waitForSelector(".ui-command", { timeout: 4000 });
  const paletteGroups = await page.evaluate(() =>
    [...document.querySelectorAll(".ui-command-group")].map((el) => el.textContent.trim())
  );
  check("palette lists Files commands", paletteGroups.includes("Files"), paletteGroups.join(", "));
  check("palette lists Go to file", paletteGroups.includes("Go to file"), paletteGroups.join(", "));
  await page.click(".ui-command-input");
  await page.waitForSelector(".ui-command-item.is-active", { timeout: 4000 });
  const paletteFirst = await paletteActiveHit(page);
  check(
    "palette list overflows so arrow keys have somewhere to scroll",
    paletteFirst.overflowed,
    JSON.stringify(paletteFirst)
  );
  check(
    "first active command is in the list viewport",
    paletteFirst.inView && paletteFirst.hitActive,
    JSON.stringify(paletteFirst)
  );
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(
    () => {
      const list = document.querySelector(".ui-command-list");
      const item = document.querySelector(".ui-command-item.is-active");
      if (!list || !item) return false;
      const box = list.getBoundingClientRect();
      const r = item.getBoundingClientRect();
      return (
        list.scrollTop > 0 &&
        r.top >= box.top - 1 &&
        r.bottom <= box.bottom + 1
      );
    },
    { timeout: 4000 }
  );
  const paletteWrap = await paletteActiveHit(page);
  check(
    "ArrowUp wraps to a row painted inside the list",
    paletteWrap.inView &&
      paletteWrap.hitActive &&
      paletteWrap.scrollTop > 0 &&
      paletteWrap.id !== paletteFirst.id,
    JSON.stringify({ wrap: paletteWrap, first: paletteFirst })
  );
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(
    (firstId) => {
      const list = document.querySelector(".ui-command-list");
      const item = document.querySelector(".ui-command-item.is-active");
      if (!list || !item) return false;
      const box = list.getBoundingClientRect();
      const r = item.getBoundingClientRect();
      return (
        item.getAttribute("data-ui-cmd") === firstId &&
        r.top >= box.top - 1 &&
        r.bottom <= box.bottom + 1
      );
    },
    { timeout: 4000 },
    paletteFirst.id
  );
  const paletteHome = await paletteActiveHit(page);
  check(
    "ArrowDown from the last row returns the first row into view",
    paletteHome.inView &&
      paletteHome.hitActive &&
      paletteHome.id === paletteFirst.id &&
      paletteHome.scrollTop < paletteWrap.scrollTop,
    JSON.stringify({ home: paletteHome, wrap: paletteWrap })
  );
  const paletteLast = await page.evaluate(() => {
    const list = document.querySelector(".ui-command-list");
    const items = [...list.querySelectorAll(".ui-command-item")];
    const last = items.at(-1);
    list.scrollTop = list.scrollHeight;
    const box = list.getBoundingClientRect();
    const r = last.getBoundingClientRect();
    return {
      label: last?.textContent?.trim() ?? "",
      inView: r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
      panelBottom: document.querySelector(".ui-command")?.getBoundingClientRect().bottom ?? 0,
      innerHeight: window.innerHeight,
    };
  });
  check(
    "scrolling the palette shows the last row in full",
    paletteLast.inView,
    JSON.stringify(paletteLast)
  );
  await page.setViewport({ width: 1280, height: 800 });
  const paletteFit = await page.evaluate(() => {
    const panel = document.querySelector(".ui-command");
    const r = panel.getBoundingClientRect();
    const list = document.querySelector(".ui-command-list");
    const items = [...list.querySelectorAll(".ui-command-item")];
    const last = items.at(-1);
    list.scrollTop = list.scrollHeight;
    const box = list.getBoundingClientRect();
    const lr = last.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      innerHeight: window.innerHeight,
      lastInView: lr.top >= box.top - 1 && lr.bottom <= box.bottom + 1,
    };
  });
  check(
    "palette stays in a 1280x800 viewport",
    paletteFit.top >= 0 && paletteFit.bottom <= paletteFit.innerHeight + 1,
    JSON.stringify(paletteFit)
  );
  check(
    "last palette row is not sliced at 1280x800",
    paletteFit.lastInView,
    JSON.stringify(paletteFit)
  );
  await page.setViewport({ width: 1440, height: 900 });
  await page.keyboard.type("new file");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ui-dialog", { timeout: 4000 });
  const paletteDialog = await page.evaluate(() => ({
    command: Boolean(document.querySelector(".ui-command")),
    title: document.querySelector(".ui-dialog h2")?.textContent ?? "",
  }));
  check("palette New file closes the palette", !paletteDialog.command, JSON.stringify(paletteDialog));
  check("palette New file opens the dialog", paletteDialog.title === "New file", paletteDialog.title);
  await page.click(".ui-dialog .ui-btn-ghost");
  await page.waitForSelector(".ui-dialog", { hidden: true, timeout: 4000 });

  await page.click("[aria-label='Command palette']");
  await page.waitForSelector(".ui-command-input", { timeout: 4000 });
  await page.click(".ui-command-input");
  await page.keyboard.type("core.cljs");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      !document.querySelector(".ui-command") &&
      /core\.cljs/.test(document.querySelector(".file-path")?.textContent ?? ""),
    { timeout: 8000 }
  );
  const paletteOpenFile = await page.evaluate(() => {
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return {
      command: Boolean(document.querySelector(".ui-command")),
      path: document.querySelector(".file-path")?.textContent ?? "",
      hitCommand: Boolean(hit?.closest(".ui-command, .ui-overlay")),
    };
  });
  check(
    "opening a file from the palette closes it",
    !paletteOpenFile.command && !paletteOpenFile.hitCommand && /core\.cljs/.test(paletteOpenFile.path),
    JSON.stringify(paletteOpenFile)
  );

  await page.click("[aria-label='Command palette']");
  await page.waitForSelector(".ui-command-input", { timeout: 4000 });
  await page.click(".ui-command-input");
  await page.keyboard.type("clear repl");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector(".ui-command"), { timeout: 4000 });
  const paletteClear = await page.evaluate(() => {
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return {
      command: Boolean(document.querySelector(".ui-command")),
      hitCommand: Boolean(hit?.closest(".ui-command, .ui-overlay")),
    };
  });
  check(
    "Clear REPL from the palette closes it",
    !paletteClear.command && !paletteClear.hitCommand,
    JSON.stringify(paletteClear)
  );

  await page.click("[aria-label='Command palette']");
  await page.waitForSelector(".ui-command-input", { timeout: 4000 });
  await page.click(".ui-command-input");
  await page.keyboard.type("help");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => !document.querySelector(".ui-command") && document.querySelector(".help"),
    { timeout: 4000 }
  );
  const paletteHelp = await page.evaluate(() => {
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return {
      command: Boolean(document.querySelector(".ui-command")),
      help: Boolean(document.querySelector(".help")),
      hitCommand: Boolean(hit?.closest(".ui-command, .ui-overlay")),
      hitHelp: Boolean(hit?.closest(".help")),
    };
  });
  check(
    "Help from the palette closes it and shows help",
    !paletteHelp.command && !paletteHelp.hitCommand && paletteHelp.help,
    JSON.stringify(paletteHelp)
  );
  await page.click(".help-close");
  await page.waitForSelector(".help", { hidden: true, timeout: 3000 });

  await page.click("section.preview [aria-label='Hide preview']");
  await page.waitForFunction(
    () => {
      const el = document.querySelector("section.preview");
      return !el || el.offsetWidth === 0 || getComputedStyle(el).display === "none";
    },
    { timeout: 4000 }
  );
  const previewHidden = await page.evaluate(() => {
    const pane = document.querySelector("section.preview");
    const iframe = document.querySelector("section.preview iframe");
    return {
      width: pane ? pane.offsetWidth : 0,
      display: pane ? getComputedStyle(pane).display : "missing",
      iframe: Boolean(iframe),
      canShow: Boolean(document.querySelector(".pane-rail[aria-label='Show preview']")),
    };
  });
  check(
    "hiding preview collapses the pane",
    previewHidden.width === 0 || previewHidden.display === "none",
    JSON.stringify(previewHidden)
  );
  check("preview iframe stays mounted while the pane is hidden", previewHidden.iframe);
  check("a preview rail can show the pane again", previewHidden.canShow);

  await page.focus("textarea[name=expr]");
  await page.evaluate(() => {
    const el = document.querySelector("textarea[name=expr]");
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.type("(+ 20 22)");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => (document.querySelector(".repl-log")?.innerText ?? "").includes("42"),
    { timeout: 8000 }
  );
  check(
    "REPL still evaluates while preview is hidden",
    (await page.$eval(".repl-log", (el) => el.innerText)).includes("42")
  );

  await page.click(".pane-rail[aria-label='Show preview']");
  await page.waitForFunction(
    () => (document.querySelector("section.preview")?.offsetWidth ?? 0) > 100,
    { timeout: 4000 }
  );

  async function workshopChrome(width, height) {
    await page.setViewport({ width, height });
    return page.evaluate(() => {
      const tabs = document.querySelector(".mobile-tabs");
      const split = document.querySelector(".splitter-files");
      const hide = document.querySelector(".sidebar .pane-hide");
      return {
        tabs: tabs ? getComputedStyle(tabs).display : "missing",
        split: split ? getComputedStyle(split).display : "missing",
        hide: hide ? getComputedStyle(hide).display : "missing",
      };
    });
  }

  const at900 = await workshopChrome(900, 800);
  check(
    "900px keeps the column workshop",
    at900.tabs === "none" && at900.split !== "none" && at900.hide !== "none",
    JSON.stringify(at900)
  );
  await page.click(".sidebar [aria-label='Hide files']");
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".sidebar");
      return !el || el.offsetWidth === 0 || getComputedStyle(el).display === "none";
    },
    { timeout: 4000 }
  );
  check(
    "900px can close the files sidebar",
    await page.evaluate(() => {
      const rail = document.querySelector(".pane-rail[aria-label='Show files']");
      const el = document.querySelector(".sidebar");
      return (
        Boolean(rail) &&
        getComputedStyle(rail).display !== "none" &&
        (!el || el.offsetWidth === 0 || getComputedStyle(el).display === "none")
      );
    })
  );
  await page.click(".pane-rail[aria-label='Show files']");
  await page.waitForFunction(
    () => (document.querySelector(".sidebar")?.offsetWidth ?? 0) > 100,
    { timeout: 4000 }
  );

  const at768 = await workshopChrome(768, 800);
  check(
    "768px keeps the column workshop",
    at768.tabs === "none" && at768.split !== "none",
    JSON.stringify(at768)
  );
  const at767 = await workshopChrome(767, 800);
  check(
    "767px uses the tab workshop",
    at767.tabs === "flex" && at767.split === "none",
    JSON.stringify(at767)
  );

  await page.setViewport({ width: 1440, height: 900 });

  const currentProject = await page.$eval("#project-select", (el) => el.value);
  check("delete project button is present", Boolean(await page.$("button[aria-label='Delete project']")));
  await page.click("button[aria-label='Delete project']");
  await page.waitForSelector(".ui-dialog", { timeout: 4000 });
  const deleteDialog = await page.evaluate(() => {
    const modal = document.querySelector(".ui-dialog");
    return {
      title: modal?.querySelector("h2")?.textContent ?? "",
      text: modal?.innerText ?? "",
      confirm: modal?.querySelector(".ui-btn-danger")?.textContent?.trim() ?? "",
    };
  });
  check("delete project dialog title", deleteDialog.title === "Delete project", deleteDialog.title);
  check(
    "delete project dialog names the current project",
    deleteDialog.text.includes(currentProject),
    deleteDialog.text.slice(0, 300)
  );
  check("delete project confirm is a danger button", deleteDialog.confirm === "Delete project", deleteDialog.confirm);
  await page.click(".ui-dialog .ui-btn-ghost");
  await page.waitForSelector(".ui-dialog", { hidden: true, timeout: 4000 });
  const afterCancel = await page.$eval("#project-select", (el) => el.value);
  check("cancel keeps the current project", afterCancel === currentProject, afterCancel);

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "New project");
    btn?.click();
  });
  await page.waitForSelector(".ui-dialog input[name=name]", { timeout: 4000 });
  const newProjField = await page.$eval(".ui-dialog input[name=name]", (el) => ({
    value: el.value,
    placeholder: el.placeholder,
  }));
  check("new project field is prefilled", Boolean(newProjField.value), JSON.stringify(newProjField));
  check(
    "new project placeholder is not a fake typed name",
    /project name/i.test(newProjField.placeholder) || newProjField.placeholder === "",
    newProjField.placeholder
  );
  await page.focus(".ui-dialog input[name=name]");
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type("doomed");
  await page.click(".ui-dialog .ui-btn-primary");
  await page.waitForFunction(
    () => [...document.querySelectorAll("#project-select option")].some((o) => o.value === "doomed"),
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () => document.querySelector("#project-select")?.value === "doomed",
    { timeout: 10000 }
  );
  await page.waitForFunction(
    () => [...document.querySelectorAll(".tree-name")].some((el) => el.textContent.trim() === "greet.cljs"),
    { timeout: 15000 }
  );

  const renameHit = await page.evaluate(() => {
    const name = [...document.querySelectorAll(".tree-name")].find((el) => el.textContent.trim() === "greet.cljs");
    const row = name?.closest(".tree-row");
    const ops = row?.querySelector(".tree-ops");
    if (ops) {
      ops.style.opacity = "1";
      ops.style.pointerEvents = "auto";
    }
    const btn = row?.querySelector("[aria-label='Rename']");
    const r = btn?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  check("greet.cljs rename control is on screen", Boolean(renameHit));
  if (renameHit) {
    await page.mouse.click(renameHit.x, renameHit.y);
    await page.waitForSelector(".ui-dialog input[name=path]", { timeout: 4000 });
    await page.focus(".ui-dialog input[name=path]");
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.type("src/app/hello.cljs");
    await page.click(".ui-dialog .ui-btn-primary");
    await page.waitForFunction(
      () => [...document.querySelectorAll(".tree-name")].some((el) => el.textContent.trim() === "hello.cljs"),
      { timeout: 8000 }
    );
    const renameToast = await page.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
    check(
      "rename toast mentions the namespace change",
      /app\.hello/.test(renameToast),
      renameToast
    );
    await page.evaluate(() => {
      const name = [...document.querySelectorAll(".tree-name")].find((el) => el.textContent.trim() === "core.cljs");
      name?.closest(".tree-item")?.click();
    });
    await page.waitForFunction(
      () => /core\.cljs/.test(document.querySelector(".file-path")?.textContent ?? ""),
      { timeout: 8000 }
    );
    const coreText = await page.evaluate(() => document.querySelector(".cm-content")?.innerText ?? "");
    check("core.cljs require follows the rename", /app\.hello/.test(coreText), coreText.slice(0, 280));
    check("core.cljs no longer requires app.greet", !/\[app\.greet/.test(coreText), coreText.slice(0, 280));
  }

  const deleteHit = await page.evaluate(() => {
    const name = [...document.querySelectorAll(".tree-name")].find((el) => el.textContent.trim() === "stats.cljs");
    const row = name?.closest(".tree-row");
    const ops = row?.querySelector(".tree-ops");
    if (ops) {
      ops.style.opacity = "1";
      ops.style.pointerEvents = "auto";
    }
    const btn = row?.querySelector("[aria-label='Delete']");
    const r = btn?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  check("stats.cljs delete control is on screen", Boolean(deleteHit));
  if (deleteHit) {
    await page.mouse.click(deleteHit.x, deleteHit.y);
    await page.waitForSelector(".ui-dialog .ui-btn-danger", { timeout: 4000 });
    await page.click(".ui-dialog .ui-btn-danger");
    await page.waitForFunction(
      () => /still require/i.test(document.querySelector(".toast")?.textContent ?? ""),
      { timeout: 8000 }
    );
    const delToast = await page.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
    check(
      "delete toast says a file still requires app.stats",
      /app\.stats/.test(delToast) && /still require/i.test(delToast),
      delToast
    );
  }

  await page.click("button[aria-label='Delete project']");
  await page.waitForSelector(".ui-dialog .ui-btn-danger", { timeout: 4000 });
  await page.click(".ui-dialog .ui-btn-danger");
  await page.waitForFunction(
    () =>
      !document.querySelector(".ui-dialog") &&
      document.querySelector("#project-select")?.value !== "doomed" &&
      ![...document.querySelectorAll("#project-select option")].some((o) => o.value === "doomed"),
    { timeout: 15000 }
  );
  const afterDelete = await page.evaluate(() => {
    const select = document.querySelector("#project-select");
    return {
      value: select?.value ?? "",
      names: [...document.querySelectorAll("#project-select option")].map((o) => o.value),
    };
  });
  check("deleted project is gone from the picker", !afterDelete.names.includes("doomed"), afterDelete.names.join(", "));
  check("another project is open after delete", Boolean(afterDelete.value) && afterDelete.value !== "doomed", afterDelete.value);

  await page.waitForSelector(".cm-content", { timeout: 10000 });
  await page.waitForFunction(
    () => /\.cljs/.test(document.querySelector(".file-path")?.textContent ?? ""),
    { timeout: 10000 }
  );
  await page.waitForFunction(
    () => {
      const head = document.querySelector("section.preview .pane-head");
      return head && !/loading|error/i.test(head.innerText);
    },
    { timeout: 20000 }
  );

  await page.click(".cm-content");
  await page.keyboard.down("Control");
  await page.keyboard.press("End");
  await page.keyboard.up("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.type("bum");
  const completionVisible = () => {
    const tip = document.querySelector(".cm-tooltip-autocomplete");
    if (!tip) return false;
    const r = tip.getBoundingClientRect();
    const x = r.left + Math.min(24, r.width / 2);
    const y = r.top + Math.min(12, r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return (
      r.top > 0 &&
      r.bottom < window.innerHeight &&
      r.width > 16 &&
      r.height > 8 &&
      hit &&
      tip.contains(hit) &&
      /bump/i.test(tip.textContent)
    );
  };
  try {
    await page.waitForFunction(completionVisible, { timeout: 2500 });
  } catch {
    await page.keyboard.down("Control");
    await page.keyboard.press("Period");
    await page.keyboard.up("Control");
    try {
      await page.waitForFunction(completionVisible, { timeout: 8000 });
    } catch (err) {
      const dump = await page.evaluate(() => {
        const tip = document.querySelector(".cm-tooltip-autocomplete");
        const r = tip?.getBoundingClientRect();
        return {
          file: document.querySelector(".file-path")?.textContent,
          tooltip: Boolean(document.querySelector(".cm-tooltip")),
          inEditor: Boolean(tip?.closest(".cm-editor")),
          text: tip?.textContent,
          cm: document.querySelector(".cm-content")?.innerText?.slice(-80),
          rect: r ? { w: r.width, h: r.height, top: r.top } : null,
        };
      });
      throw new Error(`Completions did not appear: ${JSON.stringify(dump)}`);
    }
  }
  const labels = await page.$$eval(".cm-tooltip-autocomplete li", (els) =>
    els.map((e) => e.textContent)
  );
  check("live completions include bump", labels.some((t) => /bump/i.test(t)), labels.join(" | "));
  const onScreen = await page.evaluate(() => {
    const tip = document.querySelector(".cm-tooltip-autocomplete");
    if (!tip) return { missing: true };
    const r = tip.getBoundingClientRect();
    const x = r.left + Math.min(24, r.width / 2);
    const y = r.top + Math.min(12, r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      w: r.width,
      h: r.height,
      top: r.top,
      inEditor: Boolean(tip.closest(".cm-editor")),
      hit: Boolean(hit && tip.contains(hit)),
    };
  });
  check(
    "completion list is visible on screen",
    !onScreen.missing && onScreen.w > 16 && onScreen.h > 8 && onScreen.hit && !onScreen.inEditor,
    JSON.stringify(onScreen)
  );

  await new Promise((r) => setTimeout(r, 120));
  await page.keyboard.press("Tab");
  const afterTabAccept = await page.evaluate(() => {
    const tip = document.querySelector(".cm-tooltip-autocomplete");
    const text = document.querySelector(".cm-content")?.innerText ?? "";
    const lines = text.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    const last = lines.at(-1) ?? "";
    return {
      listOpen: Boolean(tip),
      last,
      hasBump: /\bbump\b/.test(last),
    };
  });
  check(
    "Tab accepts the completion while the list is showing",
    !afterTabAccept.listOpen && afterTabAccept.hasBump,
    JSON.stringify(afterTabAccept)
  );
  await page.keyboard.press("Escape");
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");

  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".tree-row")].find((el) => {
      if (el.querySelector(".tree-name")?.textContent !== "core.cljs") return false;
      const dir = el
        .closest(".tree-children")
        ?.previousElementSibling
        ?.querySelector(".tree-name")
        ?.textContent;
      return dir === "app";
    });
    row?.querySelector(".tree-item")?.click();
  });
  await page.waitForFunction(
    () => /app\/core\.cljs/.test(document.querySelector(".file-path")?.textContent ?? ""),
    { timeout: 8000 }
  );

  let bumpPos = null;
  for (let top = 0; top <= 3600 && !bumpPos; top += 140) {
    await page.evaluate((y) => {
      const s = document.querySelector(".cm-scroller");
      if (s) s.scrollTop = y;
    }, top);
    await new Promise((r) => setTimeout(r, 40));
    bumpPos = await page.evaluate(() => {
      const root = document.querySelector(".cm-content");
      if (!root) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf("bump");
        if (i < 0) continue;
        const line = node.parentElement?.closest(".cm-line");
        if (!/\(defn\s+bump/.test(line?.textContent ?? "")) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, Math.min(i + 4, node.textContent.length));
        const r = range.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    });
  }
  check("found bump in the editor to hover", Boolean(bumpPos?.x), JSON.stringify(bumpPos));
  if (bumpPos?.x) {
    await page.mouse.click(bumpPos.x, bumpPos.y);
    const hovered = await page.evaluate(() => {
      const root = document.querySelector(".cm-content");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf("bump");
        if (i < 0) continue;
        const line = node.parentElement?.closest(".cm-line");
        if (!/\(defn\s+bump/.test(line?.textContent ?? "")) continue;
        line.scrollIntoView({ block: "center" });
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 4);
        const r = range.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        return {
          x,
          y,
          line: line.textContent,
          over: document.elementFromPoint(x, y)?.closest(".cm-editor") != null,
        };
      }
      return null;
    });
    check("bump stays in view after click", Boolean(hovered?.over), JSON.stringify(hovered));
    if (hovered?.over) {
      await page.mouse.move(hovered.x, hovered.y);
      try {
        await page.waitForFunction(() => {
          const tip = document.querySelector(".cm-evalight-doc");
          return tip && /bump/i.test(tip.textContent) && tip.getBoundingClientRect().top > 0;
        }, { timeout: 5000 });
      } catch (err) {
        const dump = await page.evaluate((p) => ({
          over: document.elementFromPoint(p.x, p.y)?.className,
          tooltip: document.querySelector(".cm-tooltip")?.textContent,
          hover: document.querySelector(".cm-evalight-doc")?.textContent,
        }), hovered);
        throw new Error(`Hover docs did not appear over bump: ${JSON.stringify(dump)}`);
      }
      const hover = await page.evaluate(() => {
        const tip = document.querySelector(".cm-evalight-doc");
        if (!tip) return { missing: true };
        const r = tip.getBoundingClientRect();
        const x = r.left + Math.min(24, r.width / 2);
        const y = r.top + Math.min(12, r.height / 2);
        const hit = document.elementFromPoint(x, y);
        return {
          w: r.width,
          h: r.height,
          top: r.top,
          parent: tip.closest(".cm-tooltip")?.parentElement?.tagName,
          text: tip.textContent,
          hit: Boolean(hit && tip.contains(hit)),
        };
      });
      check(
        "hover docs are visible on screen",
        !hover.missing && hover.w > 16 && hover.h > 8 && hover.hit,
        JSON.stringify(hover)
      );
      check(
        "hover docs mention bump",
        /bump/i.test(hover.text ?? ""),
        hover.text
      );
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.click(".cm-content");
  await page.keyboard.down("Control");
  await page.keyboard.press("End");
  await page.keyboard.up("Control");

  const editorFocus = () =>
    page.evaluate(() => Boolean(document.activeElement?.closest(".cm-editor")));
  const editorText = () => page.$eval(".cm-content", (el) => el.innerText);
  const docLines = (text) => {
    const lines = text.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  };

  const beforeShift = await editorText();
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  check("Shift-Tab keeps focus in the editor", await editorFocus());
  check(
    "Shift-Tab at column 0 does not rewrite the file",
    (await editorText()) === beforeShift,
    "document changed on Shift-Tab"
  );

  await page.keyboard.press("Enter");
  await page.keyboard.type(";;tab-probe");
  const beforeTab = await editorText();
  const beforeLines = docLines(beforeTab);
  await page.keyboard.press("Tab");
  const afterTab = await editorText();
  const afterLines = docLines(afterTab);
  const lastBefore = beforeLines.at(-1) ?? "";
  const lastAfter = afterLines.at(-1) ?? "";
  assert.ok(
    /^\s+/.test(lastAfter) && lastAfter.trim() === lastBefore.trim(),
    `Tab should indent the current line, got ${JSON.stringify({ lastBefore, lastAfter })}`
  );
  assert.ok(
    beforeLines.slice(0, -1).join("\n") === afterLines.slice(0, -1).join("\n"),
    `Tab should not format the rest of the document (${beforeLines.length} -> ${afterLines.length} lines)`
  );

  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  check("Shift-Tab still keeps focus after indent", await editorFocus());
  check(
    "Shift-Tab dedents the current line",
    (docLines(await editorText()).at(-1) ?? "") === lastBefore,
    JSON.stringify(docLines(await editorText()).at(-1))
  );

  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.type("xyzzy-indent");
  await page.keyboard.press("Escape");
  const extraIndented = docLines(await editorText()).at(-1) ?? "";
  const extraLead = extraIndented.match(/^\s*/)[0];
  check(
    "typed line has extra indent to keep",
    extraLead.length > 0 && extraIndented.trim() === "xyzzy-indent",
    JSON.stringify(extraIndented)
  );
  await page.keyboard.press("Enter");
  const afterEnter = docLines(await editorText()).at(-1) ?? "";
  check(
    "Enter keeps this line's indent instead of snapping to the tree",
    afterEnter === extraLead,
    JSON.stringify({ extraIndented, afterEnter, extraLead })
  );

  await page.keyboard.press("Escape").catch(() => {});

  // Narrow preview: Help used to sit above the modal and steal Cancel.
  await page.setViewport({ width: 900, height: 800 });
  await page.click("button.icon-btn[title='Help']");
  await page.waitForSelector(".help", { timeout: 3000 });
  await page.click("button[aria-label='Delete project']");
  await page.waitForSelector(".ui-dialog", { timeout: 4000 });

  const stacking = await page.evaluate(() => {
    const overlay = document.querySelector(".ui-overlay");
    const help = document.querySelector(".help");
    const cancel = document.querySelector(".ui-dialog .ui-btn-ghost");
    const r = cancel.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      overlayZ: Number(getComputedStyle(overlay).zIndex),
      helpZ: Number(getComputedStyle(help).zIndex),
      x,
      y,
      hitDialog: Boolean(hit?.closest(".ui-dialog")),
      hitHelp: Boolean(hit?.closest(".help")),
      hitText: hit && `${hit.tagName}.${String(hit.className).slice(0, 40)}`,
    };
  });
  check(
    "modal stacks above help",
    stacking.overlayZ > stacking.helpZ,
    JSON.stringify(stacking)
  );
  check(
    "Cancel is the hit target while Help is open",
    stacking.hitDialog && !stacking.hitHelp,
    JSON.stringify(stacking)
  );
  await page.mouse.click(stacking.x, stacking.y);
  await page.waitForSelector(".ui-dialog", { hidden: true, timeout: 4000 });
  const afterProjectCancel = await page.evaluate(() => ({
    help: Boolean(document.querySelector(".help")),
    dialog: Boolean(document.querySelector(".ui-dialog")),
  }));
  check(
    "Cancel closes the project dialog, not Help",
    afterProjectCancel.help && !afterProjectCancel.dialog,
    JSON.stringify(afterProjectCancel)
  );

  const helpClose = await page.evaluate(() => {
    const close = document.querySelector(".help-close");
    const r = close.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      hitHelp: Boolean(hit?.closest(".help")),
    };
  });
  check("Help close is clickable after the dialog", helpClose.hitHelp, JSON.stringify(helpClose));
  await page.mouse.click(helpClose.x, helpClose.y);
  await page.waitForSelector(".help", { hidden: true, timeout: 3000 });

  await page.click("button[aria-label='Delete project']");
  await page.waitForSelector(".ui-dialog", { timeout: 4000 });
  await page.click(".ui-dialog .ui-btn-ghost");
  await page.waitForSelector(".ui-dialog", { hidden: true, timeout: 4000 });

  await page.setViewport({ width: 1440, height: 900 });
  const filesVisible = await page.evaluate(() => (document.querySelector(".sidebar")?.offsetWidth ?? 0) > 100);
  if (filesVisible) {
    await page.click(".sidebar [aria-label='Hide files']");
    await page.waitForFunction(
      () => {
        const el = document.querySelector(".sidebar");
        return !el || el.offsetWidth === 0 || getComputedStyle(el).display === "none";
      },
      { timeout: 4000 }
    );
  }
  await page.waitForSelector("textarea[name=expr]", { timeout: 5000 });
  await page.click("textarea[name=expr]");
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type("(+ 9 9)");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => /\(\+\s*9\s*9\)/.test(document.querySelector(".repl-log")?.innerText ?? ""),
    { timeout: 8000 }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".pane-rail[aria-label='Show files'], .sidebar", { timeout: 20000 });
  await page.waitForFunction(
    () => document.querySelector(".repl-log") && document.querySelector(".workspace"),
    { timeout: 20000 }
  );
  const persisted = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar");
    return {
      filesHidden:
        !sidebar ||
        sidebar.offsetWidth === 0 ||
        getComputedStyle(sidebar).display === "none",
      canShow: Boolean(document.querySelector(".pane-rail[aria-label='Show files']")),
      repl: document.querySelector(".repl-log")?.innerText ?? "",
    };
  });
  check(
    "files stay hidden after reload",
    persisted.filesHidden && persisted.canShow,
    JSON.stringify({ filesHidden: persisted.filesHidden, canShow: persisted.canShow })
  );
  check(
    "REPL history survives reload",
    /\(\+\s*9\s*9\)/.test(persisted.repl),
    persisted.repl.slice(0, 240)
  );
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
