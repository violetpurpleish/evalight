import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packEvalight } from "./evalight-pack.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2];
if (!output) {
  console.error("Usage: bun scripts/pack-workshop.mjs <output-directory>");
  process.exit(1);
}

const files = await packEvalight(root);
for (const [path, contents] of Object.entries(files)) {
  const destination = join(output, path.slice("evalight/".length));
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(destination, contents);
}
