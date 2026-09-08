#!/usr/bin/env bun
/**
 * Collect licenses for third-party code that Evalight actually ships in
 * the browser UI (hosted playground and the compiled workshop JS copied
 * into an Export ZIP).
 *
 * bun run licenses         write THIRD_PARTY_LICENSES.md and public/licenses.html
 * bun run licenses --check fail on a disallowed SPDX id, missing text, or stale artifacts
 *
 * Not in this report:
 *   - npm / Maven packages that are only declared for later install
 *     (shadow-cljs, puppeteer-core, a user's replicant after bun install)
 *   - squint's chokidar tree (CLI watcher; clojure-mode imports squint's
 *     core.js runtime, not the CLI)
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const OVERRIDE_DIR = join(ROOT, "scripts/license-overrides");
const MD_PATH = join(ROOT, "THIRD_PARTY_LICENSES.md");
const HTML_PATH = join(ROOT, "public/licenses.html");

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "dns", "domain", "events", "fs", "http", "https",
  "module", "net", "os", "path", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "timers", "tls", "tty",
  "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

const LICENSE_NAMES = [
  "LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE.markdown",
  "LICENCE", "LICENCE.md", "license", "license.md",
  "COPYING", "COPYING.md", "NOTICE", "NOTICE.txt",
];

export function loadAllowlist(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "scripts/licenses-allowlist.json"), "utf8"));
}

function stripOuterParens(s) {
  let t = s.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0;
    let ok = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")") {
        depth--;
        if (depth === 0 && i !== t.length - 1) {
          ok = false;
          break;
        }
      }
    }
    if (!ok || depth !== 0) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

function splitTop(expr, op) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const re = new RegExp(`\\s+${op}\\s+`, "ig");
  let m;
  const src = expr;
  while ((m = re.exec(src))) {
    const at = m.index;
    depth = 0;
    for (let i = 0; i < at; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    if (depth === 0) {
      parts.push(src.slice(start, at).trim());
      start = at + m[0].length;
    }
  }
  parts.push(src.slice(start).trim());
  return parts.filter(Boolean);
}

/** True if every AND-clause / some OR-clause is on the allowlist. */
export function licenseAllowed(expr, allowed) {
  if (!expr || expr === "(none)") return false;
  const set = allowed instanceof Set ? allowed : new Set(allowed);
  const inner = stripOuterParens(expr);
  const orParts = splitTop(inner, "OR");
  if (orParts.length > 1) return orParts.some((p) => licenseAllowed(p, set));
  const andParts = splitTop(inner, "AND");
  if (andParts.length > 1) return andParts.every((p) => licenseAllowed(p, set));
  return set.has(inner.trim());
}

function electLicense(expr, elect) {
  if (!elect) return expr;
  const inner = stripOuterParens(expr);
  const orParts = splitTop(inner, "OR");
  if (orParts.length > 1 && orParts.some((p) => stripOuterParens(p) === elect)) {
    return elect;
  }
  return expr;
}

function readOverrideFile(name) {
  const p = join(OVERRIDE_DIR, name);
  if (!existsSync(p)) throw new Error(`Missing license override ${name}`);
  return readFileSync(p, "utf8").replace(/\r\n/g, "\n").trim();
}

function findLicenseFile(dir) {
  try {
    const names = readdirSync(dir);
    for (const want of LICENSE_NAMES) {
      const hit = names.find((n) => n === want);
      if (hit) return join(dir, hit);
    }
    const loose = names.find((n) => /^licen[cs]e/i.test(n) && !n.endsWith(".js"));
    if (loose) return join(dir, loose);
  } catch {
    return null;
  }
  return null;
}

function pkgLicenseField(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]) {
    return pkg.licenses.map((l) => (typeof l === "string" ? l : l.type)).filter(Boolean).join(" OR ");
  }
  if (pkg.license && typeof pkg.license === "object" && pkg.license.type) {
    return pkg.license.type;
  }
  return "(none)";
}

