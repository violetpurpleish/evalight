/**
 * JVM Clojure runtime for local Evalight.
 *
 * Generic Clojure: nREPL only. No preview pane (the program has no
 * window Evalight can show).
 *
 * clj-gpui: spawn `clj -M:dev` (or attach). Ctrl-Enter talks to that
 * JVM. The native GPUI window is the running program. A browser iframe
 * cannot host it. If the image interned `gpui.runtime/preview-png`,
 * Preview can display that PNG; otherwise the pane is a status card.
 */
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { connectNrepl, pingNrepl } from "./nrepl.mjs";
import { parseEvalightEdn } from "./compiled.mjs";

const NREPL_PORT = Number(process.env.EVALIGHT_NREPL_PORT || process.env.CLJ_GPUI_NREPL_PORT || 7888);

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

export function cljBin() {
  // Prefer `clojure`: `clj` is an rlwrap wrapper and exits 1 without it.
  return Bun.which("clojure") || Bun.which("clj") || null;
}

export function gpuiDevArgs() {
  return ["-M:dev"];
}

export function nreplCmdlineArgs(port) {
  return [
    "-Sdeps",
    "{:deps {nrepl/nrepl {:mvn/version \"1.3.1\"}}}",
    "-M",
    "-m",
    "nrepl.cmdline",
    "--bind",
    "127.0.0.1",
    "--port",
    String(port),
  ];
}

export function resolveCljAttach({
  attach,
  nreplFromFlag,
  nreplFromFile,
  nreplFromEdn,
  nreplDefault,
}) {
  if (!attach) return { mode: "owned" };
  const nreplPort = nreplFromFlag || nreplFromFile || nreplFromEdn || nreplDefault || null;
  if (!nreplPort) {
    throw new Error(
      "--attach needs a running nREPL. Pass --nrepl-port=, or start the app so .nrepl-port exists.",
    );
  }
  return { mode: "attach", nreplPort };
}

export function cljAttachLabel({ nreplPort, kind }) {
  const tag = kind === "gpui" ? "GPUI" : "Clojure";
  return `Attached · ${tag} · nREPL ${nreplPort}`;
}

/**
 * Live intel from the JVM image: interned vars, referred clojure.core
 * (and other ns-refers) as kind "core", and aliases. Completions only
 * list core names once the user has typed a prefix; hover needs the
 * referred vars or defn/swap! have no docs.
 */
export function cljIntelForm(nsName) {
  const ns = /^[A-Za-z0-9*.!?_+\-\/]+$/.test(nsName || "") ? nsName : "user";
  return `(do
  (set! *print-length* nil)
  (set! *print-level* nil)
  (let [ns-sym '${ns}
        n (find-ns ns-sym)
        interned (if n (ns-interns n) {})
        referred (if n (ns-refers n) {})
        aliases (if n (ns-aliases n) {})
        pack (fn [s v kind]
               (let [m (meta v)]
                 {:name (str (name s))
                  :kind kind
                  :ns (str (ns-name (.ns ^clojure.lang.Var v)))
                  :arglists (when-let [a (:arglists m)] (pr-str a))
                  :doc (:doc m)
                  :macro (boolean (:macro m))}))]
    {:ns (str ns-sym)
     :items
     (vec
      (concat
       [{:name (str ns-sym) :kind "ns"}]
       (map (fn [[s v]] (pack s v "var")) interned)
       (keep (fn [[s v]]
               (when (and (var? v) (not (contains? interned s)))
                 (pack s v "core")))
             referred)
       (mapcat
        (fn [[a t]]
          (let [target (ns-interns t)]
            (cons {:name (str a) :kind "alias" :ns (str t)}
                  (map (fn [[s v]]
                         (assoc (pack s v "var") :name (str a "/" (name s))))
                       target))))
        aliases)))}))`;
}

/**
 * Optional hook. clj-gpui does not intern this yet. When it does, the
 * var should return a base64 PNG (with or without a data: URL prefix)
 * of the current native window.
 */
export const PREVIEW_PNG_FORM = `(try
  (when-let [v (resolve 'gpui.runtime/preview-png)]
    (v))
  (catch Exception _ nil))`;

