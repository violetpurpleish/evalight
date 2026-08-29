#!/usr/bin/env bun
/**
 * Evalight, running from inside a project.
 *
 * Serves the workshop UI from ./public and the filesystem API over the
 * parent directory (the project). Skip the evalight/ folder in the tree
 * so the tool does not list itself.
 *
 *   bun evalight/server.mjs
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVALIGHT_BUILD } from "./build-id.mjs";
import {
  compiledMeta,
  handleRuntimeRequest,
  startCompiledRuntime,
  stopCompiledRuntime,
} from "./compiled.mjs";
import { createFsApi, error, json } from "./fs-http.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI_ROOT = join(HERE, "public");
const FS_ROOT = resolve(HERE, "..");
const PORT = Number(process.env.PORT || 48721);
const fsApi = createFsApi(FS_ROOT);

function contentType(p) {
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function staticHeaders(rel) {
  const headers = { "Content-Type": contentType(rel) };
  if (rel === "index.html" || /\.(html|js|css|map)$/.test(rel)) {
    headers["Cache-Control"] = "no-store";
  }
  return headers;
}

function stampHtml(html) {
  return html
    .replace(/content="evalight-editor-v[^"]*"/, `content="${EVALIGHT_BUILD}"`)
    .replace(/window\.__EVALIGHT_HTML__ = "[^"]*"/, `window.__EVALIGHT_HTML__ = "${EVALIGHT_BUILD}"`)
    .replace(/src="\/js\/main\.js[^"]*"/, `src="/js/main.js?v=${EVALIGHT_BUILD}"`);
}

async function packSelf() {
  const files = {};
  async function walk(dir, zipPrefix) {
    for (const name of await readdir(dir)) {
      if (name === ".DS_Store") continue;
      const p = join(dir, name);
      const s = await stat(p);
      const zip = `${zipPrefix}/${name}`.replaceAll("\\", "/");
      if (s.isDirectory()) await walk(p, zip);
      else files[zip] = await readFile(p, "utf8");
    }
  }
  await walk(HERE, "evalight");
  return files;
}

console.log(`Starting compiled runtime…`);
await startCompiledRuntime(FS_ROOT);

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/meta") {
      return json({
        mode: "local",
        build: EVALIGHT_BUILD,
        name: FS_ROOT.split(/[\\/]/).filter(Boolean).at(-1),
        root: FS_ROOT,
        ...compiledMeta(),
      });
    }
    const runtimeRes = await handleRuntimeRequest(req, url);
    if (runtimeRes) return runtimeRes;
    if (url.pathname === "/api/evalight-pack" && req.method === "GET") {
      try {
        return json({ files: await packSelf() });
      } catch (e) {
        return error(500, e.message || String(e));
      }
    }
    if (url.pathname.startsWith("/api/fs/")) {
      return fsApi.handle(req, url);
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = Bun.file(join(UI_ROOT, rel));
    if (await file.exists()) {
      if (rel === "index.html") {
        return new Response(stampHtml(await file.text()), { headers: staticHeaders(rel) });
      }
      return new Response(file, { headers: staticHeaders(rel) });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Evalight  http://127.0.0.1:${PORT}  ${EVALIGHT_BUILD}`);
console.log(`  project  ${FS_ROOT}`);

function shutdown() {
  stopCompiledRuntime();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
