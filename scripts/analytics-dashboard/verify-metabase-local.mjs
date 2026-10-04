#!/usr/bin/env node
/** Real pinned API acceptance on the synthetic loopback instance only. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  readConfig,
  provision,
  CARD_DEFINITIONS,
  DATABASE_NAME,
  createApi,
} from "./metabase.mjs";

const origin = "http://127.0.0.1:3033";
const secretFile = new URL(
  "../../ops/analytics/.env.local-test",
  import.meta.url,
);
const secrets = Object.fromEntries(
  readFileSync(new URL("../../ops/analytics/.env", import.meta.url), "utf8")
    .split("\n")
    .filter((s) => s.includes("="))
    .map((s) => {
      const i = s.indexOf("=");
      return [s.slice(0, i), s.slice(i + 1)];
    }),
);
let fixture = existsSync(secretFile)
  ? JSON.parse(readFileSync(secretFile, "utf8"))
  : null;
let assertions = 0;
const check = (v) => {
  assert.ok(v);
  assertions++;
};
const response = async (method, path, body, session) =>
  fetch(`${origin}/api${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      ...(session ? { "X-Metabase-Session": session } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const request = async (method, path, body, session) => {
  const r = await response(method, path, body, session);
  if (!r.ok)
    throw new Error(
      `Synthetic Metabase API ${method} ${path} failed (HTTP${r.status})`,
    );
  return r.json();
};
try {
  const r = spawnSync(
    "docker",
    [
      "exec",
      "mizyun-analytics-postgres-1",
      "psql",
      "-U",
      "metabase",
      "-d",
      "mizyun_reporting",
      "-t",
      "-A",
      "-c",
      "SELECT count(*) FROM reporting.refreshes WHERE environment IN ('dev','prod')",
    ],
    { encoding: "utf8" },
  );
  check(r.status === 0 && r.stdout.trim() === "0");
  const properties = await request("GET", "/session/properties");
  check(properties.version?.tag === "v0.63.18.2");
  if (properties["setup-token"]) {
    if (fixture)
      throw new Error(
        "Existing fixture credentials preserved; refusing to overwrite",
      );
    fixture = {
      email: "dashboard-founder@example.invalid",
      password: `Analytics-test-${randomBytes(24).toString("hex")}`,
      ordinaryPassword: `Analytics-test-${randomBytes(24).toString("hex")}`,
    };
    writeFileSync(secretFile, JSON.stringify(fixture), { mode: 0o600 });
    await request("POST", "/setup", {
      token: properties["setup-token"],
      user: {
        email: fixture.email,
        password: fixture.password,
        first_name: "Synthetic",
        last_name: "Founder",
      },
      prefs: { site_name: "Mizyun synthetic analytics", allow_tracking: false },
    });
  }
  if (!fixture)
    throw new Error(
      "No locally generated synthetic admin credentials; refusing to test this instance",
    );
  const session = (
    await request("POST", "/session", {
      username: fixture.email,
      password: fixture.password,
    })
  ).id;
  check(typeof session === "string");
  const groups = await request("GET", "/permissions/group", undefined, session);
  const admin = groups.find((g) => g.name === "Administrators");
  check(!!admin);
  if (!fixture.apiKey) {
    const key = await request(
      "POST",
      "/api-key",
      { name: "Synthetic dashboard verification", group_id: admin.id },
      session,
    );
    fixture.apiKey = key.unmasked_key;
    check(typeof fixture.apiKey === "string" && fixture.apiKey.length > 10);
    writeFileSync(secretFile, JSON.stringify(fixture), { mode: 0o600 });
  }
  const config = readConfig({
    METABASE_URL: origin,
    METABASE_API_KEY: fixture.apiKey,
    REPORTING_DB_HOST: "postgres",
    REPORTING_DB_PORT: "5432",
    REPORTING_DB_NAME: "mizyun_reporting",
    REPORTING_DB_USER: "reporting_reader",
    REPORTING_DB_PASSWORD: secrets.REPORTING_READER_PASSWORD,
  });
  const first = await provision(config);
  const second = await provision(config);
  check(JSON.stringify(first) === JSON.stringify(second));
  const api = createApi(config);
  const dashboard = await api("GET", `/dashboard/${first.dashboardId}`);
  check(
    dashboard.dashcards.filter((dc) => dc.card_id).length ===
      CARD_DEFINITIONS.length,
  );
  const dbs = await api("GET", "/database");
  const db = (Array.isArray(dbs) ? dbs : dbs.data).find(
    (d) => d.name === DATABASE_NAME,
  );
  check(!!db);
  for (const dc of dashboard.dashcards.filter((d) => d.card_id)) {
    const result = await api("POST", `/card/${dc.card_id}/query`, {});
    check(result.status === "completed");
  }
  // A separate non-administrator proves data-graph and collection restrictions.
  const people = await request("GET", "/user", undefined, session);
  let ordinary = (Array.isArray(people) ? people : people.data).find(
    (p) => p.email === "dashboard-observer@example.invalid",
  );
  if (!ordinary)
    ordinary = await request(
      "POST",
      "/user",
      {
        email: "dashboard-observer@example.invalid",
        first_name: "Synthetic",
        last_name: "Observer",
        password: fixture.ordinaryPassword,
      },
      session,
    );
  check(!ordinary.is_superuser);
  const other = (
    await request("POST", "/session", {
      username: "dashboard-observer@example.invalid",
      password: fixture.ordinaryPassword,
    })
  ).id;
  const direct = await response(
    "POST",
    "/dataset",
    {
      database: db.id,
      type: "native",
      native: { query: "SELECT count(*) FROM reporting.metrics" },
    },
    other,
  );
  if (direct.status === 200) {
    const denied = await direct.json();
    check(denied.status === "failed" && !denied.data?.rows?.length);
  } else check([401, 403].includes(direct.status));
  check(
    [401, 403, 404].includes(
      (
        await response(
          "GET",
          `/dashboard/${first.dashboardId}`,
          undefined,
          other,
        )
      ).status,
    ),
  );
  check(
    [401, 403].includes(
      (await response("GET", `/dashboard/${first.dashboardId}`)).status,
    ),
  );
  check(
    [401, 403].includes(
      (
        await response("POST", "/dataset", {
          database: db.id,
          type: "native",
          native: { query: "SELECT count(*) FROM reporting.metrics" },
        })
      ).status,
    ),
  );
  const firstCard = dashboard.dashcards.find((dc) => dc.card_id).card_id;
  check(
    [401, 403, 404].includes(
      (await response("GET", `/card/${firstCard}`, undefined, other)).status,
    ),
  );
  check(
    [401, 403, 404].includes(
      (await response("POST", `/card/${firstCard}/query`, {}, other)).status,
    ),
  );
  check(
    [401, 403].includes(
      (await response("POST", `/card/${firstCard}/query`, {})).status,
    ),
  );
  // Keep the ordinary principal denied and clear the temporary login sessions.
  await response("DELETE", "/session", undefined, other);
  await response("DELETE", "/session", undefined, session);
  process.stdout.write(
    `Real Metabase v0.63.18.2 verification PASS: ${assertions} assertions, ${CARD_DEFINITIONS.length} cards; anonymous/nonadmin denial and repeat-safe provisioning verified\n`,
  );
  process.stdout.write(
    `Synthetic preview: ${origin}/dashboard/${first.dashboardId}\n`,
  );
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exitCode = 1;
}
