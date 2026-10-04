import { readFileSync } from "node:fs";
import {
  screenNameSchema,
  dashboardControlSchema,
  analyticsSettingsDestinationSchema,
  durationBucketSchema,
  failureReasonSchema,
  featureActionSchema,
  onboardingStepSchema,
} from "../../packages/contracts/src/index.ts";

const simple = new Set([
  "active_accounts",
  "sessions",
  "meals_logged",
  "workouts_logged",
  "body_records_logged",
  "events",
  "registrations",
  "d1_eligible",
  "d1_returned",
  "d7_eligible",
  "d7_returned",
  "onboarding_started",
  "onboarding_completed",
]);
const flows = ["meal", "workout", "body_measurement"];
const flowMetric = new Set([
  "flow_started",
  "flow_completed",
  "flow_failed",
  "flow_exited",
]);
const attempts = new Set([
  "attempts_started",
  "attempts_completed",
  "attempts_exited",
  "attempts_open",
  "attempts_failed",
]);
const attemptKinds = [...flows, "onboarding"];
const enumDimensions = {
  onboarding_steps: onboardingStepSchema.options,
  onboarding_failures: onboardingStepSchema.options,
  onboarding_exits: onboardingStepSchema.options,
  screen_views: screenNameSchema.options,
  dashboard_clicks: dashboardControlSchema.options,
  settings_searches: ["none", "1_to_5", "6_plus"],
  settings_selections: analyticsSettingsDestinationSchema.options,
};
const sqlStrings = (items) => items.map((s) => `'${s}'`).join(",");
const pairs = (a, b) => a.flatMap((x) => b.map((y) => `${x}>${y}`));
const safeSql = [
  `(metric IN (${sqlStrings([...attempts])}) AND dimension IN (${sqlStrings(attemptKinds)}))`,
  `(metric IN (${sqlStrings([...simple])}) AND dimension='all')`,
  `(metric IN (${sqlStrings([...flowMetric])}) AND dimension IN (${sqlStrings(flows)}))`,
  ...Object.entries(enumDimensions).map(
    ([m, ds]) => `(metric='${m}' AND dimension IN (${sqlStrings(ds)}))`,
  ),
  `(metric='navigation' AND dimension IN (${sqlStrings(pairs(screenNameSchema.options, screenNameSchema.options).filter((s) => s.split(">")[0] !== s.split(">")[1]))}))`,
  `(metric='duration_bucket' AND dimension IN (${sqlStrings(pairs(flows, durationBucketSchema.options))}))`,
  `(metric='failures' AND dimension IN (${sqlStrings(pairs(flows, failureReasonSchema.options))}))`,
  `(metric='feature_actions' AND dimension IN (${sqlStrings(pairs(featureActionSchema.options, ["success", "failure"]))}))`,
  `(metric='active_days' AND dimension ~ '^(?:[1-9]|[12][0-9]|30)$')`,
  `(metric='releases' AND (dimension='unknown' OR dimension ~ '^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}/([0-9]{1,6}|unknown)$'))`,
].join(" OR ");
export const SOURCE_SQL = readFileSync(
  new URL("./source.sql", import.meta.url),
  "utf8",
).replace("/*ALLOWED_DIMENSIONS*/", () => `(${safeSql})`);
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const date = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;

export function validDimension(metric, dimension) {
  if (attempts.has(metric)) return attemptKinds.includes(dimension);
  if (simple.has(metric)) return dimension === "all";
  if (flowMetric.has(metric)) return flows.includes(dimension);
  if (Object.hasOwn(enumDimensions, metric))
    return enumDimensions[metric].includes(dimension);
  if (metric === "active_days")
    return /^(?:[1-9]|[12][0-9]|30)$/.test(dimension);
  if (metric === "releases")
    return (
      dimension === "unknown" ||
      /^\d{1,4}\.\d{1,4}\.\d{1,4}\/(?:\d{1,6}|unknown)$/.test(dimension)
    );
  const [a, b, ...extra] = dimension.split(">");
  if (extra.length) return false;
  if (metric === "navigation")
    return (
      screenNameSchema.options.includes(a) &&
      screenNameSchema.options.includes(b) &&
      a !== b
    );
  if (metric === "duration_bucket")
    return flows.includes(a) && durationBucketSchema.options.includes(b);
  if (metric === "failures")
    return flows.includes(a) && failureReasonSchema.options.includes(b);
  if (metric === "feature_actions")
    return (
      featureActionSchema.options.includes(a) &&
      ["success", "failure"].includes(b)
    );
  return false;
}

