/**
 * Classify a directory as a ClojureScript app, JVM Clojure, clj-gpui,
 * the Evalight checkout itself, or nothing we know how to run.
 *
 * evalight.edn `:runtime` always wins. Otherwise gpui.edn / a clj-gpui
 * dep beats shadow-cljs, and `:workshop` in shadow-cljs.edn marks this
 * repository so `bun run local` here stays on SCI.
 */

export function runtimeFromEdn(text) {
  const m = (text || "").match(/:runtime\s+:(gpui|clj|cljs)\b/);
  return m ? m[1] : null;
}

export function previewKindFromEdn(text) {
  const m = (text || "").match(/:preview\s*\{[^}]*:kind\s+:(native|iframe|none)\b/);
  return m ? m[1] : null;
}

export function mainFromEdn(text) {
  const m = (text || "").match(/:main\s+([A-Za-z0-9*.!?_+\-\/]+)/);
  return m ? m[1] : null;
}

export function looksLikeGpui(depsEdn, hasGpuiEdn) {
  if (hasGpuiEdn) return true;
  const t = depsEdn || "";
  return /clj-gpui/.test(t) || /gpui\.dev/.test(t);
}

/**
 * clj-gpui templates set `:main-opts ["-m" "gpui.dev" "todomvc.app/app"]`
 * and often have no evalight.edn. Without this, the REPL ns stays my.app.
 */
export function gpuiMainFromDeps(depsEdn) {
  const t = depsEdn || "";
  const quoted = t.match(/:main-opts\s*\[[^\]]*"gpui\.dev"\s+"([^"]+\/[^"]+)"/);
  if (quoted) return quoted[1];
  const bare = t.match(/:main-opts\s*\[[^\]]*gpui\.dev\s+([A-Za-z0-9*.!?_+\-]+\/[A-Za-z0-9*.!?_+\-]+)/);
  return bare ? bare[1] : null;
}

export function looksLikeClj(depsEdn, projectClj) {
  if (projectClj && projectClj.trim()) return true;
  const t = depsEdn || "";
  return t.includes("{:paths") || t.includes("{:deps") || t.includes(":deps");
}

function defaultsFor(kind, formMain) {
  if (kind === "gpui") {
    return {
      kind,
      preview: "native",
      mainNs: formMain || "my.app/app",
    };
  }
  if (kind === "clj") {
    return {
      kind,
      preview: "none",
      mainNs: formMain || "user",
    };
  }
  if (kind === "cljs") {
    return {
      kind,
      preview: "iframe",
      mainNs: formMain || "app.core",
    };
  }
  return {
    kind,
    preview: "none",
    mainNs: formMain || null,
  };
}

/**
 * Pure classifier. File IO lives in detectProject.
 */
export function classifyProject({
  evalightEdn = "",
  shadowEdn = "",
  depsEdn = "",
  projectClj = "",
  gpuiEdn = "",
  hasGpuiEdn = false,
} = {}) {
  const forced = runtimeFromEdn(evalightEdn);
  const gpui = looksLikeGpui(depsEdn, hasGpuiEdn || Boolean(gpuiEdn && gpuiEdn.trim()));
  const formMain =
    mainFromEdn(evalightEdn) ||
    mainFromEdn(gpuiEdn) ||
    (gpui || forced === "gpui" ? gpuiMainFromDeps(depsEdn) : null);
  const previewOverride = previewKindFromEdn(evalightEdn);

  let kind;
  if (forced === "gpui" || forced === "clj" || forced === "cljs") {
    kind = forced;
  } else if (gpui) {
    kind = "gpui";
  } else if ((shadowEdn || "").includes(":workshop")) {
    kind = "workshop";
  } else if ((shadowEdn || "").includes(":app") || (evalightEdn || "").includes(":main")) {
    kind = "cljs";
  } else if (looksLikeClj(depsEdn, projectClj)) {
    kind = "clj";
  } else {
    kind = "none";
  }

  const out = defaultsFor(kind, formMain);
  if (previewOverride) out.preview = previewOverride;
  return out;
}

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

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

export async function detectProject(root) {
  const evalightEdn = await readText(join(root, "evalight.edn"));
  const shadowEdn = await readText(join(root, "shadow-cljs.edn"));
  const depsEdn = await readText(join(root, "deps.edn"));
  const projectClj = await readText(join(root, "project.clj"));
  const gpuiEdn = await readText(join(root, "gpui.edn"));
  const hasGpuiEdn = await exists(join(root, "gpui.edn"));
  return classifyProject({
    evalightEdn,
    shadowEdn,
    depsEdn,
    projectClj,
    gpuiEdn,
    hasGpuiEdn,
  });
}
