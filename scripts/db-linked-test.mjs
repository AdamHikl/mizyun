#!/usr/bin/env node
//
// Hosted-DB pgTAP — runs the existing pgTAP suite against the
// linked project via psql. This is the only way to exercise the
// hosted schema: the JS API does not let us set the role to
// `service_role` or simulate `request.jwt.claim.sub`.
//
// Usage:
//   pnpm db:linked-test
//
// Requires:
//   - `pnpm db:link` ran successfully beforehand
//   - `SUPABASE_DB_PASSWORD` set in env (postgres-role password)
//   - `psql` on PATH (Postgres client)
//
// Exit codes:
//   0  tests passed.
//   2  preflight failed.
//   3  `psql` exited non-zero.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const preflight = spawnSync("node", ["scripts/db-preflight.mjs"], {
  stdio: "inherit",
});
if (preflight.status !== 0) {
  process.exit(preflight.status ?? 2);
}

const projectRef = process.env.SUPABASE_PROJECT_REF ?? "";
const password = process.env.SUPABASE_DB_PASSWORD ?? "";
// Supabase pooler host pattern for the postgres role.
const host = `aws-0-${region(projectRef)}.pooler.supabase.com`;
const dbUrl = `postgresql://postgres:${encodeURIComponent(password)}@${host}:6543/postgres`;

const here = fileURLToPath(new URL(".", import.meta.url));
const schemaTests = ["supabase/tests/database/0001_schema_security.test.sql"];
const isolationTests = ["supabase/tests/database/0002_user_isolation.test.sql"];

let total = 0;
let failures = 0;

for (const file of [...schemaTests, ...isolationTests]) {
  const sql = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  // eslint-disable-next-line no-console
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(
    "psql",
    [
      dbUrl,
      "--single-transaction",
      "--set",
      "ON_ERROR_STOP=1",
      "--no-psqlrc",
      "-f",
      "-",
    ],
    {
      stdio: ["pipe", "inherit", "inherit"],
      input: sql,
    },
  );
  total += 1;
  if (result.status !== 0) {
    failures += 1;
  }
}

void here;
process.exit(failures === 0 ? 0 : 3);

function region(ref) {
  const fallback = process.env.SUPABASE_REGION ?? "eu-central-1";
  if (!ref) return fallback;
  // Hosted project region is part of the project metadata; we
  // fall back to SUPABASE_REGION when the helper can't derive
  // it. The CI environment exports the region explicitly so the
  // CLI never has to guess.
  return fallback;
}
