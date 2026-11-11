import { test } from "node:test";
import assert from "node:assert/strict";
import {
  main,
  parseArgs,
  remoteCommand,
  importSql,
  sourceTopologyCommand,
} from "./collect.mjs";
import { spawnSync } from "node:child_process";
import { assertLocalContext } from "./local.mjs";

const context = [
  { Endpoints: { docker: { Host: "unix:///local-docker.sock" } } },
];
const snapshot = () => ({
  generatedAt: new Date().toISOString(),
  totalAccounts: 3,
  consentingAccounts: 2,
  metrics: [
    {
      day: new Date().toISOString().slice(0, 10),
      platform: "all",
      metric: "registrations",
      dimension: "all",
      value: 3,
    },
  ],
});
const sourceOutput = () => `${"a".repeat(40)}\n${JSON.stringify(snapshot())}`;
function harness(environment = {}) {
  const calls = [];
  const output = [];
  const state = { rows: "previous-snapshot", blocked: false };
  const dependencies = {
    environment,
    createRuntime: ({ environment: env }) => ({
      verifyRunning() {
        calls.push("verify");
        assertLocalContext(context, env);
        if (state.blocked) throw new Error("private destination detail");
      },
      importSql(sql) {
        calls.push("import");
        assert.match(sql, /BEGIN;/);
        assert.match(sql, /COMMIT;$/);
        state.rows = "replaced-snapshot";
      },
    }),
    execute(command, args, input) {
      calls.push("source");
      assert.equal(command, "ssh");
      assert.ok(args.includes("mizyun-hetzner-ops"));
      assert.match(input, /READ ONLY/);
      return sourceOutput();
    },
    readFile() {
      calls.push("read");
      return JSON.stringify([
        {
          platform: "ios",
          day: new Date().toISOString().slice(0, 10),
          metric: "first_time_downloads",
          value: 3,
          source: "apple_app_store_connect",
        },
      ]);
    },
    write(text) {
      output.push(text);
    },
  };
  return { dependencies, calls, output, state };
}

test("collector refuses duplicate, missing, unknown and synthetic options without side effects", async () => {
  const invalid = [
    [],
    ["--env"],
    ["--store"],
    ["--env", "--json"],
    ["--store", ""],
    ["--env", "dev", "--env", "prod"],
    ["--env", "dev", "--json", "--json"],
    ["--store", "file", "--store", "other"],
    ["--env", "dev", "--snapshot", "file"],
    ["--env", "synthetic", "--snapshot", "file"],
    ["--env", "synthetic"],
    ["--store", "file", "--json"],
    ["--env", "dev", "--store", "file"],
    ["--ssh", "rpserver"],
    ["--env", "prod\nprivate"],
  ];
  for (const args of invalid) {
    const h = harness();
    assert.throws(() => parseArgs(args));
    await assert.rejects(main(args, h.dependencies));
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.output, []);
  }
});

test("remote Docker overrides deny all source/store reads and imports before execution", async () => {
  for (const environment of [
    { DOCKER_HOST: "ssh://unapproved-target" },
    { DOCKER_CONTEXT: "unapproved-context" },
  ]) {
    for (const args of [
      ["--env", "dev"],
      ["--env", "prod", "--json"],
      ["--store", "private-file"],
    ]) {
      const h = harness(environment);
      // Exercise the actual default runtime: override refusal must happen
      // before private-file reads or even Docker context inspection.
      delete h.dependencies.createRuntime;
      await assert.rejects(
        main(args, h.dependencies),
        /No raw diagnostics disclosed/,
      );
      assert.deepEqual(h.calls, []);
      assert.equal(h.state.rows, "previous-snapshot");
      assert.deepEqual(h.output, []);
    }
  }
});

