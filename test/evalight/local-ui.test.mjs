import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWatchLoaderJs, serveLocalUi } from "../../src/evalight/embed/static.mjs";

assert.equal(isWatchLoaderJs("SHADOW_ENV.evalLoad(src)"), true);
assert.equal(isWatchLoaderJs("COMPILED=!0;var evalight=1"), false);

const dir = mkdtempSync(join(tmpdir(), "evalight-local-ui-"));
mkdirSync(join(dir, "evalight-ui/js"), { recursive: true });
mkdirSync(join(dir, "public/js"), { recursive: true });
writeFileSync(join(dir, "public/index.html"), `<script src="/js/main.js"></script>`);
writeFileSync(join(dir, "public/js/main.js"), `SHADOW_ENV.evalLoad("cljs-runtime/evalight.core.js");`);
writeFileSync(join(dir, "evalight-ui/js/main.js"), `COMPILED=!0;console.log("workshop-release");`);

const js = await serveLocalUi(dir, "/js/main.js");
assert.equal(js.status, 200);
const body = await js.text();
assert.ok(body.includes("workshop-release"));
assert.ok(!body.includes("SHADOW_ENV"));

const html = await serveLocalUi(dir, "/");
assert.equal(html.status, 200);
assert.ok((await html.text()).includes("/js/main.js"));

const missing = mkdtempSync(join(tmpdir(), "evalight-local-ui-miss-"));
mkdirSync(join(missing, "public/js"), { recursive: true });
writeFileSync(join(missing, "public/js/main.js"), `SHADOW_ENV.evalLoad("x");`);
const refused = await serveLocalUi(missing, "/js/main.js");
assert.equal(refused.status, 503);
assert.match(await refused.text(), /evalight-ui/);

console.log("local-ui.test.mjs ok");
