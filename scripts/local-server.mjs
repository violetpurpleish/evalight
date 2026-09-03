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

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyEmbedServer, ensureWorkshopUi, handlePackRequest } from "./evalight-pack.mjs";
import { serveLocalUi } from "./static-ui.mjs";
import {
  handleRuntimeRequest,
  parseEvalightArgs,
  runtimeMeta,
  startRuntime,
  stopRuntime,
} from "../src/evalight/embed/runtime.mjs";
import { createFsApi, json } from "../src/evalight/embed/fs-http.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
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
// Release workshop JS in parallel with the project runtime. Do not serve
// leftover public/js from `shadow-cljs watch :app` — that HUD reconnects
// forever because this server never starts the watch websocket.
const uiReady = ensureWorkshopUi(ROOT);
await startRuntime(FS_ROOT, {
  attach: flags.attach,
  previewUrl: flags.previewUrl,
  nreplPort: flags.nreplPort,
});
try {
  await uiReady;
} catch (e) {
  console.error(e.message || e);
  stopRuntime();
  process.exit(1);
}

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
      return handlePackRequest(ROOT);
    }
    if (url.pathname.startsWith("/api/fs/")) {
      return fsApi.handle(req, url);
    }
    const served = await serveLocalUi(ROOT, url.pathname);
    if (served) return served;
    return new Response("Not found", { status: 404 });
  },
});

const meta = runtimeMeta();
console.log(`Evalight local mode`);
console.log(`  UI:   http://127.0.0.1:${PORT}`);
console.log(`  FS:   ${FS_ROOT}`);
console.log(`  kind: ${meta.runtime || meta.kind}${meta.app ? ` · ${meta.app}` : ""}`);
console.log(`  js:   evalight-ui/js (release workshop, not shadow-cljs watch)`);

function shutdown() {
  stopRuntime();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
