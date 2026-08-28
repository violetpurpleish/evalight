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
  if (!lampFrame) {
    check("preview iframe is reachable for lamp Rename", false, "contentFrame() was null");
  } else {
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

  await page.keyboard.press("Escape").catch(() => {});
  if (await page.$(".help")) {
    await page.click(".help-close");
    await page.waitForSelector(".help", { hidden: true, timeout: 3000 });
  }

  await page.waitForSelector("textarea[name=expr]", { timeout: 5000 });
  await page.waitForFunction(
    () => {
      const head = document.querySelector("section.preview .pane-head");
      return head && !/loading|error/i.test(head.innerText);
    },
    { timeout: 20000 }
  );

  await page.focus("textarea[name=expr]");
  await page.evaluate(() => {
    const el = document.querySelector("textarea[name=expr]");
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.type("(defn squared [n]");
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
  await page.click(".pane-rail[aria-label='Show files']");
  await page.waitForFunction(
    () => (document.querySelector(".sidebar")?.offsetWidth ?? 0) > 100,
    { timeout: 4000 }
  );

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
  await page.focus(".ui-dialog input[name=name]");
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
  await page.keyboard.press("Home");
  await page.keyboard.up("Control");

  const editorFocus = () =>
    page.evaluate(() => Boolean(document.activeElement?.closest(".cm-editor")));
  const editorText = () => page.$eval(".cm-content", (el) => el.innerText);

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

  await page.keyboard.down("Control");
  await page.keyboard.press("End");
  await page.keyboard.up("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.type(";;tab-probe");
  const docLines = (text) => {
    const lines = text.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  };
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
  check(
    "ns form stayed at column 0",
    afterLines.some((l) => /^\(ns app\.core/.test(l)),
    afterLines.find((l) => l.includes("(ns ")) ?? "missing ns"
  );

  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  check(
    "Shift-Tab still keeps focus after indent",
    await editorFocus()
  );
  check(
    "Shift-Tab dedents the current line",
    (docLines(await editorText()).at(-1) ?? "") === lastBefore,
    JSON.stringify(docLines(await editorText()).at(-1))
  );

  for (let i = 0; i < 16; i++) {
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
  }
  check(
    "undo removes the tab probe",
    !(await editorText()).includes(";;tab-probe"),
    (await editorText()).slice(-120)
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
  await page.keyboard.press("Escape");
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
