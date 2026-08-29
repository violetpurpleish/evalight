import assert from "node:assert/strict";
import { join } from "node:path";
import { isUserProject } from "../../src/evalight/embed/compiled.mjs";

const root = join(import.meta.dir, "../..");
assert.equal(await isUserProject(root), false, "Evalight itself must stay on SCI");

console.log("build-id.test.mjs ok");
