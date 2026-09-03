/**
 * Binary read/write on the shared filesystem HTTP API.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsApi, isBinaryPath } from "../../src/evalight/embed/fs-http.mjs";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG_B64, "base64");

assert.equal(isBinaryPath("resources/icon.png"), true);
assert.equal(isBinaryPath("src/app/core.cljs"), false);
assert.equal(isBinaryPath("logo.svg"), false);
assert.equal(isBinaryPath("fonts/app.woff2"), true);

const dir = await mkdtemp(join(tmpdir(), "evalight-fs-http-"));
const api = createFsApi(dir);

async function call(pathname, method, { path, body } = {}) {
  const url = new URL("http://evalight.test" + pathname);
  if (path != null) url.searchParams.set("path", path);
  const req = new Request(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await api.handle(req, url);
  const data = await res.json();
  return { status: res.status, data };
}

const written = await call("/write", "PUT", {
  body: { path: "resources/icon.png", content: PNG_B64, encoding: "base64" },
});
assert.equal(written.status, 200, JSON.stringify(written.data));
assert.equal(written.data.path, "resources/icon.png");

const disk = await readFile(join(dir, "resources/icon.png"));
assert.deepEqual(disk, PNG);

const read = await call("/read", "GET", { path: "resources/icon.png" });
assert.equal(read.status, 200, JSON.stringify(read.data));
assert.equal(read.data.encoding, "base64");
assert.equal(read.data.content, PNG_B64);

const textWrite = await call("/write", "PUT", {
  body: { path: "src/app/core.cljs", content: "(ns app.core)\n" },
});
assert.equal(textWrite.status, 200, JSON.stringify(textWrite.data));
const textRead = await call("/read", "GET", { path: "src/app/core.cljs" });
assert.equal(textRead.data.content, "(ns app.core)\n");
assert.equal(textRead.data.encoding, undefined);

console.log("fs-http binary read/write ok");
