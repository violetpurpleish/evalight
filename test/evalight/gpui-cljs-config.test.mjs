import assert from "node:assert/strict";
import { ednValue, readEdn } from "../../src/evalight/embed/edn.mjs";
import { absoluteProjectPaths, nativeShadowEdn, nodeBuildInfo } from "../../src/evalight/embed/gpui-cljs-config.mjs";

const source = `{:source-paths ["src" "../clj-gpui/src"]
 :nrepl {:port 7888} :http {:port 9630} :dev-http {3456 "public"}
 :builds {:app {:target :node-script :output-to "target/app.js" :main example.app/main
                :devtools {:after-load example.app/reload!}}
          :other {:target :node-script :output-to "other.js" :main other/main}}}
 ; a trailing comment with } must not become the insertion point`;
assert.equal(nodeBuildInfo(source).buildId, "app");
assert.equal(nodeBuildInfo(source, "other").mainNs, "other/main");
assert.equal(nodeBuildInfo(source, "missing"), null);
assert.equal(nodeBuildInfo(source.replaceAll(":app", ":one")), null, "multiple builds require an explicit selection");
assert.equal(nodeBuildInfo(`{:builds {:custom {:target :node-script :main custom/main :output-to "app.js"}}}`).buildId, "custom");

const overlay = ednValue(readEdn(nativeShadowEdn(source, "/tmp/project", { nreplPort: 9876, shadowHttp: 9877 })));
assert.deepEqual(overlay["source-paths"], ["/tmp/project/src", "/tmp/clj-gpui/src"]);
assert.equal(overlay.builds.app["output-to"], "/tmp/project/target/app.js");
assert.equal(overlay.builds.app.devtools["after-load"], "example.app/reload!");
assert.equal(overlay.builds.app.devtools.autoload, undefined, "shadow must keep native hot reload enabled");
assert.equal(overlay.nrepl.port, 9876);
assert.equal(overlay.nrepl.host, "127.0.0.1");
assert.equal(overlay["dev-http"], undefined, "native builds need no app HTTP server");
assert.equal(overlay["cache-root"], ".shadow-cljs", "compiler caches stay in the temporary root");
assert.equal(ednValue(readEdn(nativeShadowEdn(source.replace(':source-paths', ':cache-root "shared-cache" :source-paths'),
  "/tmp/project", { nreplPort: 9876, shadowHttp: 9877 })))["cache-root"], ".shadow-cljs");
const deps = ednValue(readEdn(absoluteProjectPaths(`{:paths ["src" "resources"]
 :deps {clj-gpui/clj-gpui {:local/root "../clj-gpui"}}
 :aliases {:cljs {:extra-paths ["macros"]}}}`, "/tmp/project")));
assert.equal(deps.deps["clj-gpui/clj-gpui"]["local/root"], "/tmp/clj-gpui");
assert.deepEqual(deps.paths, ["/tmp/project/src", "/tmp/project/resources"]);
assert.deepEqual(deps.aliases.cljs["extra-paths"], ["/tmp/project/macros"]);
assert.equal(ednValue(readEdn('{:x 1 #_ [:ignored] ; comment\n}')).x, 1);
assert.throws(() => readEdn("{:builds {"), /Unterminated|end/);
assert.throws(() => readEdn('{:name "unterminated}'), /Unterminated/);
assert.throws(() => nativeShadowEdn("[]", "/tmp/project", {}), /map/);
console.log("gpui-cljs-config.test.mjs ok");
