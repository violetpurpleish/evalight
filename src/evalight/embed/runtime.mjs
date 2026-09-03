/**
 * Local-mode runtime entry. ClojureScript keeps the compiled shadow
 * watch. JVM Clojure and clj-gpui use nREPL without an iframe app.
 */
import {
  compiledMeta,
  handleRuntimeRequest as handleCompiledRequest,
  parseEvalightArgs,
  startCompiledRuntime,
  stopCompiledRuntime,
} from "./compiled.mjs";
import {
  cljActive,
  cljMeta,
  handleCljRequest,
  startCljRuntime,
  stopCljRuntime,
} from "./clj.mjs";
import { detectProject } from "./project.mjs";

let active = "compiled";
let detected = { kind: "none", preview: "none", mainNs: null };

export { parseEvalightArgs, detectProject };

export async function startRuntime(projectRoot, flags = {}) {
  const project = await detectProject(projectRoot);
  detected = project;
  console.log(
    `Detected ${project.kind}${project.mainNs ? ` · ${project.mainNs}` : ""} (preview ${project.preview})`,
  );
  if (project.kind === "clj" || project.kind === "gpui") {
    active = "clj";
    console.log(`Starting ${project.kind} runtime…`);
    return startCljRuntime(projectRoot, { ...flags, project });
  }
  active = "compiled";
  console.log("Starting compiled runtime…");
  return startCompiledRuntime(projectRoot, flags);
}

export async function handleRuntimeRequest(req, url) {
  if (active === "clj" || cljActive()) {
    const res = await handleCljRequest(req, url);
    if (res) return res;
  }
  return handleCompiledRequest(req, url);
}

export function runtimeMeta() {
  const extra = {
    kind: detected.kind,
    mainNs: detected.mainNs || null,
  };
  if (active === "clj" || cljActive()) return { ...extra, ...cljMeta() };
  return { ...extra, ...compiledMeta() };
}

export function stopRuntime() {
  if (active === "clj") stopCljRuntime();
  else stopCompiledRuntime();
  active = "compiled";
}
