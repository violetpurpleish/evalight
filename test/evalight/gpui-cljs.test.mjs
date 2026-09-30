import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProject } from "../../src/evalight/embed/project.mjs";
import { createGpuiCljsRuntime } from "../../src/evalight/embed/gpui-cljs.mjs";

const root = await mkdtemp(join(tmpdir(), "evalight-gpui-cljs-test-"));
const shadow = `{:source-paths ["src" "../clj-gpui/src"]
 :builds {:native {:target :node-script :main native.app/main :output-to "target/native.js"
                  :devtools {:after-load native.app/reload!}}}}`;
await writeFile(join(root, "shadow-cljs.edn"), shadow);
await writeFile(join(root, "gpui.edn"), `{:backend :cljs :cljs-build :native}`);
await writeFile(join(root, "deps.edn"), '{:deps {clj-gpui/clj-gpui {:local/root "../clj-gpui"}}}');
const project = await detectProject(root);

function fixture({ compilerFailure = false } = {}) {
  const spawned = [];
  const evals = [];
  let clone = 0;
  let closes = 0;
  let polls = 0;
  let capture = "png";
  let runtimeConnected = true;
  const client = {
    clone: async () => `session-${++clone}`,
    close: () => { closes++; },
    eval: async (session, code, _ms, ns) => {
      evals.push({ session, code, ns });
      let value = "true";
      if (code === "(") return { ok: true, stderr: "EOF while reading" };
      if (code === "(throw-test)") return { ok: true, value: ":repl/exception!", stderr: "expected exception" };
      if (code.includes("compiler-env")) value = `{:ns "native.app" :items [{:name "ui/label" :doc "Native label" :arglists "([text])"}]}`;
      else if (code.includes("preview-png")) { polls = 0; value = "nil"; }
      else if (code.includes("some-> (aget")) {
        polls++;
        value = capture === "timeout" || polls === 1 ? "nil"
          : `{:done true :png ${capture === "nil" ? "nil" : JSON.stringify("A".repeat(48))}}`;
      } else if (code === "true" && !runtimeConnected) return { ok: true, value: "nil", stderr: "No available JS runtime." };
      return { ok: true, value, stdout: "", ns };
    },
  };
  const runtime = createGpuiCljsRuntime({
    startupTimeout: 500, captureTimeout: 220,
    ensureDependencies: async () => {}, ping: async () => true, connect: () => client,
    spawnProcess: (bin, args, options) => {
      const proc = new EventEmitter();
      Object.assign(proc, { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null,
        kill: () => { proc.killed = true; proc.exitCode = 0; proc.emit("close", 0); } });
      spawned.push({ bin, args, options, proc });
      queueMicrotask(() => {
        if (args.includes("watch")) {
          if (compilerFailure) { proc.exitCode = 1; proc.emit("exit", 1); proc.emit("close", 1); }
          else proc.stdout.emit("data", Buffer.from("Build completed\n"));
        }
      });
      return proc;
    },
  });
  return { runtime, spawned, evals, setCapture: (value) => { capture = value; },
    setConnected: (value) => { runtimeConnected = value; }, get closes() { return closes; } };
}

