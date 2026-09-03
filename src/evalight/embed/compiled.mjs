/**
 * Compiled-app runtime for exported Evalight.
 *
 * Default: Evalight owns shadow-cljs watch :app (overlay config, own
 * ports, Live reload). `bun run evalight --attach` joins a watch the
 * developer already started. Do not sniff .nrepl-port unless --attach.
 *
 * The preview iframe is that compiled app. Ctrl-Enter evals through
 * nREPL into the JS heap. Hover and completions read the same shadow
 * :app compiler env that analyzed those forms. SCI is not used here.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectNrepl, pingNrepl } from "./nrepl.mjs";
import { detectProject } from "./project.mjs";

const APP_PORT = Number(process.env.EVALIGHT_APP_PORT || 48741);
const NREPL_PORT = Number(process.env.EVALIGHT_NREPL_PORT || 7879);
const SHADOW_HTTP = Number(process.env.EVALIGHT_SHADOW_HTTP || 9640);

/**
 * CLJS ns-interns is a compile-time macro, so intel does not scrape the
 * JS intern map. It reads shadow's :app compiler env. REPL analysis of
 * (def ...) writes into that same env, so a REPL-only def shows up
 * without a save. Runtime values still live in the JS heap.
 *
 * Analyzer :arglists is (quote ([e])). Unwrap before pr-str or hover
 * shows "(quote ([e]))" next to the name.
 */
export function intelForm(nsName, buildId) {
  const ns = /^[A-Za-z0-9*.!?_+\-\/]+$/.test(nsName || "") ? nsName : "cljs.user";
  return `(do
  (require '[shadow.cljs.devtools.api :as api])
  (set! *print-length* nil)
  (set! *print-level* nil)
  (let [build ${buildId}
        ns-sym '${ns}
        env (api/compiler-env build)
        ns-map (get-in env [:cljs.analyzer/namespaces ns-sym])
        defs (or (:defs ns-map) {})
        reqs (or (:requires ns-map) {})
        uses (or (:uses ns-map) {})
        unpack-arglists (fn [a]
                          (cond
                            (nil? a) nil
                            (and (seq? a) (= 'quote (first a))) (second a)
                            :else a))
        pack (fn [s m]
               {:name (str (name s))
                :kind "var"
                :ns (str (or (:ns m) ns-sym))
                :arglists (when-let [a (unpack-arglists (:arglists m))]
                            (pr-str a))
                :doc (:doc m)
                :macro (boolean (:macro m))})]
    {:ns (str ns-sym)
     :items
     (vec
      (concat
       [{:name (str ns-sym) :kind "ns"}]
       (map (fn [[s m]] (pack s m)) defs)
       (map (fn [[s t]] {:name (str s) :kind "core" :ns (str t)}) uses)
       (mapcat
        (fn [[a t]]
          (if (= (str a) (str t))
            [{:name (str t) :kind "ns"}]
            (let [target (or (get-in env [:cljs.analyzer/namespaces t :defs]) {})]
              (cons {:name (str a) :kind "alias" :ns (str t)}
                    (map (fn [[s m]]
                           (assoc (pack s m) :name (str a "/" (name s))))
                         target)))))
        reqs)))}))`;
}

export function previewUrl() {
  return `http://127.0.0.1:${APP_PORT}/`;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readText(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return "";
  }
}

export async function isUserProject(root) {
  const project = await detectProject(root);
  return project.kind === "cljs";
}

