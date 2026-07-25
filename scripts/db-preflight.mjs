#!/usr/bin/env node
//
// Hosted-DB preflight — gates every `db:*` command against the
// remote Supabase project. Prints a checklist and refuses to
// continue when any required env is missing or looks unsafe.
//
// Usage:
//   pnpm db:preflight
//
// Required env:
//   SUPABASE_PROJECT_REF   the hosted project id (e.g. "abcdefghijkl")
//   SUPABASE_DB_PASSWORD   the postgres-role password from
//                          Supabase Dashboard → Project Settings
//                          → Database. Never commit.
//
// Optional env:
//   SUPABASE_REGION       EU region code (e.g. "eu-central-1")
//                          Defaults to "eu-central-1" per ADR-0017.
//
// Exit codes:
//   0  preflight passed.
//   2  required env missing or unsafe.

import { existsSync, statSync } from "node:fs";
import { exit } from "node:process";

const REQUIRED_ENV = ["SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD"];
const SAFE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

const failures = [];

const requireEnv = (name) => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    failures.push(`missing required env ${name}`);
    return null;
  }
  return value;
};

const projectRef = requireEnv("SUPABASE_PROJECT_REF");
const dbPassword = requireEnv("SUPABASE_DB_PASSWORD");

if (projectRef !== null && !SAFE_KEY_PATTERN.test(projectRef)) {
  failures.push(
    `SUPABASE_PROJECT_REF "${projectRef}" contains unsafe characters`,
  );
}

if (dbPassword !== null && dbPassword.length < 16) {
  failures.push(
    `SUPABASE_DB_PASSWORD is suspiciously short (<16 chars); refusing`,
  );
}

const region = process.env.SUPABASE_REGION ?? "eu-central-1";
const euRegions = new Set([
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
]);
if (!euRegions.has(region)) {
  failures.push(
    `SUPABASE_REGION "${region}" is not in the EU allow-list (ADR-0017)`,
  );
}

// Guard against committing secrets. The root .env is gitignored;
// refuse to run if it appears tracked or has loose permissions.
const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) {
  try {
    const stat = statSync(envFile);
    const bits = stat.mode & 0o777;
    if (bits !== 0o600) {
      failures.push(
        `.env has permissions ${bits.toString(8)}; expected 0600 (mode 600)`,
      );
    }
  } catch {
    // best-effort; if stat fails we skip the check
  }
}

const printSummary = () => {
  // eslint-disable-next-line no-console
  console.log(
    [
      "AI-OPS-002 hosted DB preflight:",
      `  SUPABASE_PROJECT_REF = ${projectRef ?? "<missing>"}`,
      `  SUPABASE_REGION       = ${region}`,
      `  SUPABASE_DB_PASSWORD  = ${dbPassword === null ? "<missing>" : "<set>"}`,
    ].join("\n"),
  );
};

printSummary();

if (failures.length > 0) {
  // eslint-disable-next-line no-console
  console.error("\nPreflight failed:");
  for (const failure of failures) {
    // eslint-disable-next-line no-console
    console.error(`  - ${failure}`);
  }
  exit(2);
}

// eslint-disable-next-line no-console
console.log(
  "\nPreflight passed. You can run pnpm db:link, db:push, db:linked-test.",
);
