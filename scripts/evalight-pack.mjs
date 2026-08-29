/**
 * Files that go in an exported project's evalight/ folder so the zip
 * can run this workshop with `bun run evalight`.
 *
 * Do not copy public/js from `shadow-cljs watch`. That tree is ~50MB of
 * cljs-runtime. The workshop UI is a release build in evalight-ui/js.
 *
 * This file is the only pack inventory. Browser export fallback reads
 * public/evalight-embed/manifest.json, which copyEmbedServer writes from here.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, relative } from "node:path";
import { cljsBuildId, embedBuildIdSource, stampHtml } from "./evalight-build.mjs";

export const EMBED_FILES = [
  "server.mjs",
  "compiled.mjs",
  "nrepl.mjs",
  "bencode.mjs",
  "fs-http.mjs",
  "static.mjs",
  "build-id.mjs",
];

export const PACK_STATIC = [
  { from: "public/index.html", zip: "evalight/public/index.html", url: "/index.html", stamp: true },
  { from: "public/preview.html", zip: "evalight/public/preview.html", url: "/preview.html" },
  { from: "public/favicon.svg", zip: "evalight/public/favicon.svg", url: "/favicon.svg" },
  { from: "public/css/ui.css", zip: "evalight/public/css/ui.css", url: "/css/ui.css" },
  { from: "public/css/evalight.css", zip: "evalight/public/css/evalight.css", url: "/css/evalight.css" },
  { from: "public/css/preview.css", zip: "evalight/public/css/preview.css", url: "/css/preview.css" },
];

export const PACK_RELEASE = [
  { from: "evalight-ui/js/main.js", zip: "evalight/public/js/main.js", url: "/js/main.js" },
  { from: "evalight-ui/js/preview/preview.js", zip: "evalight/public/js/preview/preview.js", url: "/js/preview/preview.js" },
];

const FINGERPRINT = "evalight-ui/js/.src-fingerprint";

async function readText(root, rel) {
  const file = Bun.file(join(root, rel));
  if (!(await file.exists())) {
    throw new Error(`Missing ${rel}`);
  }
  return file.text();
}

export function fallbackManifest() {
  return {
    files: [
      ...PACK_STATIC.map(({ url, zip }) => ({ url, zip })),
      ...PACK_RELEASE.map(({ url, zip }) => ({ url, zip })),
      ...EMBED_FILES.map((name) => ({
        url: `/evalight-embed/${name}`,
        zip: `evalight/${name}`,
      })),
    ],
  };
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

export async function syncEmbedBuildId(root) {
  const id = cljsBuildId(root);
  await writeFile(join(root, "src/evalight/embed/build-id.mjs"), embedBuildIdSource(id));
  return id;
}

export async function copyEmbedServer(root) {
  const id = await syncEmbedBuildId(root);
  await mkdir(join(root, "public/evalight-embed"), { recursive: true });
  for (const name of EMBED_FILES) {
    const src = await readText(root, `src/evalight/embed/${name}`);
    await Bun.write(join(root, "public/evalight-embed", name), src);
  }
  await Bun.write(
    join(root, "public/evalight-embed/manifest.json"),
    `${JSON.stringify(fallbackManifest(), null, 2)}\n`,
  );
  return id;
}

export async function packEvalight(root, { requireJs = true, compileIfMissing = false } = {}) {
  if (compileIfMissing) {
    await ensureWorkshopUi(root);
  }
  const id = await syncEmbedBuildId(root);
  const files = {};
  for (const name of EMBED_FILES) {
    files[`evalight/${name}`] = await readText(root, `src/evalight/embed/${name}`);
  }
  for (const item of PACK_STATIC) {
    let text = await readText(root, item.from);
    if (item.stamp) text = stampHtml(text, id);
    files[item.zip] = text;
  }
  for (const item of PACK_RELEASE) {
    const file = Bun.file(join(root, item.from));
    if (await file.exists()) {
      files[item.zip] = await file.text();
    } else if (requireJs) {
      throw new Error(
        `Evalight UI is not built (${item.from}). Run bun run embed, then export again.`,
      );
    }
  }
  return files;
}

/** Keep in sync with evalight.export/with-evalight-script (browser zip rewrite). */
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