function resolveNodePackage(fromDir, name) {
  let dir = fromDir;
  while (true) {
    const candidate = join(dir, "node_modules", name);
    const pkgJson = join(candidate, "package.json");
    if (existsSync(pkgJson)) {
      return { dir: realpathSync(candidate), pkg: JSON.parse(readFileSync(pkgJson, "utf8")) };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function entryFromPackage(pkg, pkgDir, subpath) {
  if (!subpath || subpath === ".") {
    const exp = pkg.exports;
    if (typeof exp === "string") return join(pkgDir, exp);
    if (exp && typeof exp === "object") {
      const main = exp["."] ?? exp["./"] ?? exp["import"] ?? exp["require"];
      if (typeof main === "string") return join(pkgDir, main);
      if (main && typeof main === "object") {
        const inner = main.import || main.require || main.default || main.browser;
        if (typeof inner === "string") return join(pkgDir, inner);
      }
    }
    const file = pkg.module || pkg.main;
    if (file) return join(pkgDir, file);
    return join(pkgDir, "index.js");
  }
  const exp = pkg.exports;
  const key = subpath.startsWith(".") ? subpath : `./${subpath}`;
  if (exp && typeof exp === "object" && exp[key]) {
    const v = exp[key];
    if (typeof v === "string") return join(pkgDir, v);
    if (v && typeof v === "object") {
      const inner = v.import || v.require || v.default;
      if (typeof inner === "string") return join(pkgDir, inner);
    }
  }
  return join(pkgDir, subpath);
}

function isDir(p) {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

function withJsExt(p) {
  if (!p) return null;
  const tryFile = (q) => {
    if (existsSync(q) && !isDir(q)) return q;
    return null;
  };
  const hit = tryFile(p)
    || tryFile(p + ".js")
    || tryFile(p + ".mjs")
    || tryFile(p + ".cjs")
    || tryFile(p + ".json");
  if (hit) return hit;
  if (existsSync(p) && isDir(p)) {
    return tryFile(join(p, "index.js"))
      || tryFile(join(p, "index.mjs"))
      || tryFile(join(p, "index.cjs"));
  }
  return null;
}

function resolveFile(fromFile, spec) {
  if (!spec || spec.startsWith("node:") || NODE_BUILTINS.has(spec.split("/")[0])) {
    return null;
  }
  const fromDir = dirname(fromFile);
  if (spec.startsWith(".")) {
    return withJsExt(join(fromDir, spec));
  }
  const parts = spec.startsWith("@") ? spec.split("/") : [spec.split("/")[0], ...spec.split("/").slice(1)];
  const pkgName = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const sub = spec.startsWith("@") ? parts.slice(2).join("/") : parts.slice(1).join("/");
  const resolved = resolveNodePackage(fromDir, pkgName);
  if (!resolved) return null;
  const file = entryFromPackage(resolved.pkg, resolved.dir, sub || ".");
  return withJsExt(file);
}

const IMPORT_RE = /(?:import|export)\s+(?:[^'"\n]+from\s+)?["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\)|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function scanImports(source) {
  const out = [];
  let m;
  const re = new RegExp(IMPORT_RE.source, "g");
  while ((m = re.exec(source))) {
    const spec = m[1] || m[2] || m[3];
    if (spec) out.push(spec);
  }
  return out;
}

function packageNameOf(file, root) {
  const rel = relative(join(root, "node_modules"), file).replaceAll("\\", "/");
  if (rel.startsWith("..") || rel.startsWith("/")) return null;
  const parts = rel.split("/");
  if (parts[0].startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0];
}

const CLJS_NS = /^(cljs|clojure|evalight|ui|sci|replicant)[./]/;

function cljsJsRequires(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (isDir(p)) {
        walk(p);
        continue;
      }
      if (!/\.(cljs|cljc|js)$/.test(name)) continue;
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/\["(@?[^"\]]+)"/g)) {
        const spec = m[1];
        if (spec.startsWith(".") || spec.includes(" ") || CLJS_NS.test(spec)) continue;
        if (spec.startsWith("@") || spec.includes("/") || spec === "jszip" || spec === "parinfer") {
          out.push(spec);
        }
      }
      for (const m of text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
        if (!m[1].startsWith(".")) out.push(m[1]);
      }
    }
  };
  walk(join(root, "src"));
  return [...new Set(out)];
}

