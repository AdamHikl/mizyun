import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { watch } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  stat,
  unlink,
} from "node:fs/promises";
import { constants, hostname } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// Deliberately independent of cwd, Git worktrees and TMPDIR. This is a local,
// per-user lock for all Mizyun copies, including task-only temporary snapshots.
export function defaultLockDirectory() {
  if (process.platform === "win32" || !process.getuid)
    throw new Error(
      "Serialized checks require a POSIX host with process groups.",
    );
  return `/tmp/mizyun-check-${process.getuid()}`;
}

const generatedDirectories = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  "dist",
  "coverage",
  ".turbo",
  ".expo",
  ".cache",
  ".idea",
  ".vscode",
  ".claude",
]);

function excluded(relativePath) {
  const parts = relativePath.split(/[\\/]/);
  return (
    parts.some((part) => generatedDirectories.has(part)) ||
    /^apps\/mobile\/(?:ios\/(?:Pods|build|DerivedData)|android\/(?:\.gradle|build|app\/build)|modules\/[^/]+\/android\/build)(?:\/|$)/.test(
      relativePath,
    ) ||
    /(?:^|\/)\.DS_Store$|\.tsbuildinfo$|(?:^|\/)\.eslintcache$/.test(
      relativePath,
    ) ||
    relativePath === "apps/mobile/expo-env.d.ts" ||
    /^\.agents\/tasks\/batch-report-.*\.json$/.test(relativePath)
  );
}

async function containsInput(cwd, relativePath) {
  for (const entry of await readdir(join(cwd, relativePath), {
    withFileTypes: true,
  })) {
    const relative = `${relativePath}/${entry.name}`;
    if (excluded(relative)) continue;
    if (!entry.isDirectory() || (await containsInput(cwd, relative)))
      return true;
  }
  return false;
}

