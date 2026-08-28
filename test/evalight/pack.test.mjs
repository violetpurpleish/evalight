import assert from "node:assert/strict";
import { join } from "node:path";
import { packEvalight, withEvalightScript } from "../../scripts/evalight-pack.mjs";

const root = join(import.meta.dir, "../..");

const files = await packEvalight(root, { requireJs: false });
assert.ok(files["evalight/server.mjs"].includes("bun evalight/server.mjs"));
assert.ok(files["evalight/server.mjs"].includes("SKIP_ROOT"));
assert.ok(files["evalight/public/index.html"].includes("/js/main.js"));
assert.ok(files["evalight/public/preview.html"].includes("preview"));
assert.ok(files["evalight/public/css/evalight.css"]);
assert.ok(files["evalight/public/css/preview.css"]);
assert.equal(
  files["evalight/public/preview.css"],
  undefined,
);
assert.equal(
  Object.keys(files).some((k) => k.includes("cljs-runtime")),
  false,
);

const out = withEvalightScript(`{"name":"lamp","scripts":{"dev":"shadow-cljs watch app"}}`);
const pkg = JSON.parse(out);
assert.equal(pkg.scripts.evalight, "bun evalight/server.mjs");
assert.equal(pkg.scripts.dev, "shadow-cljs watch app");

assert.equal(withEvalightScript("{not json"), "{not json");

console.log("pack.test.mjs ok");
