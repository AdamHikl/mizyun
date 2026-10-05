import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { checkLockStatus, defaultLockDirectory } from "./run-check.mjs";

const runnerUrl = new URL("./run-check.mjs", import.meta.url).href;

function fixture(t, gateSource, { groupProbe } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mizyun-check-runner-test-"));
  const cwd = join(root, "repo");
  const lockDirectory = join(root, "lock");
  const audit = join(root, "audit.jsonl");
  mkdirSync(cwd);
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ scripts: { "check:steps": "node gate.mjs" } }),
  );
  writeFileSync(
    join(cwd, "gate.mjs"),
    `import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
const audit = ${JSON.stringify(audit)};
const record = event => appendFileSync(audit, JSON.stringify({ event, time: Date.now(), pid: process.pid }) + '\\n');
${gateSource}`,
  );
  const helper = join(root, "invoke.mjs");
  writeFileSync(
    helper,
    `import { runCheck } from ${JSON.stringify(runnerUrl)};
${
  groupProbe
    ? `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const kill = process.kill.bind(process);
const spawnSync = childProcess.spawnSync;
let probedGroup;
process.kill = (pid, signal) => {
  if (pid < 0 && signal === 0) {
    probedGroup = -pid;
    throw Object.assign(new Error('simulated group probe EPERM'), { code: 'EPERM' });
  }
  return kill(pid, signal);
};
childProcess.spawnSync = (command, args, options) => {
  if (command === 'ps' && args[0] === '-axo') {
    const probe = ${JSON.stringify(groupProbe)};
    return { status: probe === 'unavailable' ? 1 : 0,
      stdout: probe === 'empty' || probe === 'unavailable' ? '' : probedGroup + ' ' + (probe === 'zombie' ? 'Z' : 'R') + '\\n' };
  }
  return spawnSync(command, args, options);
};
syncBuiltinESMExports();
`
    : ""
}
process.exitCode = await runCheck({ cwd: process.argv[2] || ${JSON.stringify(cwd)}, lockDirectory: ${JSON.stringify(lockDirectory)}, pollMs: 20, shutdownMs: 2000 });`,
  );
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
    }
    await Promise.all(children.map((child) => child.done));
    rmSync(root, { recursive: true, force: true });
  });
  function start(checkCwd = cwd) {
    const child = spawn(process.execPath, [helper, checkCwd], {
      stdio: "pipe",
    });
    child.output = "";
    child.stdout.on("data", (chunk) => (child.output += chunk));
    child.stderr.on("data", (chunk) => (child.output += chunk));
    child.done = new Promise((resolve) => {
      child.on("close", (code, signal) => {
        child.result = { code, signal };
        resolve(child.result);
      });
    });
    children.push(child);
    return child;
  }
  return {
    root,
    cwd,
    lockDirectory,
    lock: join(lockDirectory, "owner.json"),
    start,
    diagnostics: async () => {
      const pids = [
        ...children.map(({ pid }) => pid),
        ...(existsSync(audit)
          ? readFileSync(audit, "utf8")
              .trim()
              .split("\n")
              .map(JSON.parse)
              .map(({ pid }) => pid)
          : []),
      ].filter(Number.isSafeInteger);
      const processes = spawnSync(
        "ps",
        [
          "-p",
          [...new Set(pids)].join(","),
          "-o",
          "pid=,ppid=,pgid=,stat=,lstart=,command=",
        ],
        { encoding: "utf8", timeout: 2000 },
      );
      return JSON.stringify(
        {
          root,
          children: children.map(
            ({ pid, exitCode, signalCode, result, output }) => ({
              pid,
              exitCode,
              signalCode,
              result,
              output: output.slice(-8000),
            }),
          ),
          lock: existsSync(join(lockDirectory, "owner.json"))
            ? readFileSync(join(lockDirectory, "owner.json"), "utf8")
            : null,
          lockStatus: await checkLockStatus(lockDirectory),
          audit: existsSync(audit)
            ? readFileSync(audit, "utf8").slice(-8000)
            : null,
          processes: {
            status: processes.status,
            error: processes.error?.message,
            stdout: processes.stdout?.slice(-8000),
            stderr: processes.stderr?.slice(-2000),
          },
        },
        null,
        2,
      );
    },
    events: () =>
      existsSync(audit)
        ? readFileSync(audit, "utf8").trim().split("\n").map(JSON.parse)
        : [],
  };
}

