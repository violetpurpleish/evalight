#!/usr/bin/env bun
/**
 * Local Evalight bridge.
 *
 * Serves the same browser UI, plus a tiny filesystem API rooted at a
 * real directory. The UI talks to this backend instead of OPFS.
 *
 *   bun run local
 *   bun run local /path/to/project
 *   bun run local --attach /path/to/project
 */

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyEmbedServer, handlePackRequest } from "./evalight-pack.mjs";
import { EVALIGHT_BUILD, servePublicPath } from "./static-ui.mjs";
import {
  compiledMeta,
  handleRuntimeRequest,
  parseEvalightArgs,
  startCompiledRuntime,
  stopCompiledRuntime,
} from "../src/evalight/embed/compiled.mjs";
import { createFsApi, json } from "../src/evalight/embed/fs-http.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const UI_ROOT = join(ROOT, "public");
const flags = (() => {
  try {
    return parseEvalightArgs(process.argv);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
})();
const FS_ROOT = resolve(flags.positional[0] || process.cwd());
const PORT = Number(process.env.PORT || 48721);
const fsApi = createFsApi(FS_ROOT);

await copyEmbedServer(ROOT);
console.log(`Starting compiled runtime…`);
await startCompiledRuntime(FS_ROOT, {
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
        build: EVALIGHT_BUILD,
        name: FS_ROOT.split(/[\\/]/).filter(Boolean).at(-1),
        root: FS_ROOT,
        ...compiledMeta(),
      });
    }
    const runtimeRes = await handleRuntimeRequest(req, url);
    if (runtimeRes) return runtimeRes;
    if (url.pathname === "/api/evalight-pack" && req.method === "GET") {
      return handlePackRequest(ROOT);
    }
    if (url.pathname.startsWith("/api/fs/")) {
      return fsApi.handle(req, url);
    }
    const served = await servePublicPath(UI_ROOT, url.pathname);
    if (served) return served;
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Evalight local mode  ${EVALIGHT_BUILD}`);
console.log(`  UI:  http://127.0.0.1:${PORT}`);
console.log(`  FS:  ${FS_ROOT}`);

function shutdown() {
  stopCompiledRuntime();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
