#!/usr/bin/env node
/** Real local API acceptance; no source writes, raw data, resets or demo imports. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createLiveRuntime, LIVE_ORIGIN } from "./runtime.mjs";
import { readLiveAdmin } from "./live.mjs";
import {
  readConfig,
  createApi,
  provision,
  CARD_DEFINITIONS,
  DATABASE_NAME,
  LIVE_SECURITY_TEXT,
} from "./metabase.mjs";

const runtime = createLiveRuntime();
let assertions = 0;
const check = (value) => {
  assert.ok(value);
  assertions++;
};
const response = async (method, path, body, session) =>
  fetch(`${LIVE_ORIGIN}/api${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      ...(session ? { "X-Metabase-Session": session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const request = async (...args) => {
  const value = await response(...args);
  if (!value.ok) throw new Error("Local acceptance request failed");
  return value.status === 204 ? null : value.json();
};
let session, observerSession, observer, evidence;
try {
  runtime.verifyRunning();
  const admin = readLiveAdmin(runtime.root);
  const config = readConfig({
    METABASE_URL: LIVE_ORIGIN,
    METABASE_API_KEY: admin.apiKey,
    REPORTING_DB_HOST: "postgres",
    REPORTING_DB_PORT: "5432",
    REPORTING_DB_NAME: "mizyun_reporting",
    REPORTING_DB_USER: "reporting_reader",
    REPORTING_DB_PASSWORD: runtime.files.env.REPORTING_READER_PASSWORD,
  });
  const first = await provision(config, { defaultEnvironment: "prod" });
  const second = await provision(config, { defaultEnvironment: "prod" });
  check(JSON.stringify(first) === JSON.stringify(second));
  const api = createApi(config);
  const dashboard = await api("GET", `/dashboard/${first.dashboardId}`);
  const environmentParameter = dashboard.parameters.find(
    (parameter) => parameter.id === "environment",
  );
  check(environmentParameter?.default === "prod");
  check(
    JSON.stringify(environmentParameter.values_source_config.values) ===
      JSON.stringify(["dev", "prod"]),
  );
  check(
    dashboard.dashcards.filter(
      (card) =>
        !card.card_id &&
        card.visualization_settings?.text === LIVE_SECURITY_TEXT,
    ).length === 1,
  );
  check(!dashboard.public_uuid && !dashboard.enable_embedding);
  const cards = dashboard.dashcards.filter((card) => card.card_id);
  check(cards.length === CARD_DEFINITIONS.length);
  const inventory = await api("GET", "/database");
  const databases = Array.isArray(inventory) ? inventory : inventory.data;
  const reports = databases.filter(
    (database) => database.name === DATABASE_NAME,
  );
  check(reports.length === 1 && reports[0].is_sample === false);
  const database = reports[0];
  const samples = databases.filter(
    (connection) => connection.id !== database.id,
  );
  check(samples.length <= 1);
  for (const sample of samples) {
    const details = await api("GET", `/database/${sample.id}`);
    check(
      details.name === "Sample Database" &&
        details.engine === "sqlite" &&
        details.is_sample === true &&
        details.details?.db === "/plugins/sample-database.sqlite" &&
        details.details?.["read-only?"] === true &&
        Object.keys(details.details).sort().join(",") === "db,read-only?",
    );
  }
  for (const card of cards) {
    const definition = await api("GET", `/card/${card.card_id}`);
    check(definition.dataset_query.database === database.id);
    const result = await api("POST", `/card/${card.card_id}/query`, {});
    check(result.status === "completed");
  }
  check(
    [401, 403].includes(
      (await response("GET", `/dashboard/${first.dashboardId}`)).status,
    ),
  );
  check(
    [401, 403].includes(
      (
        await response("POST", "/dataset", {
          database: database.id,
          type: "native",
          native: { query: "SELECT count(*) FROM reporting.metrics" },
        })
      ).status,
    ),
  );
  session = (
    await request("POST", "/session", {
      username: admin.email,
      password: admin.password,
    })
  ).id;
  check(typeof session === "string" && session.length > 0);
  const positiveControl = await request(
    "POST",
    "/dataset",
    {
      database: database.id,
      type: "native",
      native: { query: "SELECT count(*) FROM reporting.metrics" },
    },
    session,
  );
  check(
    positiveControl.status === "completed" &&
      positiveControl.data?.rows?.length === 1,
  );
  const observerPassword = `Local-check-${randomBytes(24).toString("hex")}`;
  const observerEmail = `readonly-${randomBytes(8).toString("hex")}@dashboard.local.invalid`;
  observer = await request(
    "POST",
    "/user",
    {
      email: observerEmail,
      first_name: "Local",
      last_name: "Acceptance",
      password: observerPassword,
    },
    session,
  );
  check(observer.is_superuser === false);
  observerSession = (
    await request("POST", "/session", {
      username: observerEmail,
      password: observerPassword,
    })
  ).id;
  check(typeof observerSession === "string" && observerSession.length > 0);
  const ordinaryPrincipal = await request(
    "GET",
    "/user/current",
    undefined,
    observerSession,
  );
  check(
    ordinaryPrincipal.id === observer.id &&
      ordinaryPrincipal.is_superuser === false,
  );
  const denied = await response(
    "POST",
    "/dataset",
    {
      database: database.id,
      type: "native",
      native: { query: "SELECT count(*) FROM reporting.metrics" },
    },
    observerSession,
  );
  if (denied.status === 200) {
    const value = await denied.json();
    check(value.status === "failed" && !value.data?.rows?.length);
  } else check([401, 403].includes(denied.status));
  check(
    [401, 403, 404].includes(
      (
        await response(
          "GET",
          `/dashboard/${first.dashboardId}`,
          undefined,
          observerSession,
        )
      ).status,
    ),
  );
  check(
    [401, 403, 404].includes(
      (
        await response(
          "POST",
          `/card/${cards[0].card_id}/query`,
          {},
          observerSession,
        )
      ).status,
    ),
  );
  const sources = JSON.parse(
    runtime.readSql(
      "SELECT json_agg(json_build_object('environment',environment,'sourceSha',source_sha,'generatedAt',generated_at) ORDER BY environment) FROM reporting.refreshes WHERE environment IN ('dev','prod');",
    ),
  );
  check(Array.isArray(sources) && sources.length === 2);
  check(
    sources.every(
      (source) =>
        /^[a-f0-9]{40}$/.test(source.sourceSha) &&
        Date.now() - Date.parse(source.generatedAt) < 7200000 &&
        Date.parse(source.generatedAt) <= Date.now() + 300000,
    ),
  );
  evidence = {
    assertions,
    cards: cards.length,
    liveSources: sources,
    bundledVendorSampleExcluded: true,
    accepted: true,
  };
} catch {
  console.error(
    `Local real dashboard acceptance failed after ${assertions} assertions; private diagnostics suppressed.`,
  );
  process.exitCode = 1;
} finally {
  try {
    if (observerSession)
      await request("DELETE", "/session", undefined, observerSession);
  } catch {
    process.exitCode = 1;
  }
  try {
    if (observer?.id && session) {
      await request("DELETE", `/user/${observer.id}`, undefined, session);
      const account = await response(
        "GET",
        `/user/${observer.id}`,
        undefined,
        session,
      );
      check(
        account.status === 404 ||
          (account.ok && (await account.json()).is_active === false),
      );
    }
  } catch {
    process.exitCode = 1;
  }
  try {
    if (session) await request("DELETE", "/session", undefined, session);
  } catch {
    process.exitCode = 1;
  }
}

if (!process.exitCode && evidence)
  console.log(JSON.stringify({ ...evidence, assertions }));
else
  console.error(
    "Live acceptance incomplete or temporary account cleanup failed; success is not claimed.",
  );