function collectNpm(root) {
  const entries = cljsJsRequires(root);
  const files = new Set();
  const queue = [];
  const pkgs = new Map();

  const enqueueSpec = (fromFile, spec) => {
    const resolved = resolveFile(fromFile, spec);
    if (resolved && !files.has(resolved)) {
      files.add(resolved);
      queue.push(resolved);
    }
  };

  const seedFrom = join(root, "src/evalight/editor.cljs");
  for (const spec of entries) enqueueSpec(seedFrom, spec);

  while (queue.length) {
    const file = queue.shift();
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const name = packageNameOf(file, root);
    if (name && !pkgs.has(name)) {
      const resolved = resolveNodePackage(dirname(file), name);
      if (resolved) pkgs.set(name, resolved);
    }
    if (file.endsWith(".json")) continue;
    for (const spec of scanImports(text)) {
      enqueueSpec(file, spec);
    }
  }

  return pkgs;
}

function mavenRepo() {
  return join(process.env.HOME || "/root", ".m2/repository");
}

function mavenDir(coord, version) {
  const [group, artifact] = coord.split("/");
  return join(mavenRepo(), ...group.split("."), artifact, version);
}

function pomHomepage(pom) {
  const scm = pom.match(/<scm>[\s\S]*?<url>([^<]+)<\/url>/);
  if (scm) return scm[1];
  const urls = [...pom.matchAll(/<url>([^<]+)<\/url>/g)].map((m) => m[1]);
  return urls.find((u) => /github\.com|gitlab\.com/.test(u)) || urls[0] || "";
}

function parsePomLicense(pomText) {
  const block = pomText.match(/<licenses>[\s\S]*?<\/licenses>/);
  if (!block) return { name: "", url: "" };
  const name = (block[0].match(/<name>([^<]+)<\/name>/) || [])[1] || "";
  const url = (block[0].match(/<url>([^<]+)<\/url>/) || [])[1] || "";
  return { name, url };
}

function pomToSpdx(name, url) {
  const n = (name || "").toLowerCase();
  const u = (url || "").toLowerCase();
  if (u.includes("opensource.org/license/mit") || n === "mit" || n.includes("mit license")) return "MIT";
  if (n.includes("eclipse public license 1.0") || u.includes("eclipse-1.0") || u.includes("epl-1-0")) return "EPL-1.0";
  if (n.includes("eclipse public license 2") || u.includes("epl-2")) return "EPL-2.0";
  if (n.includes("apache") && (n.includes("2.0") || u.includes("apache.org/licenses/license-2.0"))) return "Apache-2.0";
  if (n === "epl") return null;
  return name || "(none)";
}

function unzipEntry(jar, entry) {
  const r = Bun.spawnSync(["unzip", "-p", jar, entry], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) return null;
  return Buffer.from(r.stdout).toString("utf8");
}

function jarLicenseText(jar) {
  if (!existsSync(jar)) return null;
  const r = Bun.spawnSync(["unzip", "-l", jar], { stdout: "pipe", stderr: "pipe" });
  const listing = Buffer.from(r.stdout).toString("utf8");
  const names = [...listing.matchAll(/\s(\S*LICEN[CS]E\S*|\S*NOTICE\S*)\s*$/gim)].map((m) => m[1]);
  const prefer = names.find((n) => /LICENSE$/i.test(n) && !n.includes("MANIFEST"))
    || names.find((n) => /LICENSE/i.test(n));
  if (!prefer) return null;
  return unzipEntry(jar, prefer);
}

