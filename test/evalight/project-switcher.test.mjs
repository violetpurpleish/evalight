/** Project creation, persisted edit order, keyboard search, and narrow layouts. */
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
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.waitForFunction(() => document.querySelector(".file-path")?.textContent.includes("core.cljs"));

  const openMenu = async () => {
    await page.click("#project-select");
    await page.waitForSelector(".project-menu input");
    assert.equal(await page.$eval(".project-menu input", el => el === document.activeElement), true);
  };
  const rows = () => page.$$eval(".project-option", els => els.map(el => el.dataset.project));
  const waitProject = name => page.waitForFunction(name => document.querySelector("#project-select")?.value === name, {}, name);
  const readMeta = name => page.evaluate(async name => {
    const root = await navigator.storage.getDirectory();
    const ws = await root.getDirectoryHandle("evalight");
    const meta = await ws.getDirectoryHandle("project-meta");
    return JSON.parse(await (await (await meta.getFileHandle(`${name}.json`)).getFile()).text());
  }, name);
  const created = await readMeta("lamp");
  assert.ok(created["created-at"] > 0);
  assert.equal(created["created-at"], created["edited-at"]);

  for (const name of ["amber-counter", "zebra-notes-with-a-long-project-name-for-layout"]) {
    await openMenu();
    await page.click(".project-menu-footer button");
    await page.waitForSelector(".ui-dialog input");
    await page.$eval(".ui-dialog input", (el, name) => { el.value = name; el.closest("form").requestSubmit(); }, name);
    await waitProject(name);
    await page.waitForSelector(".cm-content");
    const meta = await readMeta(name);
    assert.equal(meta["created-at"], meta["edited-at"]);
  }

  // Deterministic dates make the sort independent of filesystem resolution.
  const names = ["lamp", "amber-counter", "zebra-notes-with-a-long-project-name-for-layout"];
  await page.evaluate(async names => {
    const ws = await (await navigator.storage.getDirectory()).getDirectoryHandle("evalight");
    const meta = await ws.getDirectoryHandle("project-meta");
    for (const [i, name] of names.entries()) {
      const fh = await meta.getFileHandle(`${name}.json`);
      const writer = await fh.createWritable();
      await writer.write(JSON.stringify({ "created-at": Date.now() - 86400000 * 7,
        "edited-at": Date.now() - 86400000 * (3 - i) }));
      await writer.close();
    }
  }, names);
  await page.reload();
  await page.waitForSelector(".cm-content");
  await openMenu();
  assert.deepEqual(await rows(), [...names].reverse());
  assert.match(await page.$eval(".project-options", el => el.textContent), /Edited 3 days ago/);
  assert.match(await page.$eval(".project-options", el => el.textContent), /Created /);
  assert.equal(await page.$$eval(".project-option[aria-current=true]", els => els.length), 1);

  await page.type(".project-menu input", "no-such-project");
  assert.equal(await page.$eval(".project-empty", el => el.textContent), "No matching projects");
  await page.$eval(".project-menu input", el => { el.value = "lamp"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.deepEqual(await rows(), ["lamp"]);
  const beforeOpen = await readMeta("lamp");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.project), "lamp");
  await page.keyboard.press("Enter");
  await waitProject("lamp");
  await page.waitForSelector(".project-menu", { hidden: true });
  assert.deepEqual(await readMeta("lamp"), beforeOpen, "Opening a project must not change edit time");

  // Creating a file is a project edit; opening it afterward isn't another edit.
  await page.evaluate(() => [...document.querySelectorAll(".tree-tools button")].find(el => el.textContent === "File").click());
  await page.waitForSelector(".ui-dialog input");
  await page.$eval(".ui-dialog input", el => { el.value = "edited.txt"; el.closest("form").requestSubmit(); });
  await page.waitForFunction(() => document.querySelector(".file-path")?.textContent.includes("edited.txt"));
  await page.click(".cm-content");
  await page.keyboard.sendCharacter("A real edit updates the project timestamp.");
  await page.waitForFunction(() => !document.querySelector(".tree-row .dot"));
  const edited = await readMeta("lamp");
  assert.equal(edited["created-at"], beforeOpen["created-at"]);
  assert.ok(edited["edited-at"] > beforeOpen["edited-at"]);
  await openMenu();
  assert.equal((await rows())[0], "lamp");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "project-select");
  await page.reload();
  await page.waitForSelector(".cm-content");
  await openMenu();
  assert.equal((await rows())[0], "lamp", "Edited ordering persists through reload");
  assert.deepEqual(await readMeta("lamp"), edited);

  await page.keyboard.press("Escape");
  await page.setViewport({ width: 390, height: 844 });
  await openMenu();
  const bounds = await page.evaluate(() => {
    const menu = document.querySelector(".project-menu").getBoundingClientRect();
    const footer = document.querySelector(".project-menu-footer").getBoundingClientRect();
    return { left: menu.left, right: menu.right, bottom: menu.bottom,
      footerBottom: footer.bottom, width: innerWidth, height: innerHeight };
  });
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.width, JSON.stringify(bounds));
  assert.ok(bounds.bottom <= bounds.height && bounds.footerBottom <= bounds.height, JSON.stringify(bounds));
  await page.click(".wordmark");
  await page.waitForSelector(".project-menu", { hidden: true });
  console.log("project-switcher: creation, edit tracking, persisted ordering, search, keyboard, and mobile layout passed");
} finally {
  await browser?.close();
  server.stop(true);
}
