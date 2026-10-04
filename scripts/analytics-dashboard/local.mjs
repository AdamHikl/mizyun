#!/usr/bin/env node
/** Local synthetic preview only. Never invokes source collectors, SSH or resets. */
import { lstatSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { generateDemo, DEMO_SHA, AUTOMATED_FIXTURE_SHA } from "./demo.mjs";
import { snapshotImportSql } from "./snapshot.mjs";
import {
  provision,
  createApi,
  readConfig,
  METABASE_VERSION,
} from "./metabase.mjs";

export const LOCAL_ORIGIN = "http://127.0.0.1:3033";
export const PROJECT = "mizyun-analytics";
const directory = fileURLToPath(
  new URL("../../ops/analytics/", import.meta.url),
);
const expectedEmails = [
  "dashboard-founder@example.invalid",
  "dashboard-observer@example.invalid",
];
const envKeys = [
  "METABASE_DB_PASSWORD",
  "REPORTING_READER_PASSWORD",
  "REPORTING_WRITER_PASSWORD",
  "METABASE_ENCRYPTION_KEY",
  "METABASE_PORT",
  "METABASE_SITE_URL",
];
const expectedMetabaseEnv = {
  MB_DB_TYPE: "postgres",
  MB_DB_HOST: "postgres",
  MB_DB_PORT: "5432",
  MB_DB_DBNAME: "metabase",
  MB_DB_USER: "metabase",
  MB_SITE_URL: LOCAL_ORIGIN,
  MB_ENABLE_PUBLIC_SHARING: "false",
  MB_ENABLE_EMBEDDING: "false",
  MB_QUERY_CACHING_ENABLED: "false",
  MB_METABOT_ENABLED: "false",
  MB_EMBEDDED_METABOT_ENABLED: "false",
  MB_ANON_TRACKING_ENABLED: "false",
};
function assertMetabaseEnv(environment) {
  if (
    Object.entries(expectedMetabaseEnv).some(
      ([key, value]) => environment?.[key] !== value,
    ) ||
    environment.MB_DB_CONNECTION_URI ||
    ["MB_ENABLE_EMBEDDING_STATIC", "MB_ENABLE_EMBEDDING_INTERACTIVE"].some(
      (key) => Object.hasOwn(environment, key) && environment[key] !== "false",
    )
  )
    throw new Error(
      "Unexpected effective Metabase backend, sharing, cache, AI or tracking settings",
    );
}
const privateJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid private local JSON; diagnostics suppressed");
  }
};

export function parseLocalArgs(args) {
  if (!args.length) return "start";
  if (args.length === 1 && args[0] === "--status") return "status";
  if (args.length === 1 && args[0] === "--help") return "help";
  throw new Error(
    "Use analytics:dashboard:local [--status|--help]; no remote or environment options allowed",
  );
}
export function readPrivate(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.uid !== process.getuid()
  )
    throw new Error(
      "Local credential files must be owned regular files with mode 600",
    );
  return readFileSync(path, "utf8");
}
export function readLocalFiles(root = directory) {
  const env = {};
  for (const line of readPrivate(join(root, ".env")).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const split = line.indexOf("=");
    const key = line.slice(0, split);
    const value = line.slice(split + 1);
    if (
      split < 1 ||
      !envKeys.includes(key) ||
      Object.hasOwn(env, key) ||
      !value ||
      /[\r\n\u0000]/.test(value)
    )
      throw new Error("Invalid private local configuration");
    env[key] = value;
  }
  if (
    envKeys.some((key) => !env[key]) ||
    env.METABASE_PORT !== "3033" ||
    env.METABASE_SITE_URL !== LOCAL_ORIGIN
  )
    throw new Error(
      "Local preview must use the fixed loopback origin and complete existing secrets",
    );
  const fixture = privateJson(readPrivate(join(root, ".env.local-test")));
  if (
    fixture.email !== expectedEmails[0] ||
    typeof fixture.password !== "string" ||
    fixture.password.length < 16 ||
    /[\r\n\u0000]/.test(fixture.password) ||
    typeof fixture.apiKey !== "string" ||
    fixture.apiKey.length < 10
  )
    throw new Error(
      "Existing synthetic founder credentials/API key required; run the local initialization verification first",
    );
  return { env, fixture, root };
}

