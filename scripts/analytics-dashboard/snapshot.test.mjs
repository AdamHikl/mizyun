import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOURCE_SQL,
  snapshotImportSql,
  storeImportSql,
  validateSnapshot,
} from "./snapshot.mjs";
import { collect, parseArgs, remoteCommand } from "./collect.mjs";

const now = Date.parse("2026-10-03T12:00:00.000Z");
const snapshot = () => ({
  environment: "synthetic",
  generatedAt: new Date(now).toISOString(),
  sourceSha: "a".repeat(40),
  totalAccounts: 3,
  consentingAccounts: 2,
  metrics: [
    {
      day: "2026-10-03",
      platform: "ios",
      metric: "settings_selections",
      dimension: "appearance",
      value: 1,
    },
  ],
});

test("aggregate trust boundary rejects private strings, extras, stale snapshots and duplicates", () => {
  assert.equal(validateSnapshot(snapshot(), now).metrics.length, 1);
  for (const mutate of [
    (v) => (v.metrics[0].dimension = "private query"),
    (v) => (v.metrics[0].query = "private query"),
    (v) => v.metrics.push({ ...v.metrics[0] }),
    (v) => (v.consentingAccounts = 4),
    (v) => (v.generatedAt = "2026-10-03T09:00:00.000Z"),
    (v) => (v.metrics[0].value = -1),
    (v) => (v.metrics[0].day = "2026-02-31"),
    (v) => (v.metrics[0].day = "2026-09-01"),
    (v) => (v.sourceSha = "a;select private"),
    (v) => (v.metrics[0].metric = "user_ids"),
  ]) {
    const v = snapshot();
    mutate(v);
    assert.throws(() => validateSnapshot(v, now), /Invalid aggregate/);
  }
});
test("SQL import atomically replaces the current environment and cannot interpolate data as code", () => {
  const sql = snapshotImportSql(snapshot(), now);
  assert.match(sql, /LOCK TABLE reporting.refreshes/);
  assert.match(sql, /Stale snapshot/);
  assert.match(
    sql,
    /DELETE FROM reporting.metric_data WHERE environment='synthetic'/,
  );
  assert.match(sql, /decode\('[a-f0-9]+','hex'\)/);
  assert.match(sql, /COMMIT;$/);
  assert.doesNotMatch(sql, /appearance/);
});
test("only normalized separately attributed store aggregates are accepted", () => {
  const r = {
    platform: "ios",
    day: "2026-10-01",
    metric: "first_time_downloads",
    value: 2,
    source: "apple_app_store_connect",
  };
  assert.match(storeImportSql([r], now), /ON CONFLICT\(platform,day,metric\)/);
  for (const bad of [
    { ...r, source: "google_play_console" },
    { ...r, value: null },
    { ...r, email: "private" },
    { ...r, metric: "downloads" },
  ])
    assert.throws(() => storeImportSql([bad], now), /Invalid normalized/);
  assert.throws(() => storeImportSql([r, r], now));
});
test("collector only selects fixed marked Hetzner environments and sanitized errors", () => {
  assert.deepEqual(parseArgs(["--env", "dev"]).environment, "dev");
  for (const args of [
    ["--env", "both"],
    ["--env", "prod", "--snapshot", "/tmp/input"],
    ["--env", "synthetic"],
    ["--ssh", "rpserver"],
  ])
    assert.throws(() => parseArgs(args));
  assert.match(remoteCommand("dev"), /hetzner-primary/);
  assert.match(
    remoteCommand("dev"),
    /"HostIp":"127\.0\.0\.1","HostPort":"5433"/,
  );
  assert.match(
    remoteCommand("prod"),
    /"HostIp":"127\.0\.0\.1","HostPort":"5432"/,
  );
  assert.throws(() => remoteCommand("prod; printenv"));
  assert.throws(
    () => collect("dev", () => "private broken row"),
    (e) => !e.message.includes("private"),
  );
  assert.match(SOURCE_SQL, /READ ONLY/);
  assert.match(SOURCE_SQL, /c\.epoch=e\.epoch/);
  assert.match(SOURCE_SQL, /c\.granted/);
  assert.doesNotMatch(SOURCE_SQL, /\/\*ALLOWED_DIMENSIONS\*\//);
});
