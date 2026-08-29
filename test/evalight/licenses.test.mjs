/**
 * License collector: what is actually shipped in the Evalight UI,
 * allowlist behaviour, and the export split (Evalight MIT at zip root,
 * third-party notices only next to the compiled workshop JS).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkReport,
  collectDistributed,
  licenseAllowed,
  loadAllowlist,
} from "../../scripts/licenses.mjs";
import { fallbackManifest, packEvalight } from "../../scripts/evalight-pack.mjs";

const root = join(import.meta.dir, "../..");
const allow = new Set(loadAllowlist(root).allowed);

assert.equal(licenseAllowed("MIT", allow), true);
assert.equal(licenseAllowed("EPL-2.0", allow), true);
assert.equal(licenseAllowed("(MIT OR GPL-3.0-or-later)", allow), true);
assert.equal(licenseAllowed("(MIT AND Zlib)", allow), true);
assert.equal(licenseAllowed("GPL-3.0-or-later", allow), false);
assert.equal(licenseAllowed("AGPL-3.0", allow), false);

const { npm, maven, report } = (() => {
  const r = collectDistributed(root);
  return { npm: r.npm, maven: r.maven, report: r };
})();

const npmNames = new Set(npm.map((p) => p.name));
const mavenNames = new Set(maven.map((p) => p.name));

assert.equal(npmNames.has("@codemirror/state"), true);
assert.equal(npmNames.has("@nextjournal/clojure-mode"), true);
assert.equal(npmNames.has("parinfer"), true);
assert.equal(npmNames.has("jszip"), true);
assert.equal(npmNames.has("squint-cljs"), true);
assert.equal(npmNames.has("pako"), true);

assert.equal(npmNames.has("puppeteer-core"), false, "puppeteer is a test dep, not bundled");
assert.equal(npmNames.has("shadow-cljs"), false, "the compiler is not in the browser JS");
assert.equal(npmNames.has("chokidar"), false, "squint's CLI watcher is not imported");

const jszip = npm.find((p) => p.name === "jszip");
assert.equal(jszip.spdx, "MIT");
assert.equal(jszip.originalSpdx, "(MIT OR GPL-3.0-or-later)");
assert.equal(/GNU GENERAL PUBLIC LICENSE/.test(jszip.text), false);

const clojureMode = npm.find((p) => p.name === "@nextjournal/clojure-mode");
assert.equal(clojureMode.spdx, "EPL-2.0");

const replicant = maven.find((p) => p.name === "no.cjohansen/replicant");
assert.ok(replicant, "replicant missing from Clojure runtime list");
assert.equal(replicant.spdx, "MIT");
assert.equal(/Christian Johansen/.test(replicant.text), true);
assert.equal(/^EPL$/i.test(replicant.spdx), false);

assert.equal(mavenNames.has("org.babashka/sci"), true);
assert.equal(mavenNames.has("borkdude/edamame"), true);
assert.equal(mavenNames.has("org.clojure/clojurescript"), true);
assert.equal(mavenNames.has("org.clojure/google-closure-library"), true);
assert.equal(mavenNames.has("org.clojure/clojure"), false, "JVM Clojure is not in the JS bundle");

const problems = checkReport(report);
assert.deepEqual(problems, []);

const md = readFileSync(join(root, "THIRD_PARTY_LICENSES.md"), "utf8");
assert.match(md, /Evalight itself is MIT/);
assert.match(md, /@nextjournal\/clojure-mode/);
assert.match(md, /org\.babashka\/sci/);
assert.doesNotMatch(md, /puppeteer-core/);

const html = readFileSync(join(root, "public/licenses.html"), "utf8");
assert.match(html, /Open source licenses/);
assert.match(html, /violetpurpleish/);
assert.match(html, /org\.babashka\/sci/);

const packed = await packEvalight(root, { requireJs: false });
assert.ok(packed["evalight/public/licenses.html"].includes("Open source licenses"));
assert.equal(
  fallbackManifest().files.some((f) => f.zip === "evalight/public/licenses.html"),
  true,
);

console.log("licenses.test.mjs ok", { npm: npm.length, maven: maven.length });
