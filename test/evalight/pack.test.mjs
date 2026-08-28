import { expect, test } from "bun:test";
import { join } from "node:path";
import { packEvalight, withEvalightScript } from "../../scripts/evalight-pack.mjs";

const root = join(import.meta.dir, "../..");

test("pack includes the embedded server and workshop HTML", async () => {
  const files = await packEvalight(root, { requireJs: false });
  expect(files["evalight/server.mjs"]).toContain("bun evalight/server.mjs");
  expect(files["evalight/server.mjs"]).toContain("SKIP");
  expect(files["evalight/public/index.html"]).toContain("/js/main.js");
  expect(files["evalight/public/preview.html"]).toContain("preview");
  expect(files["evalight/public/css/evalight.css"]).toBeTruthy();
  expect(files["evalight/public/js/main.js"]).toBeUndefined();
});

test("withEvalightScript adds bun run evalight", () => {
  const out = withEvalightScript(`{"name":"lamp","scripts":{"dev":"shadow-cljs watch app"}}`);
  const pkg = JSON.parse(out);
  expect(pkg.scripts.evalight).toBe("bun evalight/server.mjs");
  expect(pkg.scripts.dev).toBe("shadow-cljs watch app");
});

test("withEvalightScript leaves broken JSON alone", () => {
  expect(withEvalightScript("{not json")).toBe("{not json");
});