async function waitFor(predicate, label, { stopped, diagnostics } = {}) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (stopped?.() || Date.now() > deadline) {
      const reason = stopped?.()
        ? "Process exited before"
        : "Timed out waiting for";
      assert.fail(
        `${reason} ${label}${diagnostics ? `\n${await diagnostics()}` : ""}`,
      );
    }
    await delay(20);
  }
}

test("default lock is stable across cwd and TMPDIR", () => {
  assert.equal(defaultLockDirectory(), `/tmp/mizyun-check-${process.getuid()}`);
});

for (const groupProbe of ["empty", "zombie", "live", "unavailable"]) {
  test(`EPERM group probe with ${groupProbe} member inspection`, async (t) => {
    const f = fixture(t, "record('start');", { groupProbe });
    const run = f.start();
    const drained = groupProbe === "empty" || groupProbe === "zombie";
    assert.equal((await run.done).code, drained ? 0 : 1, run.output);
    assert.equal(existsSync(f.lock), !drained);
    if (!drained) assert.match(run.output, /Lock retained/);
    if (groupProbe === "live") assert.match(run.output, /EPERM/);
    if (groupProbe === "unavailable")
      assert.match(
        run.output,
        /Cannot verify that the check process group has stopped/,
      );
  });
}

test("real competing processes serialize all gates and release their lock", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 400);",
  );
  const first = f.start();
  await waitFor(() => f.events().length === 1, "first gate");
  const second = f.start();
  await waitFor(
    () => /Waiting for check runner/.test(second.output),
    "lock wait",
  );
  assert.equal(f.events().length, 1);
  assert.deepEqual(await first.done, { code: 0, signal: null });
  assert.deepEqual(await second.done, { code: 0, signal: null });
  assert.deepEqual(
    f.events().map(({ event }) => event),
    ["start", "end", "start", "end"],
  );
  assert.equal(existsSync(f.lock), false);
});

test("gate failure preserves its exit code and allows the next run", async (t) => {
  const f = fixture(t, "record('failure'); process.exitCode = 7;");
  assert.equal((await f.start().done).code, 7);
  assert.equal(existsSync(f.lock), false);
  assert.equal((await f.start().done).code, 7);
  assert.equal(f.events().length, 2);
});

test("different repository copies share the same lock queue", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 400);",
  );
  const other = join(f.root, "other-repo");
  mkdirSync(other);
  for (const name of ["package.json", "gate.mjs"])
    copyFileSync(join(f.cwd, name), join(other, name));
  const first = f.start();
  await waitFor(() => f.events().length === 1, "first copy gate");
  const second = f.start(other);
  await waitFor(
    () => /Waiting for check runner/.test(second.output),
    "other copy wait",
  );
  assert.equal((await first.done).code, 0);
  assert.equal((await second.done).code, 0);
  assert.deepEqual(
    f.events().map(({ event }) => event),
    ["start", "end", "start", "end"],
  );
});

test("read-only status distinguishes unlocked, active and stale ownership", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 400);",
  );
  assert.equal((await checkLockStatus(f.lockDirectory)).state, "unlocked");
  const run = f.start();
  await waitFor(() => f.events().length === 1, "status owner gate");
  const owner = readFileSync(f.lock, "utf8");
  assert.equal((await checkLockStatus(f.lockDirectory)).state, "active");
  assert.equal(readFileSync(f.lock, "utf8"), owner);
  assert.equal((await run.done).code, 0);
  writeFileSync(f.lock, owner);
  assert.equal((await checkLockStatus(f.lockDirectory)).state, "stale");
  assert.equal(readFileSync(f.lock, "utf8"), owner);
});