const CLOJURE_RUNTIME = [
  "no.cjohansen/replicant",
  "org.babashka/sci",
  "borkdude/edamame",
  "org.babashka/sci.impl.types",
  "org.clojure/clojurescript",
  "org.clojure/google-closure-library",
];

// Read the jars Shadow actually resolved, not the newest-looking directory in
// the shared Maven cache (lexical ordering even puts 1.11.60 after 1.11.132).
export function runtimeVersionsFromClasspath(classpath) {
  const files = classpath.match(/:files\s+\[([^\]]*)\]/)?.[1] || "";
  const versions = {};
  for (const match of files.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    const file = JSON.parse(match[0]).replaceAll("\\", "/");
    for (const coord of CLOJURE_RUNTIME) {
      const [group, artifact] = coord.split("/");
      const prefix = `/${group.replaceAll(".", "/")}/${artifact}/`;
      const start = file.lastIndexOf(prefix);
      if (start < 0) continue;
      const [version, jar] = file.slice(start + prefix.length).split("/");
      if (jar === `${artifact}-${version}.jar`) versions[coord] = version;
    }
  }
  return versions;
}

function collectClojure(root) {
  const classpath = join(root, ".shadow-cljs/classpath.edn");
  if (!existsSync(classpath)) {
    throw new Error("Missing resolved Shadow classpath. Run a shadow-cljs compile before collecting licenses.");
  }
  const versions = runtimeVersionsFromClasspath(readFileSync(classpath, "utf8"));

  const pkgs = [];
  for (const coord of CLOJURE_RUNTIME) {
    const version = versions[coord];
    if (!version) {
      pkgs.push({
        kind: "maven",
        name: coord,
        version: "(missing)",
        spdx: "(none)",
        text: "",
        homepage: "",
        error: `No version on the classpath for ${coord}. Run a shadow-cljs compile so Maven jars are present.`,
      });
      continue;
    }
    const dir = mavenDir(coord, version);
    const artifact = coord.split("/")[1];
    const pomPath = join(dir, `${artifact}-${version}.pom`);
    const jarPath = join(dir, `${artifact}-${version}.jar`);
    const pom = existsSync(pomPath) ? readFileSync(pomPath, "utf8") : "";
    const { name, url } = pom ? parsePomLicense(pom) : { name: "", url: "" };
    let spdx = pomToSpdx(name, url) || "(none)";
    let text = jarLicenseText(jarPath) || "";
    const homepage = pomHomepage(pom);
    pkgs.push({
      kind: "maven",
      name: coord,
      version,
      spdx,
      text: text.replace(/\r\n/g, "\n").trim(),
      homepage,
      pomLicense: name,
      pomUrl: url,
    });
  }
  return pkgs;
}

function applyOverrides(pkg, allowlist) {
  const key = `${pkg.kind}:${pkg.name}`;
  const ov = allowlist.overrides?.[key];
  if (!ov) return pkg;
  const next = { ...pkg, override: ov };
  if (ov.spdx) next.spdx = ov.spdx;
  if (ov.elect) {
    next.originalSpdx = pkg.spdx;
    next.spdx = electLicense(pkg.spdx, ov.elect);
  }
  if (ov.file) next.text = readOverrideFile(ov.file);
  if (ov.note) next.note = ov.note;
  return next;
}

function npmRecord(name, { dir, pkg }, allowlist) {
  let spdx = pkgLicenseField(pkg);
  const licFile = findLicenseFile(dir);
  let text = licFile ? readFileSync(licFile, "utf8").replace(/\r\n/g, "\n").trim() : "";
  const rec = {
    kind: "npm",
    name,
    version: pkg.version || "",
    spdx,
    text,
    homepage: typeof pkg.homepage === "string"
      ? pkg.homepage
      : pkg.homepage?.url || pkg.repository?.url || "",
    licenseFile: licFile ? relative(ROOT, licFile) : "",
  };
  return applyOverrides(rec, allowlist);
}

