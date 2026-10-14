#!/usr/bin/env node
/** Synthetic only: fixed dedicated dashboard container, a newly named scratch DB. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  SOURCE_SQL,
  validateSnapshot,
  snapshotImportSql,
  storeImportSql,
} from "./snapshot.mjs";

const container = "mizyun-analytics-postgres-1";
const db = `analytics_source_${randomBytes(8).toString("hex")}`;
let assertions = 0;
const check = (condition) => {
  assert.ok(condition);
  assertions++;
};
const docker = (args, input, expected = 0) => {
  const r = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error || (expected === 0 ? r.status !== 0 : r.status === 0))
    throw new Error(
      "Isolated synthetic PostgreSQL assertion failed (raw diagnostics suppressed)",
    );
  return r.stdout.trim();
};
const sql = (database, input, role = "metabase", fail = false) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "sh",
      "-c",
      `PGPASSWORD="$${role === "reporting_reader" ? "REPORTING_READER_PASSWORD" : role === "reporting_writer" ? "REPORTING_WRITER_PASSWORD" : "POSTGRES_PASSWORD"}" psql -h 127.0.0.1 -X -q -t -A -v ON_ERROR_STOP=1 -U ${role} -d ${database}`,
    ],
    input,
    fail ? 1 : 0,
  );
// Freeze only clock expressions for deterministic UTC-boundary regressions;
// execute the production source query itself against real scratch tables.
const clockSql = (query, instant) => {
  const at = new Date(instant).toISOString();
  return query
    .replace(/\bnow\(\)/g, `TIMESTAMPTZ '${at}'`)
    .replace(/\bcurrent_date\b/g, `DATE '${at.slice(0, 10)}'`);
};
const capture = (instant) =>
  validateSnapshot(
    {
      ...JSON.parse(
        sql(db, instant ? clockSql(SOURCE_SQL, instant) : SOURCE_SQL),
      ),
      environment: "synthetic",
      sourceSha: "a".repeat(40),
    },
    instant ? Date.parse(instant) : Date.now(),
  );
const registrations = (v) =>
  v.metrics.filter((row) => row.metric === "registrations");
const checkRegistrationCalendar = (v) => {
  const rows = registrations(v).sort((a, b) => a.day.localeCompare(b.day));
  const last = Date.parse(v.generatedAt.slice(0, 10));
  check(rows.length === 30);
  check(
    rows.every(
      (row, index) =>
        row.day ===
          new Date(last - (29 - index) * 86400000).toISOString().slice(0, 10) &&
        row.platform === "all" &&
        row.dimension === "all",
    ),
  );
  return rows;
};
const imports = (v) =>
  sql("mizyun_reporting", snapshotImportSql(v), "reporting_writer");
try {
  check(
    docker([
      "inspect",
      "--format",
      '{{index .Config.Labels "com.docker.compose.project"}}',
      container,
    ]) === "mizyun-analytics",
  );
  check(
    docker(["inspect", "--format", "{{.Config.Image}}", container]) ===
      "postgres:17.6",
  );
  // Never mutate a warehouse already attached to real Dev/Production snapshots.
  check(
    sql(
      "mizyun_reporting",
      "SELECT count(*) FROM reporting.refreshes WHERE environment IN ('dev','prod');",
    ) === "0",
  );
  sql("metabase", `CREATE DATABASE ${db};`);
  sql(
    db,
    `
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz NOT NULL,email_confirmed_at timestamptz);
CREATE TABLE public.product_analytics_consents(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,version text,granted boolean,epoch uuid);
CREATE TABLE public.product_analytics_events(id uuid,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,epoch uuid,version text,event_name text,session_id uuid,sequence integer,flow_id uuid,platform text,app_version text,build text,properties jsonb,recorded_at timestamptz,PRIMARY KEY(user_id,id));
INSERT INTO auth.users SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '10 days',CASE WHEN n=1 THEN now() ELSE NULL END FROM generate_series(1,3)n;
INSERT INTO public.product_analytics_consents SELECT id,'product-analytics-v2',id<>'00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111' FROM auth.users;
INSERT INTO public.product_analytics_events VALUES
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','product-analytics-v2','app_session_started','22222222-2222-4222-8222-222222222222',0,NULL,'ios','1.0.6','6','{"entryPoint":"cold_start"}',now()-interval '10 days'),
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','product-analytics-v2','app_session_started','33333333-3333-4333-8333-333333333333',0,NULL,'android','1.0.6','6','{"entryPoint":"foreground"}',now()-interval '3 days'),
('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','product-analytics-v2','screen_viewed','44444444-4444-4444-8444-444444444444',1,NULL,'ios','1.0.6','6','{"screen":"dashboard"}',now()),
('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','product-analytics-v2','screen_viewed','44444444-4444-4444-8444-444444444444',2,NULL,'ios','1.0.6','6','{"screen":"settings"}',now()),
('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','product-analytics-v2','core_record_created','44444444-4444-4444-8444-444444444444',3,NULL,'ios','1.0.6','6','{"recordKind":"meal"}',now()),
('10000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','product-analytics-v2','dashboard_control_clicked','44444444-4444-4444-8444-444444444444',4,NULL,'android','1.0.6','6','{"control":"weight_card"}',now()),
('10000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','product-analytics-v2','settings_search_selected','44444444-4444-4444-8444-444444444444',5,NULL,'ios','1.0.6','6','{"destination":"appearance"}',now()),
('10000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','product-analytics-v2','core_record_created','55555555-5555-4555-8555-555555555555',0,NULL,'ios','1.0.6','6','{"recordKind":"meal"}',now()),
('10000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000003','66666666-6666-4666-8666-666666666666','product-analytics-v2','core_record_created','55555555-5555-4555-8555-555555555555',0,NULL,'ios','1.0.6','6','{"recordKind":"meal"}',now()),
('10000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','product-analytics-v2','core_record_created','55555555-5555-4555-8555-555555555555',0,NULL,'ios','1.0.6','6','{"recordKind":"meal"}',now()-interval '31 days'),
('10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','product-analytics-v2','settings_search_selected','44444444-4444-4444-8444-444444444444',6,NULL,'ios','synthetic forbidden','6','{"destination":"synthetic forbidden"}',now());
`,
  );
  const initial = capture();
  check(initial.totalAccounts === 3 && initial.consentingAccounts === 2);
  const calendar = checkRegistrationCalendar(initial);
  check(calendar.reduce((sum, row) => sum + row.value, 0) === 3);
  check(calendar.filter((row) => row.value === 3).length === 1);
  check(calendar[15].value === 0 && calendar.at(-1).value === 0);
  // Both unconfirmed accounts count, including the account denying analytics.
  check(
    sql(
      db,
      "SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NULL;",
    ) === "2",
  );
  sql(
    db,
    "DELETE FROM public.product_analytics_consents WHERE user_id='00000000-0000-4000-8000-000000000003';",
  );
  const withoutConsent = capture();
  check(withoutConsent.consentingAccounts === 1);
  check(
    registrations(withoutConsent).reduce((sum, row) => sum + row.value, 0) ===
      3,
  );
  sql(
    db,
    "INSERT INTO public.product_analytics_consents VALUES ('00000000-0000-4000-8000-000000000003','product-analytics-v2',true,'11111111-1111-4111-8111-111111111111');",
  );
  const today = initial.generatedAt.slice(0, 10);
  const metric = (v, name, dimension = "all", day = today) =>
    v.metrics.find(
      (r) =>
        r.metric === name &&
        r.dimension === dimension &&
        r.platform === "all" &&
        r.day === day,
    )?.value;
  check(metric(initial, "active_accounts") === 1); // Same account on both platforms.
  check(metric(initial, "meals_logged") === 1); // Denied, old-epoch and expired rows excluded.
  check(metric(initial, "navigation", "dashboard>settings") === 1);
  check(metric(initial, "settings_selections", "appearance") === 1);
  check(!JSON.stringify(initial).includes("synthetic forbidden"));
  check(
    initial.metrics.some((r) => r.metric === "d7_returned" && r.value === 1),
  );
  check(
    !initial.metrics.some((r) => r.metric === "d1_returned" && r.value === 1),
  );
  sql(
    db,
    `
INSERT INTO public.product_analytics_events
SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
'00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','product-analytics-v2',name,
'44444444-4444-4444-8444-444444444444',seq,
('77777777-7777-4777-8777-'||lpad(flow::text,12,'0'))::uuid,'ios','1.0.6','6',props::jsonb,
(current_date-1)::timestamptz + interval '12 hours' + make_interval(secs=>seq)
FROM (VALUES
(1,1,1,'logging_flow_started','{"flow":"meal"}'),
(2,1,2,'logging_flow_started','{"flow":"meal"}'),
(3,1,3,'logging_flow_failed','{"flow":"meal","reason":"network"}'),
(4,1,4,'logging_flow_completed','{"flow":"meal"}'),
(5,1,5,'logging_flow_completed','{"flow":"meal"}'),
(6,2,1,'logging_flow_started','{"flow":"meal"}'),
(7,2,2,'logging_flow_exited','{"flow":"meal"}'),
(8,2,3,'logging_flow_completed','{"flow":"meal"}'),
(9,3,1,'logging_flow_started','{"flow":"meal"}'),
(10,3,2,'logging_flow_failed','{"flow":"meal","reason":"network"}'),
(11,4,2,'logging_flow_completed','{"flow":"meal"}'),
(12,5,1,'logging_flow_started','{"flow":"meal"}'),
(13,5,2,'logging_flow_completed','{"flow":"meal"}'),
(14,6,1,'onboarding_started','{}'),
(15,6,2,'onboarding_failed','{"step":"primary_goal","reason":"network"}'),
(16,6,3,'onboarding_step_completed','{"step":"primary_goal"}'),
(17,6,4,'onboarding_completed','{}')
) fixture(n,flow,seq,name,props);
-- Same UUID for a different consenting owner must not join the first owner.
INSERT INTO public.product_analytics_events SELECT '20000000-0000-4000-8000-000000000018',
'00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','product-analytics-v2',
'logging_flow_started','44444444-4444-4444-8444-444444444444',1,
'77777777-7777-4777-8777-000000000001','android','1.0.6','6','{"flow":"meal"}',(current_date-1)::timestamptz+interval '12 hours';
`,
  );
  const matched = capture();
  const yesterday = new Date(Date.parse(initial.generatedAt) - 86400000)
    .toISOString()
    .slice(0, 10);
  check(metric(matched, "attempts_started", "meal", yesterday) === 5);
  check(metric(matched, "attempts_completed", "meal", yesterday) === 2);
  check(metric(matched, "attempts_exited", "meal", yesterday) === 1);
  check(metric(matched, "attempts_open", "meal", yesterday) === 2);
  check(metric(matched, "attempts_failed", "meal", yesterday) === 2);
  check(metric(matched, "attempts_completed", "onboarding", yesterday) === 1);
  check(metric(matched, "onboarding_steps", "primary_goal", yesterday) === 1);
  // The aggregate day follows the start even when completion occurs next day.
  sql(
    db,
    "UPDATE public.product_analytics_events SET recorded_at=now() WHERE id='20000000-0000-4000-8000-000000000013';",
  );
  check(metric(capture(), "attempts_completed", "meal", yesterday) === 2);
  sql(
    db,
    "DELETE FROM public.product_analytics_events WHERE id::text LIKE '20000000-%';",
  );
  imports(initial);
  imports(initial); // Lost-response retry is idempotent.
  check(
    Number(
      sql(
        "mizyun_reporting",
        "SELECT count(*) FROM reporting.metrics;",
        "reporting_reader",
      ),
    ) === initial.metrics.length,
  );
  sql(
    "mizyun_reporting",
    "SELECT * FROM reporting.metric_data;",
    "reporting_reader",
    true,
  );
  assertions++;
  sql(
    "mizyun_reporting",
    "DELETE FROM reporting.store_metrics;",
    "reporting_reader",
    true,
  );
  assertions++;
  sql("metabase", "SELECT 1;", "reporting_reader", true);
  assertions++;
  // Store normalization is tested in our disposable database only. Never leave
  // fabricated store downloads in the dashboard official-report table.
  sql(
    db,
    `GRANT CONNECT ON DATABASE ${db} TO reporting_reader, reporting_writer;`,
  );
  sql(
    db,
    readFileSync(
      new URL("../../ops/analytics/warehouse.sql", import.meta.url),
      "utf8",
    ),
  );
  const stores = [
    {
      platform: "ios",
      day: today,
      metric: "first_time_downloads",
      value: 4,
      source: "apple_app_store_connect",
    },
  ];
  sql(db, storeImportSql(stores), "reporting_writer");
  sql(db, storeImportSql(stores), "reporting_writer");
  check(
    sql(
      db,
      "SELECT value FROM reporting.store_metrics WHERE platform='ios' AND metric='first_time_downloads';",
      "reporting_reader",
    ) === "4",
  );
  // Clear/rotation and withdrawal invalidate captured event contributions.
  sql(
    db,
    "UPDATE public.product_analytics_consents SET epoch=gen_random_uuid() WHERE user_id='00000000-0000-4000-8000-000000000001';",
  );
  const rotated = capture();
  check(!rotated.metrics.some((r) => r.metric === "events"));
  check(registrations(rotated).reduce((sum, row) => sum + row.value, 0) === 3);
  imports(rotated);
  check(
    sql(
      "mizyun_reporting",
      "SELECT count(*) FROM reporting.metrics WHERE metric='events';",
      "reporting_reader",
    ) === "0",
  );
  sql(
    db,
    "DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000001';",
  );
  const deleted = capture();
  check(deleted.totalAccounts === 2);
  check(deleted.consentingAccounts === 1);
  checkRegistrationCalendar(deleted);
  check(registrations(deleted).reduce((sum, row) => sum + row.value, 0) === 2);
  imports(deleted);
  sql(
    "mizyun_reporting",
    "UPDATE reporting.refreshes SET generated_at=now()-interval '3 hours' WHERE environment='synthetic';",
    "reporting_writer",
  );
  check(
    sql(
      "mizyun_reporting",
      "SELECT count(*) FROM reporting.metrics;",
      "reporting_reader",
    ) === "0",
  );
  // Empty account sources still provide explicit zero days. Exercise the real
  // warehouse view in the scratch DB with a clock crossing UTC midnight.
  sql(db, "DELETE FROM auth.users;");
  const empty = capture();
  check(empty.totalAccounts === 0 && empty.consentingAccounts === 0);
  check(checkRegistrationCalendar(empty).every((row) => row.value === 0));
  const beforeMidnight = `${today}T23:59:00.000Z`;
  const afterMidnight = new Date(
    Date.parse(beforeMidnight) + 120000,
  ).toISOString();
  const firstDay = new Date(Date.parse(beforeMidnight) - 29 * 86400000)
    .toISOString()
    .slice(0, 10);
  const precedingDay = new Date(Date.parse(beforeMidnight) - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  sql(
    db,
    `INSERT INTO auth.users(id,created_at) VALUES
('00000000-0000-4000-8000-000000000011','${firstDay}T00:00:00Z'),
('00000000-0000-4000-8000-000000000012','${precedingDay}T23:59:59Z'),
('00000000-0000-4000-8000-000000000013','${beforeMidnight}'),
('00000000-0000-4000-8000-000000000014','${today}T23:59:01Z'),
('00000000-0000-4000-8000-000000000015','${afterMidnight}');`,
  );
  const bounded = capture(beforeMidnight);
  const boundedCalendar = checkRegistrationCalendar(bounded);
  check(boundedCalendar[0].value === 1 && boundedCalendar.at(-1).value === 1);
  check(boundedCalendar.reduce((sum, row) => sum + row.value, 0) === 2);
  const nextCalendar = checkRegistrationCalendar(capture(afterMidnight));
  check(nextCalendar.at(-1).day === afterMidnight.slice(0, 10));
  check(nextCalendar.at(-1).value === 1);
  check(nextCalendar.reduce((sum, row) => sum + row.value, 0) === 3);
  sql(db, "DELETE FROM auth.users;");
  const boundary = capture(beforeMidnight);
  check(checkRegistrationCalendar(boundary).every((row) => row.value === 0));
  sql(
    db,
    snapshotImportSql(boundary, Date.parse(beforeMidnight)),
    "reporting_writer",
  );
  const readerView = sql(
    db,
    "SELECT pg_get_viewdef('reporting.metrics', true);",
  );
  const readRegistrationsAt = (instant) => {
    sql(
      db,
      `CREATE OR REPLACE VIEW reporting.metrics AS ${clockSql(readerView, instant)};`,
    );
    return JSON.parse(
      sql(
        db,
        `SET timezone='Pacific/Auckland';
SELECT json_build_object('count',count(*),'lastDay',max(day),'total',coalesce(sum(value),0))
FROM reporting.metrics WHERE metric='registrations';`,
        "reporting_reader",
      ),
    );
  };
  const freshZeros = readRegistrationsAt(beforeMidnight);
  check(
    freshZeros.count === 30 &&
      freshZeros.lastDay === today &&
      freshZeros.total === 0,
  );
  const crossedBoundary = readRegistrationsAt(afterMidnight);
  check(
    crossedBoundary.count === 29 &&
      crossedBoundary.lastDay === today &&
      crossedBoundary.total === 0,
  );
  // A reader never generates an unobserved new day from a previous-day source.
  check(crossedBoundary.lastDay < afterMidnight.slice(0, 10));
  const expired = new Date(
    Date.parse(beforeMidnight) + 3 * 3600000,
  ).toISOString();
  check(readRegistrationsAt(expired).count === 0);
  sql(
    db,
    "DELETE FROM reporting.refreshes WHERE environment='synthetic';",
    "reporting_writer",
  );
  check(readRegistrationsAt(beforeMidnight).count === 0);
  // Restore synthetic display data, leaving only aggregate fixture counts.
  const display = { ...initial, generatedAt: new Date().toISOString() };
  imports(display);
  const older = {
    ...display,
    generatedAt: new Date(Date.now() - 10000).toISOString(),
  };
  sql("mizyun_reporting", snapshotImportSql(older), "reporting_writer", true);
  assertions++;
  check(
    Number(
      sql(
        "mizyun_reporting",
        "SELECT count(*) FROM reporting.metrics;",
        "reporting_reader",
      ),
    ) === initial.metrics.length,
  );
  process.stdout.write(
    `Isolated PostgreSQL17.6 dashboard verification PASS: ${assertions} assertions; synthetic aggregate preview retained\n`,
  );
} finally {
  // Drop only the database created by this process. Existing app databases untouched.
  try {
    sql("metabase", `DROP DATABASE IF EXISTS ${db} WITH (FORCE);`);
  } catch {
    process.stderr.write("Synthetic scratch cleanup failed\n");
    process.exitCode = 1;
  }
}
