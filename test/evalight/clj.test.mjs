import assert from "node:assert/strict";
import {
  cljAttachLabel,
  cljBin,
  cljIntelForm,
  gpuiDevArgs,
  nreplCmdlineArgs,
  PREVIEW_PNG_FORM,
  resolveCljAttach,
} from "../../src/evalight/embed/clj.mjs";

assert.deepEqual(gpuiDevArgs(), ["-M:dev"]);
assert.ok(nreplCmdlineArgs(7888).includes("nrepl.cmdline"));
assert.ok(nreplCmdlineArgs(7888).includes("7888"));

assert.equal(resolveCljAttach({ attach: false, nreplFromFile: 7888 }).mode, "owned");

const joined = resolveCljAttach({
  attach: true,
  nreplFromFile: 7888,
});
assert.equal(joined.mode, "attach");
assert.equal(joined.nreplPort, 7888);

assert.equal(
  resolveCljAttach({
    attach: true,
    nreplFromFlag: 7879,
    nreplFromFile: 7888,
  }).nreplPort,
  7879,
);

assert.throws(
  () => resolveCljAttach({ attach: true }),
  /nREPL/,
);

assert.equal(
  cljAttachLabel({ nreplPort: 7888, kind: "gpui" }),
  "Attached · GPUI · nREPL 7888",
);
assert.equal(
  cljAttachLabel({ nreplPort: 7888, kind: "clj" }),
  "Attached · Clojure · nREPL 7888",
);

const intel = cljIntelForm("my.app");
assert.ok(intel.includes("ns-interns"));
assert.ok(intel.includes("ns-refers"));
assert.ok(intel.includes("ns-aliases"));
assert.match(intel, /pack s v "core"/);
assert.ok(!intel.includes("compiler-env"));
assert.ok(!intel.includes("nrepl-select"));
assert.match(intel, /ns-sym 'my\.app/);

const safe = cljIntelForm("user; (println :nope)");
assert.match(safe, /ns-sym 'user\b/);

assert.ok(PREVIEW_PNG_FORM.includes("gpui.runtime/preview-png"));
const bin = cljBin();
assert.ok(bin === null || typeof bin === "string");
if (Bun.which("clojure") && Bun.which("clj")) {
  assert.match(cljBin(), /clojure$/);
}

console.log("clj.test.mjs ok");