export function assertLocalContext(value, environment = process.env) {
  if (environment.DOCKER_HOST || environment.DOCKER_CONTEXT)
    throw new Error(
      "Docker endpoint/context overrides are not allowed for local analytics",
    );
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !/^unix:\/\/\//.test(value[0]?.Endpoints?.docker?.Host ?? "")
  )
    throw new Error(
      "Analytics preview requires a local Unix Docker daemon; remote contexts are refused",
    );
}
export function assertLocalCompose(value, root = directory) {
  const db = value.services?.postgres;
  const mb = value.services?.metabase;
  if (
    value.name !== PROJECT ||
    Object.keys(value.services ?? {})
      .sort()
      .join(",") !== "metabase,postgres" ||
    db?.image !== "postgres:17.6" ||
    mb?.image !== "metabase/metabase:v0.63.18.2"
  )
    throw new Error("Dedicated pinned analytics compose target required");
  for (const service of [db, mb])
    if (
      service.build ||
      service.command ||
      service.entrypoint ||
      service.privileged ||
      service.network_mode ||
      Object.keys(service.networks ?? {}).join(",") !== "analytics"
    )
      throw new Error("Unexpected analytics service overrides or networks");
  if (
    db.ports?.length ||
    mb.ports?.length !== 1 ||
    mb.ports[0].host_ip !== "127.0.0.1" ||
    String(mb.ports[0].published) !== "3033" ||
    mb.ports[0].target !== 3000
  )
    throw new Error("Only the fixed Metabase loopback port may be exposed");
  assertMetabaseEnv(mb.environment);
  const mounts = db.volumes ?? [];
  if (
    mounts.length !== 3 ||
    !mounts.some(
      (v) =>
        v.type === "volume" &&
        v.source === "postgres-data" &&
        v.target === "/var/lib/postgresql/data",
    ) ||
    !mounts.some(
      (v) =>
        v.type === "bind" &&
        v.source === join(root, "init.sql") &&
        v.target === "/docker-entrypoint-initdb.d/10-reporting.sql" &&
        v.read_only === true,
    ) ||
    !mounts.some(
      (v) =>
        v.type === "bind" &&
        v.source === join(root, "warehouse.sql") &&
        v.target === "/opt/analytics/warehouse.sql" &&
        v.read_only === true,
    ) ||
    mb.volumes?.length ||
    value.volumes?.["postgres-data"]?.external ||
    value.volumes?.["postgres-data"]?.name !== `${PROJECT}_postgres-data` ||
    value.volumes?.["postgres-data"]?.driver_opts ||
    (value.volumes?.["postgres-data"]?.driver &&
      value.volumes["postgres-data"].driver !== "local") ||
    value.networks?.analytics?.external ||
    value.networks?.analytics?.name !== `${PROJECT}_analytics`
  )
    throw new Error("Unexpected local analytics storage mounts");
}
export function assertLocalContainer(container, service, root = directory) {
  if (
    container.Config?.Labels?.["com.docker.compose.project"] !== PROJECT ||
    container.Config?.Labels?.["com.docker.compose.service"] !== service ||
    container.Config?.Image !==
      { postgres: "postgres:17.6", metabase: "metabase/metabase:v0.63.18.2" }[
        service
      ] ||
    Object.keys(container.NetworkSettings?.Networks ?? {}).join(",") !==
      `${PROJECT}_analytics`
  )
    throw new Error(
      "Existing container does not match dedicated analytics target",
    );
  const imageDefaults =
    service === "postgres"
      ? { entrypoint: ["docker-entrypoint.sh"], cmd: ["postgres"] }
      : { entrypoint: ["/app/run_metabase.sh"], cmd: null };
  if (
    JSON.stringify(container.Config.Entrypoint) !==
      JSON.stringify(imageDefaults.entrypoint) ||
    JSON.stringify(container.Config.Cmd) !==
      JSON.stringify(imageDefaults.cmd) ||
    container.HostConfig?.Privileged !== false ||
    ["ExtraHosts", "CapAdd", "Devices", "SecurityOpt"].some(
      (key) => container.HostConfig?.[key]?.length,
    )
  )
    throw new Error(
      "Existing analytics container overrides pinned execution or privilege settings",
    );
  if (!Array.isArray(container.Config.Env))
    throw new Error("Missing effective analytics container environment");
  const effectiveEnv = {};
  for (const item of container.Config.Env) {
    if (typeof item !== "string" || item.indexOf("=") < 1)
      throw new Error("Invalid effective analytics container environment");
    const split = item.indexOf("=");
    const key = item.slice(0, split);
    if (Object.hasOwn(effectiveEnv, key))
      throw new Error(
        "Duplicate effective analytics container environment key",
      );
    effectiveEnv[key] = item.slice(split + 1);
  }
  if (service === "metabase") assertMetabaseEnv(effectiveEnv);
  else if (
    effectiveEnv.POSTGRES_DB !== "metabase" ||
    effectiveEnv.POSTGRES_USER !== "metabase"
  )
    throw new Error(
      "Existing analytics Postgres targets a different application database or role",
    );
  const ports = container.HostConfig?.PortBindings ?? {};
  if (
    service === "postgres"
      ? Object.keys(ports).length !== 0
      : Object.keys(ports).join(",") !== "3000/tcp" ||
        ports["3000/tcp"]?.length !== 1 ||
        ports["3000/tcp"][0].HostIp !== "127.0.0.1" ||
        ports["3000/tcp"][0].HostPort !== "3033"
  )
    throw new Error("Existing analytics container exposes an unexpected port");
  const mounts = container.Mounts ?? [];
  // Docker Desktop reports macOS bind sources translated inside its local VM.
  const hostBind = (source, filename) =>
    source === join(root, filename) ||
    source === `/host_mnt${join(root, filename)}`;
  if (
    service === "metabase"
      ? mounts.length !== 0
      : mounts.length !== 3 ||
        !mounts.some(
          (m) =>
            m.Type === "volume" &&
            m.Name === `${PROJECT}_postgres-data` &&
            m.Destination === "/var/lib/postgresql/data",
        ) ||
        !mounts.some(
          (m) =>
            m.Type === "bind" &&
            hostBind(m.Source, "init.sql") &&
            m.Destination === "/docker-entrypoint-initdb.d/10-reporting.sql" &&
            m.RW === false,
        ) ||
        !mounts.some(
          (m) =>
            m.Type === "bind" &&
            hostBind(m.Source, "warehouse.sql") &&
            m.Destination === "/opt/analytics/warehouse.sql" &&
            m.RW === false,
        )
  )
    throw new Error("Existing analytics container mounts unexpected storage");
}
export function assertSyntheticWarehouse(value) {
  if (
    !value ||
    value.realSnapshots !== 0 ||
    value.storeRows !== 0 ||
    value.unknownWitnesses !== 0
  )
    throw new Error(
      "Local demo refuses real Dev/Production snapshots, store reports or unknown synthetic source witnesses",
    );
}
export function guardedDemoSql(snapshot, now = Date.now()) {
  if (snapshot.environment !== "synthetic" || snapshot.sourceSha !== DEMO_SHA)
    throw new Error(
      "Only the owned simulated demo snapshot can be refreshed locally",
    );
  return snapshotImportSql(snapshot, now).replace(
    "BEGIN;",
    () => `BEGIN;
LOCK TABLE reporting.refreshes, reporting.metric_data, reporting.store_metrics IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM reporting.refreshes WHERE environment<>'synthetic' OR source_sha NOT IN ('${DEMO_SHA}','${AUTOMATED_FIXTURE_SHA}')) OR EXISTS(SELECT 1 FROM reporting.store_metrics)
THEN RAISE EXCEPTION 'Local synthetic demo boundary refused'; END IF; END $$;`,
  );
}
const warehouseCheckSql = `SELECT json_build_object('realSnapshots',(SELECT count(*) FROM reporting.refreshes WHERE environment<>'synthetic'),'storeRows',(SELECT count(*) FROM reporting.store_metrics),'unknownWitnesses',(SELECT count(*) FROM reporting.refreshes WHERE environment='synthetic' AND source_sha NOT IN ('${DEMO_SHA}','${AUTOMATED_FIXTURE_SHA}')),'generatedAt',(SELECT generated_at FROM reporting.refreshes WHERE environment='synthetic'));`;

