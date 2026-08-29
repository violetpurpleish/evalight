import assert from "node:assert/strict";
import { overlayShadowEdn, parseEvalightEdn, stripTopKey } from "../../src/evalight/embed/compiled.mjs";

const src = `{:source-paths ["src"]
 :dependencies [[no.cjohansen/replicant "2026.07.1"]]
 :dev-http {3456 "public"}
 :nrepl {:port 7888}
 :node-modules {:managed-by :bun}
 :builds
 {:app {:target :browser
        :output-dir "public/js"
        :asset-path "/js"
        :modules {:main {:init-fn app.core/init}}}}}
`;

const out = overlayShadowEdn(src, { nreplPort: 7878, shadowHttp: 9641, appPort: 48751 });
assert.equal(out.includes(":dev-http {3456"), false, "old :dev-http must be stripped");
assert.equal(out.includes(":nrepl {:port 7888}"), false, "old :nrepl must be stripped");
assert.ok(out.includes(":nrepl {:port 7878}"));
assert.ok(out.includes(':http {:host "127.0.0.1" :port 9641}'));
assert.ok(out.includes(":dev-http {48751 \"public\"}"));
assert.ok(out.includes(":devtools {:autoload false}"));
assert.ok(out.includes(":source-paths"));
assert.ok(out.includes(":builds"));

const noHttp = stripTopKey(`{:nrepl {:port 1} :builds {}}`, "nrepl");
assert.equal(noHttp.includes(":nrepl"), false);

const intel = parseEvalightEdn(
  `{:ns "app.core" :items [{:name "stats/record!" :kind "var" :ns "app.stats" :doc "Bump the stats tally." :macro false :arglists "([])"}]}`,
);
assert.equal(intel.ns, "app.core");
assert.equal(intel.items[0].name, "stats/record!");
assert.equal(intel.items[0].doc, "Bump the stats tally.");
assert.equal(parseEvalightEdn("nil"), null);

console.log("overlay.test.mjs ok");
