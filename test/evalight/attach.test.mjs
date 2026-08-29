import assert from "node:assert/strict";
import {
  attachLabel,
  parseEvalightArgs,
  parseNreplPort,
  resolveAttachTarget,
} from "../../src/evalight/embed/compiled.mjs";

const owned = parseEvalightArgs(["bun", "evalight/server.mjs"]);
assert.equal(owned.attach, false);
assert.equal(owned.previewUrl, null);
assert.equal(owned.nreplPort, null);
assert.deepEqual(owned.positional, []);

const withAttach = parseEvalightArgs([
  "bun",
  "evalight/server.mjs",
  "--attach",
  "--preview-url=http://127.0.0.1:3456/",
  "--nrepl-port=7888",
]);
assert.equal(withAttach.attach, true);
assert.equal(withAttach.previewUrl, "http://127.0.0.1:3456/");
assert.equal(withAttach.nreplPort, 7888);

const split = parseEvalightArgs([
  "bun",
  "scripts/local-server.mjs",
  "--attach",
  "--preview-url",
  "http://127.0.0.1:3456/",
  "/tmp/lamp",
]);
assert.equal(split.attach, true);
assert.equal(split.previewUrl, "http://127.0.0.1:3456/");
assert.deepEqual(split.positional, ["/tmp/lamp"]);

const dashed = parseEvalightArgs(["bun", "evalight/server.mjs", "--", "--attach"]);
assert.equal(dashed.attach, true);

assert.throws(
  () => parseEvalightArgs(["bun", "x", "--preview-url=http://127.0.0.1:3456/"]),
  /only apply with --attach/,
);
assert.throws(
  () => parseEvalightArgs(["bun", "x", "--nope"]),
  /Unknown flag/,
);

assert.equal(resolveAttachTarget({ attach: false, nreplFromFile: 7888 }).mode, "owned");
assert.equal(
  resolveAttachTarget({
    attach: false,
    nreplFromFile: 7888,
    previewFromDevHttp: 3456,
  }).mode,
  "owned",
);

const joined = resolveAttachTarget({
  attach: true,
  nreplFromFile: 7888,
  previewFromDevHttp: 3456,
});
assert.equal(joined.mode, "attach");
assert.equal(joined.nreplPort, 7888);
assert.equal(joined.previewUrl, "http://127.0.0.1:3456/");

const flagged = resolveAttachTarget({
  attach: true,
  nreplFromFlag: 7879,
  nreplFromFile: 7888,
  previewFromFlag: "http://127.0.0.1:9000/",
  previewFromDevHttp: 3456,
});
assert.equal(flagged.nreplPort, 7879);
assert.equal(flagged.previewUrl, "http://127.0.0.1:9000/");

assert.equal(
  resolveAttachTarget({
    attach: true,
    nreplFromEdn: 7880,
    previewFromDevHttp: 3456,
  }).nreplPort,
  7880,
);

assert.throws(
  () => resolveAttachTarget({ attach: true }),
  /--nrepl-port/,
);
assert.throws(
  () => resolveAttachTarget({ attach: true, nreplFromFlag: 7888 }),
  /--preview-url/,
);

assert.equal(
  parseNreplPort(`{:nrepl {:port 7880}\n :dev-http {3456 "public"}}`),
  7880,
);
assert.equal(parseNreplPort(`{:dev-http {3456 "public"}}`), null);

assert.equal(
  attachLabel({ buildId: ":app", previewUrl: "http://127.0.0.1:3456/" }),
  "Attached · :app · localhost:3456",
);

console.log("attach.test.mjs ok");
