import { join } from "node:path";

export function contentType(p) {
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
  return "application/octet-stream";
}

/** Same check as evalight.export/watch-build-js?. Watch loaders reconnect forever. */
export function isWatchLoaderJs(body) {
  return typeof body === "string" && !body.includes("COMPILED=!0");
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
  return new Response(file, { headers: staticHeaders(rel) });
}

/**
 * `bun run local` must not serve leftover `public/js` from `shadow-cljs
 * watch :app`. That build injects the shadow HUD, which then sits on
 * "Reconnecting…" because local mode never starts the watch websocket.
 * The workshop chrome is the `:workshop` release in evalight-ui/js.
 */
export async function serveLocalUi(repoRoot, pathname) {
  if (pathname.startsWith("/js/")) {
    const release = await servePublicPath(join(repoRoot, "evalight-ui"), pathname);
    if (release && release.status === 200) {
      const rel = decodeURIComponent(pathname.slice(1));
      if (rel === "js/main.js" || rel.endsWith("/main.js")) {
        const body = await release.clone().text();
        if (isWatchLoaderJs(body)) {
          return new Response(
            "Evalight local mode will not serve a shadow-cljs watch loader. Run bun run embed, then bun run local again.",
            { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
          );
        }
      }
      return release;
    }
    return new Response(
      "Evalight local mode needs the release workshop UI in evalight-ui/js. Run bun run embed.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  return servePublicPath(join(repoRoot, "public"), pathname);
}
