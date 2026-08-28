/**
 * Files that go in an exported project's evalight/ folder so the zip
 * can run this workshop with `bun run evalight`.
 *
 * Do not copy public/js from `shadow-cljs watch`. That tree is ~50MB of
 * cljs-runtime. The workshop UI is a release build in evalight-ui/js.
 */
import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const STATIC = [
  ["public/index.html", "evalight/public/index.html"],
  ["public/preview.html", "evalight/public/preview.html"],
  ["public/favicon.svg", "evalight/public/favicon.svg"],
  ["public/css/ui.css", "evalight/public/css/ui.css"],
  ["public/css/evalight.css", "evalight/public/css/evalight.css"],
  ["public/css/preview.css", "evalight/public/css/preview.css"],
];

const RELEASE = [
  ["evalight-ui/js/main.js", "evalight/public/js/main.js"],
  ["evalight-ui/js/preview/preview.js", "evalight/public/js/preview/preview.js"],
];

async function readText(root, rel) {
  const file = Bun.file(join(root, rel));
  if (!(await file.exists())) {
    throw new Error(`Missing ${rel}`);
  }
  return file.text();
}

function compileWorkshop(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bunx",
      ["shadow-cljs", "release", "workshop", "workshop-preview"],
      { cwd: root, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`shadow-cljs release workshop failed (${code})`));
    });
  });
}

let compiling = null;

export async function ensureWorkshopUi(root) {
  const main = Bun.file(join(root, "evalight-ui/js/main.js"));
  if (await main.exists()) return;
  if (!compiling) {
    compiling = compileWorkshop(root).finally(() => {
      compiling = null;
    });
  }
  await compiling;
}

export async function copyEmbedServer(root) {
  const src = await readText(root, "src/evalight/embed/server.mjs");
  await mkdir(join(root, "public/evalight-embed"), { recursive: true });
  await Bun.write(join(root, "public/evalight-embed/server.mjs"), src);
}

export async function packEvalight(root, { requireJs = true, compileIfMissing = false } = {}) {
  if (compileIfMissing) {
    await ensureWorkshopUi(root);
  }
  const files = {};
  files["evalight/server.mjs"] = await readText(root, "src/evalight/embed/server.mjs");
  for (const [from, to] of STATIC) {
    files[to] = await readText(root, from);
  }
  for (const [from, to] of RELEASE) {
    const file = Bun.file(join(root, from));
    if (await file.exists()) {
      files[to] = await file.text();
    } else if (requireJs) {
      throw new Error(
        `Evalight UI is not built (${from}). Run bun run embed, then export again.`,
      );
    }
  }
  return files;
}

export function withEvalightScript(packageJsonText) {
  try {
    const data = JSON.parse(packageJsonText || "{}");
    data.scripts = { ...(data.scripts || {}), evalight: "bun evalight/server.mjs" };
    return `${JSON.stringify(data, null, 2)}\n`;
  } catch {
    return packageJsonText;
  }
}

export async function handlePackRequest(root) {
  try {
    const files = await packEvalight(root, { compileIfMissing: true, requireJs: true });
    return Response.json({ files });
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
