import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const binary = resolve(process.argv[2]);
const scratch = await mkdtemp(join(tmpdir(), "evalight-workshop-"));
const project = join(scratch, "project with spaces");
const opener = process.platform === "darwin" ? "open" : "xdg-open";
const opened = join(scratch, "opened");
let child;
let exited;
try {
  await mkdir(join(project, "src"), { recursive: true });
  // Detect the workshop as the project type, so this smoke test needs no app runtime.
  await writeFile(join(project, "shadow-cljs.edn"), "{:builds {:workshop {}}}");
  await writeFile(join(project, "src/demo.cljs"), "(ns demo)\n");
  await writeFile(join(scratch, opener), '#!/bin/sh\nprintf "%s" "$1" > "$OPENED"\n', { mode: 0o755 });

  child = spawn(binary, ["dev"], {
    cwd: join(project, "src"),
    env: { ...process.env, PATH: scratch + delimiter + process.env.PATH, PORT: "0", OPENED: opened },
    stdio: ["ignore", "pipe", "inherit"],
  });
  exited = new Promise((done) => child.once("close", done));
  const url = await new Promise((done, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Workshop did not start:\n" + output)), 10000);
    child.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/^Evalight  (http:\/\/127\.0\.0\.1:\d+\/)$/m);
      if (match) {
        clearTimeout(timeout);
        done(match[1]);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    exited.then((code) => {
      clearTimeout(timeout);
      reject(new Error(`Workshop exited (${code}):\n${output}`));
    });
  });
  const meta = await (await fetch(url + "api/meta")).json();
  assert.equal(meta.kind, "workshop");
  assert.equal(meta.root, await realpath(project));
  const source = await fetch(url + "api/fs/read?path=src%2Fdemo.cljs");
  assert.equal(source.status, 200);
  assert.equal((await source.json()).content, "(ns demo)\n");
  assert.equal((await fetch(url + "js/main.js")).status, 200);
  for (let tries = 0; tries < 100; tries++) {
    if (await Bun.file(opened).exists()) break;
    await Bun.sleep(20);
  }
  assert.equal(await readFile(opened, "utf8"), url);
  console.log("CLI workshop smoke test passed");
} finally {
  child?.kill();
  await exited;
  await rm(scratch, { recursive: true, force: true });
}
