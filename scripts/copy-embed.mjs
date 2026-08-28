#!/usr/bin/env bun
import { join } from "node:path";
import { copyEmbedServer } from "./evalight-pack.mjs";

await copyEmbedServer(join(import.meta.dir, ".."));
