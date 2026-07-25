#!/usr/bin/env node
//
// Hosted-DB link — wraps `supabase link --project-ref` with the
// preflight gate. Never accepts an explicit `--password` flag;
// the CLI pulls it from `SUPABASE_DB_PASSWORD` so the secret
// never appears on the shell history.
//
// Usage:
//   pnpm db:link
//   pnpm db:link --dry-run
//
// Exit codes:
//   0  link succeeded (or dry-run completed).
//   2  preflight failed.
//   3  `supabase link` exited non-zero.

import { spawnSync } from "node:child_process";

const preflight = spawnSync("node", ["scripts/db-preflight.mjs"], {
  stdio: "inherit",
});
if (preflight.status !== 0) {
  process.exit(preflight.status ?? 2);
}

const args = process.argv.slice(2);
if (!args.includes("--project-ref")) {
  args.push("--project-ref", process.env.SUPABASE_PROJECT_REF ?? "");
}

const result = spawnSync("supabase", ["link", ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD ?? "",
  },
});

process.exit(result.status ?? 3);
