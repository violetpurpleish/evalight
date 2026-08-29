import { join } from "node:path";
import { EVALIGHT_BUILD } from "../src/evalight/embed/build-id.mjs";
import { stampHtml } from "./evalight-build.mjs";

export { EVALIGHT_BUILD };

export function contentType(p) {
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
  return "application/octet-stream";
}

export function staticHeaders(rel) {
  const headers = { "Content-Type": contentType(rel) };
  if (rel === "index.html" || /\.(html|js|css|map)$/.test(rel)) {
    headers["Cache-Control"] = "no-store";
  }
  return headers;
}

export async function servePublicPath(uiRoot, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  if (!rel || rel.includes("..")) return null;
  const file = Bun.file(join(uiRoot, rel));
  if (!(await file.exists())) return null;
  if (rel === "index.html") {
    const html = stampHtml(await file.text(), EVALIGHT_BUILD);
    return new Response(html, { headers: staticHeaders(rel) });
  }
  return new Response(file, { headers: staticHeaders(rel) });
}