function parseDevHttp(shadowText) {
  const m = shadowText.match(/:dev-http\s*\{(\d+)\s+"public"/);
  return m ? Number(m[1]) : null;
}

export function parseNreplPort(shadowText) {
  const m = (shadowText || "").match(/:nrepl\s*\{[^}]*:port\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * bun run evalight [--attach] [--preview-url=http://127.0.0.1:3456/] [--nrepl-port=7888]
 * bun run local [--attach] [project-dir]
 */
export function parseEvalightArgs(argv) {
  const out = { attach: false, previewUrl: null, nreplPort: null, positional: [] };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a === "--attach") {
      out.attach = true;
      continue;
    }
    if (a === "--preview-url" || a.startsWith("--preview-url=")) {
      out.previewUrl = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
      continue;
    }
    if (a === "--nrepl-port" || a.startsWith("--nrepl-port=")) {
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
      out.nreplPort = Number(v);
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown flag ${a}. Try --attach, --preview-url=, --nrepl-port=.`);
    }
    out.positional.push(a);
  }
  if (out.nreplPort != null && !(Number.isFinite(out.nreplPort) && out.nreplPort > 0)) {
    throw new Error("--nrepl-port must be a port number.");
  }
  if (!out.attach && (out.previewUrl || out.nreplPort)) {
    throw new Error("--preview-url and --nrepl-port only apply with --attach.");
  }
  return out;
}

/**
 * Default is owned watch. .nrepl-port is consulted only when attach is true.
 */
export function resolveAttachTarget({
  attach,
  nreplFromFlag,
  nreplFromFile,
  nreplFromEdn,
  previewFromFlag,
  previewFromDevHttp,
}) {
  if (!attach) return { mode: "owned" };
  const nreplPort = nreplFromFlag || nreplFromFile || nreplFromEdn || null;
  if (!nreplPort) {
    throw new Error(
      "--attach needs a running shadow-cljs nREPL. Pass --nrepl-port=, set :nrepl {:port ...} in shadow-cljs.edn, or start watch so .nrepl-port exists.",
    );
  }
  const previewUrl = previewFromFlag
    || (previewFromDevHttp ? `http://127.0.0.1:${previewFromDevHttp}/` : null);
  if (!previewUrl) {
    throw new Error(
      "--attach could not tell where the compiled app is served. Pass --preview-url=http://127.0.0.1:3456/",
    );
  }
  return { mode: "attach", nreplPort, previewUrl };
}

export function attachLabel({ buildId, previewUrl }) {
  let host = previewUrl || "";
  try {
    const u = new URL(previewUrl);
    const name = u.hostname === "127.0.0.1" ? "localhost" : u.hostname;
    host = u.port ? `${name}:${u.port}` : u.host;
  } catch {
    /* keep raw */
  }
  const build = String(buildId || ":app");
  const tagged = build.startsWith(":") ? build : `:${build}`;
  return `Attached · ${tagged} · ${host}`;
}

/**
 * shadow-cljs --config-merge only merges into the *build* map, not
 * :nrepl / :http / :dev-http. We rewrite those keys ourselves.
 */
export function overlayShadowEdn(text, { nreplPort, shadowHttp, appPort }) {
  let out = text || "{}";
  for (const key of ["nrepl", "http", "dev-http"]) {
    out = stripTopKey(out, key);
  }
  const last = out.lastIndexOf("}");
  if (last === -1) {
    throw new Error("shadow-cljs.edn is not a map");
  }
  const inject =
    `\n :nrepl {:port ${nreplPort}}\n` +
    ` :http {:host "127.0.0.1" :port ${shadowHttp}}\n` +
    ` :dev-http {${appPort} "public"}\n`;
  return disableAppDevtools(out.slice(0, last) + inject + out.slice(last));
}

/** Keep the nREPL websocket; do not let shadow reload the iframe. Live does that. */
export function disableAppDevtools(edn) {
  const m = edn.match(/:app\s*\{/);
  if (!m) return edn;
  const at = edn.indexOf(m[0]);
  const after = at + m[0].length;
  if (/:devtools/.test(edn.slice(at, after + 500))) return edn;
  return `${edn.slice(0, after)}\n        :devtools {:autoload false}\n        ${edn.slice(after)}`;
}

export function stripTopKey(edn, key) {
  const needle = `:${key}`;
  let search = 0;
  while (search < edn.length) {
    const idx = edn.indexOf(needle, search);
    if (idx < 0) return edn;
    const before = idx === 0 ? "\n" : edn[idx - 1];
    if (before && /[A-Za-z0-9*!?_\-+.:/]/.test(before)) {
      search = idx + needle.length;
      continue;
    }
    const lineStart = edn.lastIndexOf("\n", idx);
    const linePrefix = edn.slice(lineStart + 1, idx);
    if (linePrefix.includes(";")) {
      search = idx + needle.length;
      continue;
    }
    let i = idx + needle.length;
    while (i < edn.length && /\s/.test(edn[i])) i++;
    if (edn[i] === "{") {
      let depth = 0;
      for (let j = i; j < edn.length; j++) {
        const ch = edn[j];
        if (ch === '"') {
          j++;
          while (j < edn.length && edn[j] !== '"') {
            if (edn[j] === "\\") j++;
            j++;
          }
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            return edn.slice(0, idx) + edn.slice(j + 1);
          }
        }
      }
      return edn;
    }
    while (i < edn.length && !/[\s}]/.test(edn[i])) i++;
    return edn.slice(0, idx) + edn.slice(i);
  }
  return edn;
}

async function readNreplPortFile(root) {
  const text = (await readText(join(root, ".nrepl-port"))).trim();
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function discoverNrepl(watchDir, projectRoot, wanted) {
  for (const root of [watchDir, projectRoot]) {
    if (!root) continue;
    const p = await readNreplPortFile(root);
    if (p && (await pingNrepl(p))) return p;
  }
  if (wanted && (await pingNrepl(wanted))) return wanted;
  return null;
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => {
      out += b;
    });
    child.stderr.on("data", (b) => {
      out += b;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${args.join(" ")} failed (${code})\n${out.slice(-4000)}`));
    });
  });
}

async function ensureDeps(root) {
  const shadowBin = join(root, "node_modules", ".bin", "shadow-cljs");
  if (await exists(shadowBin)) return;
  const pkg = join(root, "package.json");
  if (!(await exists(pkg))) {
    throw new Error(
      "This project has no package.json. Exported Evalight compiles with shadow-cljs; add one, or run bun install in a project created by Export ZIP.",
    );
  }
  await run("bun", ["install"], { cwd: root, env: process.env });
  if (!(await exists(shadowBin))) {
    throw new Error(
      "bun install finished but shadow-cljs is not in node_modules. Add it as a devDependency (Export ZIP already does).",
    );
  }
}

async function waitUntil(fn, ms, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(label);
}

const WATCH_SKIP = new Set([
  "shadow-cljs.edn",
  ".shadow-cljs",
  ".nrepl-port",
  ".git",
  "evalight",
  "evalight-ui",
]);

async function makeWatchRoot(projectRoot, overlay) {
  const dir = await mkdtemp(join(tmpdir(), "evalight-watch-"));
  const names = await readdir(projectRoot);
  for (const name of names) {
    if (WATCH_SKIP.has(name)) continue;
    await symlink(join(projectRoot, name), join(dir, name));
  }
  await writeFile(join(dir, "shadow-cljs.edn"), overlay, "utf8");
  return dir;
}

let client = null;
let session = null;
let cljSession = null;
let cljs = false;
let lastNrepl = null;
let child = null;
let watchRoot = null;
let started = null;

async function ensureCljs(nreplPort, buildId) {
  if (client && session && cljSession && cljs && lastNrepl === nreplPort) return;
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    client = null;
    session = null;
    cljSession = null;
    cljs = false;
  }
  lastNrepl = nreplPort;
  client = connectNrepl(nreplPort);
  cljSession = await client.clone();
  session = await client.clone();
  const sel = await client.eval(
    session,
    `(do (require '[shadow.cljs.devtools.api :as shadow]) (shadow/nrepl-select ${buildId}))`,
    20000,
  );
  if (/no-worker|No application|nrepl-select/i.test(sel.stderr || "") && !sel.ok) {
    throw new Error(sel.stderr || sel.ex || "shadow/nrepl-select failed");
  }
  // nrepl-select often returns [:selected :app] even before a runtime attaches.
  cljs = true;
}

async function cljsEval(code, nsName, ms = 20000) {
  if (!client || !session || !cljs) {
    throw new Error("Compiled REPL is not connected.");
  }
  return client.eval(session, code, ms, nsName || undefined);
}

function noRuntime(result) {
  const blob = `${result?.value || ""} ${result?.stderr || ""} ${result?.stdout || ""} ${result?.ex || ""}`;
  return /no-runtime|no connected JS runtime|There is no connected/i.test(blob);
}

export async function runtimeStatus() {
  if (!started) {
    return {
      runtime: "compiled",
      ready: false,
      connected: false,
      error: "Starting the compiled app (shadow-cljs watch)…",
      previewUrl: previewUrl(),
    };
  }
  if (!started.enabled) {
    return {
      runtime: "none",
      ready: false,
      connected: false,
      error: started?.error || null,
      previewUrl: null,
    };
  }
  if (started.error && !(started.nreplPort && (await pingNrepl(started.nreplPort)))) {
    return {
      runtime: "compiled",
      ready: false,
      connected: false,
      error: started.error,
      previewUrl: started.previewUrl,
      attached: started.attached,
    };
  }
  if (started.nreplPort && !(await pingNrepl(started.nreplPort))) {
    return {
      runtime: "compiled",
      ready: true,
      connected: false,
      previewUrl: started.previewUrl,
      error: "Waiting for nREPL…",
      attached: started.attached,
    };
  }
  try {
    await ensureCljs(started.nreplPort, started.buildId);
    const ping = await cljsEval("true", started.mainNs, 8000);
    const connected = ping.ok && !noRuntime(ping);
    return {
      runtime: "compiled",
      ready: true,
      connected,
      previewUrl: started.previewUrl,
      error: connected ? null : (ping.stderr || "Waiting for the compiled app to open in Preview."),
      attached: started.attached,
    };
  } catch (e) {
    return {
      runtime: "compiled",
      ready: true,
      connected: false,
      previewUrl: started.previewUrl,
      error: e.message || String(e),
      attached: started.attached,
    };
  }
}

export async function runtimeEval(code, nsName) {
  const st = await runtimeStatus();
  if (!st.connected) {
    return {
      ok: false,
      error: { message: st.error || "The compiled app has not connected yet. Leave Preview open." },
    };
  }
  const result = await cljsEval(code, nsName || started.mainNs, 20000);
  if (noRuntime(result)) {
    return {
      ok: false,
      error: { message: "No JS runtime is connected. The Preview iframe must show the compiled app." },
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      stdout: result.stdout,
      error: { message: result.stderr || result.ex || "Evaluation failed." },
    };
  }
  return {
    ok: true,
    value: result.value,
    stdout: result.stdout,
    ns: result.ns,
  };
}

export async function runtimeIntel(nsName) {
  const st = await runtimeStatus();
  if (!st.connected) {
    return { ok: false, items: [], ns: nsName || started?.mainNs, error: st.error };
  }
  if (!cljSession) {
    return { ok: false, items: [], ns: nsName || started?.mainNs, error: "Clojure nREPL session missing" };
  }
  const result = await client.eval(
    cljSession,
    intelForm(nsName || started.mainNs, started.buildId),
    20000,
  );
  if (!result.ok) {
    return {
      ok: false,
      items: [],
      ns: nsName || started?.mainNs,
      error: result.stderr || result.ex,
    };
  }
  try {
    const data = ednMap(result.value || "{}");
    return { ok: true, ns: data.ns, items: data.items || [] };
  } catch (e) {
    return { ok: false, items: [], ns: nsName || started?.mainNs, error: e.message };
  }
}

/**
 * Tiny EDN reader for the intel map we print: keywords, strings, vectors,
 * maps, true/false/nil. Not a general EDN parser.
 */
function ednMap(src) {
  const s = src.trim();
  return ednRead(s).value;
}

export function parseEvalightEdn(src) {
  return ednMap(src);
}

function ednRead(src, i = 0) {
  const skip = () => {
    while (i < src.length && /\s|,/.test(src[i])) i++;
  };
  skip();
  const c = src[i];
  if (c === "{") {
    const obj = {};
    i++;
    while (true) {
      skip();
      if (src[i] === "}") {
        i++;
        break;
      }
      const k = ednRead(src, i);
      i = k.next;
      const v = ednRead(src, i);
      i = v.next;
      const key = typeof k.value === "string" ? k.value.replace(/^:/, "") : String(k.value);
      obj[key] = v.value;
    }
    return { value: obj, next: i };
  }
  if (c === "[") {
    const arr = [];
    i++;
    while (true) {
      skip();
      if (src[i] === "]") {
        i++;
        break;
      }
      const v = ednRead(src, i);
      i = v.next;
      arr.push(v.value);
    }
    return { value: arr, next: i };
  }
  if (c === '"') {
    i++;
    let out = "";
    while (i < src.length && src[i] !== '"') {
      if (src[i] === "\\") {
        i++;
        out += src[i] === "n" ? "\n" : src[i];
        i++;
      } else {
        out += src[i++];
      }
    }
    i++;
    return { value: out, next: i };
  }
  if (src.startsWith("nil", i) && (i + 3 >= src.length || /[\s,\]\}]/.test(src[i + 3] || ""))) {
    return { value: null, next: i + 3 };
  }
  if (src.startsWith("true", i) && (i + 4 >= src.length || /[\s,\]\}]/.test(src[i + 4] || ""))) {
    return { value: true, next: i + 4 };
  }
  if (src.startsWith("false", i) && (i + 5 >= src.length || /[\s,\]\}]/.test(src[i + 5] || ""))) {
    return { value: false, next: i + 5 };
  }
  if (c === ":") {
    i++;
    let tok = "";
    while (i < src.length && /[A-Za-z0-9*!?_\-+.\/]/.test(src[i])) tok += src[i++];
    return { value: tok, next: i };
  }
  let tok = "";
  while (i < src.length && !/[\s,\]\}]/.test(src[i])) tok += src[i++];
  if (/^-?\d+$/.test(tok)) return { value: Number(tok), next: i };
  return { value: tok, next: i };
}