async function readNreplPortFile(root) {
  const text = (await readText(join(root, ".nrepl-port"))).trim();
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseNreplPort(edn) {
  const m = (edn || "").match(/:nrepl\s*\{[^}]*:port\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

let client = null;
let session = null;
let lastNrepl = null;
let child = null;
let started = null;

async function ensureClj(nreplPort) {
  if (client && session && lastNrepl === nreplPort) return;
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    client = null;
    session = null;
  }
  lastNrepl = nreplPort;
  client = connectNrepl(nreplPort);
  session = await client.clone();
}

async function cljEval(code, nsName, ms = 20000) {
  if (!client || !session) {
    throw new Error("Clojure REPL is not connected.");
  }
  return client.eval(session, code, ms, nsName || undefined);
}

export function cljActive() {
  return Boolean(started?.enabled);
}

export async function runtimeStatus() {
  if (!started) {
    return {
      runtime: "clj",
      ready: false,
      connected: false,
      error: "Starting the Clojure runtime…",
      previewUrl: null,
      preview: "none",
    };
  }
  if (!started.enabled) {
    return {
      runtime: "none",
      ready: false,
      connected: false,
      error: started?.error || null,
      previewUrl: null,
      preview: "none",
    };
  }
  const preview = started.kind === "gpui" ? "native" : "none";
  const fatal = /Clojure CLI not found|exited \(/i.test(started.error || "");
  if (started.error && !(started.nreplPort && (await pingNrepl(started.nreplPort)))) {
    return {
      runtime: started.kind,
      ready: false,
      connected: false,
      fatal,
      error: started.error,
      previewUrl: null,
      preview,
      nreplPort: started.nreplPort,
      app: started.mainNs,
      attached: started.attached,
    };
  }
  if (started.nreplPort && !(await pingNrepl(started.nreplPort))) {
    return {
      runtime: started.kind,
      ready: true,
      connected: false,
      previewUrl: null,
      preview,
      error: "Waiting for nREPL…",
      nreplPort: started.nreplPort,
      app: started.mainNs,
      attached: started.attached,
    };
  }
  try {
    await ensureClj(started.nreplPort);
    const ping = await cljEval("true", undefined, 8000);
    const connected = Boolean(ping.ok);
    return {
      runtime: started.kind,
      ready: true,
      connected,
      previewUrl: null,
      preview,
      error: connected ? null : (ping.stderr || ping.ex || "Waiting for Clojure nREPL."),
      nreplPort: started.nreplPort,
      app: started.mainNs,
      attached: started.attached,
    };
  } catch (e) {
    return {
      runtime: started.kind,
      ready: true,
      connected: false,
      previewUrl: null,
      preview,
      error: e.message || String(e),
      nreplPort: started.nreplPort,
      app: started.mainNs,
      attached: started.attached,
    };
  }
}

function nsOf(mainNs) {
  if (!mainNs) return "user";
  const i = mainNs.lastIndexOf("/");
  return i > 0 ? mainNs.slice(0, i) : mainNs;
}

export async function runtimeEval(code, nsName) {
  const st = await runtimeStatus();
  if (!st.connected) {
    return {
      ok: false,
      error: { message: st.error || "Clojure nREPL has not connected yet." },
    };
  }
  const result = await cljEval(code, nsName || nsOf(started.mainNs), 20000);
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
  const ns = nsName || nsOf(started?.mainNs) || "user";
  if (!st.connected) {
    return { ok: false, items: [], ns, error: st.error };
  }
  const result = await cljEval(cljIntelForm(ns), ns, 20000);
  if (!result.ok) {
    return {
      ok: false,
      items: [],
      ns,
      error: result.stderr || result.ex,
    };
  }
  try {
    const data = parseEvalightEdn(result.value || "{}");
    return { ok: true, ns: data.ns, items: data.items || [] };
  } catch (e) {
    return { ok: false, items: [], ns, error: e.message };
  }
}

function stripEdnString(v) {
  const s = String(v || "").trim();
  if (s === "nil" || s === "") return null;
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, s.endsWith('"') ? -1 : undefined);
    }
  }
  return s;
}

export async function runtimeFrame() {
  if (!started || started.kind !== "gpui") {
    return { ok: false, png: null };
  }
  const st = await runtimeStatus();
  if (!st.connected) {
    return { ok: false, png: null, error: st.error };
  }
  const result = await cljEval(PREVIEW_PNG_FORM, nsOf(started.mainNs), 8000);
  const raw = stripEdnString(result.value);
  if (!result.ok || !raw || raw.length < 32) {
    return { ok: false, png: null };
  }
  const png = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
  return { ok: true, png };
}

export async function handleCljRequest(req, url) {
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
  if (url.pathname === "/api/runtime/frame" && req.method === "GET") {
    return Response.json(await runtimeFrame());
  }
  return null;
}

