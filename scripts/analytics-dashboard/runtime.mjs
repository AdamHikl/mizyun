/** Fixed Mac real-data runtime. No source collection and no remote Docker endpoints. */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  assertLocalContext,
  assertLocalCompose,
  assertLocalContainer,
  readPrivate,
  PROJECT as SYNTHETIC_PROJECT,
  LOCAL_ORIGIN as SYNTHETIC_ORIGIN,
} from "./local.mjs";

export const LIVE_PROJECT = "mizyun-analytics-live";
export const LIVE_ORIGIN = "http://127.0.0.1:3034";
export const LIVE_ROOT = fileURLToPath(
  new URL("../../ops/analytics/", import.meta.url),
);
const secretKeys = [
  "METABASE_DB_PASSWORD",
  "REPORTING_READER_PASSWORD",
  "REPORTING_WRITER_PASSWORD",
  "METABASE_ENCRYPTION_KEY",
];
export function privateJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Invalid private analytics response; diagnostics suppressed",
    );
  }
}
export function readLiveFiles(root = LIVE_ROOT) {
  const env = {};
  for (const line of readPrivate(join(root, ".env.live")).split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    const key = line.slice(0, split),
      value = line.slice(split + 1);
    if (
      split < 1 ||
      !secretKeys.includes(key) ||
      Object.hasOwn(env, key) ||
      !/^[a-f0-9]{64}$/.test(value)
    )
      throw new Error("Invalid private live analytics configuration");
    env[key] = value;
  }
  if (
    secretKeys.some((key) => !env[key]) ||
    new Set(Object.values(env)).size !== secretKeys.length
  )
    throw new Error("Complete independent live analytics secrets required");
  return { root, env };
}
export function ensureLiveFiles(root = LIVE_ROOT) {
  if (!existsSync(join(root, ".env.live"))) {
    // Exclusive creation preserves a prior operator's secrets and encryption key.
    const content =
      secretKeys
        .map((key) => `${key}=${randomBytes(32).toString("hex")}`)
        .join("\n") + "\n";
    writeFileSync(join(root, ".env.live"), content, {
      flag: "wx",
      mode: 0o600,
    });
  }
  return readLiveFiles(root);
}
function expectedEnvironment(service, files) {
  return service === "postgres"
    ? {
        POSTGRES_DB: "metabase",
        POSTGRES_USER: "metabase",
        POSTGRES_PASSWORD: files.env.METABASE_DB_PASSWORD,
        REPORTING_READER_PASSWORD: files.env.REPORTING_READER_PASSWORD,
        REPORTING_WRITER_PASSWORD: files.env.REPORTING_WRITER_PASSWORD,
      }
    : {
        MB_DB_TYPE: "postgres",
        MB_DB_HOST: "postgres",
        MB_DB_PORT: "5432",
        MB_DB_DBNAME: "metabase",
        MB_DB_USER: "metabase",
        MB_DB_PASS: files.env.METABASE_DB_PASSWORD,
        MB_ENCRYPTION_SECRET_KEY: files.env.METABASE_ENCRYPTION_KEY,
        MB_SITE_URL: LIVE_ORIGIN,
        MB_ENABLE_PUBLIC_SHARING: "false",
        MB_ENABLE_EMBEDDING: "false",
        MB_QUERY_CACHING_ENABLED: "false",
        MB_METABOT_ENABLED: "false",
        MB_EMBEDDED_METABOT_ENABLED: "false",
        MB_ANON_TRACKING_ENABLED: "false",
        JAVA_TIMEZONE: "UTC",
        JAVA_OPTS: "-Xms256m -Xmx1024m",
      };
}
function assertEnvironment(env, service, files) {
  const expected = expectedEnvironment(service, files);
  if (
    Object.entries(expected).some(
      ([key, value]) => String(env?.[key]) !== value,
    ) ||
    Object.keys(env ?? {}).some(
      (key) =>
        /^(MB_|REPORTING_|POSTGRES_|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGOPTIONS|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|CLASSPATH)/.test(
          key,
        ) && !Object.hasOwn(expected, key),
    ) ||
    (service === "postgres" &&
      env.PGDATA &&
      env.PGDATA !== "/var/lib/postgresql/data")
  )
    throw new Error(
      "Live analytics effective credentials or configuration differ from the private fixed target",
    );
}
// Reuse the stricter existing preview checks through an explicit identity adapter.
// Nothing in the synthetic launcher is weakened or made real-data compatible.
export function assertLiveCompose(value, files) {
  if (
    value.name !== LIVE_PROJECT ||
    value.networks?.analytics?.name !== `${LIVE_PROJECT}_analytics` ||
    value.volumes?.["postgres-data"]?.name !==
      `${LIVE_PROJECT}_postgres-data` ||
    String(value.services?.metabase?.ports?.[0]?.published) !== "3034"
  )
    throw new Error(
      "Dedicated live analytics project, network, volume and port required",
    );
  for (const service of ["postgres", "metabase"])
    assertEnvironment(value.services?.[service]?.environment, service, files);
  if (
    Object.keys(value.volumes ?? {}).join(",") !== "postgres-data" ||
    Object.keys(value.networks ?? {}).join(",") !== "analytics"
  )
    throw new Error("Unexpected live analytics networks or volumes");
  const adapted = structuredClone(value);
  adapted.name = SYNTHETIC_PROJECT;
  adapted.networks.analytics.name = `${SYNTHETIC_PROJECT}_analytics`;
  adapted.volumes["postgres-data"].name = `${SYNTHETIC_PROJECT}_postgres-data`;
  adapted.services.metabase.ports[0].published = "3033";
  adapted.services.metabase.environment.MB_SITE_URL = SYNTHETIC_ORIGIN;
  assertLocalCompose(adapted, files.root);
}
export function assertLiveContainer(container, service, files) {
  if (
    container.Config?.Labels?.["com.docker.compose.project"] !== LIVE_PROJECT ||
    Object.keys(container.NetworkSettings?.Networks ?? {}).join(",") !==
      `${LIVE_PROJECT}_analytics` ||
    (service === "postgres" &&
      !container.Mounts?.some(
        (m) => m.Name === `${LIVE_PROJECT}_postgres-data`,
      )) ||
    (service === "metabase" &&
      container.HostConfig?.PortBindings?.["3000/tcp"]?.[0]?.HostPort !==
        "3034")
  )
    throw new Error(
      "Existing container is outside the dedicated live analytics target",
    );
  const env = {};
  if (!Array.isArray(container.Config.Env))
    throw new Error("Missing live container environment");
  for (const item of container.Config.Env) {
    const split = typeof item === "string" ? item.indexOf("=") : -1;
    if (split < 1 || Object.hasOwn(env, item.slice(0, split)))
      throw new Error("Invalid live container environment");
    env[item.slice(0, split)] = item.slice(split + 1);
  }
  assertEnvironment(env, service, files);
  const adapted = structuredClone(container);
  adapted.Config.Labels["com.docker.compose.project"] = SYNTHETIC_PROJECT;
  adapted.NetworkSettings.Networks = { [`${SYNTHETIC_PROJECT}_analytics`]: {} };
  if (service === "metabase") {
    adapted.HostConfig.PortBindings["3000/tcp"][0].HostPort = "3033";
    adapted.Config.Env = adapted.Config.Env.map((item) =>
      item.startsWith("MB_SITE_URL=")
        ? `MB_SITE_URL=${SYNTHETIC_ORIGIN}`
        : item,
    );
  } else
    adapted.Mounts = adapted.Mounts.map((m) =>
      m.Type === "volume" && m.Name === `${LIVE_PROJECT}_postgres-data`
        ? { ...m, Name: `${SYNTHETIC_PROJECT}_postgres-data` }
        : m,
    );
  assertLocalContainer(adapted, service, files.root);
}
const warehouseGuard =
  "DO $$ BEGIN IF EXISTS(SELECT 1 FROM reporting.refreshes WHERE environment='synthetic') OR EXISTS(SELECT 1 FROM reporting.metric_data WHERE environment='synthetic') THEN RAISE EXCEPTION 'Synthetic rows refused in live reporting'; END IF; END $$;";