export async function handleRuntimeRequest(req, url) {
  if (url.pathname === "/api/runtime" && req.method === "GET") {
    return Response.json(await runtimeStatus());
  }
  if (url.pathname === "/api/runtime/eval" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return Response.json(await runtimeEval(body.code || "", body.ns));
  }
  if (url.pathname === "/api/runtime/intel" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return Response.json(await runtimeIntel(body.ns));
  }
  return null;
}

function parseMainNs(edn) {
  const m = edn.match(/:main\s+([A-Za-z0-9*.!?_+\-\/]+)/);
  return m ? m[1] : "app.core";
}

export async function startCompiledRuntime(projectRoot, {
  buildId = "app",
  attach = false,
  previewUrl: previewFromFlag = null,
  nreplPort: nreplFromFlag = null,
} = {}) {
  const enabled = await isUserProject(projectRoot);
  if (!enabled) {
    started = { enabled: false, error: null };
    return started;
  }
  const edn = await readText(join(projectRoot, "evalight.edn"));
  const mainNs = parseMainNs(edn);
  const shadowText = await readText(join(projectRoot, "shadow-cljs.edn"));

  if (attach) {
    try {
      const nreplFromFile = await readNreplPortFile(projectRoot);
      const target = resolveAttachTarget({
        attach: true,
        nreplFromFlag,
        nreplFromFile,
        nreplFromEdn: parseNreplPort(shadowText),
        previewFromFlag,
        previewFromDevHttp: parseDevHttp(shadowText),
      });
      if (!(await pingNrepl(target.nreplPort))) {
        throw new Error(
          `--attach: nothing is listening on nREPL ${target.nreplPort}. Start shadow-cljs watch ${buildId} first.`,
        );
      }
      await ensureCljs(target.nreplPort, `:${buildId}`);
      started = {
        enabled: true,
        attached: true,
        nreplPort: target.nreplPort,
        previewUrl: target.previewUrl,
        buildId: `:${buildId}`,
        mainNs,
        child: null,
        error: null,
        attachLabel: attachLabel({ buildId: `:${buildId}`, previewUrl: target.previewUrl }),
      };
      console.log(`  runtime  compiled ${started.attachLabel}`);
      console.log(`  preview  ${started.previewUrl}`);
      console.log(`  nREPL    ${started.nreplPort} (will not be stopped)`);
      return started;
    } catch (e) {
      started = {
        enabled: true,
        attached: true,
        error: e.message || String(e),
        previewUrl: previewFromFlag || null,
        nreplPort: nreplFromFlag || null,
        buildId: `:${buildId}`,
        mainNs,
        child: null,
        attachLabel: null,
      };
      console.warn(`  runtime  ${started.error}`);
      return started;
    }
  }

  try {
    await ensureDeps(projectRoot);
  } catch (e) {
    started = {
      enabled: true,
      attached: false,
      error: e.message || String(e),
      previewUrl: null,
      nreplPort: null,
      buildId: `:${buildId}`,
      mainNs,
    };
    console.warn(`  runtime  ${started.error}`);
    return started;
  }

  const nreplPortWanted = NREPL_PORT;
  const appPort = APP_PORT;
  const shadowHttp = SHADOW_HTTP;
  const overlay = overlayShadowEdn(shadowText, {
    nreplPort: nreplPortWanted,
    shadowHttp,
    appPort,
  });

  try {
    watchRoot = await makeWatchRoot(projectRoot, overlay);
  } catch (e) {
    started = {
      enabled: true,
      attached: false,
      error: e.message || String(e),
      previewUrl: `http://127.0.0.1:${appPort}/`,
      nreplPort: null,
      buildId: `:${buildId}`,
      mainNs,
    };
    console.warn(`  runtime  ${started.error}`);
    return started;
  }

  const bin = join(projectRoot, "node_modules", ".bin", "shadow-cljs");
  let log = "";
  let spawnErr = null;
  child = spawn(bin, ["--force-spawn", "watch", buildId], {
    cwd: watchRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const onData = (b) => {
    log += String(b);
    process.stdout.write(b);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (e) => {
    spawnErr = e;
  });
  child.on("exit", (code) => {
    if (started?.child === child) {
      started.error = `shadow-cljs watch exited (${code})`;
      started.child = null;
      cljs = false;
      session = null;
    }
  });

  let nreplPort = nreplPortWanted;
  try {
    await waitUntil(
      () => {
        if (spawnErr) throw spawnErr;
        if (child.exitCode != null && !/Build completed/.test(log)) {
          throw new Error(`shadow-cljs watch exited (${child.exitCode})\n${log.slice(-4000)}`);
        }
        return /Build completed/.test(log);
      },
      120000,
      "shadow-cljs watch did not finish compiling",
    );
    nreplPort = await waitUntil(
      () => discoverNrepl(watchRoot, projectRoot, nreplPortWanted),
      20000,
      "nREPL did not start",
    );
    try {
      await waitUntil(async () => {
        try {
          const root = await fetch(`http://127.0.0.1:${appPort}/`);
          if (root.ok) return true;
          const idx = await fetch(`http://127.0.0.1:${appPort}/index.html`);
          return idx.ok;
        } catch {
          return false;
        }
      }, 15000, `compiled app did not serve on :${appPort}`);
    } catch (e) {
      console.warn(`  runtime  ${e.message} (Preview may still load)`);
    }
  } catch (e) {
    started = {
      enabled: true,
      attached: false,
      error: `${e.message}\nNeed a JDK and bun install. Evalight will not fall back to SCI in an exported project.`,
      previewUrl: `http://127.0.0.1:${appPort}/`,
      nreplPort,
      buildId: `:${buildId}`,
      mainNs,
      child,
    };
    console.warn(`  runtime  ${e.message}`);
    return started;
  }

  started = {
    enabled: true,
    attached: false,
    nreplPort,
    previewUrl: `http://127.0.0.1:${appPort}/`,
    buildId: `:${buildId}`,
    mainNs,
    child,
    error: null,
  };
  console.log(`  runtime  compiled shadow-cljs watch :${buildId}`);
  console.log(`  preview  ${started.previewUrl}`);
  console.log(`  nREPL    ${nreplPort}`);
  return started;
}

function killWatch(proc) {
  if (!proc) return;
  const pid = proc.pid;
  if (pid && process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGTERM");
      return;
    } catch {
      /* not a group leader */
    }
  }
  proc.kill("SIGTERM");
}

export function stopCompiledRuntime() {
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    client = null;
    session = null;
    cljSession = null;
    cljs = false;
    lastNrepl = null;
  }
  if (child) {
    killWatch(child);
    child = null;
  }
  if (watchRoot) {
    const dir = watchRoot;
    watchRoot = null;
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function compiledMeta() {
  if (!started || !started.enabled) {
    return { runtime: "sci" };
  }
  return {
    runtime: "compiled",
    "preview-url": started.previewUrl || (started.attached ? null : previewUrl()),
    "runtime-error": started.error || null,
    attached: Boolean(started.attached),
    "attach-label": started.attachLabel || null,
  };
}
