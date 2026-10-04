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
const capture = () =>
  validateSnapshot({
    ...JSON.parse(sql(db, SOURCE_SQL)),
    environment: "synthetic",
    sourceSha: "a".repeat(40),
  });
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
CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz NOT NULL);
CREATE TABLE public.product_analytics_consents(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,version text,granted boolean,epoch uuid);
CREATE TABLE public.product_analytics_events(id uuid,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,epoch uuid,version text,event_name text,session_id uuid,sequence integer,flow_id uuid,platform text,app_version text,build text,properties jsonb,recorded_at timestamptz,PRIMARY KEY(user_id,id));
INSERT INTO auth.users SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '10 days' FROM generate_series(1,3)n;
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