test("standalone import also verifies the Mac runtime instead of executing Docker directly", async () => {
  const h = harness({ DOCKER_HOST: "ssh://unapproved-target" });
  delete h.dependencies.createRuntime;
  await assert.rejects(
    importSql("SELECT 1;", h.dependencies),
    /private diagnostics suppressed/,
  );
  assert.deepEqual(h.calls, []);
  assert.equal(h.state.rows, "previous-snapshot");
});

test("live capture guards before collection and again immediately before snapshot replacement", async () => {
  const h = harness();
  await main(["--env", "dev"], h.dependencies);
  assert.deepEqual(h.calls, ["verify", "source", "verify", "import"]);
  assert.equal(h.state.rows, "replaced-snapshot");
  assert.deepEqual(h.output, ["Refreshed dev aggregate dashboard\n"]);
});

test("destination changes during source collection refuse replacement", async () => {
  const h = harness();
  const execute = h.dependencies.execute;
  h.dependencies.execute = (...args) => {
    const output = execute(...args);
    h.state.blocked = true;
    return output;
  };
  await assert.rejects(
    main(["--env", "dev"], h.dependencies),
    /No raw diagnostics disclosed/,
  );
  assert.deepEqual(h.calls, ["verify", "source", "verify"]);
  assert.equal(h.state.rows, "previous-snapshot");
  assert.deepEqual(h.output, []);
});

test("failed/malformed source reads preserve the prior snapshot and suppress private diagnostics", async () => {
  for (const execute of [
    () => {
      throw new Error("private source key");
    },
    () => "private malformed payload",
    () =>
      `${"a".repeat(40)}\n${JSON.stringify({ ...snapshot(), email: "private-email" })}`,
  ]) {
    const h = harness();
    h.dependencies.execute = execute;
    await assert.rejects(
      main(["--env", "prod"], h.dependencies),
      (error) => !/key|payload|email/.test(error.message),
    );
    assert.deepEqual(h.calls, ["verify"]);
    assert.equal(h.state.rows, "previous-snapshot");
    assert.deepEqual(h.output, []);
  }
});

test("store import guards before file reads and again before importing normalized aggregates", async () => {
  const h = harness();
  await main(["--store", "private-file"], h.dependencies);
  assert.deepEqual(h.calls, ["verify", "read", "verify", "import"]);
  assert.deepEqual(h.output, ["Imported normalized store aggregates\n"]);
  const broken = harness();
  broken.dependencies.readFile = () => "private malformed file";
  await assert.rejects(
    main(["--store", "private-file"], broken.dependencies),
    /No raw diagnostics disclosed/,
  );
  assert.equal(broken.state.rows, "previous-snapshot");
  assert.deepEqual(broken.calls, ["verify"]);
});

test("JSON capture returns only validated aggregates and never imports rows", async () => {
  const h = harness();
  await main(["--env", "prod", "--json"], h.dependencies);
  assert.deepEqual(h.calls, ["verify", "source"]);
  const result = JSON.parse(h.output[0]);
  assert.equal(result.environment, "prod");
  assert.equal(result.sourceSha, "a".repeat(40));
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "environment",
      "generatedAt",
      "sourceSha",
      "totalAccounts",
      "consentingAccounts",
      "metrics",
    ].sort(),
  );
  assert.equal(h.state.rows, "previous-snapshot");
});

test("source git trust is per invocation and limited to the fixed manifest checkout", () => {
  assert.match(
    remoteCommand("dev"),
    /git -c safe\.directory=\/var\/lib\/mizyun\/dev\/repo -C \/var\/lib\/mizyun\/dev\/repo rev-parse HEAD/,
  );
  assert.match(
    remoteCommand("prod"),
    /git -c safe\.directory=\/var\/lib\/mizyun\/repo -C \/var\/lib\/mizyun\/repo rev-parse HEAD/,
  );
  for (const env of ["dev", "prod"])
    assert.doesNotMatch(
      remoteCommand(env),
      /git config|--global|--system|safe\.directory=\*/,
    );
});

