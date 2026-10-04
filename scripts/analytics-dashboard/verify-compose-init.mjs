#!/usr/bin/env node
/** Fresh init must work without resetting any existing application or dashboard volume. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const project = `mizyun-analytics-init-check-${randomBytes(8).toString("hex")}`;
const compose = [
  "compose",
  "--project-name",
  project,
  "--env-file",
  fileURLToPath(new URL("../../ops/analytics/.env", import.meta.url)),
  "-f",
  fileURLToPath(new URL("../../ops/analytics/compose.yaml", import.meta.url)),
];
const run = (args) =>
  spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
try {
  assert.equal(run([...compose, "up", "-d", "postgres"]).status, 0);
  const container = `${project}-postgres-1`;
  assert.equal(
    run([
      "inspect",
      "--format",
      '{{index .Config.Labels "com.docker.compose.project"}}',
      container,
    ]).stdout.trim(),
    project,
  );
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const health = run([
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      container,
    ]);
    if (health.stdout.trim() === "healthy") {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(ready);
  const check = run([
    "exec",
    container,
    "psql",
    "-U",
    "metabase",
    "-d",
    "mizyun_reporting",
    "-t",
    "-A",
    "-c",
    "SELECT to_regclass('reporting.metrics') IS NOT NULL AND has_table_privilege('reporting_reader','reporting.metrics','SELECT') AND NOT has_table_privilege('reporting_reader','reporting.metric_data','SELECT') AND NOT has_database_privilege('reporting_reader','metabase','CONNECT')",
  ]);
  assert.equal(check.status, 0);
  assert.equal(check.stdout.trim(), "t");
  process.stdout.write(
    "Fresh compose PostgreSQL17.6 initialization and reader isolation PASS; isolated scratch project only\n",
  );
} catch {
  process.stderr.write(
    "Fresh analytics initialization failed; no raw Docker/SQL diagnostics disclosed\n",
  );
  process.exitCode = 1;
} finally {
  // The unique project is created by this invocation; unrelated volumes never match it.
  if (run([...compose, "down", "--volumes"]).status !== 0) {
    process.stderr.write("Scratch analytics project cleanup failed\n");
    process.exitCode = 1;
  }
}