/** Strict boundary: malicious source properties cannot enter an aggregate warehouse. */
export function validateSnapshot(v, now = Date.now()) {
  const invalid = () => {
    throw new Error("Invalid aggregate snapshot; nothing imported");
  };
  if (
    !exact(v, [
      "environment",
      "generatedAt",
      "sourceSha",
      "totalAccounts",
      "consentingAccounts",
      "metrics",
    ])
  )
    invalid();
  if (
    !["dev", "prod", "synthetic"].includes(v.environment) ||
    !/^[a-f0-9]{40}$/.test(v.sourceSha)
  )
    invalid();
  const generated = Date.parse(v.generatedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.generatedAt) ||
    !Number.isFinite(generated) ||
    generated > now + 300000 ||
    generated < now - 7200000
  )
    invalid();
  if (
    !count(v.totalAccounts) ||
    !count(v.consentingAccounts) ||
    v.consentingAccounts > v.totalAccounts ||
    !Array.isArray(v.metrics) ||
    v.metrics.length > 20000
  )
    invalid();
  const firstDay = new Date(generated - 29 * 86400000)
    .toISOString()
    .slice(0, 10);
  const lastDay = new Date(generated).toISOString().slice(0, 10);
  const keys = new Set();
  for (const row of v.metrics) {
    if (
      !exact(row, ["day", "platform", "metric", "dimension", "value"]) ||
      !date(row.day) ||
      row.day < firstDay ||
      row.day > lastDay ||
      !["ios", "android", "all"].includes(row.platform) ||
      !count(row.value) ||
      typeof row.dimension !== "string" ||
      !validDimension(row.metric, row.dimension)
    )
      invalid();
    const key = JSON.stringify([
      row.day,
      row.platform,
      row.metric,
      row.dimension,
    ]);
    if (keys.has(key)) invalid();
    keys.add(key);
  }
  return v;
}

export function snapshotImportSql(value, now = Date.now()) {
  const v = validateSnapshot(value, now);
  const hex = Buffer.from(JSON.stringify(v)).toString("hex");
  return `BEGIN; SET LOCAL statement_timeout='15s';
CREATE TEMP TABLE incoming AS SELECT convert_from(decode('${hex}','hex'),'UTF8')::jsonb payload;
-- Serialize refreshes; an older/lost-response retry cannot roll a report back.
LOCK TABLE reporting.refreshes IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM reporting.refreshes r,incoming i
 WHERE r.environment=i.payload->>'environment' AND r.generated_at>(i.payload->>'generatedAt')::timestamptz)
 THEN RAISE EXCEPTION 'Stale snapshot'; END IF; END $$;
DELETE FROM reporting.metric_data WHERE environment='${v.environment}';
INSERT INTO reporting.refreshes SELECT payload->>'environment',(payload->>'generatedAt')::timestamptz,payload->>'sourceSha',(payload->>'totalAccounts')::bigint,(payload->>'consentingAccounts')::bigint FROM incoming
ON CONFLICT(environment) DO UPDATE SET generated_at=excluded.generated_at,source_sha=excluded.source_sha,total_accounts=excluded.total_accounts,consenting_accounts=excluded.consenting_accounts;
INSERT INTO reporting.metric_data SELECT '${v.environment}',r.day,r.platform,r.metric,r.dimension,r.value
FROM incoming i,LATERAL jsonb_to_recordset(i.payload->'metrics') AS r(day date,platform text,metric text,dimension text,value bigint);
COMMIT;`;
}

export function validateStoreImport(v, now = Date.now()) {
  const invalid = () => {
    throw new Error("Invalid normalized store report; nothing imported");
  };
  if (!Array.isArray(v) || !v.length || v.length > 10000) invalid();
  const seen = new Set();
  for (const r of v) {
    if (
      !exact(r, ["platform", "day", "metric", "value", "source"]) ||
      !date(r.day) ||
      r.day > new Date(now).toISOString().slice(0, 10) ||
      !count(r.value)
    )
      invalid();
    const apple =
      r.platform === "ios" &&
      r.source === "apple_app_store_connect" &&
      ["first_time_downloads", "redownloads"].includes(r.metric);
    const google =
      r.platform === "android" &&
      r.source === "google_play_console" &&
      [
        "user_acquisitions",
        "device_installs",
        "listing_visitors",
        "install_clicks",
      ].includes(r.metric);
    if (!apple && !google) invalid();
    const key = JSON.stringify([r.platform, r.day, r.metric]);
    if (seen.has(key)) invalid();
    seen.add(key);
  }
  return v;
}

export function storeImportSql(v, now = Date.now()) {
  const hex = Buffer.from(JSON.stringify(validateStoreImport(v, now))).toString(
    "hex",
  );
  return `BEGIN; SET LOCAL statement_timeout='15s';
INSERT INTO reporting.store_metrics SELECT r.platform,r.day,r.metric,r.value,r.source,now()
FROM jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb) AS r(platform text,day date,metric text,value bigint,source text)
ON CONFLICT(platform,day,metric) DO UPDATE SET value=excluded.value,source=excluded.source,imported_at=excluded.imported_at;
COMMIT;`;
}
