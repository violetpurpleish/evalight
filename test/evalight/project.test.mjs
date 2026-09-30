import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyProject, detectProject, gpuiMainFromDeps } from "../../src/evalight/embed/project.mjs";
import { isUserProject } from "../../src/evalight/embed/compiled.mjs";

const gpuiDeps = `{:paths ["src"]
 :deps {clj-gpui/clj-gpui {:local/root "../.."}}
 :aliases {:dev {:main-opts ["-m" "gpui.dev" "my.app/app"]}}}`;

assert.deepEqual(
  classifyProject({
    evalightEdn: `{:name "counter" :main my.app/app :runtime :gpui :preview {:kind :native}}`,
  }),
  { kind: "gpui", preview: "native", mainNs: "my.app/app" },
);

assert.deepEqual(
  classifyProject({ evalightEdn: `{:name "lib" :main my.lib :runtime :clj}` }),
  { kind: "clj", preview: "none", mainNs: "my.lib" },
);

assert.equal(classifyProject({ evalightEdn: `{:main app.core :runtime :cljs}` }).kind, "cljs");
assert.equal(classifyProject({ evalightEdn: `{:main app.core :runtime :cljs}` }).preview, "iframe");

assert.equal(classifyProject({ hasGpuiEdn: true, gpuiEdn: `{:main my.app/app}` }).kind, "gpui");
assert.equal(classifyProject({ depsEdn: gpuiDeps }).kind, "gpui");
assert.equal(classifyProject({ depsEdn: gpuiDeps }).preview, "native");
assert.equal(classifyProject({ depsEdn: gpuiDeps }).mainNs, "my.app/app");
assert.equal(
  gpuiMainFromDeps(`:aliases {:dev {:main-opts ["-m" "gpui.dev" "todomvc.app/app"]}}`),
  "todomvc.app/app",
);
assert.equal(
  classifyProject({
    depsEdn: `{:paths ["src"]
 :deps {clj-gpui/clj-gpui {:local/root "../.."}}
 :aliases {:dev {:extra-deps {nrepl/nrepl {:mvn/version "1.3.1"}}
                 :main-opts ["-m" "gpui.dev" "todomvc.app/app"]}}}`,
  }).mainNs,
  "todomvc.app/app",
  "todomvc-style :main-opts without evalight.edn",
);
assert.equal(classifyProject({ depsEdn: `{:deps {foo {:mvn/version "1"}} :aliases {:dev {:main-opts ["-m" "gpui.dev"]}}}` }).kind, "gpui");

assert.equal(
  classifyProject({
    shadowEdn: `{:builds {:workshop {} :app {}}}`,
    evalightEdn: "",
  }).kind,
  "workshop",
  "Evalight checkout has :workshop even though it also has :app",
);

assert.equal(
  classifyProject({
    shadowEdn: `{:builds {:app {:target :browser}}}`,
    evalightEdn: `{:main app.core}`,
  }).kind,
  "cljs",
);

assert.equal(
  classifyProject({ evalightEdn: `{:name "lamp" :main app.core}` }).kind,
  "cljs",
  "evalight.edn :main without :runtime is still a ClojureScript lamp",
);

assert.equal(classifyProject({ depsEdn: `{:paths ["src"] :deps {}}` }).kind, "clj");
assert.equal(classifyProject({ depsEdn: `{:paths ["src"] :deps {}}` }).preview, "none");
assert.equal(classifyProject({ projectClj: `(defproject x "0.1.0")` }).kind, "clj");
assert.equal(classifyProject({}).kind, "none");

const nativeShadow = `{:deps {:aliases [:cljs]}
 :builds {:app {:target :node-script :output-to "target/app.js" :main my.app/main
                :devtools {:after-load my.app/reload!}}}}`;
assert.deepEqual(classifyProject({ depsEdn: gpuiDeps, shadowEdn: nativeShadow,
  gpuiEdn: `{:backend :cljs :cljs-build :app :cljs-output "target/app.js"}` }),
  { kind: "gpui", preview: "native", backend: "cljs", mainNs: "my.app/main", buildId: "app", outputTo: "target/app.js" });
assert.equal(classifyProject({ depsEdn: gpuiDeps, shadowEdn: nativeShadow }).backend, "cljs");
assert.equal(classifyProject({ shadowEdn: nativeShadow.replace(':deps {:aliases [:cljs]}', ':source-paths ["src" "../clj-gpui/src"]') }).kind, "gpui");
assert.equal(classifyProject({ depsEdn: gpuiDeps, shadowEdn: nativeShadow,
  evalightEdn: `{:runtime :cljs :preview {:kind :native}}` }).backend, "cljs");
assert.equal(classifyProject({ depsEdn: gpuiDeps, shadowEdn: nativeShadow,
  evalightEdn: `{:runtime :clj}` }).backend, undefined, "explicit JVM override wins");
assert.equal(classifyProject({ hasGpuiEdn: true, shadowEdn: `{:builds {:app {:target :browser}}}` }).backend, undefined,
  "a browser build does not change the JVM GPUI path");
assert.equal(classifyProject({ gpuiEdn: `{:description ":backend :cljs"}` }).backend, undefined,
  "strings do not select the CLJS backend");
assert.equal(classifyProject({ depsEdn: gpuiDeps, shadowEdn: nativeShadow,
  evalightEdn: `{:runtime :gpui :cljs-build :missing}` }).backend, "cljs",
  "an invalid explicit CLJS selection must report a build error instead of starting JVM Clojure");

assert.equal(
  classifyProject({
    evalightEdn: `{:runtime :clj :preview {:kind :iframe} :main user}`,
  }).preview,
  "iframe",
  "evalight.edn :preview :kind overrides the default",
);

assert.equal(
  classifyProject({
    shadowEdn: `{:builds {:app {}}}`,
    depsEdn: gpuiDeps,
  }).kind,
  "gpui",
  "clj-gpui markers beat a stray shadow-cljs.edn",
);

const root = join(import.meta.dir, "../..");
const here = await detectProject(root);
assert.equal(here.kind, "workshop");
assert.equal(await isUserProject(root), false, "Evalight itself must stay on SCI");

const dir = mkdtempSync(join(tmpdir(), "evalight-kind-"));
writeFileSync(join(dir, "evalight.edn"), `{:name "demo" :main my.app/app :runtime :gpui}\n`);
writeFileSync(join(dir, "deps.edn"), gpuiDeps);
assert.equal((await detectProject(dir)).kind, "gpui");
assert.equal(await isUserProject(dir), false, "clj-gpui is not a shadow-cljs user project");

const cljsDir = mkdtempSync(join(tmpdir(), "evalight-cljs-"));
writeFileSync(join(cljsDir, "evalight.edn"), `{:name "lamp" :main app.core}\n`);
writeFileSync(join(cljsDir, "shadow-cljs.edn"), `{:builds {:app {:target :browser}}}\n`);
assert.equal((await detectProject(cljsDir)).kind, "cljs");
assert.equal(await isUserProject(cljsDir), true);

const cljDir = mkdtempSync(join(tmpdir(), "evalight-clj-"));
mkdirSync(join(cljDir, "src"), { recursive: true });
writeFileSync(join(cljDir, "deps.edn"), `{:paths ["src"] :deps {org.clojure/clojure {:mvn/version "1.12.0"}}}\n`);
assert.equal((await detectProject(cljDir)).kind, "clj");
assert.equal(await isUserProject(cljDir), false);

console.log("project.test.mjs ok");
