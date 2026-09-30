import { resolve } from "node:path";
import { ednGet, ednValue, readEdn, replaceEdn } from "./edn.mjs";

export function nodeBuildInfo(shadowText, requestedBuild = null) {
  const config = readEdn(shadowText || "{}");
  const builds = ednGet(config, "builds");
  const candidates = [];
  for (let i = 0; i < (builds?.items?.length || 0); i += 2) {
    const build = builds.items[i + 1];
    if (ednValue(ednGet(build, "target")) === "node-script") {
      candidates.push({ buildId: builds.items[i].value,
        outputTo: ednValue(ednGet(build, "output-to")),
        mainNs: ednValue(ednGet(build, "main")) });
    }
  }
  if (requestedBuild) return candidates.find((b) => b.buildId === requestedBuild) || null;
  return candidates.find((b) => b.buildId === "app") || (candidates.length === 1 ? candidates[0] : null);
}

/** A temporary shadow root must still resolve paths against the real project. */
export function absoluteProjectPaths(text, root) {
  const edits = [];
  const arrays = new Set(["paths", "extra-paths", "source-paths", "externs"]);
  const scalars = new Set(["local/root", "output-to", "output-dir", "file", "cache-root"]);
  function absolute(node) {
    if (node?.type === "string") edits.push({ ...node, value: JSON.stringify(resolve(root, node.value)) });
  }
  function walk(node) {
    if (node.type === "map") {
      for (let i = 0; i < node.items.length; i += 2) {
        const key = node.items[i].value;
        const value = node.items[i + 1];
        if (arrays.has(key)) value.items?.forEach(absolute);
        else if (scalars.has(key)) absolute(value);
        walk(value);
      }
    } else node.items?.forEach(walk);
  }
  walk(readEdn(text));
  return replaceEdn(text, edits);
}

export function nativeShadowEdn(text, root, { nreplPort, shadowHttp }) {
  let out = absoluteProjectPaths(text, root);
  const config = readEdn(out);
  if (config.type !== "map") throw new Error("shadow-cljs.edn must be an EDN map");
  const edits = [];
  for (let i = 0; i < config.items.length; i += 2) {
    if (["nrepl", "http", "dev-http", "cache-root"].includes(config.items[i].value)) {
      edits.push({ start: config.items[i].start, end: config.items[i + 1].end, value: "" });
    }
  }
  out = replaceEdn(out, edits);
  const last = readEdn(out).end - 1;
  return out.slice(0, last) + `\n :cache-root ".shadow-cljs"\n :nrepl {:host "127.0.0.1" :port ${nreplPort}}\n :http {:host "127.0.0.1" :port ${shadowHttp}}\n` + out.slice(last);
}