try {
  const owned = fixture();
  await owned.runtime.start(root, { project });
  assert.equal(owned.spawned.length, 2, "compile plus Bun app");
  assert.equal(owned.spawned[0].bin, process.execPath, "use Bun even without a Node binary");
  assert.ok(owned.spawned[0].args.includes("native"));
  assert.equal(owned.spawned[1].options.cwd, root, "native resources resolve in the real project");
  assert.equal(owned.spawned[1].args.at(-1), join(root, "target/native.js"));
  assert.equal(await readFile(join(root, "shadow-cljs.edn"), "utf8"), shadow, "source config is untouched");
  const tempDeps = await readFile(join(owned.spawned[0].options.cwd, "deps.edn"), "utf8");
  assert.ok(!tempDeps.includes('"../clj-gpui"'), "relative dependency roots are rebased");
  assert.equal((await owned.runtime.status()).connected, true);
  assert.equal(owned.runtime.meta()["preview-url"], null);
  assert.equal(owned.runtime.meta().backend, "cljs");
  await owned.runtime.evaluate("(+ 1 1)", "scratch.ns");
  assert.equal(owned.evals.at(-1).session, "session-2", "eval uses the JS session");
  assert.equal(owned.evals.at(-1).ns, "scratch.ns");
  assert.equal((await owned.runtime.evaluate("(")).ok, false, "shadow reader errors are not successful evaluations");
  assert.equal((await owned.runtime.evaluate("(throw-test)")).ok, false, "shadow exception results are errors");
  const intel = await owned.runtime.intel();
  assert.equal(intel.items[0].name, "ui/label");
  assert.equal(owned.evals.at(-1).session, "session-1", "intel uses the compiler's JVM session");
  assert.ok(owned.evals.at(-1).code.includes("build :native"));
  assert.equal((await owned.runtime.frame()).png, `data:image/png;base64,${"A".repeat(48)}`);
  assert.ok(owned.evals.at(-1).code.includes("js-delete"), "capture globals are cleaned up");
  owned.setCapture("nil");
  assert.equal((await owned.runtime.frame()).png, null);
  owned.setCapture("timeout");
  assert.match((await owned.runtime.frame()).error, /timed out/);
  owned.setConnected(false);
  assert.equal((await owned.runtime.status()).connected, false, "shadow connection alone is not application readiness");
  assert.equal((await owned.runtime.evaluate("(+ 1 1)")).ok, false);
  owned.runtime.stop();
  assert.ok(owned.spawned.every((p) => p.proc.killed), "stop both owned processes");
  assert.ok(owned.closes > 0);

  const attached = fixture();
  await attached.runtime.start(root, { project, attach: true, nreplPort: 9999 });
  assert.equal(attached.spawned.length, 0, "attach never starts a compiler or app");
  assert.equal((await attached.runtime.status()).connected, true);
  assert.equal(attached.runtime.meta()["nrepl-port"], 9999);
  attached.runtime.stop();
  assert.equal(attached.spawned.length, 0, "attached applications remain owned externally");

  await writeFile(join(root, ".nrepl-port"), "9998\n");
  const discovered = fixture();
  await discovered.runtime.start(root, { project, attach: true });
  assert.equal(discovered.runtime.meta()["nrepl-port"], 9998, "attach discovers a port without a preview URL");
  discovered.runtime.stop();
  const hidden = fixture();
  await hidden.runtime.start(root, { project: { ...project, preview: "none" } });
  assert.equal(hidden.runtime.meta().preview, "none", "hiding Preview keeps the native CLJS runtime");
  assert.equal((await hidden.runtime.status()).connected, true);
  hidden.runtime.stop();

  const missing = fixture();
  await missing.runtime.start(root, { project: { ...project, buildId: "missing" } });
  assert.match(missing.runtime.meta()["runtime-error"], /node-script build/);
  assert.equal(missing.spawned.length, 0);
  missing.runtime.stop();

  const broken = fixture({ compilerFailure: true });
  const failed = await broken.runtime.start(root, { project });
  assert.match(failed.error, /shadow-cljs watch exited/);
  assert.equal(broken.spawned.length, 1, "never run an app after a failed compile");
  assert.equal((await broken.runtime.status()).fatal, true);
  broken.runtime.stop();

  const exited = fixture();
  await exited.runtime.start(root, { project });
  exited.spawned[1].proc.exitCode = 1;
  exited.spawned[1].proc.emit("exit", 1);
  exited.spawned[1].proc.emit("close", 1);
  assert.equal((await exited.runtime.status()).fatal, true);
  assert.ok(exited.spawned[0].proc.killed, "app exit also stops its compiler");
  exited.runtime.stop();

  let finishInstall;
  let installing;
  const installationStarted = new Promise((resolve) => { installing = resolve; });
  let processes = 0;
  const canceled = createGpuiCljsRuntime({
    ensureDependencies: () => { installing(); return new Promise((resolve) => { finishInstall = resolve; }); },
    spawnProcess: () => { processes++; throw new Error("must not spawn after stop"); },
  });
  const pendingStart = canceled.start(root, { project });
  await installationStarted;
  canceled.stop();
  finishInstall();
  await pendingStart;
  assert.equal(processes, 0, "canceling startup cannot leave a compiler or native app running");
} finally { await rm(root, { recursive: true, force: true }); }
console.log("gpui-cljs.test.mjs ok");
