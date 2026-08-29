import assert from "node:assert/strict";
import { join } from "node:path";
import { packEvalight, fallbackManifest, withEvalightScript } from "../../scripts/evalight-pack.mjs";

const root = join(import.meta.dir, "../..");

const files = await packEvalight(root, { requireJs: false });
assert.ok(files["evalight/server.mjs"].includes("createFsApi"));
assert.ok(files["evalight/fs-http.mjs"].includes("SKIP_ROOT"));
assert.ok(files["evalight/static.mjs"].includes("servePublicPath"));
assert.ok(files["evalight/server.mjs"].includes("servePublicPath"));
assert.ok(files["evalight/public/index.html"].includes("/js/main.js"));
assert.equal(files["evalight/build-id.mjs"], undefined);
assert.ok(files["evalight/compiled.mjs"].includes("resolveAttachTarget"));
assert.ok(files["evalight/server.mjs"].includes("parseEvalightArgs"));
assert.ok(files["evalight/nrepl.mjs"].includes("bencode"));
assert.ok(files["evalight/public/preview.html"].includes("preview"));
assert.ok(files["evalight/public/css/evalight.css"]);
assert.ok(files["evalight/public/css/preview.css"]);
assert.ok(files["evalight/public/licenses.html"].includes("Open source licenses"));
assert.ok(files["evalight/public/licenses.html"].includes("@codemirror/state"));
assert.ok(files["evalight/public/licenses.html"].includes("org.babashka/sci"));
assert.equal(
  files["evalight/public/preview.css"],
  undefined,
);
assert.equal(
  Object.keys(files).some((k) => k.includes("cljs-runtime")),
  false,
);

const zips = new Set(fallbackManifest().files.map((f) => f.zip));
for (const zip of Object.keys(files)) {
  assert.ok(zips.has(zip), `packed ${zip} missing from fallbackManifest`);
}

const out = withEvalightScript(`{"name":"lamp","scripts":{"dev":"shadow-cljs watch app"}}`);
const pkg = JSON.parse(out);
assert.equal(pkg.scripts.evalight, "bun evalight/server.mjs");
assert.equal(pkg.scripts.dev, "shadow-cljs watch app");

assert.equal(withEvalightScript("{not json"), "{not json");

console.log("pack.test.mjs ok");
