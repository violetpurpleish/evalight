#!/usr/bin/env bun
/**
 * Dev entry: compile with shadow-cljs, serve the UI from public/.
 *
 * shadow-cljs's own HTTP server does not map / to index.html, so Bun
 * serves the static files instead. Live reload still goes through the
 * shadow-cljs watch process.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyEmbedServer, ensureWorkshopUi, handlePackRequest } from "./evalight-pack.mjs";
import { EVALIGHT_BUILD, servePublicPath } from "./static-ui.mjs";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const UI_ROOT = join(ROOT, "public");
const PORT = Number(process.env.PORT || 48721);

await copyEmbedServer(ROOT);

const shadow = spawn("bunx", ["shadow-cljs", "watch", "app", "preview"], {
  stdio: "inherit",
  env: process.env,
});

shadow.on("exit", (code) => {
  if (code) process.exit(code);
});

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/meta") {
      return Response.json({ mode: "browser", build: EVALIGHT_BUILD });
    }
    if (url.pathname === "/api/evalight-pack" && req.method === "GET") {
      return handlePackRequest(ROOT);
    }
    const served = await servePublicPath(UI_ROOT, url.pathname);
    if (served) return served;
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Evalight  http://127.0.0.1:${PORT}  ${EVALIGHT_BUILD}`);

setTimeout(() => {
  ensureWorkshopUi(ROOT).catch((err) => {
    console.warn("workshop UI for export:", err.message);
  });
}, 8000);

function shutdown() {
  shadow.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