function topology(environment) {
  const container = (project, network, bindings, ports = bindings) => ({
    running: "true",
    project,
    networks: `${network} `,
    bindings: JSON.stringify(bindings),
    ports: JSON.stringify(ports),
  });
  return environment === "dev"
    ? {
        "mizyun-dev-db": container("mizyun-dev", "mizyun-dev_default", {
          "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5433" }],
        }),
      }
    : {
        "supabase-db": container("supabase", "supabase_default", {
          "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }],
        }),
      };
}
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
function runTopology(environment, fixtures) {
  const formats = {
    running: "{{.State.Running}}",
    project: '{{index .Config.Labels "com.docker.compose.project"}}',
    networks:
      "{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}",
    bindings: "{{json .HostConfig.PortBindings}}",
    ports: "{{json .NetworkSettings.Ports}}",
  };
  const cases = Object.entries(fixtures)
    .flatMap(([name, fields]) =>
      Object.entries(fields).map(
        ([key, value]) =>
          `${shellQuote(`${name}|${formats[key]}`)}) printf '%s' ${shellQuote(value)} ;;`,
      ),
    )
    .join("\n");
  // All docker calls resolve to this shell function. No Docker daemon, SSH,
  // source database, Git operation or temporary executable is contacted.
  const script = `set -eu\ndocker() { test "$1" = inspect; test "$2" = --format; case "$4|$3" in\n${cases}\n*) return 1 ;;\nesac; }\n${sourceTopologyCommand(environment)}\nprintf '%s' 'guard-accepted'`;
  return spawnSync("/bin/sh", ["-c", script], {
    encoding: "utf8",
    timeout: 1000,
  });
}

test("fixed source topology shell accepts isolated Dev and the direct loopback Production database", () => {
  for (const environment of ["dev", "prod"]) {
    const result = runTopology(environment, topology(environment));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "guard-accepted");
  }
  assert.match(remoteCommand("prod"), /docker exec -i supabase-db psql/);
  assert.throws(() => sourceTopologyCommand("rpserver"));
});

test("fixed shell denies stopped, wrong-project, extra-network and swapped/public binding source fixtures", () => {
  const cases = [
    [
      "dev",
      (v) => {
        v["mizyun-dev-db"].project = "supabase";
      },
    ],
    [
      "dev",
      (v) => {
        v["mizyun-dev-db"].networks += "supabase_default ";
      },
    ],
    [
      "dev",
      (v) => {
        v["mizyun-dev-db"].ports = JSON.stringify({
          "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }],
        });
      },
    ],
    [
      "dev",
      (v) => {
        v["mizyun-dev-db"].bindings = JSON.stringify({
          "5432/tcp": [
            { HostIp: "127.0.0.1", HostPort: "5433" },
            { HostIp: "0.0.0.0", HostPort: "5433" },
          ],
        });
      },
    ],
    [
      "prod",
      (v) => {
        v["supabase-db"].bindings = JSON.stringify({
          "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5432" }],
        });
      },
    ],
    [
      "prod",
      (v) => {
        v["supabase-db"].ports = JSON.stringify({
          "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5432" }],
        });
      },
    ],
    [
      "prod",
      (v) => {
        v["supabase-db"].running = "false";
      },
    ],
    [
      "prod",
      (v) => {
        v["supabase-db"].project = "mizyun-dev";
      },
    ],
    [
      "prod",
      (v) => {
        v["supabase-db"].networks = "mizyun-dev_default ";
      },
    ],
    [
      "prod",
      (v) => {
        v["supabase-db"].bindings = JSON.stringify({
          "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5433" }],
        });
      },
    ],
    [
      "prod",
      (v) => {
        // The old unbound database behind the pooler is no longer accepted.
        v["supabase-db"].bindings = JSON.stringify({});
        v["supabase-db"].ports = JSON.stringify({ "5432/tcp": null });
      },
    ],
  ];
  for (const [environment, mutate] of cases) {
    const fixtures = topology(environment);
    mutate(fixtures);
    const result = runTopology(environment, fixtures);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
  }
});