async function waitUntil(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(label);
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

export async function startCljRuntime(projectRoot, {
  attach = false,
  nreplPort: nreplFromFlag = null,
  project,
} = {}) {
  const kind = project?.kind === "gpui" ? "gpui" : "clj";
  const mainNs = project?.mainNs || (kind === "gpui" ? "my.app/app" : "user");
  const edn = await readText(join(projectRoot, "evalight.edn"));

  if (attach) {
    try {
      const nreplFromFile = await readNreplPortFile(projectRoot);
      const target = resolveCljAttach({
        attach: true,
        nreplFromFlag,
        nreplFromFile,
        nreplFromEdn: parseNreplPort(edn),
        nreplDefault: NREPL_PORT,
      });
      if (!(await pingNrepl(target.nreplPort))) {
        throw new Error(
          `--attach: nothing is listening on nREPL ${target.nreplPort}. Start the Clojure app first.`,
        );
      }
      await ensureClj(target.nreplPort);
      started = {
        enabled: true,
        attached: true,
        kind,
        nreplPort: target.nreplPort,
        mainNs,
        child: null,
        error: null,
        attachLabel: cljAttachLabel({ nreplPort: target.nreplPort, kind }),
      };
      console.log(`  runtime  ${kind} ${started.attachLabel}`);
      console.log(`  nREPL    ${started.nreplPort} (will not be stopped)`);
      if (kind === "gpui") console.log("  preview  native GPUI window");
      return started;
    } catch (e) {
      started = {
        enabled: true,
        attached: true,
        kind,
        error: e.message || String(e),
        nreplPort: nreplFromFlag || null,
        mainNs,
        child: null,
        attachLabel: null,
      };
      console.warn(`  runtime  ${started.error}`);
      return started;
    }
  }

  const bin = cljBin();
  if (!bin) {
    started = {
      enabled: true,
      attached: false,
      kind,
      error: "Clojure CLI not found (clj or clojure). JVM Clojure needs a JDK and the Clojure CLI. shadow-cljs is not used here.",
      nreplPort: null,
      mainNs,
    };
    console.warn(`  runtime  ${started.error}`);
    return started;
  }

  const nreplPortWanted = nreplFromFlag || NREPL_PORT;
  const args = kind === "gpui" ? gpuiDevArgs() : nreplCmdlineArgs(nreplPortWanted);
  let log = "";
  let spawnErr = null;
  const env = { ...process.env };
  if (kind === "gpui") env.CLJ_GPUI_NREPL_PORT = String(nreplPortWanted);

  child = spawn(bin, args, {
    cwd: projectRoot,
    env,
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
      started.error = `${kind === "gpui" ? "clj -M:dev" : "nREPL"} exited (${code})`;
      started.child = null;
      session = null;
    }
  });

  try {
    const nreplPort = await waitUntil(
      async () => {
        if (spawnErr) throw spawnErr;
        if (child.exitCode != null) {
          throw new Error(`${args.join(" ")} exited (${child.exitCode})\n${log.slice(-4000)}`);
        }
        const fromFile = await readNreplPortFile(projectRoot);
        if (fromFile && (await pingNrepl(fromFile))) return fromFile;
        if (await pingNrepl(nreplPortWanted)) return nreplPortWanted;
        return null;
      },
      120000,
      kind === "gpui"
        ? "clj-gpui nREPL did not start. Need Java, the Clojure CLI, and a built GPUI host (first run compiles Rust)."
        : "Clojure nREPL did not start. Need Java and the Clojure CLI.",
    );
    await ensureClj(nreplPort);
    started = {
      enabled: true,
      attached: false,
      kind,
      nreplPort,
      mainNs,
      child,
      error: null,
    };
    console.log(`  runtime  ${kind} ${kind === "gpui" ? "clj -M:dev" : "nREPL"}`);
    console.log(`  nREPL    ${nreplPort}`);
    if (kind === "gpui") console.log("  preview  native GPUI window");
    return started;
  } catch (e) {
    started = {
      enabled: true,
      attached: false,
      kind,
      error: e.message || String(e),
      nreplPort: nreplPortWanted,
      mainNs,
      child,
    };
    console.warn(`  runtime  ${e.message}`);
    return started;
  }
}

export function stopCljRuntime() {
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    client = null;
    session = null;
    lastNrepl = null;
  }
  if (child) {
    killWatch(child);
    child = null;
  }
  started = null;
}

export function cljMeta() {
  if (!started || !started.enabled) {
    return { runtime: "none" };
  }
  return {
    runtime: started.kind,
    preview: started.kind === "gpui" ? "native" : "none",
    "preview-url": null,
    "runtime-error": started.error || null,
    attached: Boolean(started.attached),
    "attach-label": started.attachLabel || null,
    "nrepl-port": started.nreplPort || null,
    app: started.mainNs || null,
  };
}
