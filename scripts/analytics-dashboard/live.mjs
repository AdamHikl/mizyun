#!/usr/bin/env node
/** On-demand real aggregates on this Mac. Never deploys or changes source services. */
import { existsSync, writeFileSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPrivate } from "./local.mjs";
import {
  createLiveRuntime,
  ensureLiveFiles,
  LIVE_ORIGIN,
  LIVE_ROOT,
  privateJson,
} from "./runtime.mjs";
import {
  readConfig,
  createApi,
  provision,
  METABASE_VERSION,
} from "./metabase.mjs";
import { snapshotImportSql, validateSnapshot } from "./snapshot.mjs";
import { collect } from "./collect.mjs";

export const OPERATOR_EMAIL = "operator@dashboard.local.invalid";
const KEY_NAME = "Mizyun local live dashboard";
export function parseLiveArgs(args) {
  if (!args.length || (args.length === 1 && args[0] === "start"))
    return "start";
  if (args.length === 1 && ["--status", "status"].includes(args[0]))
    return "status";
  if (args.length === 1 && ["--stop", "stop"].includes(args[0])) return "stop";
  if (args.length === 1 && args[0] === "--help") return "help";
  throw new Error(
    "Use analytics:dashboard [start|--status|--stop|--help]; remote, reset and source options are refused",
  );
}
export function readLiveAdmin(root = LIVE_ROOT) {
  const value = privateJson(readPrivate(join(root, ".env.live-admin")));
  if (
    Object.keys(value).some(
      (key) => !["email", "password", "apiKey"].includes(key),
    ) ||
    value.email !== OPERATOR_EMAIL ||
    typeof value.password !== "string" ||
    !/^Live-[a-f0-9]{64}$/.test(value.password) ||
    (Object.hasOwn(value, "apiKey") &&
      (typeof value.apiKey !== "string" ||
        value.apiKey.length < 10 ||
        /[\r\n\u0000]/.test(value.apiKey)))
  )
    throw new Error(
      "Invalid private live administrator credentials; refusing to reset",
    );
  return value;
}
function createAdmin(root) {
  if (existsSync(join(root, ".env.live-admin"))) return readLiveAdmin(root);
  const value = {
    email: OPERATOR_EMAIL,
    password: `Live-${randomBytes(32).toString("hex")}`,
  };
  writeFileSync(join(root, ".env.live-admin"), JSON.stringify(value), {
    flag: "wx",
    mode: 0o600,
  });
  return value;
}
function saveAdmin(root, value, previous) {
  const current = readLiveAdmin(root);
  if (JSON.stringify(current) !== JSON.stringify(previous))
    throw new Error(
      "Live administrator credentials changed concurrently; preserved",
    );
  const temporary = join(
    root,
    `.env.live-admin-${randomBytes(8).toString("hex")}`,
  );
  writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  renameSync(temporary, join(root, ".env.live-admin"));
}
export function exportLiveLogin(root = LIVE_ROOT) {
  const value = readLiveAdmin(root),
    path = join(root, ".env.live-login");
  const content = `Private real aggregate dashboard: ${LIVE_ORIGIN}\nEmail: ${value.email}\nPassword: ${value.password}\n`;
  if (existsSync(path)) {
    if (readPrivate(path) !== content)
      throw new Error(
        "Existing live login file differs; credentials preserved",
      );
  } else writeFileSync(path, content, { flag: "wx", mode: 0o600 });
  return path;
}
export function createBootstrapApi(fetchImpl = fetch) {
  return async (method, path, body, session, remainingMs) => {
    let response;
    try {
      response = await fetchImpl(`${LIVE_ORIGIN}/api${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(
          Math.min(
            path === "/session/properties" ? 3000 : 10000,
            remainingMs ?? Infinity,
          ),
        ),
        headers: {
          "Content-Type": "application/json",
          ...(session ? { "X-Metabase-Session": session } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error("API error");
      if (response.status === 204) return null;
      return await response.json();
    } catch {
      throw new Error(
        "Private local Metabase setup request failed; diagnostics suppressed",
      );
    }
  };
}
export async function waitLiveApi(
  api,
  {
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = {},
) {
  const deadline = now() + 120000;
  // A separate iteration bound also protects injected/frozen clocks.
  for (let attempt = 0; attempt < 120 && now() < deadline; attempt++) {
    const requestBudget = Math.min(3000, deadline - now());
    if (requestBudget <= 0) break;
    let properties;
    try {
      properties = await api(
        "GET",
        "/session/properties",
        undefined,
        undefined,
        requestBudget,
      );
    } catch {
      // Cold-start transport failures are retried; no private diagnostics escape.
    }
    if (properties) {
      if (properties.version?.tag !== METABASE_VERSION)
        throw new Error("Live Metabase is not the pinned version");
      if (now() < deadline) return;
    }
    const remaining = deadline - now();
    if (remaining > 0) await pause(Math.min(1000, remaining));
  }
  throw new Error(
    "Live Metabase did not become ready within two minutes; existing data and credentials were preserved",
  );
}
export async function bootstrapLiveAdmin(
  runtime,
  { bootstrapApi = createBootstrapApi(), pause, now } = {},
) {
  runtime.verifyRunning();
  await waitLiveApi(bootstrapApi, { pause, now });
  const root = runtime.root;
  const properties = await bootstrapApi("GET", "/session/properties");
  let admin;
  if (properties["setup-token"]) {
    admin = createAdmin(root);
    if (admin.apiKey)
      throw new Error(
        "Initialized live credentials cannot be reused to reset another instance",
      );
    // Persist the password first, so a lost setup response can recover via login.
    await bootstrapApi("POST", "/setup", {
      token: properties["setup-token"],
      user: {
        email: admin.email,
        password: admin.password,
        first_name: "Local",
        last_name: "Operator",
      },
      prefs: {
        site_name: "Mizyun private developer analytics",
        allow_tracking: false,
      },
    });
  } else {
    if (!existsSync(join(root, ".env.live-admin")))
      throw new Error(
        "Initialized instance lacks owned live administrator credentials; refusing adoption or reset",
      );
    admin = readLiveAdmin(root);
  }
  const session = (
    await bootstrapApi("POST", "/session", {
      username: admin.email,
      password: admin.password,
    })
  ).id;
  if (typeof session !== "string" || !session.length)
    throw new Error("Invalid private administrator session");
  try {
    const current = await bootstrapApi(
      "GET",
      "/user/current",
      undefined,
      session,
    );
    if (current.email !== OPERATOR_EMAIL || current.is_superuser !== true)
      throw new Error("Owned local administrator access required");
    if (!admin.apiKey) {
      const groups = await bootstrapApi(
        "GET",
        "/permissions/group",
        undefined,
        session,
      );
      if (!Array.isArray(groups))
        throw new Error("Invalid local permission groups");
      const administrators = groups.filter(
        (group) => group.name === "Administrators",
      );
      if (
        administrators.length !== 1 ||
        !Number.isSafeInteger(administrators[0].id) ||
        administrators[0].id < 1
      )
        throw new Error("Unique local administrators group required");
      const keys = await bootstrapApi("GET", "/api-key", undefined, session);
      if (!Array.isArray(keys) || keys.some((key) => key.name === KEY_NAME))
        throw new Error(
          "Existing managed API key lacks local secret; refusing duplicate or regeneration",
        );
      const key = await bootstrapApi(
        "POST",
        "/api-key",
        { name: KEY_NAME, group_id: administrators[0].id },
        session,
      );
      if (
        typeof key.unmasked_key !== "string" ||
        key.unmasked_key.length < 10 ||
        /[\r\n\u0000]/.test(key.unmasked_key)
      )
        throw new Error("Invalid private administrator API key");
      const next = { ...admin, apiKey: key.unmasked_key };
      saveAdmin(root, next, admin);
      admin = next;
    }
    return admin;
  } finally {
    // A logout failure must not disclose the token or replace a useful setup error.
    try {
      await bootstrapApi("DELETE", "/session", undefined, session);
    } catch {
      /* session expires normally */
    }
  }
}
export const freshnessSql =
  "SELECT json_build_object('sources',COALESCE((SELECT json_agg(json_build_object('environment',environment,'generatedAt',generated_at,'readerVisible',generated_at>now()-interval '2 hours' AND generated_at<=now()+interval '5 minutes') ORDER BY environment) FROM reporting.refreshes WHERE environment IN ('dev','prod')),'[]'::json),'storeReports',(SELECT count(*) FROM reporting.store_metrics));";
function freshness(runtime) {
  const value = privateJson(runtime.readSql(freshnessSql));
  if (
    !Array.isArray(value?.sources) ||
    !Number.isSafeInteger(value.storeReports) ||
    value.storeReports < 0 ||
    value.sources.some(
      (source) =>
        !["dev", "prod"].includes(source.environment) ||
        typeof source.readerVisible !== "boolean" ||
        !Number.isFinite(Date.parse(source.generatedAt)),
    ) ||
    new Set(value.sources.map((source) => source.environment)).size !==
      value.sources.length
  )
    throw new Error("Invalid local live source freshness response");
  return value;
}
export async function runLive(args = process.argv.slice(2), dependencies = {}) {
  const mode = parseLiveArgs(args);
  if (mode === "help")
    return {
      help: "pnpm analytics:dashboard — start the private real-data dashboard and refresh Dev/Production aggregates\npnpm analytics:dashboard --status — read local freshness without collecting\npnpm analytics:dashboard --stop — stop only this dashboard, preserving data and credentials\nLogin: ops/analytics/.env.live-login. Source failures are reported as unavailable. Store downloads need separately imported official reports.",
    };
  const root = dependencies.root ?? LIVE_ROOT;
  const runtime =
    dependencies.runtime ??
    createLiveRuntime({
      root,
      execute: dependencies.execute,
      environment: dependencies.environment,
    });
  runtime.verifyContext();
  if (!existsSync(join(root, ".env.live")) && mode !== "start")
    return { url: LIVE_ORIGIN, status: "not-initialized" };
  if (mode === "start") {
    runtime.prepareCredentials();
    (dependencies.ensureFiles ?? ensureLiveFiles)(root);
  }
  if (mode === "stop") {
    runtime.stop();
    return {
      url: LIVE_ORIGIN,
      status: "stopped",
      notice:
        "Live analytics containers stopped; data and credentials preserved.",
    };
  }
  if (mode === "status") {
    const processes = runtime.inspect();
    if (
      processes.length !== 2 ||
      processes.some((process) => process.State !== "running")
    )
      return { url: LIVE_ORIGIN, status: "stopped" };
    return { url: LIVE_ORIGIN, status: "running", ...freshness(runtime) };
  }
  runtime.start();
  const admin = await (dependencies.bootstrap ?? bootstrapLiveAdmin)(
    runtime,
    dependencies,
  );
  const config = readConfig({
    METABASE_URL: LIVE_ORIGIN,
    METABASE_API_KEY: admin.apiKey,
    REPORTING_DB_HOST: "postgres",
    REPORTING_DB_PORT: "5432",
    REPORTING_DB_NAME: "mizyun_reporting",
    REPORTING_DB_USER: "reporting_reader",
    REPORTING_DB_PASSWORD: runtime.files.env.REPORTING_READER_PASSWORD,
  });
  runtime.verifyRunning();
  const api = dependencies.api ?? createApi(config);
  const dashboard = await (dependencies.provision ?? provision)(config, {
    api,
    defaultEnvironment: "prod",
  });
  const outcomes = [];
  for (const environment of ["dev", "prod"]) {
    try {
      runtime.verifyRunning();
      const snapshot = validateSnapshot(
        await (dependencies.collect ?? collect)(environment),
      );
      if (snapshot.environment !== environment)
        throw new Error("Source environment mismatch");
      runtime.importSql(snapshotImportSql(snapshot));
      outcomes.push({
        environment,
        status: "refreshed",
        generatedAt: snapshot.generatedAt,
      });
    } catch {
      let cleared = false;
      try {
        runtime.importSql(
          `BEGIN; DELETE FROM reporting.refreshes WHERE environment='${environment}'; COMMIT;`,
        );
        cleared = true;
      } catch {
        /* report the inability to clear instead of claiming stale data is hidden */
      }
      outcomes.push({
        environment,
        status: "unavailable",
        cleared,
        notice: cleared
          ? "Previous source snapshot cleared; collection or import failed."
          : "Source failed and previous snapshot could not be cleared; check local runtime before viewing.",
      });
    }
  }
  const loginPath = (dependencies.exportLogin ?? exportLiveLogin)(root);
  return {
    ...dashboard,
    status: outcomes.every((outcome) => outcome.status === "refreshed")
      ? "running"
      : "partial",
    loginPath,
    outcomes,
    ...freshness(runtime),
    notice:
      "Real retained aggregate snapshots only. Mac-off catch-up is limited to the retained 30-day window; app charts hide after two hours without refresh. Store downloads remain unavailable until official reports are imported.",
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runLive();
    console.log(result.help ?? JSON.stringify(result));
  } catch {
    console.error(
      "Live analytics failed; existing resources and credentials were preserved. Private diagnostics suppressed.",
    );
    process.exitCode = 1;
  }
}
