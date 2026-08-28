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
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI_ROOT = join(HERE, "public");
const FS_ROOT = resolve(HERE, "..");
const PORT = Number(process.env.PORT || 48721);
const SKIP = new Set([
  "node_modules",
  ".git",
  ".shadow-cljs",
  ".cpcache",
  "out",
  ".DS_Store",
]);
const SKIP_ROOT = new Set(["evalight", "evalight-ui"]);

function safe(rel) {
  const full = resolve(FS_ROOT, rel || ".");
  const relToRoot = relative(FS_ROOT, full);
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(status, message) {
  return json({ error: message }, status);
}

async function readBody(req) {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}

async function handleFs(req, url) {
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

function contentType(p) {
  if (p.endsWith(".js")) return "application/javascript";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".json")) return "application/json";
  return "application/octet-stream";
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
      });
    }
    if (url.pathname === "/api/evalight-pack" && req.method === "GET") {
      try {
        return json({ files: await packSelf() });
      } catch (e) {
        return error(500, e.message || String(e));
      }
    }
    if (url.pathname.startsWith("/api/fs/")) {
      return handleFs(req, url);
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = Bun.file(join(UI_ROOT, rel));
    if (await file.exists()) {
      return new Response(file, { headers: { "Content-Type": contentType(rel) } });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Evalight  http://127.0.0.1:${PORT}`);
console.log(`  project  ${FS_ROOT}`);
