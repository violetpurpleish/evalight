#!/usr/bin/env bun
/**
 * Evalight, running from inside a project.
 *
 * Serves the workshop UI from ./public and the filesystem API over the
 * parent directory (the project). Skip the evalight/ folder in the tree
 * so the tool does not list itself.
 *
 *   bun evalight/server.mjs
 *   bun evalight/server.mjs --attach
 *   bun evalight/server.mjs --attach --preview-url=http://127.0.0.1:3456/
 *
 * ClojureScript projects start shadow-cljs watch. JVM Clojure / clj-gpui
 * start (or attach to) nREPL. Generic Clojure has no preview pane.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleRuntimeRequest,
  parseEvalightArgs,
  runtimeMeta,
  startRuntime,
  stopRuntime,
} from "./runtime.mjs";
import { createFsApi, error, json } from "./fs-http.mjs";
import { servePublicPath } from "./static.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI_ROOT = join(HERE, "public");
const FS_ROOT = resolve(HERE, "..");
const PORT = Number(process.env.PORT || 48721);
const fsApi = createFsApi(FS_ROOT);

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

const flags = (() => {
  try {
    return parseEvalightArgs(process.argv);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
})();

await startRuntime(FS_ROOT, {
  attach: flags.attach,
  previewUrl: flags.previewUrl,
  nreplPort: flags.nreplPort,
});

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/meta") {
      return json({
        mode: "local",
        name: FS_ROOT.split(/[\\/]/).filter(Boolean).at(-1),
        root: FS_ROOT,
        ...runtimeMeta(),
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
    const served = await servePublicPath(UI_ROOT, url.pathname);
    if (served) return served;
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Evalight  http://127.0.0.1:${PORT}`);
console.log(`  project  ${FS_ROOT}`);

function shutdown() {
  stopRuntime();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