export function exportLogin(files) {
  const path = join(files.root, ".env.local-login");
  const content = `Local synthetic preview only: ${LOCAL_ORIGIN}\nEmail: ${files.fixture.email}\nPassword: ${files.fixture.password}\n`;
  if (existsSync(path)) {
    if (readPrivate(path) !== content)
      throw new Error(
        "Existing local login file differs; refusing to overwrite credentials",
      );
  } else writeFileSync(path, content, { flag: "wx", mode: 0o600 });
  return path;
}
function execute(command, args, input, env) {
  const r = spawnSync(command, args, {
    input,
    env,
    encoding: "utf8",
    timeout: 150000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error || r.status !== 0)
    throw new Error(
      "Local analytics command failed; private diagnostics suppressed",
    );
  return r.stdout.trim();
}
function parseProcesses(output) {
  if (!output.trim()) return [];
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return output.split("\n").map((line) => privateJson(line));
  }
}
export async function waitLocalApi(
  api,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; attempt < 15; attempt++) {
    let properties;
    try {
      properties = await api("GET", "/session/properties");
    } catch {
      if (attempt === 14)
        throw new Error(
          "Local Metabase did not become ready; existing data and credentials were not reset",
        );
      await pause(1000);
      continue;
    }
    if (properties.version?.tag !== METABASE_VERSION)
      throw new Error("Local Metabase is not the pinned version");
    return;
  }
}
export async function runLocal(
  args = process.argv.slice(2),
  dependencies = {},
) {
  const mode = parseLocalArgs(args);
  if (mode === "help")
    return {
      help: "pnpm analytics:dashboard:local — start and refresh the existing private local synthetic preview\npnpm analytics:dashboard:local --status — inspect the preview without changes\nLogin is stored in ops/analytics/.env.local-login; credentials are never printed. Store reports are unavailable in this demo.",
    };
  const files = (dependencies.readFiles ?? readLocalFiles)();
  const environment = dependencies.environment ?? process.env;
  assertLocalContext(
    privateJson(
      (dependencies.execute ?? execute)(
        "docker",
        ["context", "inspect"],
        undefined,
        environment,
      ),
    ),
    environment,
  );
  const childEnv = { ...environment, ...files.env };
  const run = (params, input) =>
    (dependencies.execute ?? execute)("docker", params, input, childEnv);
  const compose = [
    "compose",
    "--project-name",
    PROJECT,
    "--env-file",
    join(files.root, ".env"),
    "-f",
    join(files.root, "compose.yaml"),
  ];
  assertLocalCompose(
    privateJson(run([...compose, "config", "--format", "json"])),
    files.root,
  );
  const inspect = () => {
    const processes = parseProcesses(
      run([...compose, "ps", "--all", "--format", "json"]),
    );
    for (const process of processes) {
      if (
        !["postgres", "metabase"].includes(process.Service) ||
        process.Name !== `${PROJECT}-${process.Service}-1`
      )
        throw new Error("Unexpected container in dedicated analytics project");
      const container = privateJson(run(["inspect", process.Name]));
      if (!Array.isArray(container) || container.length !== 1)
        throw new Error("Invalid container identity");
      assertLocalContainer(container[0], process.Service, files.root);
    }
    return processes;
  };
  let processes = inspect();
  if (mode === "start") {
    // Official Compose --no-recreate preserves existing containers/volumes.
    // https://docs.docker.com/reference/cli/docker/compose/up/
    run([
      ...compose,
      "up",
      "--detach",
      "--no-recreate",
      "--no-build",
      "--pull",
      "never",
      "--wait",
      "--wait-timeout",
      "120",
    ]);
    processes = inspect();
  }
  if (processes.length !== 2 || processes.some((p) => p.State !== "running")) {
    if (mode === "status")
      return { url: LOCAL_ORIGIN, status: "stopped", synthetic: true };
    throw new Error("Both dedicated local analytics services must be running");
  }
  const psql = [
    ...compose,
    "exec",
    "-T",
    "postgres",
    "sh",
    "-c",
    'PGPASSWORD="$REPORTING_WRITER_PASSWORD" psql -h 127.0.0.1 -X -q -t -A -v ON_ERROR_STOP=1 -U reporting_writer -d mizyun_reporting',
  ];
  const warehouse = privateJson(run(psql, warehouseCheckSql));
  assertSyntheticWarehouse(warehouse);
  if (mode === "status")
    return {
      url: LOCAL_ORIGIN,
      status: "running",
      synthetic: true,
      generatedAt: warehouse.generatedAt ?? null,
    };
  const config = readConfig({
    METABASE_URL: LOCAL_ORIGIN,
    METABASE_API_KEY: files.fixture.apiKey,
    REPORTING_DB_HOST: "postgres",
    REPORTING_DB_PORT: "5432",
    REPORTING_DB_NAME: "mizyun_reporting",
    REPORTING_DB_USER: "reporting_reader",
    REPORTING_DB_PASSWORD: files.env.REPORTING_READER_PASSWORD,
  });
  const api = dependencies.api ?? createApi(config);
  const readinessApi =
    dependencies.api ??
    createApi(config, (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(3000) }),
    );
  await waitLocalApi(readinessApi, dependencies.pause);
  const users = await api("GET", "/user");
  const people = Array.isArray(users) ? users : users.data;
  if (
    !Array.isArray(people) ||
    people.some((p) => !expectedEmails.includes(p.email))
  )
    throw new Error(
      "Local preview refuses an instance containing nonfixture accounts",
    );
  const now = (dependencies.now ?? Date.now)();
  run(psql, guardedDemoSql(generateDemo(now), now));
  const result = await (dependencies.provision ?? provision)(config, { api });
  const loginPath = (dependencies.exportLogin ?? exportLogin)(files);
  return {
    ...result,
    synthetic: true,
    loginPath,
    notice:
      "SIMULATED app aggregates refreshed for 30 UTC days. No real user sources accessed. Store reports remain unavailable.",
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runLocal();
    console.log(result.help ?? JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
