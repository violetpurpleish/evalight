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

const UI_ROOT = join(fileURLToPath(new URL("../public", import.meta.url)));
const PORT = Number(process.env.PORT || 48721);

function contentType(p) {
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
  return "application/octet-stream";
}

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
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = Bun.file(join(UI_ROOT, rel));
    if (await file.exists()) {
      return new Response(file, { headers: { "Content-Type": contentType(rel) } });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Evalight  http://127.0.0.1:${PORT}`);

function shutdown() {
  shadow.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
