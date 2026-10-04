import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  symlinkSync,
  statSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createLiveRuntime,
  ensureLiveFiles,
  readLiveFiles,
  assertLiveCompose,
  assertLiveContainer,
  guardLiveImport,
  LIVE_PROJECT,
  LIVE_ORIGIN,
} from "./runtime.mjs";
import {
  parseLiveArgs,
  runLive,
  bootstrapLiveAdmin,
  readLiveAdmin,
  exportLiveLogin,
  createBootstrapApi,
  waitLiveApi,
  OPERATOR_EMAIL,
} from "./live.mjs";
import { snapshotImportSql } from "./snapshot.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mizyun-live-unit-"));
  const files = ensureLiveFiles(root);
  const mbEnv = {
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
  const dbEnv = {
    POSTGRES_DB: "metabase",
    POSTGRES_USER: "metabase",
    POSTGRES_PASSWORD: files.env.METABASE_DB_PASSWORD,
    REPORTING_READER_PASSWORD: files.env.REPORTING_READER_PASSWORD,
    REPORTING_WRITER_PASSWORD: files.env.REPORTING_WRITER_PASSWORD,
  };
  const volumes = [
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
  ];
  const config = {
    name: LIVE_PROJECT,
    services: {
      postgres: {
        image: "postgres:17.6",
        networks: { analytics: {} },
        environment: dbEnv,
        volumes,
      },
      metabase: {
        image: "metabase/metabase:v0.63.18.2",
        networks: { analytics: {} },
        environment: mbEnv,
        ports: [{ host_ip: "127.0.0.1", published: "3034", target: 3000 }],
      },
    },
    networks: { analytics: { name: `${LIVE_PROJECT}_analytics` } },
    volumes: { "postgres-data": { name: `${LIVE_PROJECT}_postgres-data` } },
  };
  function container(service) {
    return {
      State: { Running: !state.stopped },
      Config: {
        Image: config.services[service].image,
        Labels: {
          "com.docker.compose.project": LIVE_PROJECT,
          "com.docker.compose.service": service,
        },
        Entrypoint:
          service === "postgres"
            ? ["docker-entrypoint.sh"]
            : ["/app/run_metabase.sh"],
        Cmd: service === "postgres" ? ["postgres"] : null,
        Env: Object.entries(service === "postgres" ? dbEnv : mbEnv).map(
          ([k, v]) => `${k}=${v}`,
        ),
      },
      NetworkSettings: { Networks: { [`${LIVE_PROJECT}_analytics`]: {} } },
      HostConfig: {
        Privileged: false,
        PortBindings:
          service === "postgres"
            ? {}
            : { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3034" }] },
      },
      Mounts:
        service === "postgres"
          ? volumes.map((v) =>
              v.type === "volume"
                ? {
                    Type: "volume",
                    Name: `${LIVE_PROJECT}_postgres-data`,
                    Destination: v.target,
                  }
                : {
                    Type: "bind",
                    Source: v.source,
                    Destination: v.target,
                    RW: false,
                  },
            )
          : [],
    };
  }
  const state = {
    calls: [],
    config,
    stopped: false,
    missing: false,
    syntheticRows: 0,
    context: "unix:///fixture/docker.sock",
    containerMutation: null,
  };
  const execute = (command, args, input) => {
    state.calls.push({ command, args, input });
    assert.equal(command, "docker");
    if (args[0] === "context")
      return JSON.stringify([
        { Endpoints: { docker: { Host: state.context } } },
      ]);
    if (args.includes("config")) return JSON.stringify(state.config);
    if (args.includes("ps"))
      return JSON.stringify(
        state.missing
          ? []
          : ["postgres", "metabase"].map((Service) => ({
              Service,
              Name: `${LIVE_PROJECT}-${Service}-1`,
              State: state.stopped ? "exited" : "running",
            })),
      );
    if (args[0] === "inspect") {
      const value = container(
        args[1].includes("postgres") ? "postgres" : "metabase",
      );
      state.containerMutation?.(value);
      return JSON.stringify([value]);
    }
    if (args.includes("up")) {
      state.stopped = false;
      state.missing = false;
      return "";
    }
    if (args.includes("stop")) {
      state.stopped = true;
      return "";
    }
    if (args.includes("exec"))
      return input.startsWith("SELECT json_build_object('syntheticRows'")
        ? JSON.stringify({ syntheticRows: state.syntheticRows })
        : input.startsWith("SELECT")
          ? JSON.stringify({ sources: [], storeReports: 0 })
          : "";
    throw new Error("Unexpected mock Docker command");
  };
  const runtime = createLiveRuntime({ execute, environment: {}, root });
  return {
    root,
    files,
    state,
    execute,
    runtime,
    container,
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}
function snapshot(environment) {
  return {
    environment,
    sourceSha: "a".repeat(40),
    generatedAt: new Date().toISOString(),
    totalAccounts: 12,
    consentingAccounts: 4,
    metrics: [
      {
        day: new Date().toISOString().slice(0, 10),
        platform: "all",
        metric: "registrations",
        dimension: "all",
        value: 12,
      },
    ],
  };
}
test("live CLI exposes fixed start/status/stop only and help reads nothing", async () => {
  for (const args of [
    ["--env", "prod"],
    ["--reset"],
    ["--url", "https://remote"],
    ["--status", "--stop"],
    ["--snapshot", "file"],
  ])
    assert.throws(() => parseLiveArgs(args));
  assert.equal(parseLiveArgs([]), "start");
  assert.equal(parseLiveArgs(["--stop"]), "stop");
  assert.ok(
    (
      await runLive(["--help"], {
        runtime: {
          verifyContext() {
            throw new Error("unexpected");
          },
        },
      })
    ).help,
  );
});
test("private secrets are generated once independently and preserved with mode600", () => {
  const f = fixture();
  try {
    const before = readFileSync(join(f.root, ".env.live"), "utf8");
    ensureLiveFiles(f.root);
    assert.equal(readFileSync(join(f.root, ".env.live"), "utf8"), before);
    assert.equal(statSync(join(f.root, ".env.live")).mode & 0o777, 0o600);
    assert.equal(new Set(Object.values(f.files.env)).size, 4);
    chmodSync(join(f.root, ".env.live"), 0o644);
    assert.throws(() => readLiveFiles(f.root), /mode 600/);
    chmodSync(join(f.root, ".env.live"), 0o600);
    symlinkSync(join(f.root, ".env.live"), join(f.root, ".env.link"));
    const other = mkdtempSync(join(tmpdir(), "mizyun-live-symlink-"));
    try {
      symlinkSync(join(f.root, ".env.live"), join(other, ".env.live"));
      assert.throws(() => readLiveFiles(other));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  } finally {
    f.clean();
  }
});
test("runtime construction is inert; remote endpoints and overrides refuse before imports", () => {
  const f = fixture();
  try {
    assert.equal(f.state.calls.length, 0);
    for (const context of ["ssh://remote", "tcp://127.0.0.1:2376"]) {
      f.state.context = context;
      assert.throws(() => f.runtime.importSql("BEGIN; COMMIT;"), /local Unix/);
    }
    f.state.calls = [];
    const runtime = createLiveRuntime({
      execute: f.execute,
      environment: { DOCKER_HOST: "ssh://remote" },
      root: f.root,
    });
    assert.throws(() => runtime.verifyRunning(), /overrides/);
    assert.equal(f.state.calls.length, 0);
    assert.equal(
      f.state.calls.some((c) => c.args.includes("exec")),
      false,
    );
  } finally {
    f.clean();
  }
});
test("missing private credentials with an existing live resource refuse secret regeneration", async () => {
  for (const resource of ["ps", "volume", "network"]) {
    const f = fixture();
    try {
      unlinkSync(join(f.root, ".env.live"));
      const calls = [];
      const runtime = createLiveRuntime({
        root: f.root,
        environment: {},
        execute: (command, args) => {
          calls.push(args);
          if (args[0] === "context")
            return JSON.stringify([
              {
                Endpoints: { docker: { Host: "unix:///fixture/docker.sock" } },
              },
            ]);
          return args[0] === resource ? "existing-owned-resource" : "";
        },
      });
      await assert.rejects(
        runLive([], { root: f.root, runtime }),
        /restore it instead of generating/,
      );
      assert.equal(existsSync(join(f.root, ".env.live")), false);
      assert.equal(
        calls.some(
          (args) =>
            args.includes("up") ||
            args.includes("stop") ||
            args.includes("exec"),
        ),
        false,
      );
    } finally {
      f.clean();
    }
  }
});
test("live identities cannot be adapted from synthetic storage, external network or arbitrary mounts", () => {
  const f = fixture();
  try {
    assertLiveCompose(f.state.config, f.files);
    for (const mutate of [
      (c) => (c.name = "mizyun-analytics"),
      (c) =>
        (c.volumes["postgres-data"].name = "mizyun-analytics_postgres-data"),
      (c) => (c.networks.analytics.external = true),
      (c) => (c.services.postgres.volumes[0].source = "supabase"),
      (c) => (c.services.metabase.ports[0].host_ip = "0.0.0.0"),
      (c) => (c.networks.extra = {}),
    ]) {
      const config = structuredClone(f.state.config);
      mutate(config);
      assert.throws(() => assertLiveCompose(config, f.files));
    }
    for (const mutate of [
      (c) =>
        (c.Config.Labels["com.docker.compose.project"] = "mizyun-analytics"),
      (c) => (c.Mounts[0].Name = "supabase_user_data"),
      (c) => (c.NetworkSettings.Networks.remote = {}),
      (c) =>
        c.Mounts.push({
          Type: "bind",
          Source: "/Users/adam/.ssh",
          Destination: "/root/.ssh",
        }),
    ]) {
      const c = f.container("postgres");
      mutate(c);
      assert.throws(() => assertLiveContainer(c, "postgres", f.files));
    }
  } finally {
    f.clean();
  }
});
test("actual runtime secrets, commands and flags must match even when Compose is safe", () => {
  const f = fixture();
  try {
    for (const service of ["postgres", "metabase"]) {
      assertLiveContainer(f.container(service), service, f.files);
      for (const mutate of [
        (c) => (c.HostConfig.Privileged = true),
        (c) => (c.Config.Cmd = ["sh"]),
        (c) => (c.Config.Entrypoint = ["sh"]),
        (c) => (c.HostConfig.ExtraHosts = ["postgres:10.0.0.1"]),
      ]) {
        const c = f.container(service);
        mutate(c);
        assert.throws(() => assertLiveContainer(c, service, f.files));
      }
      for (const item of f.container(service).Config.Env) {
        const c = f.container(service),
          key = item.split("=")[0];
        c.Config.Env = c.Config.Env.map((v) =>
          v.startsWith(key + "=") ? key + "=wrong" : v,
        );
        assert.throws(() => assertLiveContainer(c, service, f.files), key);
      }
      const c = f.container(service);
      c.Config.Env.push("MB_DB_CONNECTION_URI=postgres://remote/db");
      assert.throws(() => assertLiveContainer(c, service, f.files));
    }
    f.state.containerMutation = (c) => {
      c.Config.Env.push("JAVA_TOOL_OPTIONS=-javaagent:/tmp/agent");
    };
    assert.throws(() => f.runtime.importSql("BEGIN; COMMIT;"));
    assert.equal(
      f.state.calls.some((c) => c.args.includes("exec")),
      false,
    );
  } finally {
    f.clean();
  }
});
test("import repeats context/container guards and rejects synthetic warehouse before writes", () => {
  const f = fixture();
  try {
    f.runtime.verifyRunning();
    const before = f.state.calls.length;
    f.runtime.importSql(
      "BEGIN; DELETE FROM reporting.refreshes WHERE environment='dev'; COMMIT;",
    );
    assert.ok(f.state.calls.slice(before).some((c) => c.args[0] === "context"));
    const sql = f.state.calls.at(-1).input;
    assert.match(sql, /LOCK TABLE/);
    assert.equal((sql.match(/DO \$\$ BEGIN/g) ?? []).length, 2);
    assert.match(sql, /END \$\$;\nCOMMIT;$/);
    f.state.syntheticRows = 1;
    const calls = f.state.calls.length;
    assert.throws(
      () => f.runtime.importSql("BEGIN; COMMIT;"),
      /refuses synthetic/,
    );
    assert.equal(
      f.state.calls.slice(calls).filter((c) => c.input?.startsWith("BEGIN;"))
        .length,
      0,
    );
    f.state.syntheticRows = 0;
    f.state.context = "ssh://remote";
    assert.throws(() => f.runtime.importSql("BEGIN; COMMIT;"));
  } finally {
    f.clean();
  }
});
test("transactional import preserves literal dollar delimiters and blocks psql metacommands", () => {
  for (const sql of [
    "DELETE FROM reporting.refreshes;",
    "BEGIN;\n\\! cat /secret\nCOMMIT;",
    "BEGIN; COMMIT;\n",
  ])
    assert.throws(() => guardLiveImport(sql));
  const sql = guardLiveImport(snapshotImportSql(snapshot("dev")));
  assert.match(sql, /DO \$\$ BEGIN/);
  assert.match(sql, /END \$\$;/);
  assert.doesNotMatch(sql, /DO \$ BEGIN/);
});
test("start preserves containers/volumes; stop and status never collect or remove resources", async () => {
  const f = fixture();
  try {
    f.state.stopped = true;
    f.runtime.start();
    const up = f.state.calls.find((c) => c.args.includes("up"));
    assert.ok(up.args.includes("--no-recreate"));
    assert.ok(up.args.includes("never"));
    const deps = {
      root: f.root,
      runtime: f.runtime,
      collect: () => {
        throw new Error("must not collect");
      },
    };
    const result = await runLive(["--status"], deps);
    assert.equal(result.status, "running");
    assert.equal((await runLive(["--stop"], deps)).status, "stopped");
    assert.equal((await runLive(["--status"], deps)).status, "stopped");
    assert.equal(
      f.state.calls.some((c) =>
        c.args.some((a) =>
          ["down", "rm", "prune", "--volumes", "--force-recreate"].includes(a),
        ),
      ),
      false,
    );
    assert.equal(
      readFileSync(join(f.root, ".env.live"), "utf8").includes(
        f.files.env.METABASE_ENCRYPTION_KEY,
      ),
      true,
    );
  } finally {
    f.clean();
  }
});
function bootstrapMock({ ready = false, failSetup = false } = {}) {
  const state = { ready, calls: [], keys: [] };
  const api = async (method, path, body, session) => {
    state.calls.push({ method, path, body, session });
    if (path === "/session/properties")
      return {
        version: { tag: "v0.63.18.2" },
        ...(state.ready ? {} : { "setup-token": "private-setup-token" }),
      };
    if (path === "/setup") {
      state.ready = true;
      if (failSetup) throw new Error("lost response");
      return { id: "setup-session" };
    }
    if (path === "/session")
      return method === "DELETE" ? null : { id: "private-session-token" };
    if (path === "/user/current")
      return { email: OPERATOR_EMAIL, is_superuser: true };
    if (path === "/permissions/group")
      return [{ name: "Administrators", id: 2 }];
    if (path === "/api-key" && method === "GET") return state.keys;
    if (path === "/api-key" && method === "POST") {
      state.keys.push({ name: body.name });
      return { unmasked_key: "private-live-api-key" };
    }
    throw new Error("unexpected bootstrap request");
  };
  return { state, api };
}
test("bootstrap stores generated admin before setup and repeat start preserves credentials", async () => {
  const f = fixture(),
    mock = bootstrapMock();
  try {
    const first = await bootstrapLiveAdmin(f.runtime, {
      bootstrapApi: mock.api,
    });
    assert.equal(first.email, OPERATOR_EMAIL);
    assert.equal(first.apiKey, "private-live-api-key");
    const before = readFileSync(join(f.root, ".env.live-admin"), "utf8");
    const second = await bootstrapLiveAdmin(f.runtime, {
      bootstrapApi: mock.api,
    });
    assert.deepEqual(first, second);
    assert.equal(readFileSync(join(f.root, ".env.live-admin"), "utf8"), before);
    assert.equal(mock.state.calls.filter((c) => c.path === "/setup").length, 1);
    assert.equal(
      mock.state.calls.filter(
        (c) => c.path === "/api-key" && c.method === "POST",
      ).length,
      1,
    );
    const login = exportLiveLogin(f.root);
    assert.equal(statSync(login).mode & 0o777, 0o600);
    assert.doesNotMatch(readFileSync(login, "utf8"), /private-live-api-key/);
    assert.equal(exportLiveLogin(f.root), login);
    writeFileSync(login, "other owner credentials");
    assert.throws(() => exportLiveLogin(f.root), /preserved/);
  } finally {
    f.clean();
  }
});
test("lost setup response recovers using the saved password without resetting or another setup", async () => {
  const f = fixture(),
    mock = bootstrapMock({ failSetup: true });
  try {
    await assert.rejects(
      bootstrapLiveAdmin(f.runtime, { bootstrapApi: mock.api }),
      /lost response/,
    );
    const before = readLiveAdmin(f.root);
    assert.equal(before.apiKey, undefined);
    const recovered = await bootstrapLiveAdmin(f.runtime, {
      bootstrapApi: mock.api,
    });
    assert.equal(recovered.password, before.password);
    assert.equal(mock.state.calls.filter((c) => c.path === "/setup").length, 1);
  } finally {
    f.clean();
  }
});
test("foreign initialized instance and lost API-key response refuse adoption/regeneration", async () => {
  const f = fixture(),
    mock = bootstrapMock({ ready: true });
  try {
    await assert.rejects(
      bootstrapLiveAdmin(f.runtime, { bootstrapApi: mock.api }),
      /refusing adoption/,
    );
    assert.equal(
      mock.state.calls.some((c) => c.method === "POST"),
      false,
    );
    writeFileSync(
      join(f.root, ".env.live-admin"),
      JSON.stringify({
        email: OPERATOR_EMAIL,
        password: "Live-" + "a".repeat(64),
      }),
      { mode: 0o600 },
    );
    mock.state.keys = [{ name: "Mizyun local live dashboard" }];
    await assert.rejects(
      bootstrapLiveAdmin(f.runtime, { bootstrapApi: mock.api }),
      /refusing duplicate or regeneration/,
    );
    assert.equal(
      mock.state.calls.some(
        (c) =>
          c.path.includes("regenerate") ||
          (c.path === "/api-key" && c.method === "POST"),
      ),
      false,
    );
  } finally {
    f.clean();
  }
});
test("bootstrap transport fixes loopback, refuses redirects and sanitizes rejected secret payloads", async () => {
  let request;
  const api = createBootstrapApi(async (url, init) => {
    request = { url, init };
    return {
      ok: false,
      status: 400,
      json: async () => ({ message: "secret-password" }),
    };
  });
  await assert.rejects(
    api("POST", "/session", { password: "secret-password" }),
    {
      message:
        "Private local Metabase setup request failed; diagnostics suppressed",
    },
  );
  assert.equal(request.url, LIVE_ORIGIN + "/api/session");
  assert.equal(request.init.redirect, "error");
});
test("live cold readiness tolerates more than fifteen initial failures and rejects an unexpected version immediately", async () => {
  let elapsed = 0;
  let calls = 0;
  await waitLiveApi(
    async () => {
      calls++;
      if (calls <= 20) throw new Error("private cold startup diagnostics");
      return { version: { tag: "v0.63.18.2" } };
    },
    {
      now: () => elapsed,
      pause: async (ms) => {
        elapsed += ms;
      },
    },
  );
  assert.equal(calls, 21);
  assert.equal(elapsed, 20000);
  calls = 0;
  await assert.rejects(
    waitLiveApi(
      async () => {
        calls++;
        return { version: { tag: "v0.64.0" } };
      },
      {
        now: () => 0,
        pause: async () => {
          throw new Error("must deny without polling");
        },
      },
    ),
    /not the pinned version/,
  );
  assert.equal(calls, 1);
});
test("live readiness is bounded by a two-minute deadline and remaining request budgets", async () => {
  let elapsed = 0;
  let calls = 0;
  await assert.rejects(
    waitLiveApi(
      async (method, path, body, session, budget) => {
        calls++;
        assert.equal(path, "/session/properties");
        assert.ok(budget > 0 && budget <= 3000 && budget <= 120000 - elapsed);
        elapsed += budget;
        throw new Error("private startup failure");
      },
      {
        now: () => elapsed,
        pause: async (ms) => {
          assert.ok(ms > 0 && ms <= 1000);
          elapsed += ms;
        },
      },
    ),
    {
      message:
        "Live Metabase did not become ready within two minutes; existing data and credentials were preserved",
    },
  );
  assert.equal(elapsed, 120000);
  assert.equal(calls, 30);
  let frozenCalls = 0;
  await assert.rejects(
    waitLiveApi(
      async () => {
        frozenCalls++;
        throw new Error("offline");
      },
      { now: () => 0, pause: async () => {} },
    ),
    /within two minutes/,
  );
  assert.equal(frozenCalls, 120);
});
test("bootstrap uses three-second properties timeouts, ten-second other requests and a shorter remaining deadline", async () => {
  const timeout = AbortSignal.timeout;
  const budgets = [];
  AbortSignal.timeout = (ms) => {
    budgets.push(ms);
    return timeout(ms);
  };
  try {
    const api = createBootstrapApi(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    await api("GET", "/session/properties");
    await api("POST", "/session", {});
    await api("GET", "/session/properties", undefined, undefined, 400);
    assert.deepEqual(budgets, [3000, 10000, 400]);
  } finally {
    AbortSignal.timeout = timeout;
  }
});
test("live start imports independent real environments; failure clears only failed source and reports honestly", async () => {
  const f = fixture();
  try {
    const seen = [];
    const result = await runLive([], {
      root: f.root,
      runtime: f.runtime,
      bootstrap: async () => ({ apiKey: "private-live-api-key" }),
      provision: async (config, options) => {
        assert.equal(config.url, LIVE_ORIGIN);
        assert.equal(options.defaultEnvironment, "prod");
        return { dashboardId: 7, url: LIVE_ORIGIN + "/dashboard/7" };
      },
      collect: async (environment) => {
        seen.push(environment);
        if (environment === "dev") throw new Error("secret response");
        return snapshot(environment);
      },
      exportLogin: () => join(f.root, ".env.live-login"),
    });
    assert.deepEqual(seen, ["dev", "prod"]);
    assert.equal(result.status, "partial");
    assert.equal(result.outcomes[0].cleared, true);
    assert.equal(result.outcomes[1].status, "refreshed");
    const writes = f.state.calls
      .filter((c) => c.input?.startsWith("BEGIN;"))
      .map((c) => c.input);
    assert.match(
      writes[0],
      /DELETE FROM reporting.refreshes WHERE environment='dev'/,
    );
    assert.match(
      writes[1],
      /DELETE FROM reporting.metric_data WHERE environment='prod'/,
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /secret response|private-live-api-key/,
    );
  } finally {
    f.clean();
  }
});
test("mislabeled or synthetic collection results are cleared instead of imported", async () => {
  const f = fixture();
  try {
    const result = await runLive([], {
      root: f.root,
      runtime: f.runtime,
      bootstrap: async () => ({ apiKey: "private-live-api-key" }),
      provision: async () => ({}),
      collect: async () => snapshot("synthetic"),
      exportLogin: () => "login",
    });
    assert.ok(
      result.outcomes.every((o) => o.status === "unavailable" && o.cleared),
    );
    assert.equal(
      f.state.calls.some((c) =>
        c.input?.includes("CREATE TEMP TABLE incoming"),
      ),
      false,
    );
  } finally {
    f.clean();
  }
});
test("invalidation failure is reported distinctly and does not prevent the independent other source", async () => {
  const f = fixture();
  try {
    const importSql = f.runtime.importSql;
    f.runtime.importSql = (sql) => {
      if (
        sql.includes("DELETE FROM reporting.refreshes WHERE environment='dev'")
      )
        throw new Error("private rejected SQL");
      return importSql(sql);
    };
    const result = await runLive([], {
      root: f.root,
      runtime: f.runtime,
      bootstrap: async () => ({ apiKey: "private-live-api-key" }),
      provision: async () => ({}),
      collect: async (env) => {
        if (env === "dev") throw new Error("private source error");
        return snapshot(env);
      },
      exportLogin: () => "login",
    });
    assert.equal(result.outcomes[0].cleared, false);
    assert.match(result.outcomes[0].notice, /could not be cleared/);
    assert.equal(result.outcomes[1].status, "refreshed");
    assert.doesNotMatch(
      JSON.stringify(result),
      /private rejected|private source/,
    );
  } finally {
    f.clean();
  }
});
