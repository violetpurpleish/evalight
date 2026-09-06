/**
 * Filesystem HTTP API used by both bun run evalight and bun run local.
 */
import { link, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
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

/** Keep in sync with evalight.paths/binary-exts. */
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|bmp|avif|woff2?|ttf|otf|eot|wasm|zip|gz|tgz|7z|rar|bin|pdf|mp3|mp4|webm|ogg|wav|mov|class|jar)$/i;

export function isBinaryPath(p) {
  return BINARY_EXT.test(p || "");
}

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
  async function safe(rel) {
    const full = resolve(fsRoot, rel || ".");
    const relToRoot = relative(resolve(fsRoot), full);
    if (relToRoot === ".." || relToRoot.startsWith(`..${sep}`)) {
      throw new Error("Path escapes the project root.");
    }
    // Canonicalize the root (e.g. macOS /tmp), but reject symlinks below it.
    // This also prevents directory cycles during recursive tree reads.
    const root = await realpath(fsRoot);
    let current = root;
    for (const part of relToRoot.split(sep).filter(Boolean)) {
      current = join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new Error("Symbolic links are not supported in project paths.");
        }
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return current;
  }

  async function listDir(rel) {
    const dir = await safe(rel);
    const names = await readdir(dir);
    const entries = [];
    for (const name of names) {
      if (SKIP.has(name)) continue;
      if (!rel && SKIP_ROOT.has(name)) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const s = await lstat(join(dir, name));
      if (s.isSymbolicLink()) continue;
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
        if (isBinaryPath(path)) {
          const buf = await readFile(await safe(path));
          return json({ path, content: buf.toString("base64"), encoding: "base64" });
        }
        const content = await readFile(await safe(path), "utf8");
        return json({ path, content });
      }
      if (url.pathname.endsWith("/exists") && req.method === "GET") {
        try {
          await stat(await safe(path));
          return json({ exists: true });
        } catch {
          return json({ exists: false });
        }
      }
      if (url.pathname.endsWith("/write") && req.method === "PUT") {
        const body = await readBody(req);
        const target = await safe(body.path);
        await mkdir(dirname(target), { recursive: true });
        if (body.encoding === "base64") {
          await writeFile(target, Buffer.from(body.content ?? "", "base64"));
        } else {
          await writeFile(target, body.content ?? "", "utf8");
        }
        return json({ path: body.path });
      }
      if (url.pathname.endsWith("/mkdir") && req.method === "POST") {
        const body = await readBody(req);
        await mkdir(await safe(body.path), { recursive: true });
        return json({ path: body.path });
      }
      if (url.pathname.endsWith("/rename") && req.method === "POST") {
        const body = await readBody(req);
        const from = await safe(body.from);
        const to = await safe(body.to);
        try {
          await lstat(to);
          return error(409, "Destination already exists.");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        await mkdir(dirname(to), { recursive: true });
        if ((await lstat(from)).isFile()) {
          // link fails atomically if the destination appeared after the check.
          await link(from, to);
          await unlink(from);
        } else {
          await rename(from, to);
        }
        return json({ to: body.to });
      }
      if (url.pathname.endsWith("/delete") && req.method === "DELETE") {
        await rm(await safe(path), { recursive: true, force: true });
        return json({ path });
      }
      return error(404, "Unknown filesystem endpoint");
    } catch (e) {
      return error(400, e.message || String(e));
    }
  }

  return { handle, safe };
}