test("a source directory named build is still checked", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 400);",
  );
  mkdirSync(join(f.cwd, "build"));
  writeFileSync(join(f.cwd, "build/input.mjs"), "original");
  const run = f.start();
  await waitFor(() => f.events().length === 1, "build source gate");
  writeFileSync(join(f.cwd, "build/input.mjs"), "changed");
  assert.equal((await run.done).code, 1);
  assert.match(run.output, /STALE evidence/);
});

test("source mutation makes otherwise passing gates stale", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 500);",
  );
  writeFileSync(join(f.cwd, "source.ts"), "export const value = 1;\n");
  const run = f.start();
  await waitFor(() => f.events().length === 1, "gate start");
  writeFileSync(join(f.cwd, "source.ts"), "export const value = 2;\n");
  assert.equal((await run.done).code, 1);
  assert.match(run.output, /STALE evidence/);
  assert.doesNotMatch(run.output, /PASS: all gates/);
  assert.equal(existsSync(f.lock), false);
});

test("an edit restored during the gate still invalidates evidence", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 400);",
  );
  const source = join(f.cwd, "source.ts");
  writeFileSync(source, "original\n");
  const run = f.start();
  await waitFor(() => f.events().length === 1, "gate start");
  writeFileSync(source, "temporary edit\n");
  writeFileSync(source, "original\n");
  assert.equal((await run.done).code, 1);
  assert.match(run.output, /STALE evidence/);
});

test("generated caches and build output do not invalidate a run", async (t) => {
  const f = fixture(
    t,
    `record('start');
for (const name of ['dist', 'node_modules', '.cache', 'apps/mobile/ios/build']) {
  mkdirSync(name, { recursive: true }); writeFileSync(name + '/generated.txt', 'output');
}
writeFileSync('project.tsbuildinfo', 'cache');
setTimeout(() => record('end'), 100);`,
  );
  const run = f.start();
  assert.equal((await run.done).code, 0);
  assert.match(run.output, /PASS: all gates/);
});

test("ignored native configuration and environment inputs are monitored", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 400);",
  );
  mkdirSync(join(f.cwd, "apps/mobile/ios"), { recursive: true });
  writeFileSync(join(f.cwd, "apps/mobile/ios/project.pbxproj"), "original");
  writeFileSync(join(f.cwd, ".env"), "FIXTURE_VALUE=original\n");
  const run = f.start();
  await waitFor(() => f.events().length === 1, "gate start");
  writeFileSync(join(f.cwd, ".env"), "FIXTURE_VALUE=changed\n");
  assert.equal((await run.done).code, 1);
  assert.match(run.output, /STALE evidence/);
  assert.doesNotMatch(run.output, /FIXTURE_VALUE/);
});

test("native project configuration edits make passing evidence stale", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 400);",
  );
  const native = join(f.cwd, "apps/mobile/ios/Fixture.xcodeproj");
  mkdirSync(native, { recursive: true });
  const project = join(native, "project.pbxproj");
  writeFileSync(project, "original native configuration");
  const run = f.start();
  await waitFor(() => f.events().length === 1, "native gate start");
  writeFileSync(project, "changed native configuration");
  assert.equal((await run.done).code, 1);
  assert.match(run.output, /STALE evidence/);
});

