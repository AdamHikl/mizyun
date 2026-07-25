#!/usr/bin/env node
//
// Hosted-DB push — wraps `supabase db push` with the preflight
// gate and a hard refusal when SUPABASE_PROJECT_REF points at
// the production project. Production migrations run via CI on
// approval only; this script is for dev / staging.
//
// Usage:
//   pnpm db:push            # applies pending migrations to the linked project
//   pnpm db:push --dry-run  # prints the SQL that would run, does not apply
//   pnpm db:push --include-all  # includes seed.sql if present (we keep none)
//
// Exit codes:
//   0  push succeeded (or dry-run completed).
//   2  preflight failed.
//   4  push refused because the project looks like production.
//   3  `supabase db push` exited non-zero.
//
// Production-protection rule: a project ref whose name contains
// "prod" or "production" is refused. Update this list when the
// production project is created.

import { spawnSync } from "node:child_process";

const preflight = spawnSync("node", ["scripts/db-preflight.mjs"], {
  stdio: "inherit",
});
if (preflight.status !== 0) {
  process.exit(preflight.status ?? 2);
}

const projectRef = process.env.SUPABASE_PROJECT_REF ?? "";
const lower = projectRef.toLowerCase();
if (lower.includes("prod") || lower.includes("production")) {
  // eslint-disable-next-line no-console
  console.error(
    `Refusing to push migrations to ${projectRef}: looks like production. ` +
      "Production migrations run via CI on approval only.",
  );
  process.exit(4);
}

const args = process.argv.slice(2);
if (!args.includes("--project-ref")) {
  args.push("--project-ref", projectRef);
}

const result = spawnSync("supabase", ["db", "push", ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD ?? "",
  },
});

process.exit(result.status ?? 3);
