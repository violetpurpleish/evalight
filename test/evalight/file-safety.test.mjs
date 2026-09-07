/** Browser regression checks for saving and non-destructive file actions.
 * Run after shadow-cljs compile app preview. Uses an isolated Chrome profile.
 */
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
  await page.waitForSelector(".cm-content");
  await page.waitForFunction(() => document.querySelector(".file-path")?.textContent.includes("core.cljs"));
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const ws = await root.getDirectoryHandle("evalight");
    const projects = await ws.getDirectoryHandle("projects");
    const project = await projects.getDirectoryHandle("lamp");
    for (const [name, content] of [["notes-a.txt", "original A"], ["notes-b.txt", "original B"]]) {
      const file = await project.getFileHandle(name, { create: true });
      const writer = await file.createWritable();
      await writer.write(content);
      await writer.close();
    }
  });
  await page.reload();
  await page.waitForSelector(".cm-content");
  const read = (name) => page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const ws = await root.getDirectoryHandle("evalight");
    const projects = await ws.getDirectoryHandle("projects");
    const project = await projects.getDirectoryHandle("lamp");
    try { return await (await (await project.getFileHandle(name)).getFile()).text(); }
    catch (e) { if (e.name === "NotFoundError") return null; throw e; }
  }, name);
  const rowAction = async (name, selector = ".tree-item") => {
    await page.evaluate(({ name, selector }) => {
      const row = [...document.querySelectorAll(".tree-row")].find(r => r.querySelector(".tree-name")?.textContent === name);
      if (!row) throw new Error("Missing file: " + name);
      row.querySelector(selector).click();
    }, { name, selector });
  };
  const open = async (name) => {
    await rowAction(name);
    await page.waitForFunction(name => document.querySelector(".file-path")?.textContent.includes(name), {}, name);
    await page.waitForSelector(".cm-content");
  };
  const append = async (text) => {
    await page.click(".cm-content");
    await page.keyboard.down("Control");
    await page.keyboard.press("End");
    await page.keyboard.up("Control");
    await page.keyboard.sendCharacter(text);
  };
  const submitPath = async (path) => {
    await page.waitForSelector(".ui-dialog input");
    await page.$eval(".ui-dialog input", (el, path) => { el.value = path; el.closest("form").requestSubmit(); }, path);
  };

  await open("notes-a.txt");
  await append(" saved before switch");
  await open("notes-b.txt"); // Deliberately do not wait for the 320 ms autosave.
  assert.equal(await read("notes-a.txt"), "original A saved before switch");
  assert.equal(await read("notes-b.txt"), "original B");
  await open("notes-a.txt");
  assert.match(await page.$eval(".cm-content", el => el.textContent), /saved before switch/);

  await page.click('.tree-tools button[aria-label="New file"]');
  await submitPath("notes-b.txt");
  await page.waitForFunction(() => document.body.textContent.includes("notes-b.txt already exists."));
  assert.equal(await read("notes-b.txt"), "original B");
  await page.evaluate(() => [...document.querySelectorAll(".ui-dialog button")].find(el => el.textContent === "Cancel").click());

  await rowAction("notes-a.txt", '[aria-label="Rename"]');
  await submitPath("notes-b.txt");
  await page.waitForFunction(() => document.body.textContent.includes("notes-b.txt already exists."));
  assert.equal(await read("notes-b.txt"), "original B");
  assert.equal(await read("notes-a.txt"), "original A saved before switch");
  await page.evaluate(() => [...document.querySelectorAll(".ui-dialog button")].find(el => el.textContent === "Cancel").click());

  await append(" before rename");
  await rowAction("notes-a.txt", '[aria-label="Rename"]');
  await submitPath("notes-renamed.txt");
  await page.waitForFunction(() => document.querySelector(".file-path")?.textContent.includes("notes-renamed.txt"));
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(await read("notes-a.txt"), null, "pending autosave must not recreate renamed file");
  assert.equal(await read("notes-renamed.txt"), "original A saved before switch before rename");
  await append(" before delete");
  await rowAction("notes-renamed.txt", '[aria-label="Delete"]');
  await page.waitForSelector(".ui-dialog");
  await page.evaluate(() => [...document.querySelectorAll(".ui-dialog button")].find(el => el.textContent === "Delete").click());
  await page.waitForFunction(() => ![...document.querySelectorAll(".tree-name")].some(el => el.textContent === "notes-renamed.txt"));
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(await read("notes-renamed.txt"), null, "pending autosave must not recreate deleted file");
  console.log("file-safety: rapid switch, create/rename collisions, and pending-save rename/delete passed");
} finally {
  await browser?.close();
  server.stop(true);
}