test("SIGKILL leaves an owned lock and contenders refuse to steal it", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 1000);",
  );
  const owner = f.start();
  await waitFor(() => f.events().length === 1, "force-killed owner gate");
  const lock = readFileSync(f.lock, "utf8");
  owner.kill("SIGKILL");
  await waitFor(() => owner.signalCode === "SIGKILL", "owner SIGKILL exit");
  const contender = f.start();
  assert.equal((await contender.done).code, 1);
  assert.match(contender.output, /Stale check lock/);
  assert.equal(readFileSync(f.lock, "utf8"), lock);
  assert.equal(f.events().length, 1);
  assert.deepEqual(await owner.done, { code: null, signal: "SIGKILL" });
  assert.equal(f.events().at(-1).event, "end");
  assert.equal(existsSync(f.lock), true);
});

test("signal retains lock until surviving gate descendants stop", async (t) => {
  const f = fixture(
    t,
    `const descendantCode = 'import { appendFileSync } from "node:fs"; const audit = ' + JSON.stringify(audit) + '; const record = ' + record.toString() + '; process.on("SIGTERM",()=>{}); record("descendant-start"); setTimeout(()=>record("descendant-end"),900);';
const descendant = spawn(process.execPath, ['--input-type=module', '-e', descendantCode], { stdio: 'ignore' });
process.on('SIGTERM', () => { record('parent-stopped'); process.exit(0); });
record('start'); setInterval(() => {}, 1000);`,
  );
  const first = f.start();
  await waitFor(
    () => f.events().some(({ event }) => event === "descendant-start"),
    "descendant",
  );
  first.kill("SIGTERM");
  await waitFor(
    () => f.events().some(({ event }) => event === "parent-stopped"),
    "parent signal",
  );
  assert.equal(existsSync(f.lock), true);
  const second = f.start();
  await waitFor(
    () => /Waiting for check runner/.test(second.output),
    "signal lock wait",
    {
      stopped: () => second.exitCode !== null || second.signalCode !== null,
      diagnostics: f.diagnostics,
    },
  );
  assert.equal((await first.done).code, 143);
  await waitFor(
    () => f.events().filter(({ event }) => event === "start").length === 2,
    "second gate",
    {
      stopped: () => second.exitCode !== null || second.signalCode !== null,
      diagnostics: f.diagnostics,
    },
  );
  const events = f.events();
  assert.ok(
    events.findIndex(({ event }) => event === "descendant-end") <
      events.findLastIndex(({ event }) => event === "start"),
  );
  second.kill("SIGTERM");
  assert.equal((await second.done).code, 143);
  assert.equal(existsSync(f.lock), false);
});

test("cancelling a waiter cannot remove the active owner's lock", async (t) => {
  const f = fixture(
    t,
    "record('start'); setTimeout(() => record('end'), 900);",
  );
  const owner = f.start();
  await waitFor(() => f.events().length === 1, "owner gate");
  const token = JSON.parse(readFileSync(f.lock, "utf8")).token;
  const waiter = f.start();
  await waitFor(() => /Waiting for check runner/.test(waiter.output), "waiter");
  waiter.kill("SIGINT");
  assert.equal((await waiter.done).code, 130);
  assert.equal(JSON.parse(readFileSync(f.lock, "utf8")).token, token);
  assert.equal((await owner.done).code, 0);
});

test("stale or malformed locks fail visibly without stealing", async (t) => {
  const f = fixture(t, "record('unexpected');");
  mkdirSync(f.lockDirectory, { mode: 0o700 });
  const probe = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  const stale = {
    version: 1,
    token: "fixture",
    pid: probe.pid,
    host: hostname(),
    processStart: "past process",
  };
  for (const value of [JSON.stringify(stale), "malformed"]) {
    writeFileSync(f.lock, value, { mode: 0o600 });
    const run = f.start();
    assert.equal((await run.done).code, 1);
    assert.match(run.output, /(?:Stale|Unknown) check lock/);
    assert.equal(readFileSync(f.lock, "utf8"), value);
    assert.equal(f.events().length, 0);
  }
});

test("CLI rejects bypass options before running any gates", () => {
  const run = spawnSync(
    process.execPath,
    [new URL("./run-check.mjs", import.meta.url).pathname, "--skip-lock"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /no bypass options/);
});
