/** shadow-cljs compiles/reloads; Bun owns the live native GPUI application. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureDeps, intelForm, noRuntime, parseNreplPort } from "./compiled.mjs";
import { ednValue, readEdn } from "./edn.mjs";
import { absoluteProjectPaths, nativeShadowEdn, nodeBuildInfo } from "./gpui-cljs-config.mjs";
import { connectNrepl, pingNrepl } from "./nrepl.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function readText(path) {
  try { return await readFile(path, "utf8"); } catch { return ""; }
}
async function portFile(root) {
  for (const path of [".shadow-cljs/nrepl.port", ".nrepl-port"]) {
    const n = Number((await readText(join(root, path))).trim());
    if (Number.isInteger(n) && n > 0 && n <= 65535) return n;
  }
  return null;
}
function killGroup(proc) {
  if (!proc || proc.exitCode != null) return;
  try {
    if (process.platform !== "win32") process.kill(-proc.pid, "SIGTERM");
    else proc.kill("SIGTERM");
  } catch { proc.kill("SIGTERM"); }
}

export function previewRequestForm(key) {
  const quoted = JSON.stringify(key);
  return `(do
    (aset js/globalThis ${quoted} nil)
    (-> (gpui.runtime/preview-png)
        (.then (fn [png] (aset js/globalThis ${quoted} #js {:done true :png png})))
        (.catch (fn [_] (aset js/globalThis ${quoted} #js {:done true :png nil}))))
    nil)`;
}

export function createGpuiCljsRuntime({
  spawnProcess = spawn, connect = connectNrepl, ping = pingNrepl,
  ensureDependencies = ensureDeps,
  nreplPort = Number(process.env.EVALIGHT_NREPL_PORT || 7879),
  shadowHttp = Number(process.env.EVALIGHT_SHADOW_HTTP || 9640),
  startupTimeout = 120000, captureTimeout = 8000,
} = {}) {
  let started = null;
  let watch = null;
  let app = null;
  let watchRoot = null;
  let client = null;
  let jsSession = null;
  let cljSession = null;
  let connecting = null;
  let generation = 0;

  function disconnect() {
    client?.close();
    client = jsSession = cljSession = connecting = null;
  }
  function releaseProcesses() {
    const compiler = watch;
    killGroup(app);
    killGroup(compiler);
    app = watch = null;
    if (watchRoot) {
      const dir = watchRoot;
      watchRoot = null;
      const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
      if (compiler && compiler.exitCode == null && compiler.signalCode == null) compiler.once("close", cleanup);
      else cleanup();
    }
  }
  function stop() {
    generation++;
    disconnect();
    releaseProcesses();
    started = null;
  }
  function fail(error) {
    if (started) {
      started.error = error.message || String(error);
      started.ready = false;
      started.fatal = true;
    }
    disconnect();
    releaseProcesses();
  }
  async function waitUntil(fn, label, ms = startupTimeout) {
    const token = generation;
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (token !== generation) throw new Error("GPUI startup was stopped");
      if (started?.fatal) throw new Error(started.error);
      const value = await fn();
      if (value) return value;
      await sleep(100);
    }
    throw new Error(label);
  }
  async function ensureConnected() {
    if (client && jsSession && cljSession) return;
    if (connecting) return connecting;
    const token = generation;
    const buildId = started.buildId;
    const connection = connect(started.nreplPort);
    client = connection;
    const pending = (async () => {
      const clj = await connection.clone();
      const js = await connection.clone();
      const selected = await connection.eval(js,
        `(do (require '[shadow.cljs.devtools.api :as shadow]) (shadow/nrepl-select :${buildId}))`, 20000);
      if (!selected.ok) throw new Error(selected.stderr || selected.ex || "shadow/nrepl-select failed");
      if (token !== generation || client !== connection) throw new Error("GPUI REPL was disconnected");
      cljSession = clj;
      jsSession = js;
    })();
    connecting = pending;
    try { await pending; } catch (error) {
      if (client === connection) disconnect();
      else connection.close();
      throw error;
    } finally { if (connecting === pending) connecting = null; }
  }
  async function jsEval(code, nsName, ms = 20000) {
    await ensureConnected();
    return client.eval(jsSession, code, ms, nsName || started.mainNs);
  }
  function spawnOwned(args, cwd, label) {
    const proc = spawnProcess(process.execPath, ["--no-install", ...args], {
      cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    const token = generation;
    proc.log = "";
    for (const stream of [proc.stdout, proc.stderr]) stream?.on("data", (chunk) => {
      proc.log = (proc.log + String(chunk)).slice(-16000);
      process.stdout.write(chunk);
    });
    proc.on("error", (error) => { if (token === generation && started) fail(error); });
    proc.on("exit", (code, signal) => {
      if (token === generation && started && !started.fatal) {
        fail(new Error(`${label} exited (${signal || code})\n${proc.log.slice(-4000)}`));
      }
    });
    return proc;
  }
  async function start(root, { project, attach = false, nreplPort: portOverride = null } = {}) {
    stop();
    const token = generation;
    started = { enabled: true, ready: false, attached: attach, error: null, preview: project?.preview || "native",
      appId: project?.mainNs,
      buildId: project?.buildId, mainNs: project?.mainNs?.split("/")[0], nreplPort: null };
    try {
      const shadowText = await readText(join(root, "shadow-cljs.edn"));
      if (token !== generation) return null;
      const build = nodeBuildInfo(shadowText, project?.buildId);
      if (!build?.outputTo || !build.mainNs || !/^[\w.-]+$/.test(build.buildId)) {
        throw new Error("GPUI ClojureScript needs a shadow-cljs :node-script build with :main and :output-to. Select it with :cljs-build in evalight.edn or gpui.edn.");
      }
      started.buildId = build.buildId;
      started.mainNs ||= build.mainNs.split("/")[0];
      started.appId ||= build.mainNs;
      if (attach) {
        started.nreplPort = portOverride || await portFile(root) || parseNreplPort(shadowText);
        if (token !== generation) return null;
        if (!started.nreplPort || !await ping(started.nreplPort)) {
          throw new Error("--attach needs a running shadow-cljs watch and Bun app. Pass --nrepl-port or start watch so .shadow-cljs/nrepl.port exists.");
        }
        if (token !== generation) return null;
        await ensureConnected();
      } else {
        await ensureDependencies(root);
        if (token !== generation) throw new Error("GPUI startup was stopped");
        const dir = await mkdtemp(join(tmpdir(), "evalight-gpui-watch-"));
        if (token !== generation) { await rm(dir, { recursive: true, force: true }); return null; }
        watchRoot = dir;
        const skip = new Set(["shadow-cljs.edn", "deps.edn", ".shadow-cljs", ".cpcache", ".nrepl-port", ".git", "evalight", "evalight-ui"]);
        for (const name of await readdir(root)) {
          if (!skip.has(name)) await symlink(join(root, name), join(watchRoot, name));
        }
        const deps = await readText(join(root, "deps.edn"));
        if (deps) await writeFile(join(watchRoot, "deps.edn"), absoluteProjectPaths(deps, root));
        await writeFile(join(watchRoot, "shadow-cljs.edn"), nativeShadowEdn(shadowText, root, { nreplPort, shadowHttp }));
        if (token !== generation) return null;
        watch = spawnOwned([join(root, "node_modules/shadow-cljs/cli/runner.js"), "--force-spawn", "watch", build.buildId], watchRoot, "shadow-cljs watch");
        await waitUntil(() => /Build completed/.test(watch?.log || ""), "shadow-cljs did not finish compiling the GPUI app");
        started.nreplPort = await waitUntil(async () => {
          const port = await portFile(watchRoot) || nreplPort;
          return await ping(port) ? port : null;
        }, "shadow-cljs nREPL did not start");
        // The app's cwd controls resources and native host discovery.
        app = spawnOwned([resolve(root, build.outputTo)], root, "Bun GPUI app");
      }
      started.ready = true;
      started.attachLabel = attach ? `Attached · GPUI · ClojureScript · :${build.buildId}` : null;
      console.log(`  runtime  GPUI ClojureScript · :${build.buildId} · shadow nREPL ${started.nreplPort}`);
      return started;
    } catch (error) {
      if (token === generation) fail(error);
      return started;
    }
  }
  async function status() {
    const token = generation;
    const base = { runtime: "gpui", backend: "cljs", preview: started?.preview || "native", previewUrl: null,
      ready: Boolean(started?.ready), connected: false, attached: Boolean(started?.attached),
      fatal: Boolean(started?.fatal), error: started?.error || null };
    if (!started || started.fatal || !started.ready) return base;
    try {
      const result = await jsEval("true", undefined, 8000);
      const connected = result.ok && result.value === "true" && !noRuntime(result);
      return { ...base, connected,
        error: connected ? null : result.stderr || "Waiting for the Bun GPUI app to connect to shadow-cljs." };
    } catch (error) {
      if (token === generation) disconnect();
      return { ...base, error: error.message };
    }
  }
  async function evaluate(code, nsName) {
    const st = await status();
    if (!st.connected) return { ok: false, error: { message: st.error || "Bun GPUI app has not connected yet." } };
    const result = await jsEval(code, nsName);
    return result.ok && !noRuntime(result) && !(result.value == null && result.stderr) &&
      !/^:repl\/(exception|print-error)!$/.test(result.value || "")
      ? { ok: true, value: result.value, stdout: result.stdout, ns: result.ns }
      : { ok: false, stdout: result.stdout, error: { message: result.stderr || result.ex || "Evaluation failed." } };
  }
  async function intel(nsName) {
    const st = await status();
    const ns = nsName || started?.mainNs;
    if (!st.connected) return { ok: false, ns, items: [], error: st.error };
    const result = await client.eval(cljSession, intelForm(ns, `:${started.buildId}`), 20000);
    if (!result.ok) return { ok: false, ns, items: [], error: result.stderr || result.ex };
    const data = ednValue(readEdn(result.value || "{}"));
    return { ok: true, ns: data.ns, items: data.items || [] };
  }
  async function frame() {
    const st = await status();
    if (!st.connected) return { ok: false, png: null, error: st.error };
    const key = `evalight-preview-${randomUUID()}`;
    const quoted = JSON.stringify(key);
    const token = generation;
    try {
      const result = await jsEval(previewRequestForm(key));
      if (!result.ok) return { ok: false, png: null, error: result.stderr || result.ex };
      const until = Date.now() + captureTimeout;
      while (Date.now() < until) {
        if (token !== generation) return { ok: false, png: null };
        const polled = await jsEval(`(some-> (aget js/globalThis ${quoted}) (js->clj :keywordize-keys true))`, undefined, 8000);
        if (!polled.ok) return { ok: false, png: null, error: polled.stderr || polled.ex };
        const data = ednValue(readEdn(polled.value || "nil"));
        if (data?.done) {
          const png = data.png;
          return typeof png === "string" && png.length >= 32
            ? { ok: true, png: png.startsWith("data:") ? png : `data:image/png;base64,${png}` }
            : { ok: false, png: null };
        }
        await sleep(100);
      }
      return { ok: false, png: null, error: "Native preview capture timed out." };
    } finally {
      if (token === generation && client && jsSession) await jsEval(`(js-delete js/globalThis ${quoted})`).catch(() => {});
    }
  }
  async function handle(req, url) {
    try {
      if (url.pathname === "/api/runtime" && req.method === "GET") return Response.json(await status());
      if (url.pathname === "/api/runtime/frame" && req.method === "GET") return Response.json(await frame());
      if (url.pathname === "/api/runtime/eval" && req.method === "POST") {
        const body = await req.json();
        return Response.json(await evaluate(body.code || "", body.ns));
      }
      if (url.pathname === "/api/runtime/intel" && req.method === "POST") {
        const body = await req.json();
        return Response.json(await intel(body.ns));
      }
      return null;
    } catch (error) { return Response.json({ ok: false, error: { message: error.message } }); }
  }
  function meta() {
    return { runtime: "gpui", backend: "cljs", preview: started?.preview || "native", "preview-url": null,
      "runtime-error": started?.error || null, app: started?.appId || null,
      "nrepl-port": started?.nreplPort || null, "cljs-build": started?.buildId || null,
      attached: Boolean(started?.attached), "attach-label": started?.attachLabel || null };
  }
  return { start, stop, status, evaluate, intel, frame, handle, meta };
}
