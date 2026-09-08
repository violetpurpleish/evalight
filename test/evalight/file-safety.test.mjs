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
    try {
      const parts = name.split('/');
      let dir = project;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return await (await (await dir.getFileHandle(parts.at(-1))).getFile()).text();
    }
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
  const undoRename = async () => {
    await page.click('[aria-label="History"]');
    await page.waitForSelector('.history-item');
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.history-item')].find(el => el.querySelector('.history-label')?.textContent.startsWith('Renamed'));
      [...row.querySelectorAll('button')].find(el => el.textContent.trim() === 'Undo').click();
    });
    await page.waitForFunction(() => ![...document.querySelectorAll('.history-label')].some(el => el.textContent.startsWith('Renamed')));
    await page.click('[aria-label="History"]');
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
  await append(" after rename");
  await undoRename(); // Undo before autosave; it must preserve the current buffer.
  await open('notes-a.txt');
  assert.equal(await read('notes-a.txt'), 'original A saved before switch before rename after rename');
  assert.equal(await read('notes-renamed.txt'), null);
  assert.match(await page.$eval('.cm-content', el => el.textContent), /after rename/);

  // Saved history must behave the same after reloading the workshop.
  await rowAction('notes-a.txt', '[aria-label="Rename"]');
  await submitPath('notes-renamed.txt');
  await page.waitForFunction(() => document.querySelector('.file-path')?.textContent.includes('notes-renamed.txt'));
  await append(' saved later');
  await open('notes-b.txt');
  await page.reload();
  await page.waitForSelector('.cm-content');
  await undoRename();
  assert.equal(await read('notes-a.txt'), 'original A saved before switch before rename after rename saved later');
  assert.equal(await read('notes-renamed.txt'), null);
  await open('notes-a.txt');
  await rowAction('notes-a.txt', '[aria-label="Rename"]');
  await submitPath('notes-renamed.txt');
  await page.waitForFunction(() => document.querySelector('.file-path')?.textContent.includes('notes-renamed.txt'));
  await append(" before delete");
  await rowAction("notes-renamed.txt", '[aria-label="Delete"]');
  await page.waitForSelector(".ui-dialog");
  await page.evaluate(() => [...document.querySelectorAll(".ui-dialog button")].find(el => el.textContent === "Delete").click());
  await page.waitForFunction(() => ![...document.querySelectorAll(".tree-name")].some(el => el.textContent === "notes-renamed.txt"));
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(await read("notes-renamed.txt"), null, "pending autosave must not recreate deleted file");
  // Entry-point renames update config, fully qualified consumers, and their undo.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const ws = await root.getDirectoryHandle('evalight');
    const project = await (await ws.getDirectoryHandle('projects')).getDirectoryHandle('lamp');
    const app = await (await project.getDirectoryHandle('src')).getDirectoryHandle('app');
    const file = await app.getFileHandle('consumer.cljs', {create:true});
    const writer = await file.createWritable();
    await writer.write('(ns app.consumer (:require [app.core]))\n(defn consume [] (app.core/bump))\n');
    await writer.close();
  });
  await page.reload();
  await page.waitForSelector('.cm-content');
  await rowAction('core.cljs', '[aria-label="Rename"]');
  await submitPath('src/app/main.cljs');
  await page.waitForFunction(() => document.querySelector('.file-path')?.textContent.includes('main.cljs'));
  // Wait for rewrite completion, not just the early active-file update.
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('app.core is now app.main'));
  assert.match(await read('evalight.edn'), /:main app\.main/);
  assert.match(await read('shadow-cljs.edn'), /:init-fn app\.main\/init/);
  assert.match(await read('src/app/consumer.cljs'), /\(app\.main\/bump\)/);
  await open('consumer.cljs');
  await append('\n;; later consumer edit\n');
  await open('main.cljs');
  await append('\n;; later main edit\n');
  // Undo latest rename only (the deleted text file has an older rename entry).
  await page.click('[aria-label="History"]');
  await page.waitForSelector('.history-item');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.history-item')].find(el => el.querySelector('.history-label')?.textContent.includes('src/app/main.cljs'));
    [...row.querySelectorAll('button')].find(el => el.textContent.trim() === 'Undo').click();
  });
  await page.waitForFunction(() => document.querySelector('.file-path')?.textContent.includes('core.cljs'));
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Restored src/app/core.cljs'));
  assert.match(await read('evalight.edn'), /:main app\.core/);
  assert.match(await read('shadow-cljs.edn'), /:init-fn app\.core\/init/);
  assert.match(await read('src/app/consumer.cljs'), /\(app\.core\/bump\)/);
  assert.match(await read('src/app/consumer.cljs'), /later consumer edit/);
  assert.match(await read('src/app/core.cljs'), /later main edit/);
  assert.equal(await read('src/app/main.cljs'), null);
  console.log("file-safety: collisions, saves, rename/delete, undo preservation, and namespace/config rewrites passed");
} finally {
  await browser?.close();
  server.stop(true);
}
