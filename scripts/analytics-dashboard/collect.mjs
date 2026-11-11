#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEPLOYMENT_MANIFEST,
  buildRemoteHostRoleCommand,
} from "../deployment-manifest.mjs";
import {
  SOURCE_SQL,
  snapshotImportSql,
  storeImportSql,
  validateSnapshot,
} from "./snapshot.mjs";

const targets = {
  dev: { container: "mizyun-dev-db", manifest: DEPLOYMENT_MANIFEST.dev },
  prod: { container: "supabase-db", manifest: DEPLOYMENT_MANIFEST.production },
};
class CollectorArgumentsError extends Error {}

export function parseArgs(args) {
  const o = { environment: null, file: null, storeFile: null, json: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!["--env", "--store", "--json"].includes(a) || seen.has(a))
      throw new CollectorArgumentsError(
        "Use --env dev|prod [--json] or --store <file>; synthetic snapshots use pnpm analytics:dashboard:local",
      );
    seen.add(a);
    if (a === "--json") {
      o.json = true;
      continue;
    }
    const value = args[++i];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.startsWith("--") ||
      /[\r\n\u0000]/.test(value)
    )
      throw new CollectorArgumentsError(
        "Missing or invalid analytics-dashboard option value",
      );
    if (a === "--env") o.environment = value;
    else o.storeFile = value;
  }
  if (o.storeFile) {
    if (o.environment || o.file || o.json)
      throw new CollectorArgumentsError(
        "Store import cannot be combined with app capture",
      );
    return o;
  }
  if (!["dev", "prod"].includes(o.environment))
    throw new CollectorArgumentsError(
      "Use --env dev|prod; synthetic snapshots use pnpm analytics:dashboard:local",
    );
  return o;
}

const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, {
    input,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  // psql/SSH diagnostics may include a rejected payload or secrets. Never forward them.
  if (r.error || r.status !== 0)
    throw new Error(
      "Aggregate collection/import failed; source remains unavailable",
    );
  return r.stdout.trim();
};
/** Fixed shell checks also verify every binding, not just the first listener. */
export function sourceTopologyCommand(environment) {
  if (!["dev", "prod"].includes(environment))
    throw new Error("Invalid source environment");
  const check = (container, project, network, bindings, ports) => {
    const inspect = (format) =>
      `$(docker inspect --format '${format}' ${container})`;
    return [
      `test "${inspect("{{.State.Running}}")}" = true`,
      `test "${inspect('{{index .Config.Labels "com.docker.compose.project"}}')}" = '${project}'`,
      `test "${inspect("{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}")}" = '${network} '`,
      `test "${inspect("{{json .HostConfig.PortBindings}}")}" = '${JSON.stringify(bindings)}'`,
      `test "${inspect("{{json .NetworkSettings.Ports}}")}" = '${JSON.stringify(ports)}'`,
    ].join("\n");
  };
  if (environment === "dev") {
    const bindings = {
      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5433" }],
    };
    return check(
      "mizyun-dev-db",
      "mizyun-dev",
      "mizyun-dev_default",
      bindings,
      bindings,
    );
  }
  // Supavisor was removed on 2026-11-11; the database owns loopback 5432.
  const bindings = {
    "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }],
  };
  return check(
    "supabase-db",
    "supabase",
    "supabase_default",
    bindings,
    bindings,
  );
}
export function remoteCommand(environment) {
  const target = targets[environment];
  if (!target) throw new Error("Invalid source environment");
  const c = target.manifest;
  return `${buildRemoteHostRoleCommand(c)}
${sourceTopologyCommand(environment)}
git -c safe.directory=${c.defaultRemoteDir} -C ${c.defaultRemoteDir} rev-parse HEAD
docker exec -i ${target.container} psql -X -q -t -A -v ON_ERROR_STOP=1 -U postgres -d postgres`;
}

export function collect(environment, execute = run) {
  const output = execute(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "mizyun-hetzner-ops",
      remoteCommand(environment),
    ],
    SOURCE_SQL,
  );
  const [sourceSha, ...lines] = output.split("\n");
  let payload;
  try {
    payload = JSON.parse(lines.join("\n"));
  } catch {
    throw new Error("Source did not return a valid aggregate snapshot");
  }
  return validateSnapshot({ ...payload, environment, sourceSha });
}
async function liveRuntime(dependencies) {
  if (dependencies.runtime) return dependencies.runtime;
  const factory =
    dependencies.createRuntime ??
    (await import("./runtime.mjs")).createLiveRuntime;
  return factory({
    execute: dependencies.execute,
    environment: dependencies.environment,
    root: dependencies.root,
  });
}

/** Generic imports always target the separately guarded Mac live warehouse. */
export async function importSql(sql, dependencies = {}) {
  try {
    const runtime = await liveRuntime(dependencies);
    runtime.verifyRunning();
    return runtime.importSql(sql);
  } catch {
    throw new Error("Aggregate import failed; private diagnostics suppressed");
  }
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const o = parseArgs(args);
  const write = dependencies.write ?? ((text) => process.stdout.write(text));
  try {
    const runtime = await liveRuntime(dependencies);
    // Verify before SSH or file reads, including aggregate-only --json output.
    runtime.verifyRunning();
    if (o.storeFile) {
      const content = (dependencies.readFile ?? readFileSync)(
        o.storeFile,
        "utf8",
      );
      const sql = storeImportSql(JSON.parse(content));
      await importSql(sql, { runtime });
      write("Imported normalized store aggregates\n");
      return;
    }
    const snapshot = collect(o.environment, dependencies.execute ?? run);
    if (snapshot.environment !== o.environment)
      throw new Error("Snapshot environment mismatch");
    if (o.json) write(`${JSON.stringify(snapshot)}\n`);
    else {
      await importSql(snapshotImportSql(snapshot), { runtime });
      write(`Refreshed ${o.environment} aggregate dashboard\n`);
    }
  } catch {
    throw new Error(
      "Analytics dashboard refresh failed. No raw diagnostics disclosed.",
    );
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      error instanceof CollectorArgumentsError
        ? `${error.message}\n`
        : "Analytics dashboard refresh failed. No raw diagnostics disclosed.\n",
    );
    process.exitCode = 1;
  }
}
