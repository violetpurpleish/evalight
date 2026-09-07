/** Exercise the copied kit source in a real SCI project, not compiled mocks. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { servePublicPath } from "../../src/evalight/embed/static.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const chrome = [process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/local/bin/google-chrome", "/usr/bin/chromium",
].filter(Boolean).find(existsSync);
assert.ok(chrome, "Set CHROME_PATH to Chrome/Chromium");
const server = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/meta") return Response.json({ mode: "browser" });
    return await servePublicPath(join(ROOT, "public"), url.pathname) || new Response("Not found", { status: 404 });
  },
});
let browser;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const waitForFunction = page.waitForFunction.bind(page);
  page.waitForFunction = async (predicate, ...args) => {
    try { return await waitForFunction(predicate, ...args); }
    catch (error) { throw new Error(`UI condition failed: ${predicate}`, {cause: error}); }
  };

  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent === "Created lamp");
  await page.click('[aria-label="Project actions"]');
  await page.click('[aria-label="New project"]');
  await page.waitForSelector('.ui-dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ui-dialog', {hidden: true});
  await page.click('[aria-label="Help"]');
  await page.waitForSelector('.help');
  assert.equal(await page.$('[aria-label="Close help"]'), null);
  await page.click('.brand');
  await page.waitForSelector('.help', {hidden: true});
  const galleryFrame = page.frames().find(f => f.url().includes('preview.html'));
  await galleryFrame.waitForSelector('.gallery', {timeout: 20000});
  assert.equal(await galleryFrame.$$eval('.example', nodes => nodes.length), 13);
  await galleryFrame.focus('.ui-tree [role=treeitem]');
  await page.keyboard.press('ArrowUp');
  assert.equal(await galleryFrame.evaluate(() => document.activeElement.textContent), 'src');
  await page.keyboard.press('ArrowRight');
  assert.equal(await galleryFrame.evaluate(() => document.activeElement.textContent), 'core.cljs');
  await page.keyboard.press('ArrowDown');
  assert.equal(await galleryFrame.evaluate(() => document.activeElement.textContent), 'gallery.cljs');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await galleryFrame.evaluate(() => document.activeElement.textContent), 'src');
  await page.keyboard.press('ArrowLeft');
  await galleryFrame.waitForFunction(() => document.querySelectorAll('.ui-tree [role=treeitem]').length === 1);
  await page.keyboard.press('ArrowRight');
  await galleryFrame.waitForFunction(() => document.activeElement.textContent === 'core.cljs');
  await galleryFrame.$$eval('button', nodes => nodes.find(n => n.textContent === 'Search commands').click());
  await galleryFrame.waitForSelector('.ui-command');
  await page.keyboard.press('Escape');
  await galleryFrame.waitForSelector('.ui-command', {hidden: true});
  // The starter contains only the counter and gallery; theme follows the system
  // until code explicitly selects a mode.
  const appFiles = await page.evaluate(async () => {
    let dir = await navigator.storage.getDirectory();
    for (const part of ['evalight', 'projects', 'lamp', 'src', 'app']) dir = await dir.getDirectoryHandle(part);
    const names = []; for await (const [name] of dir.entries()) names.push(name);
    return names.sort();
  });
  assert.deepEqual(appFiles, ['core.cljs', 'gallery.cljs']);
  await galleryFrame.click('.counter-example button');
  await galleryFrame.waitForFunction(() => document.querySelector('.count').textContent === '1');
  for (const value of ['dark', 'light']) {
    await page.emulateMediaFeatures([{name: 'prefers-color-scheme', value}]);
    await galleryFrame.waitForFunction(value => getComputedStyle(document.documentElement).colorScheme === value, {}, value);
  }
  const evalCode = async code => {
    await page.$eval('textarea[name=expr]', (el, code) => { el.value = code; el.dispatchEvent(new Event('input', {bubbles:true})); }, code);
    await page.focus('textarea[name=expr]');
    await page.keyboard.press('Enter');
  };
  await evalCode('(set-theme! :dark)');
  await galleryFrame.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await galleryFrame.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
  await evalCode('(set-theme! :system)');
  await galleryFrame.waitForFunction(() => document.documentElement.dataset.theme === 'system');

  // Editor chrome uses the workshop theme and its own toolbar control.
  assert.ok(await page.$('[aria-label="New file"] svg'));
  assert.ok(await page.$('[aria-label="New folder"] svg'));
  await page.click('.editor-tool');
  await page.waitForFunction(() => document.querySelector('.editor-tool').getAttribute('aria-pressed') === 'true');
  await page.click('.editor-tool');
  await page.focus('.cm-content');
  const modifier = await page.evaluate(() => /Mac/.test(navigator.platform)) ? 'Meta' : 'Control';
  await page.keyboard.down(modifier); await page.keyboard.press('f'); await page.keyboard.up(modifier);
  await page.waitForSelector('.cm-search');
  const searchColors = await page.$eval('.cm-search', el => ({
    panel: getComputedStyle(el).backgroundColor,
    field: getComputedStyle(el.querySelector('input')).backgroundColor,
  }));
  assert.notEqual(searchColors.panel, 'rgb(255, 255, 255)');
  assert.notEqual(searchColors.field, 'rgb(255, 255, 255)');
  await page.keyboard.press('Escape');

  const defnBox = await page.$$eval('.cm-content span', spans => {
    const el = spans.find(el => el.textContent === 'defn');
    const r = el.getBoundingClientRect(); return {x:r.x + r.width / 2, y:r.y + r.height / 2};
  });
  await page.mouse.move(defnBox.x, defnBox.y);
  await page.waitForSelector('.cm-evalight-doc pre');
  assert.match(await page.$eval('.cm-evalight-doc pre', el => el.textContent), /Same as/);
  await page.mouse.move(1,1);
  for (const width of [320, 390]) {
    await page.setViewport({width, height: 740});
    for (const [trigger, panel] of [['.beta-badge', '.beta-pop .ui-popover-panel'], ['[aria-label="Help"]', '.help-popover-panel']]) {
      await page.click(trigger);
      await page.waitForSelector(panel);
      await page.waitForFunction(selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return r.left >= 10 && r.right <= innerWidth - 10 && r.top >= 10 && r.bottom <= innerHeight - 10;
      }, {}, panel);
      await page.click('.wordmark');
      await page.waitForSelector(panel, {hidden:true});
    }
  }
  await page.setViewport({width:1280, height:900});
  for (const [selector, pane, delta, resetWidth] of [
    ['.splitter-files', '.sidebar', 60, 220],
    ['.splitter-preview', 'section.preview', -60, 360],
  ]) {
    const box = await (await page.$(selector)).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + 30, {steps: 5});
    await page.mouse.up();
    await page.click(selector, {count: 2});
    await page.waitForFunction((pane, width) => Math.abs(document.querySelector(pane).getBoundingClientRect().width - width) < 1, {}, pane, resetWidth);
  }
  const source = await Bun.file(join(ROOT, "test/evalight/fixtures/kit-demo.cljs")).text();
  await page.evaluate(async source => {
    let dir = await navigator.storage.getDirectory();
    for (const name of ["evalight", "projects", "lamp", "src", "app"]) dir = await dir.getDirectoryHandle(name);
    const writer = await (await dir.getFileHandle("core.cljs")).createWritable();
    await writer.write(source);
    await writer.close();
  }, source);
  await page.reload();
  await page.waitForSelector("iframe");
  const frame = page.frames().find(f => f.url().includes("preview.html"));
  await frame.waitForFunction(() => document.querySelector("h1")?.textContent === "Shared UI kit", { timeout: 20000 });

  await frame.focus("#hint-trigger");
  await frame.waitForFunction(() => document.querySelector(".ui-tooltip")?.matches(":popover-open"));
  assert.equal(await frame.$eval(".ui-tooltip", el => el.textContent), "A helpful explanation");
  await page.keyboard.press("Escape");
  await frame.waitForFunction(() => !document.querySelector(".ui-tooltip")?.matches(":popover-open"));

  await frame.click("#menu-trigger");
  await frame.waitForSelector("[role=menu]");
  assert.equal(await frame.evaluate(() => document.activeElement.textContent), "First action");
  await page.keyboard.press("ArrowDown");
  assert.equal(await frame.evaluate(() => document.activeElement.textContent), "Last action", "Disabled menu item must be skipped");
  await page.keyboard.press("Home");
  assert.equal(await frame.evaluate(() => document.activeElement.textContent), "First action");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await frame.waitForFunction(() => document.querySelector("#choice").textContent === "last");
  await frame.waitForSelector("[role=menu]", { hidden: true });
  await frame.click("#menu-trigger");
  await page.keyboard.press("Escape");
  assert.equal(await frame.evaluate(() => document.activeElement.id), "menu-trigger");

  await frame.type("input[placeholder=Draft]", "keep my draft");
  await frame.focus("#demo-tab-0");
  await page.keyboard.press("ArrowRight");
  await frame.waitForFunction(() => document.querySelector("#demo-tab-2").getAttribute("aria-selected") === "true");
  assert.equal(await frame.$eval("#demo-panel-0", el => el.hidden), true);
  await page.keyboard.press("Home");
  assert.equal(await frame.$eval("input[placeholder=Draft]", el => el.value), "keep my draft");

  await frame.click(".ui-check:not(.ui-switch):not(:has(input:disabled))");
  await frame.focus("[role=switch]");
  await page.keyboard.press("Space");
  await frame.waitForFunction(() => document.querySelector("#values").textContent === "true/false");
  assert.equal(await frame.$eval("input:disabled", el => el.checked), false);

  await frame.click(".ui-disclosure-title");
  await frame.waitForFunction(() => document.querySelector(".ui-disclosure").open);
  const summaries = await frame.$$(".ui-accordion summary");
  await summaries[0].click();
  await frame.waitForFunction(() => document.querySelectorAll(".ui-accordion details")[0].open);
  await summaries[1].click();
  await frame.waitForFunction(() => {
    const ds = document.querySelectorAll(".ui-accordion details");
    return !ds[0].open && ds[1].open;
  });

  for (const [id, vertical] of [["row-split", false], ["column-split", true]]) {
    // Scroll the real iframe content into view before reading screen coordinates.
    await frame.$eval(`#${id}`, el => el.scrollIntoView({block: "center"}));
    const split = await frame.$(`#${id} .ui-split`);
    const handle = await frame.$(`#${id} .ui-split-handle`);
    const bounds = await split.boundingBox();
    const ratio = () => frame.$eval(`#${id} .ui-split`, (el, vertical) => {
      const panes = el.querySelectorAll('.ui-split-pane');
      const sizes = [...panes].map(p => vertical ? p.getBoundingClientRect().height : p.getBoundingClientRect().width);
      return sizes[0] / (sizes[0] + sizes[1]);
    }, vertical);
    assert.ok(Math.abs(await ratio() - 0.5) < 0.02, `${id}: initial divider must be centered`);
    for (const target of [0.35, 0.65, 0.05, 0.95]) {
      const hb = await handle.boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      const appearance = await handle.evaluate((el, vertical) => ({
        background: getComputedStyle(el).backgroundColor,
        thickness: getComputedStyle(el, '::before')[vertical ? 'height' : 'width'],
      }), vertical);
      assert.equal(appearance.background, 'rgba(0, 0, 0, 0)');
      assert.equal(appearance.thickness, '2px', `${id}: hover line stays slim`);
      await page.mouse.down();
      await page.mouse.move(
        vertical ? hb.x + hb.width / 2 : bounds.x + bounds.width * target,
        vertical ? bounds.y + bounds.height * target : hb.y + hb.height / 2,
        {steps: 5});
      await page.mouse.up();
      const expected = Math.min(0.8, Math.max(0.2, target));
      assert.ok(Math.abs(await ratio() - expected) < 0.025, `${id}: drag to ${target} should produce ${expected}, got ${await ratio()}`);
    }
  }

  const notify = () => frame.$$eval("button", buttons => buttons.find(b => b.textContent === "Notify").click());
  await notify();
  await frame.waitForSelector(".ui-toast");
  await frame.hover(".ui-toast");
  // Deliberately exceed the 1500ms duration: verifies pause, not UI readiness.
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.ok(await frame.$(".ui-toast"), "Hover must pause auto-dismiss");
  await frame.click(".ui-toast-action");
  await frame.waitForSelector(".ui-toast", { hidden: true });
  assert.equal(await frame.$eval("#choice", el => el.textContent), "undone");
  await notify();
  await page.mouse.move(1, 1);
  await frame.waitForSelector(".ui-toast", { hidden: true, timeout: 5000 });

  // Removing a kit file updates the facade without leaving a stale import.
  await page.evaluate(async () => {
    let dir = await navigator.storage.getDirectory();
    for (const part of ['evalight','projects','lamp','src','app']) dir = await dir.getDirectoryHandle(part);
    const out = await (await dir.getFileHandle('gallery.cljs')).createWritable();
    await out.write('(ns app.gallery)'); await out.close();
  });
  await page.reload();
  await page.waitForSelector('.tree-row');
  await page.$$eval('.tree-row', rows => rows.find(row => row.querySelector('.tree-name')?.textContent === 'tree.cljs').querySelector('[aria-label="Delete"]').click());
  await page.waitForSelector('.ui-dialog .ui-btn-danger');
  await page.click('.ui-dialog .ui-btn-danger');
  const facadeHasTree = async () => {
    let dir = await navigator.storage.getDirectory();
    for (const part of ['evalight','projects','lamp','src']) dir = await dir.getDirectoryHandle(part);
    return (await (await (await (await dir.getDirectoryHandle('ui')).getFileHandle('api.cljs')).getFile()).text()).includes('[ui.tree');
  };
  await page.waitForFunction(async () => {
    let dir = await navigator.storage.getDirectory();
    for (const part of ['evalight','projects','lamp','src']) dir = await dir.getDirectoryHandle(part);
    return !(await (await (await (await dir.getDirectoryHandle('ui')).getFileHandle('api.cljs')).getFile()).text()).includes('[ui.tree');
  });
  assert.equal(await page.evaluate(facadeHasTree), false);
  await page.click('.add-ui-btn');
  await page.waitForSelector('.kit-list');
  await page.$$eval('.kit-list li', rows => rows.find(row => row.querySelector('.kit-title')?.textContent === 'Tree').querySelector('button').click());
  await page.waitForFunction(async () => {
    let dir = await navigator.storage.getDirectory();
    for (const part of ['evalight','projects','lamp','src']) dir = await dir.getDirectoryHandle(part);
    return (await (await (await (await dir.getDirectoryHandle('ui')).getFileHandle('api.cljs')).getFile()).text()).includes('[ui.tree');
  });
  assert.equal(await page.evaluate(facadeHasTree), true);

  assert.deepEqual(errors, []);
  console.log("ui-kit: SCI tooltip, dropdown, tabs, checkbox, switch, disclosure, accordion, and toast passed");
} finally {
  await browser?.close();
  server.stop(true);
}
