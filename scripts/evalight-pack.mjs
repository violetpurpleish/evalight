/**
 * Files that go in an exported project's evalight/ folder so the zip
 * can run this workshop with `bun run evalight`.
 *
 * Do not copy public/js from `shadow-cljs watch`. That tree is ~50MB of
 * cljs-runtime. The workshop UI is a release build in evalight-ui/js.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, relative } from "node:path";

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

const FINGERPRINT = "evalight-ui/js/.src-fingerprint";

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

async function walkSourceFiles(root, dir, out) {
  const names = (await readdir(dir)).sort();
  for (const name of names) {
    if (name === ".DS_Store") continue;
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) await walkSourceFiles(root, p, out);
    else if (/\.(cljs|cljc|clj|edn|js)$/.test(name)) {
      out.push(relative(root, p).replaceAll("\\", "/"));
    }
  }
}

export async function srcFingerprint(root) {
  const h = createHash("sha1");
  const files = [];
  await walkSourceFiles(root, join(root, "src"), files);
  files.push("shadow-cljs.edn");
  for (const rel of files) {
    h.update(rel);
    h.update("\0");
    h.update(await Bun.file(join(root, rel)).text());
    h.update("\n");
  }
  return h.digest("hex");
}

let compiling = null;

export async function ensureWorkshopUi(root, { force = false } = {}) {
  const mainPath = join(root, "evalight-ui/js/main.js");
  const fpPath = join(root, FINGERPRINT);
  const fp = await srcFingerprint(root);
  const exists = await Bun.file(mainPath).exists();
  const prev = (await Bun.file(fpPath).exists()) ? (await Bun.file(fpPath).text()).trim() : "";
  if (!force && exists && prev === fp) return fp;
  if (!compiling) {
    compiling = compileWorkshop(root)
      .then(async () => {
        await Bun.write(fpPath, `${fp}\n`);
      })
      .finally(() => {
        compiling = null;
      });
  }
  await compiling;
  return fp;
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
