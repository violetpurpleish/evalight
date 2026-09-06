/**
 * Binary read/write on the shared filesystem HTTP API.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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

await writeFile(join(dir, "a.txt"), "source A");
await writeFile(join(dir, "b.txt"), "valuable B");
const collision = await call("/rename", "POST", { body: { from: "a.txt", to: "b.txt" } });
assert.equal(collision.status, 409);
assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "source A");
assert.equal(await readFile(join(dir, "b.txt"), "utf8"), "valuable B");
assert.equal((await call("/rename", "POST", { body: { from: "a.txt", to: "nested/c.txt" } })).status, 200);
assert.equal(await readFile(join(dir, "nested/c.txt"), "utf8"), "source A");
assert.equal((await call("/exists", "GET", { path: "a.txt" })).data.exists, false);

// Check the real API, including missing descendants of linked directories.
const outside = await mkdtemp(join(tmpdir(), "evalight-fs-outside-"));
await writeFile(join(outside, "secret.txt"), "outside original");
await symlink(join(outside, "secret.txt"), join(dir, "linked.txt"));
await symlink(outside, join(dir, "linked-dir"), "dir");
await symlink(join(outside, "missing.txt"), join(dir, "dangling.txt"));
await symlink(dir, join(dir, "cycle"), "dir");
for (const path of ["linked.txt", "linked-dir/secret.txt", "dangling.txt"]) {
  assert.equal((await call("/read", "GET", { path })).status, 400, path);
  assert.equal((await call("/write", "PUT", { body: { path, content: "bad" } })).status, 400, path);
  assert.equal((await call("/delete", "DELETE", { path })).status, 400, path);
}
assert.equal((await call("/write", "PUT", { body: { path: "linked-dir/new/deep.txt", content: "bad" } })).status, 400);
assert.equal((await call("/mkdir", "POST", { body: { path: "linked-dir/new" } })).status, 400);
assert.equal((await call("/list", "GET", { path: "linked-dir" })).status, 400);
assert.equal((await call("/rename", "POST", { body: { from: "b.txt", to: "linked-dir/moved.txt" } })).status, 400);
assert.equal((await call("/rename", "POST", { body: { from: "linked.txt", to: "moved.txt" } })).status, 400);
assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "outside original");
const listed = (await call("/list", "GET")).data.entries.map((entry) => entry.name);
for (const name of ["linked.txt", "linked-dir", "dangling.txt", "cycle"]) assert.ok(!listed.includes(name));
assert.equal((await call("/read", "GET", { path: "../secret.txt" })).status, 400);
assert.equal((await call("/write", "PUT", { body: { path: "..valid.txt", content: "valid" } })).status, 200);
// A symlink used for the root itself is safe (e.g. /tmp on macOS).
const parent = await mkdtemp(join(tmpdir(), "evalight-root-link-"));
await symlink(dir, join(parent, "project"), "dir");
assert.equal(await createFsApi(join(parent, "project")).safe("b.txt"), await api.safe("b.txt"));
console.log("fs-http collision and symlink protection ok");
