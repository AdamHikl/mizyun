#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootScript = path.resolve(
  __dirname,
  "../../../../scripts/check-user-feedback.mjs",
);

const res = spawnSync("node", [rootScript, ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(res.status ?? 0);
