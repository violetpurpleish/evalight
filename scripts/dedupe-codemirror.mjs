#!/usr/bin/env bun
/**
 * Nested copies of @codemirror/* break instanceof checks inside
 * EditorState.create. Delete every copy that is not the top-level one.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

const glob = new Bun.Glob("node_modules/**/node_modules/@codemirror");
const removed = [];

for await (const dir of glob.scan({ onlyFiles: false })) {
  await rm(join(process.cwd(), dir), { recursive: true, force: true });
  removed.push(dir);
}

if (removed.length) {
  console.log("Removed nested @codemirror copies:\n  " + removed.join("\n  "));
}
