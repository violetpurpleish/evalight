/**
 * Compiled-app runtime for exported Evalight.
 *
 * The preview iframe is shadow-cljs :app (the same program bun run dev
 * builds). Eval, hover, and completions go through nREPL into that heap.
 * SCI is not used here.
 */
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { connectNrepl, pingNrepl } from "./nrepl.mjs";

const APP_PORT = Number(process.env.EVALIGHT_APP_PORT || 48741);
const NREPL_PORT = Number(process.env.EVALIGHT_NREPL_PORT || 7879);
const SHADOW_HTTP = Number(process.env.EVALIGHT_SHADOW_HTTP || 9640);

const INTEL_FORM = `(let [n (ns-name *ns*)
         interned (try (ns-interns n) (catch :default _ {}))
         referred (try (ns-refers n) (catch :default _ {}))
         aliases (try (ns-aliases n) (catch :default _ {}))
         nss (try (all-ns) (catch :default _ []))
         pack (fn [s v kind]
                (let [m (or (meta v) {})]
                  {:name (str s)
                   :kind kind
                   :ns (str (or (:ns m) n))
                   :arglists (when-let [a (:arglists m)] (pr-str a))
                   :doc (:doc m)
                   :macro (boolean (:macro m))}))]
     {:ns (str n)
      :items
      (vec
       (concat
        (map (fn [[s v]] (pack s v "var")) interned)
        (keep (fn [[s v]]
                (when-not (contains? interned s)
                  (pack s v "core")))
              referred)
        (mapcat
         (fn [[a t]]
           (let [target (try (ns-interns t) (catch :default _ {}))
                 nsn (str (try (ns-name t) (catch :default _ a)))]
             (cons {:name (str a) :kind "alias" :ns nsn}
                   (map (fn [[s v]]
                          (assoc (pack s v "var") :name (str a "/" s)))
                        target))))
         aliases)
        (map (fn [x] {:name (str (ns-name x)) :kind "ns"}) nss)))})`;

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
  const edn = await readText(join(root, "evalight.edn"));
  if (edn.includes(":main")) return true;
  const shadow = await readText(join(root, "shadow-cljs.edn"));
  if (!shadow) return false;
  if (shadow.includes(":workshop")) return false;
  return shadow.includes(":app");
}

function parseDevHttp(shadowText) {
  const m = shadowText.match(/:dev-http\s*\{(\d+)\s+"public"/);
  return m ? Number(m[1]) : null;
}

async function readNreplPortFile(root) {
  const text = (await readText(join(root, ".nrepl-port"))).trim();
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
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

function waitForOutput(child, pattern, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("shadow-cljs watch did not finish compiling")), ms);
    const onData = (buf) => {
      const s = String(buf);
      if (pattern.test(s)) {
        clearTimeout(t);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
  });
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

function mergeConfig(nreplPort, shadowHttp, appPort) {
  return `{:nrepl {:port ${nreplPort}} :http {:port ${shadowHttp}} :dev-http {${appPort} "public"}}`;
}

let client = null;
let session = null;
let cljs = false;
let child = null;
let started = null;

async function ensureCljs(nreplPort, buildId) {
  if (client && session && cljs) return;
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
  client = connectNrepl(nreplPort);
  session = await client.clone();
  const sel = await client.eval(
    session,
    `(do (require '[shadow.cljs.devtools.api :as shadow]) (shadow/nrepl-select ${buildId}))`,
    20000,
  );
  const text = `${sel.value || ""} ${sel.stdout || ""} ${sel.stderr || ""}`;
  if (/no-worker|No application|nrepl-select/i.test(sel.stderr || "") && !sel.ok) {
    throw new Error(sel.stderr || sel.ex || "shadow/nrepl-select failed");
  }
  // nrepl-select often returns [:selected :app] even before a runtime attaches.
  cljs = true;
  return text;
}

async function cljsEval(code, nsName, ms = 20000) {
  if (!client || !session || !cljs) {
    throw new Error("Compiled REPL is not connected.");
  }
  const wrapped = nsName
    ? `(do (in-ns '${nsName}) ${code})`
    : code;
  return client.eval(session, wrapped, ms);
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
  const result = await cljsEval(
    `(do (set! *print-length* nil) (set! *print-level* nil) ${INTEL_FORM})`,
    nsName || started.mainNs,
    20000,
  );
  if (!result.ok || noRuntime(result)) {
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

export async function startCompiledRuntime(projectRoot, { buildId = "app" } = {}) {
  const enabled = await isUserProject(projectRoot);
  if (!enabled) {
    started = { enabled: false, error: null };
    return started;
  }
  const edn = await readText(join(projectRoot, "evalight.edn"));
  const mainNs = parseMainNs(edn);
  const shadowText = await readText(join(projectRoot, "shadow-cljs.edn"));
  const configuredHttp = parseDevHttp(shadowText);

  const existingPort = await readNreplPortFile(projectRoot);
  if (existingPort && (await pingNrepl(existingPort))) {
    const url = `http://127.0.0.1:${configuredHttp || APP_PORT}/`;
    started = {
      enabled: true,
      attached: true,
      nreplPort: existingPort,
      previewUrl: url,
      buildId: `:${buildId}`,
      mainNs,
      child: null,
      error: null,
    };
    console.log(`  runtime  compiled (attached nREPL ${existingPort})`);
    console.log(`  preview  ${url}`);
    return started;
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

  const nreplPort = NREPL_PORT;
  const appPort = APP_PORT;
  const shadowHttp = SHADOW_HTTP;
  const merge = mergeConfig(nreplPort, shadowHttp, appPort);

  child = spawn(
    "bunx",
    ["shadow-cljs", "--config-merge", merge, "watch", buildId],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (b) => process.stdout.write(b));
  child.stderr.on("data", (b) => process.stderr.write(b));
  child.on("exit", (code) => {
    if (started?.child === child) {
      started.error = `shadow-cljs watch exited (${code})`;
      started.child = null;
      cljs = false;
      session = null;
    }
  });

  try {
    await waitForOutput(child, /Build completed|[:].*Build completed/, 120000);
    await waitUntil(() => pingNrepl(nreplPort), 20000, "nREPL did not start");
    await waitUntil(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${appPort}/`);
        return res.ok;
      } catch {
        return false;
      }
    }, 30000, `compiled app did not serve on :${appPort}`);
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

export function stopCompiledRuntime() {
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    client = null;
    session = null;
    cljs = false;
  }
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }
}

export function compiledMeta() {
  if (started && !started.enabled) {
    return { runtime: "sci" };
  }
  return {
    runtime: "compiled",
    "preview-url": started?.previewUrl || previewUrl(),
    "runtime-error": started?.error || null,
  };
}
