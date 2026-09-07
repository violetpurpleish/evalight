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
  assert.equal(await galleryFrame.$$eval('.example', nodes => nodes.length), 11);
  await galleryFrame.$$eval('button', nodes => nodes.find(n => n.textContent === 'Search commands').click());
  await galleryFrame.waitForSelector('.ui-command');
  await page.keyboard.press('Escape');
  await galleryFrame.waitForSelector('.ui-command', {hidden: true});
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

  assert.deepEqual(errors, []);
  console.log("ui-kit: SCI tooltip, dropdown, tabs, checkbox, switch, disclosure, accordion, and toast passed");
} finally {
  await browser?.close();
  server.stop(true);
}