export function guardLiveImport(sql) {
  if (
    typeof sql !== "string" ||
    !sql.startsWith("BEGIN;") ||
    !sql.endsWith("COMMIT;") ||
    /(^|\n)\s*\\/.test(sql)
  )
    throw new Error(
      "Only transactional validated aggregate imports are allowed",
    );
  return sql
    .replace(
      "BEGIN;",
      () =>
        `BEGIN; LOCK TABLE reporting.refreshes, reporting.metric_data, reporting.store_metrics IN SHARE ROW EXCLUSIVE MODE; ${warehouseGuard}`,
    )
    .replace(/COMMIT;$/, () => `${warehouseGuard}\nCOMMIT;`);
}
export function executeLocal(command, args, input, env) {
  const result = spawnSync(command, args, {
    input,
    env,
    encoding: "utf8",
    timeout: 150000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "Local live analytics command failed; private diagnostics suppressed",
    );
  return result.stdout.trim();
}
function parseProcesses(text) {
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text.split("\n").map(privateJson);
  }
}
export function createLiveRuntime({
  execute = executeLocal,
  environment = process.env,
  root = LIVE_ROOT,
} = {}) {
  const compose = [
    "compose",
    "--project-name",
    LIVE_PROJECT,
    "--env-file",
    join(root, ".env.live"),
    "-f",
    join(root, "compose.live.yaml"),
  ];
  function run(args, input) {
    const files = readLiveFiles(root);
    return execute("docker", args, input, { ...environment, ...files.env });
  }
  function context() {
    // Reject overrides before contacting any Docker endpoint.
    if (environment.DOCKER_HOST || environment.DOCKER_CONTEXT)
      throw new Error("Remote Docker overrides refused for live analytics");
    assertLocalContext(
      privateJson(
        execute("docker", ["context", "inspect"], undefined, environment),
      ),
      environment,
    );
  }
  function inspect() {
    context();
    const files = readLiveFiles(root);
    assertLiveCompose(
      privateJson(run([...compose, "config", "--format", "json"])),
      files,
    );
    const processes = parseProcesses(
      run([...compose, "ps", "--all", "--format", "json"]),
    );
    const seen = new Set();
    for (const process of processes) {
      if (
        !["postgres", "metabase"].includes(process.Service) ||
        process.Name !== `${LIVE_PROJECT}-${process.Service}-1` ||
        seen.has(process.Service)
      )
        throw new Error(
          "Unexpected or duplicate container in live analytics project",
        );
      seen.add(process.Service);
      const values = privateJson(run(["inspect", process.Name]));
      if (!Array.isArray(values) || values.length !== 1)
        throw new Error("Invalid live container identity");
      assertLiveContainer(values[0], process.Service, files);
      if (process.State === "running" && values[0].State?.Running !== true)
        throw new Error("Live container running identity changed");
    }
    return processes;
  }
  function database(sql) {
    return run(
      [
        ...compose,
        "exec",
        "-T",
        "postgres",
        "sh",
        "-c",
        'PGPASSWORD="$REPORTING_WRITER_PASSWORD" psql -h 127.0.0.1 -X -q -t -A -v ON_ERROR_STOP=1 -U reporting_writer -d mizyun_reporting',
      ],
      sql,
    );
  }
  function verifyRunning() {
    const processes = inspect();
    if (processes.length !== 2 || processes.some((p) => p.State !== "running"))
      throw new Error("Both dedicated live analytics services must be running");
    const result = privateJson(
      database(
        "SELECT json_build_object('syntheticRows',(SELECT count(*) FROM reporting.refreshes WHERE environment='synthetic')+(SELECT count(*) FROM reporting.metric_data WHERE environment='synthetic'));",
      ),
    );
    if (result?.syntheticRows !== 0)
      throw new Error(
        "Live analytics refuses synthetic data; existing data was preserved",
      );
    return processes;
  }
  return {
    root,
    get files() {
      return readLiveFiles(root);
    },
    inspect,
    verifyRunning,
    verifyContext: context,
    prepareCredentials() {
      context();
      if (!existsSync(join(root, ".env.live"))) {
        const inventories = [
          [
            "ps",
            "--all",
            "--filter",
            `name=${LIVE_PROJECT}-`,
            "--format",
            "{{.ID}}",
          ],
          [
            "volume",
            "ls",
            "--filter",
            `name=${LIVE_PROJECT}_postgres-data`,
            "--format",
            "{{.Name}}",
          ],
          [
            "network",
            "ls",
            "--filter",
            `name=${LIVE_PROJECT}_analytics`,
            "--format",
            "{{.Name}}",
          ],
        ];
        for (const args of inventories) {
          if (execute("docker", args, undefined, environment).trim())
            throw new Error(
              "Existing live resources lack their private credential file; restore it instead of generating new secrets",
            );
        }
      }
    },
    start() {
      inspect();
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
      return verifyRunning();
    },
    stop() {
      inspect();
      run([...compose, "stop", "--timeout", "30"]);
    },
    readSql(sql) {
      verifyRunning();
      return database(sql);
    },
    importSql(sql) {
      const guarded = guardLiveImport(sql);
      verifyRunning();
      return database(guarded);
    },
  };
}
