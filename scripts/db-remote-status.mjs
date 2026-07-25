#!/usr/bin/env node
//
// Hosted-DB status — runs `supabase migration list` against the
// linked project so an operator can see which migrations have
// applied remotely before triggering `db:push`.
//
// Usage:
//   pnpm db:remote-status
//
// Exit codes:
//   0  status succeeded.
//   2  preflight failed.
//   3  `supabase migration list` exited non-zero.

import { spawnSync } from "node:child_process";

const preflight = spawnSync("node", ["scripts/db-preflight.mjs"], {
  stdio: "inherit",
});
if (preflight.status !== 0) {
  process.exit(preflight.status ?? 2);
}

const result = spawnSync("supabase", ["migration", "list"], {
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD ?? "",
  },
});

process.exit(result.status ?? 3);
