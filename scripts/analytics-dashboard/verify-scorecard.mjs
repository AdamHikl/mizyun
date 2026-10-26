#!/usr/bin/env node
/**
 * Synthetic only: runs scorecard.sql against scorecard-fixture.sql in a
 * disposable, uniquely named PostgreSQL container that is removed afterwards.
 * Never point this at Hetzner, the Pi or the shared local Supabase database.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SCORECARD_SQL, parseScorecard } from "./scorecard.mjs";

const image = process.env.SCORECARD_PG_IMAGE ?? "postgres:17-alpine";
const container = `mizyun-scorecard-verify-${randomBytes(6).toString("hex")}`;
const fixture = readFileSync(
  new URL("./scorecard-fixture.sql", import.meta.url),
  "utf8",
);

const docker = (args, input) => {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`docker ${args[0]} failed: ${result.stderr?.trim()}`);
  return result.stdout;
};
const psql = (input) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
    ],
    input,
  );

docker([
  "run",
  "--rm",
  "-d",
  "--name",
  container,
  "-e",
  `POSTGRES_PASSWORD=${randomBytes(12).toString("hex")}`,
  image,
]);
try {
  // The image restarts PostgreSQL once after initialisation; require a stable
  // TCP-ready server on three consecutive probes.
  for (let attempt = 0, stable = 0; stable < 3; attempt++) {
    const ready = spawnSync("docker", [
      "exec",
      container,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-tAc",
      "SELECT 1",
    ]);
    stable = ready.status === 0 ? stable + 1 : 0;
    if (attempt > 120) throw new Error("PostgreSQL did not start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  psql(fixture);
  const rows = parseScorecard(
    psql(`SET mizyun.scorecard_report_date = '2026-11-30';\n${SCORECARD_SQL}`),
  );
  const row = (metric, dimension = "all") =>
    rows.find((r) => r.metric === metric && r.dimension === dimension);
  const pick = (r) =>
    r && [r.cohortStart, r.cohortEnd, r.numerator, r.denominator];

  assert.deepEqual(pick(row("installs")), [
    "2026-11-23",
    "2026-11-29",
    1,
    null,
  ]);
  assert.equal(row("installs", "friend_or_family")?.numerator, 1);
  assert.equal(row("installs", "reddit"), undefined);
  assert.deepEqual(pick(row("registrations")), [
    "2026-11-23",
    "2026-11-29",
    1,
    null,
  ]);
  assert.deepEqual(pick(row("activated")), ["2026-11-16", "2026-11-22", 1, 3]);
  assert.deepEqual(
    pick(row("activated", "climbing_gym_or_club")).slice(2),
    [1, 1],
  );
  assert.deepEqual(pick(row("activated", "instagram")).slice(2), [0, 1]);
  assert.deepEqual(pick(row("activated", "unanswered")).slice(2), [0, 1]);
  assert.equal(row("first_record_kind", "meal")?.numerator, 1);
  assert.equal(row("first_record_kind", "workout")?.numerator, 1);
  assert.equal(row("first_record_kind", "bouldering_session"), undefined);
  assert.deepEqual(pick(row("day_7_return")), [
    "2026-11-16",
    "2026-11-22",
    1,
    1,
  ]);
  assert.deepEqual(pick(row("week_4_return", "2026-W44")), [
    "2026-10-26",
    "2026-11-01",
    1,
    null,
  ]);
  // u2's first record came 9 days after the first run: not an activated cohort member.
  assert.equal(row("first_record_cohort", "2026-W48")?.numerator, 1);
  assert.deepEqual(pick(row("mau")), ["2026-10-31", "2026-11-29", 6, 8]);
  assert.equal(row("registered_accounts")?.numerator, 9);
  assert.equal(row("consenting_accounts")?.numerator, 8);
  assert.equal(rows.length, 15);

  // A mid-week report date snaps to that week's Monday.
  const midweek = parseScorecard(
    psql(`SET mizyun.scorecard_report_date = '2026-12-02';\n${SCORECARD_SQL}`),
  );
  assert.deepEqual(
    midweek.map((r) => [r.metric, r.dimension, r.numerator, r.denominator]),
    rows.map((r) => [r.metric, r.dimension, r.numerator, r.denominator]),
  );

  // An empty week is reported as an explicit zero cohort, never omitted.
  const empty = parseScorecard(
    psql(`SET mizyun.scorecard_report_date = '2027-03-01';\n${SCORECARD_SQL}`),
  );
  const emptyRow = (metric) =>
    empty.find((r) => r.metric === metric && r.dimension === "all");
  assert.deepEqual(pick(emptyRow("activated")).slice(2), [0, 0]);
  assert.deepEqual(pick(emptyRow("installs")).slice(2), [0, null]);
  assert.deepEqual(pick(emptyRow("day_7_return")).slice(2), [0, 0]);

  // The source query is read-only.
  assert.throws(() =>
    psql(
      SCORECARD_SQL.replace(
        /WITH params AS/,
        "DELETE FROM public.product_analytics_events;\nWITH params AS",
      ),
    ),
  );
  console.log(
    `Scorecard verified against the synthetic fixture: ${rows.length} aggregate rows.`,
  );
} finally {
  spawnSync("docker", ["rm", "-f", container], { encoding: "utf8" });
}
