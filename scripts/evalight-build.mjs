import { readFileSync } from "node:fs";
import { join } from "node:path";

export function cljsBuildId(root) {
  const text = readFileSync(join(root, "src/evalight/build.cljs"), "utf8");
  const m = text.match(/\(def id "([^"]+)"\)/);
  if (!m) throw new Error("src/evalight/build.cljs is missing (def id ...)");
  return m[1];
}

export { stampHtml } from "../src/evalight/embed/static.mjs";

export function embedBuildIdSource(id) {
  return `/** Synced from src/evalight/build.cljs by copyEmbedServer / packEvalight. */\nexport const EVALIGHT_BUILD = ${JSON.stringify(id)};\n`;
}
