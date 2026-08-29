import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVALIGHT_BUILD } from "../../src/evalight/embed/build-id.mjs";
import { cljsBuildId } from "../../scripts/evalight-build.mjs";
import { isUserProject } from "../../src/evalight/embed/compiled.mjs";

const root = join(import.meta.dir, "../..");
assert.equal(EVALIGHT_BUILD, cljsBuildId(root));
assert.equal(
  EVALIGHT_BUILD,
  readFileSync(join(root, "src/evalight/build.cljs"), "utf8").match(/\(def id "([^"]+)"\)/)[1],
);

assert.equal(await isUserProject(root), false, "Evalight itself must stay on SCI");

console.log("build-id.test.mjs ok");