// Includes ignored input such as .env and native project configuration, without
// logging paths or values. Filesystem events catch intermediate edits; the final
// content/metadata fingerprint also detects changes missed by fs.watch.
export async function fingerprintInputs(cwd) {
  const hash = createHash("sha256");
  let files = 0;
  const tracked = spawnSync("git", ["ls-files", "--cached", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (tracked.error) throw tracked.error;
  const trackedPaths = new Set(
    tracked.status === 0 ? tracked.stdout.split("\0").filter(Boolean) : [],
  );
  const trackedParents = new Set();
  for (const path of trackedPaths) {
    let parent = dirname(path);
    while (parent !== ".") {
      trackedParents.add(parent);
      parent = dirname(parent);
    }
  }
  async function visit(relativePath) {
    const absolutePath = join(cwd, relativePath);
    for (const entry of (
      await readdir(absolutePath, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      if (
        excluded(relative) &&
        !trackedPaths.has(relative) &&
        !trackedParents.has(relative)
      )
        continue;
      if (entry.isDirectory()) {
        await visit(relative);
        continue;
      }
      const info = await lstat(join(cwd, relative), { bigint: true });
      hash.update(
        `${relative}\0${info.mode}\0${info.ino}\0${info.size}\0${info.mtimeNs}\0${info.ctimeNs}\0`,
      );
      if (entry.isSymbolicLink()) {
        hash.update(await readlink(join(cwd, relative)));
        const target = await stat(join(cwd, relative));
        if (!target.isFile())
          throw new Error(
            "Check input contains an unsupported directory symlink.",
          );
      } else if (!entry.isFile()) {
        throw new Error("Check input contains an unsupported special file.");
      }
      hash.update(await readFile(join(cwd, relative)));
      hash.update("\0");
      files++;
    }
  }
  await visit("");
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (head.error) throw head.error;
  if (head.status !== 0) {
    // Fixtures may be non-Git copies. A real checkout must resolve its HEAD.
    try {
      await lstat(join(cwd, ".git"));
      throw new Error("Cannot identify the check candidate Git HEAD.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  hash.update(head.status === 0 ? head.stdout.trim() : "no-git");
  return { digest: hash.digest("hex"), files };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function processStart(pid) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return result.status === 0 ? result.stdout.trim() : null;
}

function groupAlive(group) {
  if (!processExists(-group)) return false;
  // Zombies cannot run gates or hold resources, but signal 0 may find them.
  const result = spawnSync("ps", ["-axo", "pgid=,stat="], { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error("Cannot verify that the check process group has stopped.");
  return result.stdout.split("\n").some((line) => {
    const [pidGroup, state] = line.trim().split(/\s+/);
    return Number(pidGroup) === group && state && !state.startsWith("Z");
  });
}

async function acquireLock(directory, state, log, pollMs) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.uid !== process.getuid() ||
    (directoryInfo.mode & 0o077) !== 0
  )
    throw new Error(
      `Check lock directory is not private and owned: ${directory}`,
    );
  const lockPath = join(directory, "owner.json");
  const token = randomUUID();
  const candidatePath = join(directory, `${token}.candidate`);
  const started = processStart(process.pid);
  if (!started) throw new Error("Cannot identify the check runner process.");
  const metadata = {
    version: 1,
    token,
    pid: process.pid,
    host: hostname(),
    processStart: started,
    createdAt: new Date().toISOString(),
  };
  const candidate = await open(candidatePath, "wx", 0o600);
  try {
    await candidate.writeFile(JSON.stringify(metadata));
    await candidate.sync();
  } finally {
    await candidate.close();
  }
  let waitingNotice = false;
  try {
    while (!state.signal) {
      try {
        // Atomic publication avoids a partially written owner for contenders.
        await link(candidatePath, lockPath);
        const owned = await lstat(candidatePath);
        return async () => {
          const current = await lstat(lockPath);
          if (current.ino !== owned.ino || current.dev !== owned.dev)
            throw new Error("Check lock ownership changed; refusing cleanup.");
          await unlink(lockPath);
        };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      let owner;
      let ownerInfo;
      try {
        ownerInfo = await lstat(lockPath);
        if (!ownerInfo.isFile() || ownerInfo.uid !== process.getuid())
          throw new Error();
        owner = JSON.parse(await readFile(lockPath, "utf8"));
        if (
          owner.version !== 1 ||
          !Number.isSafeInteger(owner.pid) ||
          owner.pid <= 0 ||
          owner.host !== hostname() ||
          typeof owner.token !== "string" ||
          typeof owner.processStart !== "string"
        )
          throw new Error();
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw new Error(
          `Unknown check lock at ${lockPath}; no lock was removed. Inspect the owner and all gate children before manual recovery.`,
        );
      }
      if (
        !processExists(owner.pid) ||
        processStart(owner.pid) !== owner.processStart
      ) {
        // The previous owner can unlink and exit while a waiter reads it.
        // Recheck that this is still the same published lock before failing.
        try {
          const current = await lstat(lockPath);
          if (current.ino !== ownerInfo.ino || current.dev !== ownerInfo.dev)
            continue;
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        throw new Error(
          `Stale check lock at ${lockPath} (owner PID ${owner.pid}); no lock was removed. Confirm all gate children have stopped before manual recovery.`,
        );
      }
      if (!waitingNotice) {
        log(`Waiting for check runner PID ${owner.pid}; lock ${lockPath}.`);
        waitingNotice = true;
      }
      await delay(pollMs);
    }
    return null;
  } finally {
    await unlink(candidatePath);
  }
}

// Options are an exported fixture API only. The CLI always checks its own repo
// with pnpm run check:steps and the fixed host/user lock; no environment bypass.
export async function runCheck({
  cwd = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  lockDirectory = defaultLockDirectory(),
  log = (message) => console.error(`[check] ${message}`),
  pollMs = 250,
  shutdownMs = 10_000,
} = {}) {
  defaultLockDirectory(); // Reject hosts without the required signal semantics.
  const state = { signal: null };
  let group;
  let release;
  let watcher;
  let killTimer;
  let changed = false;
  let watcherError;
  const pendingEvents = new Set();
  const signalGroup = (signal) => {
    if (!group) return;
    try {
      process.kill(-group, signal);
    } catch (error) {
      if (error.code !== "ESRCH")
        log(`Could not signal gates: ${error.message}`);
    }
  };
  const handlers = new Map(
    ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [
      signal,
      () => {
        if (state.signal) {
          signalGroup("SIGKILL");
          return;
        }
        state.signal = signal;
        log(`${signal}: stopping gates; retaining the lock until they stop.`);
        signalGroup(signal);
        killTimer = setTimeout(() => signalGroup("SIGKILL"), shutdownMs);
      },
    ]),
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const cancellationCode = () => 128 + constants.signals[state.signal];
  try {
    release = await acquireLock(lockDirectory, state, log, pollMs);
    if (!release || state.signal) return cancellationCode();
    watcher = watch(cwd, { recursive: true }, (_event, filename) => {
      if (!filename) {
        changed = true;
        return;
      }
      const relative = String(filename).split(sep).join("/");
      if (excluded(relative)) return;
      const event = (async () => {
        try {
          const info = await lstat(join(cwd, relative));
          // Creating parents of excluded build/cache output changes no input.
          if (!info.isDirectory() || (await containsInput(cwd, relative)))
            changed = true;
        } catch {
          changed = true;
        }
      })();
      pendingEvents.add(event);
      event.finally(() => pendingEvents.delete(event));
    });
    watcher.on("error", (error) => {
      watcherError = error;
    });
    const before = await fingerprintInputs(cwd);
    if (state.signal) return cancellationCode();
    log(`Running all check:steps gates; input SHA-256 ${before.digest}.`);
    const child = spawn("pnpm", ["run", "check:steps"], {
      cwd,
      stdio: "inherit",
      detached: true,
    });
    group = child.pid;
    const result = await new Promise((resolveResult) => {
      let spawnError;
      child.on("error", (error) => {
        spawnError = error;
      });
      child.on("close", (code, signal) =>
        resolveResult({
          code: spawnError
            ? 1
            : (code ?? 128 + (constants.signals[signal] || 1)),
          spawnError,
        }),
      );
    });
    if (result.spawnError)
      log(`Could not start gates: ${result.spawnError.message}`);
    let remainingChildren = false;
    const drainStart = Date.now();
    while (group && groupAlive(group)) {
      if (!remainingChildren) {
        log("Waiting for remaining gate children before releasing the lock.");
        remainingChildren = true;
      }
      if (Date.now() - drainStart >= shutdownMs) signalGroup("SIGKILL");
      await delay(pollMs);
    }
    group = undefined;
    const after = await fingerprintInputs(cwd);
    await Promise.all(pendingEvents);
    if (changed || before.digest !== after.digest || watcherError) {
      log(
        "STALE evidence: check inputs changed or input monitoring failed; rerun the settled candidate.",
      );
      if (watcherError) log(`Input monitor failed: ${watcherError.message}`);
      return state.signal ? cancellationCode() : result.code || 1;
    }
    if (state.signal) return cancellationCode();
    if (result.code) return result.code;
    if (remainingChildren) {
      log("Gate command left running children; this run is not accepted.");
      return 1;
    }
    log(`PASS: all gates completed for input SHA-256 ${after.digest}.`);
    return 0;
  } catch (error) {
    log(error.message);
    return state.signal ? cancellationCode() : 1;
  } finally {
    watcher?.close();
    if (killTimer) clearTimeout(killTimer);
    // Unexpected errors retain an abandoned lock if children may still run.
    if (release && !group) await release();
    else if (release)
      log(
        `Lock retained at ${lockDirectory}: gate children may still be alive.`,
      );
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

export async function checkLockStatus(directory = defaultLockDirectory()) {
  const lockPath = join(directory, "owner.json");
  try {
    const info = await lstat(lockPath);
    if (!info.isFile() || info.uid !== process.getuid())
      throw new Error("Unknown lock ownership/type");
    const owner = JSON.parse(await readFile(lockPath, "utf8"));
    if (
      owner.version !== 1 ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      owner.host !== hostname() ||
      typeof owner.processStart !== "string"
    )
      throw new Error("Unknown lock metadata");
    const live =
      processExists(owner.pid) &&
      processStart(owner.pid) === owner.processStart;
    return { lockPath, state: live ? "active" : "stale", pid: owner.pid };
  } catch (error) {
    if (error.code === "ENOENT") return { lockPath, state: "unlocked" };
    return { lockPath, state: "unknown", error: error.message };
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length === 3 && process.argv[2] === "--status") {
    const status = await checkLockStatus();
    console.error(`[check] ${JSON.stringify(status)}`);
    process.exitCode = ["stale", "unknown"].includes(status.state) ? 1 : 0;
  } else if (process.argv.length !== 2) {
    console.error(
      "Usage: node scripts/run-check.mjs [--status] (no bypass options)",
    );
    process.exitCode = 1;
  } else {
    process.exitCode = await runCheck();
  }
}
