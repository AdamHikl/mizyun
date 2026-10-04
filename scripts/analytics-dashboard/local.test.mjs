import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  symlinkSync,
  statSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runLocal,
  parseLocalArgs,
  assertLocalContext,
  assertLocalCompose,
  assertLocalContainer,
  readPrivate,
  readLocalFiles,
  exportLogin,
  guardedDemoSql,
  waitLocalApi,
} from "./local.mjs";
import { generateDemo } from "./demo.mjs";
const root = "/fixture/ops/analytics";
const env = {
  METABASE_DB_PASSWORD: "private-db-pass",
  REPORTING_READER_PASSWORD: "private-reader-pass",
  REPORTING_WRITER_PASSWORD: "private-writer-pass",
  METABASE_ENCRYPTION_KEY: "private-encryption",
  METABASE_PORT: "3033",
  METABASE_SITE_URL: "http://127.0.0.1:3033",
};
function composeConfig() {
  return {
    name: "mizyun-analytics",
    services: {
      postgres: {
        image: "postgres:17.6",
        networks: { analytics: {} },
        volumes: [
          {
            type: "volume",
            source: "postgres-data",
            target: "/var/lib/postgresql/data",
          },
          {
            type: "bind",
            source: join(root, "init.sql"),
            target: "/docker-entrypoint-initdb.d/10-reporting.sql",
            read_only: true,
          },
          {
            type: "bind",
            source: join(root, "warehouse.sql"),
            target: "/opt/analytics/warehouse.sql",
            read_only: true,
          },
        ],
      },
      metabase: {
        image: "metabase/metabase:v0.63.18.2",
        networks: { analytics: {} },
        ports: [{ host_ip: "127.0.0.1", published: "3033", target: 3000 }],
        environment: {
          MB_SITE_URL: "http://127.0.0.1:3033",
          MB_DB_TYPE: "postgres",
          MB_DB_PORT: "5432",
          MB_DB_USER: "metabase",
          MB_DB_HOST: "postgres",
          MB_DB_DBNAME: "metabase",
          MB_ENABLE_PUBLIC_SHARING: "false",
          MB_ENABLE_EMBEDDING: "false",
          MB_QUERY_CACHING_ENABLED: "false",
          MB_METABOT_ENABLED: "false",
          MB_EMBEDDED_METABOT_ENABLED: "false",
          MB_ANON_TRACKING_ENABLED: "false",
        },
      },
    },
    volumes: { "postgres-data": { name: "mizyun-analytics_postgres-data" } },
    networks: { analytics: { name: "mizyun-analytics_analytics" } },
  };
}
function container(service) {
  return {
    Config: {
      Entrypoint:
        service === "postgres"
          ? ["docker-entrypoint.sh"]
          : ["/app/run_metabase.sh"],
      Cmd: service === "postgres" ? ["postgres"] : null,
      Env:
        service === "postgres"
          ? ["POSTGRES_DB=metabase", "POSTGRES_USER=metabase"]
          : Object.entries(composeConfig().services.metabase.environment).map(
              ([key, value]) => `${key}=${value}`,
            ),
      Labels: {
        "com.docker.compose.project": "mizyun-analytics",
        "com.docker.compose.service": service,
      },
      Image:
        service === "postgres"
          ? "postgres:17.6"
          : "metabase/metabase:v0.63.18.2",
    },
    NetworkSettings: { Networks: { "mizyun-analytics_analytics": {} } },
    Mounts:
      service === "postgres"
        ? [
            {
              Type: "volume",
              Name: "mizyun-analytics_postgres-data",
              Destination: "/var/lib/postgresql/data",
            },
            {
              Type: "bind",
              Source: join(root, "init.sql"),
              Destination: "/docker-entrypoint-initdb.d/10-reporting.sql",
              RW: false,
            },
            {
              Type: "bind",
              Source: join(root, "warehouse.sql"),
              Destination: "/opt/analytics/warehouse.sql",
              RW: false,
            },
          ]
        : [],
    HostConfig: {
      Privileged: false,
      PortBindings:
        service === "postgres"
          ? {}
          : { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3033" }] },
    },
  };
}
function fixture(changes = {}) {
  const state = {
    calls: [],
    warehouse: {
      realSnapshots: 0,
      storeRows: 0,
      unknownWitnesses: 0,
      generatedAt: "2026-10-03T10:00:00.000Z",
    },
    config: composeConfig(),
    ...changes,
  };
  const files = {
    root,
    env,
    fixture: {
      email: "dashboard-founder@example.invalid",
      password: "private-test-password",
      apiKey: "private-api-key",
    },
  };
  const dependencies = {
    readFiles: () => files,
    environment: {},
    now: () => Date.parse("2026-10-03T12:00:00.000Z"),
    execute: (command, args, input) => {
      state.calls.push({ command, args, input });
      assert.equal(command, "docker");
      if (args.join(" ") === "context inspect")
        return JSON.stringify([
          { Endpoints: { docker: { Host: "unix:///fixture/docker.sock" } } },
        ]);
      if (args.includes("config")) return JSON.stringify(state.config);
      if (args.includes("ps"))
        return JSON.stringify(
          ["postgres", "metabase"].map((Service) => ({
            Service,
            Name: `mizyun-analytics-${Service}-1`,
            State: state.stopped ? "exited" : "running",
          })),
        );
      if (args[0] === "inspect")
        return JSON.stringify([
          container(args[1].includes("postgres") ? "postgres" : "metabase"),
        ]);
      if (args.includes("up")) {
        state.stopped = false;
        return "";
      }
      if (args.includes("exec"))
        return input.startsWith("SELECT")
          ? JSON.stringify(state.warehouse)
          : "";
      throw new Error("Unexpected fixture command");
    },
    api: async (method, path) =>
      path === "/session/properties"
        ? { version: { tag: "v0.63.18.2" } }
        : [
            { email: "dashboard-founder@example.invalid" },
            { email: "dashboard-observer@example.invalid" },
          ],
    provision: async () => {
      state.provisioned = true;
      return {
        dashboardId: 8,
        cardCount: 16,
        url: "http://127.0.0.1:3033/dashboard/8",
      };
    },
    exportLogin: () => {
      state.exported = true;
      return join(root, ".env.local-login");
    },
  };
  return { state, dependencies };
}

test("local CLI rejects source, remote and reset options before executing anything", async () => {
  for (const args of [
    ["--env", "prod"],
    ["--snapshot", "/tmp/user.json"],
    ["--store", "file"],
    ["--reset"],
    ["--url", "https://phiskel.com"],
    ["--status", "--start"],
  ])
    assert.throws(() => parseLocalArgs(args));
  assert.equal(parseLocalArgs([]), "start");
  assert.equal(parseLocalArgs(["--status"]), "status");
  assert.ok(
    (
      await runLocal(["--help"], {
        readFiles: () => {
          throw new Error("must not read");
        },
      })
    ).help,
  );
});
test("local daemon trust rejects remote contexts and endpoint overrides", () => {
  assert.throws(
    () =>
      assertLocalContext(
        [{ Endpoints: { docker: { Host: "ssh://remote" } } }],
        {},
      ),
    /local Unix/,
  );
  assert.throws(
    () =>
      assertLocalContext(
        [{ Endpoints: { docker: { Host: "tcp://localhost:2376" } } }],
        {},
      ),
    /local Unix/,
  );
  for (const override of [
    { DOCKER_HOST: "ssh://remote" },
    { DOCKER_CONTEXT: "remote" },
  ])
    assert.throws(
      () =>
        assertLocalContext(
          [{ Endpoints: { docker: { Host: "unix:///local" } } }],
          override,
        ),
      /overrides/,
    );
});
test("compose and existing container cannot expose ports or mount other app storage", () => {
  assertLocalCompose(composeConfig(), root);
  for (const mutate of [
    (c) => {
      c.services.metabase.ports[0].host_ip = "0.0.0.0";
    },
    (c) => {
      c.services.postgres.image = "supabase/postgres";
    },
    (c) => {
      c.services.metabase.command = "ssh remote";
    },
    (c) => {
      c.services.postgres.volumes[0].source = "user-database";
    },
    (c) => {
      c.volumes["postgres-data"].external = true;
    },
  ]) {
    const c = composeConfig();
    mutate(c);
    assert.throws(() => assertLocalCompose(c, root));
  }
  const c = container("metabase");
  c.NetworkSettings.Networks.other = {};
  assert.throws(() => assertLocalContainer(c, "metabase"));
  const translated = container("postgres");
  for (const mount of translated.Mounts.filter((m) => m.Type === "bind"))
    mount.Source = `/host_mnt${mount.Source}`;
  assertLocalContainer(translated, "postgres", root);
  translated.Mounts[0].Name = "supabase_user_data";
  assert.throws(
    () => assertLocalContainer(translated, "postgres", root),
    /unexpected storage/,
  );
});
test("effective runtime flags and pinned commands are checked even when compose is safe", () => {
  const flagNames = [
    "MB_DB_HOST",
    "MB_DB_DBNAME",
    "MB_DB_PORT",
    "MB_DB_TYPE",
    "MB_SITE_URL",
    "MB_ENABLE_PUBLIC_SHARING",
    "MB_ENABLE_EMBEDDING",
    "MB_QUERY_CACHING_ENABLED",
    "MB_METABOT_ENABLED",
    "MB_EMBEDDED_METABOT_ENABLED",
    "MB_ANON_TRACKING_ENABLED",
  ];
  for (const key of flagNames) {
    const c = container("metabase");
    c.Config.Env = c.Config.Env.filter((item) => !item.startsWith(`${key}=`));
    c.Config.Env.push(`${key}=unexpected`);
    assert.throws(
      () => assertLocalContainer(c, "metabase", root),
      /effective Metabase/,
    );
  }
  for (const mutate of [
    (c) => {
      c.Config.Cmd = ["unsafe-command"];
    },
    (c) => {
      c.Config.Entrypoint = ["sh"];
    },
    (c) => {
      c.HostConfig.Privileged = true;
    },
    (c) => {
      c.HostConfig.ExtraHosts = ["postgres:10.0.0.10"];
    },
    (c) => {
      c.Config.Env.push("MB_DB_CONNECTION_URI=postgres://remote/database");
    },
    (c) => {
      c.Config.Env.push("MB_ENABLE_EMBEDDING_STATIC=true");
    },
    (c) => {
      c.Config.Env.push("MB_ENABLE_EMBEDDING_INTERACTIVE=true");
    },
  ]) {
    const c = container("metabase");
    mutate(c);
    assert.throws(() => assertLocalContainer(c, "metabase", root));
  }
  const db = container("postgres");
  db.Config.Env[0] = "POSTGRES_DB=user_data";
  assert.throws(
    () => assertLocalContainer(db, "postgres", root),
    /different application database/,
  );
});

test("authorized local start refreshes only owned synthetic data and never imports stores", async () => {
  const { state, dependencies } = fixture({ stopped: true });
  const result = await runLocal([], dependencies);
  const start = state.calls.find((c) => c.args.includes("up"));
  assert.ok(start.args.includes("--no-recreate"));
  assert.ok(start.args.includes("--pull"));
  assert.ok(start.args.includes("never"));
  assert.ok(state.provisioned && state.exported);
  const sql = state.calls.find((c) => c.input?.startsWith("BEGIN;")).input;
  assert.match(
    sql,
    /LOCK TABLE reporting.refreshes, reporting.metric_data, reporting.store_metrics/,
  );
  assert.match(sql, /source_sha NOT IN/);
  assert.match(sql, /DO \$\$ BEGIN IF EXISTS/);
  assert.match(sql, /END IF; END \$\$;/);
  assert.doesNotMatch(sql, /INSERT INTO reporting.store_metrics/);
  assert.match(result.notice, /SIMULATED/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-api-key|private-test-password|private-reader-pass/,
  );
  assert.equal(
    state.calls.some(
      (c) =>
        c.command === "ssh" ||
        c.args.some((a) =>
          [
            "down",
            "prune",
            "rm",
            "reset",
            "--force-recreate",
            "--renew-anon-volumes",
          ].includes(a),
        ),
    ),
    false,
  );
});
test("real snapshots, official store rows and unknown synthetic witnesses refuse all data/card writes", async () => {
  for (const forbidden of [
    { realSnapshots: 1 },
    { storeRows: 1 },
    { unknownWitnesses: 1 },
  ]) {
    const { state, dependencies } = fixture();
    Object.assign(state.warehouse, forbidden);
    await assert.rejects(runLocal([], dependencies), /refuses real/);
    assert.equal(
      state.calls.some((c) => c.input?.startsWith("BEGIN;")),
      false,
    );
    assert.equal(state.provisioned, undefined);
  }
});
test("status is read-only; stopped stack is reported without starting it", async () => {
  for (const stopped of [true, false]) {
    const { state, dependencies } = fixture({ stopped });
    const result = await runLocal(["--status"], dependencies);
    assert.equal(result.status, stopped ? "stopped" : "running");
    assert.equal(
      state.calls.some(
        (c) => c.args.includes("up") || c.input?.startsWith("BEGIN;"),
      ),
      false,
    );
    assert.equal(state.exported, undefined);
  }
});
test("nonfixture Metabase principals cannot be reconfigured by local demo", async () => {
  const { state, dependencies } = fixture();
  dependencies.api = async (method, path) =>
    path === "/session/properties"
      ? { version: { tag: "v0.63.18.2" } }
      : [{ email: "real-person@example.com" }];
  await assert.rejects(runLocal([], dependencies), /nonfixture accounts/);
  assert.equal(
    state.calls.some((c) => c.input?.startsWith("BEGIN;")),
    false,
  );
});
test("startup waits for pinned API readiness, bounds retries and refuses other versions", async () => {
  let calls = 0;
  let pauses = 0;
  await waitLocalApi(
    async () => {
      calls++;
      if (calls < 3) throw new Error("Starting");
      return { version: { tag: "v0.63.18.2" } };
    },
    async () => {
      pauses++;
    },
  );
  assert.equal(calls, 3);
  assert.equal(pauses, 2);
  calls = 0;
  await assert.rejects(
    waitLocalApi(
      async () => {
        calls++;
        throw new Error("offline");
      },
      async () => {},
    ),
    /did not become ready/,
  );
  assert.equal(calls, 15);
  await assert.rejects(
    waitLocalApi(
      async () => ({ version: { tag: "v0.64.0" } }),
      async () => {},
    ),
    /not the pinned version/,
  );
});

test("atomic import guards require fresh labelled demo and reject caller-controlled snapshots", () => {
  const now = Date.parse("2026-10-03T12:00:00.000Z");
  const demo = generateDemo(now);
  assert.throws(
    () => guardedDemoSql({ ...demo, environment: "prod" }, now),
    /owned simulated/,
  );
  assert.throws(
    () => guardedDemoSql({ ...demo, sourceSha: "f".repeat(40) }, now),
    /owned simulated/,
  );
  assert.throws(() => guardedDemoSql(demo, now + 7200001), /Invalid aggregate/);
});
test("private credential files must be mode600, nonsymlink, preserved and never expose API key in login", () => {
  const temp = mkdtempSync(join(tmpdir(), "analytics-local-cli-"));
  try {
    const envPath = join(temp, ".env");
    writeFileSync(
      envPath,
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      { mode: 0o600 },
    );
    const credentials = {
      email: "dashboard-founder@example.invalid",
      password: "private-test-password",
      apiKey: "private-api-key",
    };
    writeFileSync(join(temp, ".env.local-test"), JSON.stringify(credentials), {
      mode: 0o600,
    });
    const files = readLocalFiles(temp);
    const before = readFileSync(join(temp, ".env.local-test"), "utf8");
    const path = exportLogin(files);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.doesNotMatch(readFileSync(path, "utf8"), /private-api-key/);
    assert.equal(exportLogin(files), path);
    assert.equal(readFileSync(join(temp, ".env.local-test"), "utf8"), before);
    writeFileSync(path, "different credentials");
    assert.throws(() => exportLogin(files), /refusing to overwrite/);
    chmodSync(envPath, 0o644);
    assert.throws(() => readPrivate(envPath), /mode 600/);
    chmodSync(envPath, 0o600);
    symlinkSync(envPath, join(temp, ".env.symlink"));
    assert.throws(() => readPrivate(join(temp, ".env.symlink")), /mode 600/);
    writeFileSync(join(temp, ".env.local-test"), "bad json private-api-key");
    assert.throws(() => readLocalFiles(temp), {
      message: "Invalid private local JSON; diagnostics suppressed",
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
