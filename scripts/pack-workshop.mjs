import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packEvalight } from "./evalight-pack.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const [output] = process.argv.slice(2);
if (!output || process.argv.length !== 3) {
  console.error("Usage: bun scripts/pack-workshop.mjs <output-directory> | --archive");
  process.exit(1);
}

const archive = output === "--archive";
const files = Object.entries(await packEvalight(root, { compileIfMissing: archive }))
  .map(([path, contents]) => [path.slice("evalight/".length), contents]);
if (archive) {
  const path = join(root, "cli/assets/workshop.tar.gz");
  const temporary = `${path}.${process.pid}`;
  await mkdir(dirname(path), { recursive: true });
  try {
    const bundle = new Bun.Archive(Object.fromEntries(files), { compress: "gzip" });
    await Bun.write(temporary, await bundle.bytes());
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
} else {
  for (const [path, contents] of files) {
    const destination = join(output, path);
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, contents);
  }
}
