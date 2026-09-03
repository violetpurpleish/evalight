/**
 * Filesystem HTTP API used by both bun run evalight and bun run local.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export const SKIP = new Set([
  "node_modules",
  ".git",
  ".shadow-cljs",
  ".cpcache",
  ".nrepl-port",
  "out",
  "target",
  ".DS_Store",
]);

export const SKIP_ROOT = new Set(["evalight", "evalight-ui"]);

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function error(status, message) {
  return json({ error: message }, status);
}

async function readBody(req) {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}

export function createFsApi(fsRoot) {
  function safe(rel) {
    const full = resolve(fsRoot, rel || ".");
    const relToRoot = relative(fsRoot, full);
    if (relToRoot.startsWith("..") || relToRoot.startsWith(`..${sep}`)) {
      throw new Error("Path escapes the project root.");
    }
    return full;
  }

  async function listDir(rel) {
    const dir = safe(rel);
    const names = await readdir(dir);
    const entries = [];
    for (const name of names) {
      if (SKIP.has(name)) continue;
      if (!rel && SKIP_ROOT.has(name)) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const s = await stat(join(dir, name));
      entries.push({
        name,
        path: childRel.replaceAll("\\", "/"),
        type: s.isDirectory() ? "dir" : "file",
      });
    }
    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async function handle(req, url) {
    const path = url.searchParams.get("path") || "";
    try {
      if (url.pathname.endsWith("/list") && req.method === "GET") {
        return json({ entries: await listDir(path) });
      }
      if (url.pathname.endsWith("/read") && req.method === "GET") {
        const content = await readFile(safe(path), "utf8");
        return json({ path, content });
      }
      if (url.pathname.endsWith("/exists") && req.method === "GET") {
        try {
          await stat(safe(path));
          return json({ exists: true });
        } catch {
          return json({ exists: false });
        }
      }
      if (url.pathname.endsWith("/write") && req.method === "PUT") {
        const body = await readBody(req);
        const target = safe(body.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body.content ?? "", "utf8");
        return json({ path: body.path });
      }
      if (url.pathname.endsWith("/mkdir") && req.method === "POST") {
        const body = await readBody(req);
        await mkdir(safe(body.path), { recursive: true });
        return json({ path: body.path });
      }
      if (url.pathname.endsWith("/rename") && req.method === "POST") {
        const body = await readBody(req);
        await mkdir(dirname(safe(body.to)), { recursive: true });
        await rename(safe(body.from), safe(body.to));
        return json({ to: body.to });
      }
      if (url.pathname.endsWith("/delete") && req.method === "DELETE") {
        await rm(safe(path), { recursive: true, force: true });
        return json({ path });
      }
      return error(404, "Unknown filesystem endpoint");
    } catch (e) {
      return error(400, e.message || String(e));
    }
  }

  return { handle, safe };
}