function extraTexts(pkg) {
  const extra = [];
  if (/\bZlib\b/.test(pkg.originalSpdx || pkg.spdx) && !/zlib License/i.test(pkg.text) && pkg.text && !pkg.text.includes("jloup@gzip.org")) {
    extra.push({ spdx: "Zlib", text: readOverrideFile("Zlib.txt") });
  }
  return extra;
}

function mitStub(pkg) {
  const author = pkg.author
    || (pkg.name === "isarray" ? "Julian Gruber" : "the authors");
  return `MIT License\n\nCopyright (c) ${author}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
}

export function collectDistributed(root = ROOT) {
  const allowlist = loadAllowlist(root);
  const npmPkgs = collectNpm(root);
  const npm = [...npmPkgs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, info]) => npmRecord(name, info, allowlist));

  for (const pkg of npm) {
    if (!pkg.text && pkg.spdx === "MIT") {
      const resolved = npmPkgs.get(pkg.name);
      pkg.text = mitStub({ ...pkg, author: resolved?.pkg?.author?.name });
      pkg.note = (pkg.note ? pkg.note + " " : "") + "No LICENSE file in the package; SPDX is MIT, so the standard MIT text is shown.";
    }
    if (pkg.originalSpdx && pkg.spdx === "MIT" && pkg.text.includes("GPL version 3")) {
      const cut = pkg.text.split(/GPL version 3/i)[0].replace(/\n+$/, "").trim();
      pkg.text = cut.replace(/JSZip is dual licensed[\s\S]*?The MIT License\s*=+\s*/i, "").trim()
        || pkg.text;
    }
    const extras = extraTexts(pkg);
    if (extras.length) pkg.extra = extras;
  }

  const maven = collectClojure(root).map((p) => applyOverrides(p, allowlist));
  return { allowlist, npm, maven };
}

export const RUNTIME_FONTS = [
  { name: "Figtree", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Figtree" },
  { name: "Fraunces", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Fraunces" },
  { name: "IBM Plex Mono", license: "OFL-1.1", url: "https://fonts.google.com/specimen/IBM+Plex+Mono" },
];

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function allPackages(report) {
  return [...report.npm, ...report.maven];
}

export function checkReport(report) {
  const allowed = new Set(report.allowlist.allowed);
  const problems = [];
  const forbidden = ["puppeteer-core", "shadow-cljs", "chokidar"];
  for (const name of forbidden) {
    if (report.npm.some((p) => p.name === name)) {
      problems.push(`${name} is not shipped in the browser UI and should not be in this report`);
    }
  }
  for (const pkg of allPackages(report)) {
    const expr = pkg.originalSpdx || pkg.spdx;
    if (pkg.error) problems.push(`${pkg.name}: ${pkg.error}`);
    if (!licenseAllowed(expr, allowed) && !licenseAllowed(pkg.spdx, allowed)) {
      problems.push(`${pkg.name} ${pkg.version} uses ${expr}, which is not on the allowlist`);
    }
    if (!pkg.text) problems.push(`${pkg.name} ${pkg.version} has no license text`);
  }
  return problems;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Third-party licenses");
  lines.push("");
  lines.push("Evalight itself is MIT. Copyright (c) 2026 violetpurpleish & contributors. See `LICENSE`.");
  lines.push("");
  lines.push("This file covers third-party code **distributed in Evalight's browser UI**: the hosted playground and the compiled workshop JS that Export copies into `evalight/public/js`. It is generated by `bun run licenses`. Do not edit it by hand.");
  lines.push("");
  lines.push("An exported project's own `package.json` / `shadow-cljs.edn` may list shadow-cljs and replicant so `bun install` can compile that project later. Those later installs are not bundled in the ZIP, so they are not listed here. Copied `src/ui` and `evalight/*.mjs` are Evalight's MIT sources; see the project's `LICENSE`.");
  lines.push("");
  lines.push("## How to update this");
  lines.push("");
  lines.push("1. Add or upgrade a dependency as usual.");
  lines.push("2. Run `bun run licenses` to regenerate this file and `public/licenses.html`.");
  lines.push("3. If `bun run licenses --check` fails, the new SPDX id is not in `scripts/licenses-allowlist.json`. That is intentional. Confirm the license, then add it to `allowed` only if you mean to ship it.");
  lines.push("4. If a POM or `package.json` is wrong, add an override in that same file and put the real text under `scripts/license-overrides/`.");
  lines.push("");
  lines.push("## Packages");
  lines.push("");
  lines.push("| Package | Version | License | Kind |");
  lines.push("| --- | --- | --- | --- |");
  for (const pkg of allPackages(report)) {
    const spdx = pkg.originalSpdx && pkg.originalSpdx !== pkg.spdx
      ? `${pkg.spdx} (elected from ${pkg.originalSpdx})`
      : pkg.spdx;
    lines.push(`| ${pkg.name} | ${pkg.version} | ${spdx} | ${pkg.kind} |`);
  }
  lines.push("");
  lines.push("## Fonts loaded at runtime");
  lines.push("");
  lines.push("`public/index.html` loads Figtree, Fraunces, and IBM Plex Mono from Google Fonts. They are not files in this repository. Each is under the SIL Open Font License 1.1.");
  lines.push("");
  lines.push("## License texts");
  lines.push("");
  for (const pkg of allPackages(report)) {
    lines.push(`### ${pkg.name} ${pkg.version}`);
    lines.push("");
    if (pkg.note) lines.push(`${pkg.note}`);
    if (pkg.note) lines.push("");
    if (pkg.homepage) lines.push(`${pkg.homepage}`);
    if (pkg.homepage) lines.push("");
    lines.push("```");
    lines.push(pkg.text);
    lines.push("```");
    lines.push("");
    for (const extra of pkg.extra || []) {
      lines.push(`#### Also ${extra.spdx}`);
      lines.push("");
      lines.push("```");
      lines.push(extra.text);
      lines.push("```");
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

function renderHtml(report) {
  const rows = allPackages(report).map((pkg) => {
    const spdx = pkg.originalSpdx && pkg.originalSpdx !== pkg.spdx
      ? `${escapeHtml(pkg.spdx)} <span class="elect">(elected from ${escapeHtml(pkg.originalSpdx)})</span>`
      : escapeHtml(pkg.spdx);
    const id = `pkg-${pkg.kind}-${pkg.name.replace(/[^a-z0-9]+/gi, "-")}`;
    return `<tr><td><a href="#${id}">${escapeHtml(pkg.name)}</a></td><td>${escapeHtml(pkg.version)}</td><td>${spdx}</td><td>${pkg.kind}</td></tr>`;
  }).join("\n");

  const bodies = allPackages(report).map((pkg) => {
    const id = `pkg-${pkg.kind}-${pkg.name.replace(/[^a-z0-9]+/gi, "-")}`;
    const note = pkg.note ? `<p class="note">${escapeHtml(pkg.note)}</p>` : "";
    const home = pkg.homepage
      ? `<p class="home"><a href="${escapeHtml(pkg.homepage)}">${escapeHtml(pkg.homepage)}</a></p>`
      : "";
    const extras = (pkg.extra || []).map((e) =>
      `<h3>Also ${escapeHtml(e.spdx)}</h3><pre>${escapeHtml(e.text)}</pre>`,
    ).join("\n");
    return `<section id="${id}">
<h2>${escapeHtml(pkg.name)} <span class="ver">${escapeHtml(pkg.version)}</span></h2>
<p class="spdx">${escapeHtml(pkg.spdx)}</p>
${note}${home}
<pre>${escapeHtml(pkg.text)}</pre>
${extras}
</section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open source licenses, Evalight</title>
  <style>
    :root {
      --bg: #14110d;
      --panel: #1b1712;
      --line: #3a3224;
      --gold: #e4b34c;
      --text: #efe6d6;
      --muted: #9a8b70;
      --sans: "Figtree", system-ui, sans-serif;
      --serif: "Fraunces", Georgia, serif;
      --mono: "IBM Plex Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      line-height: 1.5;
    }
    main { max-width: 52rem; margin: 0 auto; padding: 2.2rem 1.2rem 4rem; }
    h1 { font-family: var(--serif); font-weight: 600; font-size: 1.8rem; margin: 0 0 0.4rem; }
    h2 { font-family: var(--serif); font-size: 1.15rem; margin: 2rem 0 0.4rem; }
    h3 { font-size: 0.95rem; color: var(--muted); }
    p { color: var(--muted); }
    a { color: var(--gold); }
    .lede { color: var(--text); }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin: 1rem 0 2rem; }
    th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 500; }
    .elect { color: var(--muted); font-size: 0.8em; }
    .ver, .spdx { color: var(--muted); font-weight: 400; font-size: 0.9rem; }
    .note { font-size: 0.88rem; }
    .home { font-size: 0.82rem; overflow-wrap: anywhere; }
    pre {
      white-space: pre-wrap;
      font-family: var(--mono);
      font-size: 0.72rem;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 0.9rem 1rem;
      color: var(--text);
    }
    .own {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 0.9rem 1rem;
      margin: 1.2rem 0;
      background: var(--panel);
    }
    .own strong { color: var(--gold); font-weight: 600; }
  </style>
</head>
<body>
<main>
  <h1>Open source licenses</h1>
  <p class="lede">Third-party code bundled in this Evalight UI. Generated by <code>bun run licenses</code>.</p>
  <div class="own">
    <p><strong>Evalight</strong> (this workshop, the copied <code>src/ui</code> kit, and <code>evalight/*.mjs</code> in an export) is MIT. Copyright (c) 2026 violetpurpleish &amp; contributors. That text lives in <code>LICENSE</code> at the project root, not on this page.</p>
  </div>
  <p>An exported ZIP lists later install-only deps in <code>package.json</code> and <code>shadow-cljs.edn</code>. Those packages are not copied into the ZIP, so they are not listed here.</p>
  <table>
    <thead><tr><th>Package</th><th>Version</th><th>License</th><th>Kind</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <h2>Fonts loaded at runtime</h2>
  <p>Figtree, Fraunces, and IBM Plex Mono are loaded from Google Fonts in <code>index.html</code>. They are not files in the ZIP. Each is under the SIL Open Font License 1.1.</p>
${bodies}
</main>
</body>
</html>
`;
}

export function generateArtifacts(root = ROOT) {
  const report = collectDistributed(root);
  const problems = checkReport(report);
  const md = renderMarkdown(report);
  const html = renderHtml(report);
  return { report, problems, md, html };
}

export async function writeLicenseArtifacts(root = ROOT) {
  const { report, problems, md, html } = generateArtifacts(root);
  await Bun.write(join(root, "THIRD_PARTY_LICENSES.md"), md);
  await Bun.write(join(root, "public/licenses.html"), html);
  return { report, problems, md, html };
}

function main(argv) {
  const check = argv.includes("--check");
  const { report, problems, md, html } = generateArtifacts(ROOT);
  if (problems.length) {
    console.error("License check failed:");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  if (check) {
    const mdNow = existsSync(MD_PATH) ? readFileSync(MD_PATH, "utf8") : "";
    const htmlNow = existsSync(HTML_PATH) ? readFileSync(HTML_PATH, "utf8") : "";
    if (mdNow !== md || htmlNow !== html) {
      console.error("THIRD_PARTY_LICENSES.md or public/licenses.html is stale. Run bun run licenses.");
      process.exit(1);
    }
    console.log(`licenses ok  npm=${report.npm.length} maven=${report.maven.length}`);
    return;
  }
  writeLicenseArtifacts(ROOT).then(({ report }) => {
    console.log(`wrote THIRD_PARTY_LICENSES.md and public/licenses.html  npm=${report.npm.length} maven=${report.maven.length}`);
  });
}

if (import.meta.main) main(process.argv.slice(2));
