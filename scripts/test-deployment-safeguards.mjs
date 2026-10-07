#!/usr/bin/env node

// Disposable test harness for deployment safeguards (INFRA-DUAL-004 / Q9).
// Exercises:
// 1. Argument validation and candidate commit resolution
// 2. Head A vs candidate B isolation (no branch rewind)
// 3. Concurrency locking and serialization (lock conflict rejection)
// 4. Working directory and cross-environment service guards
// 5. Unconditional migration ledger reconciliation (no diff bypass)
// 6. Health check failure rollback execution (regression for exit 1 bypass)
// 7. Protected release journal logging

import { spawnSync, spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  chmodSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exit } from "node:process";
import {
  DEPLOYMENT_MANIFEST,
  buildRemoteHostRoleCommand,
  buildRemotePromotionCommand,
  parseDeploymentArgs,
  resolvePromotionCandidate,
  validateCommitSha,
} from "./deployment-manifest.mjs";

let passedCount = 0;
let failedCount = 0;

const test = async (name, fn) => {
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log(`✓ ${name}`);
    passedCount++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`✗ ${name}:`, err.message);
    failedCount++;
  }
};

const assert = (condition, msg) => {
  if (!condition) throw new Error(msg || "Assertion failed");
};

// --- Test Suite ---

// 1. Argument parsing tests
await test("parseDeploymentArgs: parses valid options and positional SHA", () => {
  const parsed = parseDeploymentArgs([
    "--dry-run",
    "1111111111222222222233333333334444444444",
  ]);
  assert(parsed.dryRun === true, "dryRun should be true");
  assert(
    parsed.positionalSha === "1111111111222222222233333333334444444444",
    "positionalSha parsed correctly",
  );
});

await test("parseDeploymentArgs: rejects unknown flags", () => {
  let threw = false;
  try {
    parseDeploymentArgs(["--invalid-flag"]);
  } catch (err) {
    threw = true;
    assert(err.message.includes("Unrecognized"), "expected unrecognized error");
  }
  assert(threw, "should throw on unknown flags");
});

await test("parseDeploymentArgs: rejects multiple positional args", () => {
  let threw = false;
  try {
    parseDeploymentArgs(["sha1", "sha2"]);
  } catch (err) {
    threw = true;
  }
  assert(threw, "should throw on multiple positional args");
});

// 2. Candidate resolution tests
await test("resolvePromotionCandidate: Production rejects missing or HEAD SHA", () => {
  let threwMissing = false;
  try {
    resolvePromotionCandidate({
      environment: "production",
      positionalSha: null,
    });
  } catch (err) {
    threwMissing = true;
    assert(
      err.message.includes("explicit 40-character"),
      "expected explicit SHA message",
    );
  }
  assert(threwMissing, "should reject missing SHA for production");

  let threwHead = false;
  try {
    resolvePromotionCandidate({
      environment: "production",
      positionalSha: "HEAD",
    });
  } catch (err) {
    threwHead = true;
    assert(
      err.message.includes("explicit 40-character"),
      "expected explicit SHA message",
    );
  }
  assert(threwHead, "should reject HEAD for production");
});

await test("resolvePromotionCandidate: rejects malformed SHA", () => {
  let threw = false;
  try {
    resolvePromotionCandidate({
      environment: "production",
      positionalSha: "not-a-sha",
    });
  } catch (err) {
    threw = true;
  }
  assert(threw, "should reject malformed SHA");
});

await test("resolvePromotionCandidate: Dev allows HEAD", () => {
  const fakeRunner = {
    output: (args) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return "1111111111222222222233333333334444444444";
      }
      return "";
    },
    run: () => ({ status: 0 }),
  };

  const resolved = resolvePromotionCandidate({
    environment: "dev",
    positionalSha: "HEAD",
    gitRunner: fakeRunner,
  });
  assert(
    resolved === "1111111111222222222233333333334444444444",
    "Dev should resolve HEAD",
  );
});

await test("resolvePromotionCandidate: Production rejects candidate not in origin/main", () => {
  const targetSha = "2222222222333333333344444444445555555555";
  const fakeRunner = {
    output: (args) => targetSha,
    run: (args) => {
      if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
        return { status: 1 }; // Not ancestor
      }
      return { status: 0 };
    },
  };

  let threw = false;
  try {
    resolvePromotionCandidate({
      environment: "production",
      positionalSha: targetSha,
      gitRunner: fakeRunner,
    });
  } catch (err) {
    threw = true;
    assert(
      err.message.includes("not reachable from origin/main"),
      "expected origin/main ancestor error",
    );
  }
  assert(threw, "should reject non-main candidate");
});

await test("resolvePromotionCandidate: Production accepts older ancestor candidate without rewinding", () => {
  const candidateSha = "3333333333444444444455555555556666666666";
  const fakeRunner = {
    output: () => candidateSha,
    run: (args) => {
      if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
        return { status: 0 }; // Is ancestor
      }
      return { status: 0 };
    },
  };

  const resolved = resolvePromotionCandidate({
    environment: "production",
    positionalSha: candidateSha,
    gitRunner: fakeRunner,
  });
  assert(resolved === candidateSha, "candidate resolved correctly");
});

// 3. Harness environment for promotion script tests
import { realpathSync } from "node:fs";
const tempBase = realpathSync(
  mkdtempSync(path.join(tmpdir(), "mizyun-harness-")),
);
const hostRoleFile = path.join(tempBase, "host-role");
const expectedHostRole = DEPLOYMENT_MANIFEST.production.expectedHostRole;
writeFileSync(hostRoleFile, `${expectedHostRole}\n`);

// Create mock bin directory
const mockBinDir = path.join(tempBase, "bin");
mkdirSync(mockBinDir, { recursive: true });

// Mock systemctl
const mockSystemctl = path.join(mockBinDir, "systemctl");
writeFileSync(
  mockSystemctl,
  `#!/bin/sh
echo "mock systemctl called with: $@" >> "${path.join(tempBase, "systemctl.log")}"
if [ "$1" = "start" ] && [ "$2" = "mizyun-backup-for-deploy.service" ]; then
  echo "backup-resume $(git rev-parse HEAD)" >> "${path.join(tempBase, "promotion-events.log")}"
  if [ "$MIZYUN_FIXTURE_BACKUP_FAIL" = "true" ]; then exit 1; fi
fi
if [ "$1" = "stop" ] && [ "$2" = "mizyun-api.service" ]; then
  echo "api-stop $(git rev-parse HEAD)" >> "${path.join(tempBase, "promotion-events.log")}"
fi
if [ "$1" = "start" ] && [ "$2" = "cloudflared.service" ]; then
  echo "tunnel-start $(git rev-parse HEAD)" >> "${path.join(tempBase, "promotion-events.log")}"
fi
exit 0
`,
);
chmodSync(mockSystemctl, 0o755);

// Mock sudo
const mockSudo = path.join(mockBinDir, "sudo");
writeFileSync(
  mockSudo,
  `#!/bin/sh
shift
"$@"
`,
);
chmodSync(mockSudo, 0o755);

// Mock pnpm
const mockPnpm = path.join(mockBinDir, "pnpm");
writeFileSync(
  mockPnpm,
  `#!/bin/sh
if [ "$1" = "exec" ] && [ "$2" = "supabase" ] && [ "$3" = "db" ] && [ "$4" = "push" ]; then
  echo "mock supabase db push called: $@" >> "${path.join(tempBase, "supabase.log")}"
  echo "migration $(git rev-parse HEAD) $*" >> "${path.join(tempBase, "promotion-events.log")}"
  if [ "$MIZYUN_FIXTURE_PARTIAL_MIGRATION" = "true" ]; then
    case " $* " in *" --dry-run "*) ;; *) echo "one migration committed" >&2; exit 1;; esac
  fi
  exit 0
fi
if [ "$1" = "install" ]; then
  echo "mock pnpm install called: CI=$CI $@" >> "${path.join(tempBase, "pnpm.log")}"
  exit 0
fi
exit 0
`,
);
chmodSync(mockPnpm, 0o755);

// Mock curl
const mockCurl = path.join(mockBinDir, "curl");
writeFileSync(
  mockCurl,
  `#!/bin/sh
if [ -f "${path.join(tempBase, "mock_curl_fail")}" ]; then
  exit 1
fi
if [ -f "${path.join(tempBase, "mock_curl_fail_count")}" ]; then
  count=$(cat "${path.join(tempBase, "mock_curl_fail_count")}")
  if [ "$count" -gt 0 ]; then
    echo $((count - 1)) > "${path.join(tempBase, "mock_curl_fail_count")}"
    exit 1
  fi
fi
exit 0
`,
);
chmodSync(mockCurl, 0o755);

// Mock backup-production.sh
const mockBackupScript = path.join(tempBase, "backup-production.sh");
writeFileSync(
  mockBackupScript,
  `#!/bin/sh
echo "mock backup called" >> "${path.join(tempBase, "backup.log")}"
exit 0
`,
);
chmodSync(mockBackupScript, 0o755);

// Create disposable git repository for dev checkout
const devRepoDir = path.join(tempBase, "dev-repo");
mkdirSync(devRepoDir, { recursive: true });
const actualGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const fixtureGit = path.join(mockBinDir, "git");
writeFileSync(
  fixtureGit,
  `#!/bin/sh
if [ "$1" = "remote" ] && [ "$2" = "get-url" ] && [ "$3" = "origin" ]; then
  origin=$("${actualGit}" "$@") || exit $?
  case "$origin" in
    "${devRepoDir}"|"${path.join(tempBase, "does-not-exist")}") echo 'https://example.invalid/mizyun-fixture.git';;
    *) printf '%s\\n' "$origin";;
  esac
else
  exec "${actualGit}" "$@"
fi
`,
);
chmodSync(fixtureGit, 0o755);

const git = (args, cwd = devRepoDir) => {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
};

git(["init"], devRepoDir);
git(["config", "user.name", "Test Harness"], devRepoDir);
git(["config", "user.email", "test@example.com"], devRepoDir);

writeFileSync(path.join(devRepoDir, "README.md"), "# Dev Repo\n");
git(["add", "README.md"], devRepoDir);
git(["commit", "-m", "Initial commit"], devRepoDir);
const commit1 = git(["rev-parse", "HEAD"], devRepoDir);

writeFileSync(path.join(devRepoDir, "file2.txt"), "Commit 2\n");
git(["add", "file2.txt"], devRepoDir);
git(["commit", "-m", "Second commit"], devRepoDir);
const commit2 = git(["rev-parse", "HEAD"], devRepoDir);

// Create dev env file
const devEnvFile = path.join(tempBase, "dev.env");
writeFileSync(
  devEnvFile,
  `MIZYUN_DEV_DB_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
MIZYUN_DEV_DB_SSLMODE="disable"
MIZYUN_API_SERVICE="mizyun-api-dev.service"
MIZYUN_LOCAL_API_URL="http://127.0.0.1:4100"
`,
);

const devGlobalGitConfig = path.join(tempBase, ".gitconfig-dev");
writeFileSync(devGlobalGitConfig, "");

const devLockFile = path.join(tempBase, "dev.lock");

const runPromoteDev = ({
  cwd = devRepoDir,
  targetSha = commit2,
  envFile = devEnvFile,
  lockFile = devLockFile,
  extraEnv = {},
}) => {
  const promoteScript = path.resolve("scripts/promote-dev.sh");
  return spawnSync("bash", [promoteScript, targetSha], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: tempBase,
      GIT_CONFIG_GLOBAL: devGlobalGitConfig,
      PATH: `${mockBinDir}:${process.env.PATH}`,
      MIZYUN_DEV_ENV_FILE: envFile,
      MIZYUN_DEV_LOCK_FILE: lockFile,
      MIZYUN_DEV_REMOTE_DIR: devRepoDir,
      MIZYUN_DEPLOY_HOST_ROLE_FILE: hostRoleFile,
      MIZYUN_EXPECTED_DEPLOY_HOST_ROLE: expectedHostRole,
      ...extraEnv,
    },
  });
};

await test("promote-dev.sh: Rejects a host without the unique Hetzner marker", () => {
  const wrongMarker = path.join(tempBase, "wrong-dev-host-role");
  writeFileSync(wrongMarker, "raspberry-pi-legacy\n");
  const res = runPromoteDev({
    extraEnv: { MIZYUN_DEPLOY_HOST_ROLE_FILE: wrongMarker },
  });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(res.stderr.includes("deployment authority"), "expected host guard");
});

await test("promote-dev.sh: Working directory mismatch fails with exit code 2", () => {
  const res = runPromoteDev({ cwd: tempBase });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes("does not match expected dev repository"),
    "expected dir mismatch error",
  );
});

await test("promote-dev.sh: Reject execution against production service", () => {
  const badEnvFile = path.join(tempBase, "bad-service-dev.env");
  writeFileSync(
    badEnvFile,
    `MIZYUN_DEV_DB_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
MIZYUN_API_SERVICE="mizyun-api"
MIZYUN_LOCAL_API_URL="http://127.0.0.1:4100"
`,
  );
  const res = runPromoteDev({ envFile: badEnvFile });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes(
      "Refusing to run dev promotion against production service",
    ),
    "expected service guard error",
  );
});

await test("promote-dev.sh: Reject execution against production service with .service alias", () => {
  const badEnvFile = path.join(tempBase, "bad-service-alias-dev.env");
  writeFileSync(
    badEnvFile,
    `MIZYUN_DEV_DB_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
MIZYUN_API_SERVICE="mizyun-api.service"
MIZYUN_LOCAL_API_URL="http://127.0.0.1:4100"
`,
  );
  const res = runPromoteDev({ envFile: badEnvFile });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes(
      "Refusing to run dev promotion against production service",
    ),
    "expected service guard error",
  );
});

await test("promote-dev.sh: Reject execution when MIZYUN_DEV_DB_URL points to production DB port 5432", () => {
  const badEnvFile = path.join(tempBase, "bad-port-dev.env");
  writeFileSync(
    badEnvFile,
    `MIZYUN_DEV_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres"
MIZYUN_API_SERVICE="mizyun-api-dev"
MIZYUN_LOCAL_API_URL="http://127.0.0.1:4100"
`,
  );
  const res = runPromoteDev({ envFile: badEnvFile });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes("points to production database port 5432"),
    "expected port guard error",
  );
});

await test("promote-dev.sh: Reject execution when Dev DB port is omitted", () => {
  const badEnvFile = path.join(tempBase, "missing-port-dev.env");
  writeFileSync(
    badEnvFile,
    `MIZYUN_DEV_DB_URL="postgresql://postgres:postgres@127.0.0.1/postgres"\nMIZYUN_API_SERVICE="mizyun-api-dev"\nMIZYUN_LOCAL_API_URL="http://127.0.0.1:4100"\n`,
  );
  const res = runPromoteDev({ envFile: badEnvFile });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes("canonical localhost:5433"),
    "expected canonical Dev DB guard",
  );
});

await test("promote-dev.sh: Concurrency lock blocks simultaneous promotion with exit code 75", async () => {
  // Hold lock via python in background
  const locker = spawn(
    "python3",
    [
      "-c",
      `import sys, fcntl, time
f = open("${devLockFile}", "w")
fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
sys.stdout.write("locked\\n")
sys.stdout.flush()
time.sleep(5)
`,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );

  await new Promise((resolve) => {
    locker.stdout.once("data", () => resolve());
  });

  try {
    const res = runPromoteDev({});
    assert(
      res.status === 75,
      `expected exit 75 for locked file, got ${res.status}`,
    );
    assert(
      res.stderr.includes("is held by another process"),
      "expected lock contention message",
    );
  } finally {
    locker.kill("SIGKILL");
  }
});

await test("promote-dev.sh: Unconditionally reconciles migration ledger and logs journal", () => {
  const supabaseLog = path.join(tempBase, "supabase.log");
  if (existsSync(supabaseLog)) rmSync(supabaseLog);

  // Set origin to local repo so fetch works
  git(["remote", "add", "origin", devRepoDir], devRepoDir);

  const res = runPromoteDev({ targetSha: commit1 });
  assert(
    res.status === 0,
    `promotion should succeed, got ${res.status}: ${res.stderr}`,
  );

  // Check that supabase db push was invoked
  const supabaseContent = existsSync(supabaseLog)
    ? readFileSync(supabaseLog, "utf8")
    : "";
  assert(
    supabaseContent.includes("mock supabase db push called") &&
      supabaseContent.includes("--yes"),
    "supabase db push should be called with --yes in dev",
  );

  // Check release journal
  const journalPath = path.join(
    devRepoDir,
    ".git/mizyun-dev-release-journal.jsonl",
  );
  assert(existsSync(journalPath), "journal file should exist");
  const journalLines = readFileSync(journalPath, "utf8").trim().split("\n");
  const lastEntry = JSON.parse(journalLines[journalLines.length - 1]);
  assert(
    lastEntry.status === "success",
    "journal entry status should be success",
  );
  assert(lastEntry.targetSha === commit1, "journal targetSha should match");
  assert(
    lastEntry.service === "mizyun-api-dev.service",
    "journal service should match",
  );
});

await test("promote-dev.sh: Health-check failure triggers rollback (regression for exit 1 bypass)", () => {
  // Flag mock curl to fail
  const curlFailFlag = path.join(tempBase, "mock_curl_fail");
  writeFileSync(curlFailFlag, "fail");

  const journalPath = path.join(
    devRepoDir,
    ".git/mizyun-dev-release-journal.jsonl",
  );
  const linesBefore = existsSync(journalPath)
    ? readFileSync(journalPath, "utf8").trim().split("\n").length
    : 0;

  const res = runPromoteDev({
    targetSha: commit2,
    extraEnv: { MIZYUN_HEALTH_RETRIES: "2", MIZYUN_HEALTH_SLEEP: "0" },
  });
  rmSync(curlFailFlag); // cleanup flag

  assert(
    res.status === 1,
    `expected exit 1 on health failure, got ${res.status}`,
  );
  assert(
    res.stderr.includes("Dev API did not become healthy"),
    "expected timeout message",
  );
  assert(
    res.stderr.includes("restoring API code"),
    "rollback_code MUST be invoked on timeout",
  );

  // Verify journal logged rollback_failed because curl failed during rollback too
  assert(existsSync(journalPath), "journal file should exist");
  const linesAfter = readFileSync(journalPath, "utf8").trim().split("\n");
  assert(
    linesAfter.length > linesBefore,
    "new journal entry should be appended",
  );
  const lastEntry = JSON.parse(linesAfter[linesAfter.length - 1]);
  assert(
    lastEntry.status === "rollback_failed",
    `journal status should be rollback_failed, got ${lastEntry.status}`,
  );
});

await test("promote-dev.sh: Rollback logs 'rolled_back' when rollback health check succeeds", () => {
  // Fail only 2 attempts (the deployment health check), then succeed on rollback
  const curlFailCount = path.join(tempBase, "mock_curl_fail_count");
  writeFileSync(curlFailCount, "2");

  const journalPath = path.join(
    devRepoDir,
    ".git/mizyun-dev-release-journal.jsonl",
  );
  const linesBefore = existsSync(journalPath)
    ? readFileSync(journalPath, "utf8").trim().split("\n").length
    : 0;

  const res = runPromoteDev({
    targetSha: commit2,
    extraEnv: { MIZYUN_HEALTH_RETRIES: "2", MIZYUN_HEALTH_SLEEP: "0" },
  });
  if (existsSync(curlFailCount)) rmSync(curlFailCount);

  assert(
    res.status === 1,
    `expected exit 1 on health failure, got ${res.status}`,
  );
  assert(res.stderr.includes("Rollback to"), "rollback must succeed");

  assert(existsSync(journalPath), "journal file should exist");
  const linesAfter = readFileSync(journalPath, "utf8").trim().split("\n");
  assert(
    linesAfter.length > linesBefore,
    "new journal entry should be appended",
  );
  const lastEntry = JSON.parse(linesAfter[linesAfter.length - 1]);
  assert(
    lastEntry.status === "rolled_back",
    `journal status should be rolled_back, got ${lastEntry.status}`,
  );
});

await test("promote-dev.sh: Rejects git safe.directory wildcard '*'", () => {
  const badGitConfig = path.join(tempBase, ".gitconfig-wildcard");
  writeFileSync(badGitConfig, "[safe]\n\tdirectory = *\n");
  const res = runPromoteDev({
    extraEnv: { GIT_CONFIG_GLOBAL: badGitConfig },
  });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes("contains unsafe wildcard '*'"),
    `expected wildcard error, got: ${res.stderr}`,
  );
});

await test("promote-dev.sh: Enforces non-interactive CI=true for pnpm install", () => {
  const pnpmLog = path.join(tempBase, "pnpm.log");
  if (existsSync(pnpmLog)) rmSync(pnpmLog);

  const res = runPromoteDev({ targetSha: commit1 });
  assert(res.status === 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
  assert(existsSync(pnpmLog), "pnpm log should exist");
  const logContent = readFileSync(pnpmLog, "utf8");
  assert(
    logContent.includes("mock pnpm install called: CI=true"),
    `expected CI=true in pnpm install invocation, got: ${logContent}`,
  );
});

await test("promote-dev.sh: Normalizes bare service name to .service matching narrow sudoers rule", () => {
  const systemctlLog = path.join(tempBase, "systemctl.log");
  if (existsSync(systemctlLog)) rmSync(systemctlLog);

  const bareServiceEnv = path.join(tempBase, "bare-service-dev.env");
  writeFileSync(
    bareServiceEnv,
    `MIZYUN_DEV_DB_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
MIZYUN_DEV_DB_SSLMODE="disable"
MIZYUN_API_SERVICE="mizyun-api-dev"
MIZYUN_LOCAL_API_URL="http://127.0.0.1:4100"
`,
  );

  const res = runPromoteDev({ envFile: bareServiceEnv, targetSha: commit1 });
  assert(res.status === 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
  assert(existsSync(systemctlLog), "systemctl log should exist");
  const logContent = readFileSync(systemctlLog, "utf8");
  assert(
    logContent.includes("restart mizyun-api-dev.service"),
    `systemctl restart must use qualified .service unit, got: ${logContent}`,
  );
});

await test("promote-dev.sh: Rejects ephemeral .bundle or root origin URLs", () => {
  git(
    ["remote", "set-url", "origin", "/var/lib/mizyun/dev/origin.bundle"],
    devRepoDir,
  );
  try {
    const res = runPromoteDev({ targetSha: commit1 });
    assert(res.status === 2, `expected exit 2, got ${res.status}`);
    assert(
      res.stderr.includes("points to a temporary or root bundle"),
      `expected bundle rejection error, got: ${res.stderr}`,
    );
  } finally {
    git(["remote", "set-url", "origin", devRepoDir], devRepoDir);
  }
});

await test("promote-dev.sh: Fails closed with descriptive error when git fetch fails", () => {
  const nonExistentRepo = path.join(tempBase, "does-not-exist");
  git(["remote", "set-url", "origin", nonExistentRepo], devRepoDir);
  try {
    const res = runPromoteDev({ targetSha: commit1 });
    assert(res.status !== 0, `expected non-zero exit, got ${res.status}`);
    assert(
      res.stderr.includes("Failed to fetch from origin"),
      `expected fetch failure message, got: ${res.stderr}`,
    );
  } finally {
    git(["remote", "set-url", "origin", devRepoDir], devRepoDir);
  }
});

// --- Production Promotion Safeguard Tests ---

const prodRepoDir = path.join(tempBase, "prod-repo");
mkdirSync(prodRepoDir, { recursive: true });

git(["init"], prodRepoDir);
git(["config", "user.name", "Test Harness"], prodRepoDir);
git(["config", "user.email", "test@example.com"], prodRepoDir);

writeFileSync(path.join(prodRepoDir, "README.md"), "# Prod Repo\n");
git(["add", "README.md"], prodRepoDir);
git(["commit", "-m", "Prod commit 1"], prodRepoDir);
const prodCommit1 = git(["rev-parse", "HEAD"], prodRepoDir);

// Add remote origin pointing to itself so fetch origin main works
git(["remote", "add", "origin", prodRepoDir], prodRepoDir);
git(["branch", "-M", "main"], prodRepoDir);

const prodEnvFile = path.join(tempBase, "production.env");
writeFileSync(
  prodEnvFile,
  `NODE_ENV="production"
MIZYUN_PRODUCTION_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres"
MIZYUN_PRODUCTION_DB_DIRECT_CONTAINER="false"
MIZYUN_API_SERVICE="mizyun-api"
MIZYUN_LOCAL_API_URL="http://127.0.0.1:4000"
`,
);

const prodLockFile = path.join(tempBase, "production.lock");

// Put backup-production.sh in scripts/ of prodRepoDir so promote-production can find it
mkdirSync(path.join(prodRepoDir, "scripts"), { recursive: true });
writeFileSync(
  path.join(prodRepoDir, "scripts/backup-production.sh"),
  `#!/bin/sh
echo "backup mock executed"
exit 0
`,
);
chmodSync(path.join(prodRepoDir, "scripts/backup-production.sh"), 0o755);
git(["add", "scripts/backup-production.sh"], prodRepoDir);
git(["commit", "-m", "Add production backup fixture"], prodRepoDir);
const prodCommit2 = git(["rev-parse", "HEAD"], prodRepoDir);

const runPromoteProd = ({
  cwd = prodRepoDir,
  targetSha = prodCommit2,
  envFile = prodEnvFile,
  lockFile = prodLockFile,
  extraEnv = {},
}) => {
  const promoteScript = path.resolve("scripts/promote-production.sh");
  return spawnSync("bash", [promoteScript, targetSha], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: tempBase,
      GIT_CONFIG_GLOBAL: "/dev/null",
      PATH: `${mockBinDir}:${process.env.PATH}`,
      MIZYUN_PRODUCTION_ENV_FILE: envFile,
      MIZYUN_PRODUCTION_LOCK_FILE: lockFile,
      MIZYUN_REMOTE_DIR: prodRepoDir,
      MIZYUN_DEPLOY_HOST_ROLE_FILE: hostRoleFile,
      MIZYUN_EXPECTED_DEPLOY_HOST_ROLE: expectedHostRole,
      ...extraEnv,
    },
  });
};

await test("promote-production.sh: Rejects a host without the unique Hetzner marker", () => {
  const missingMarker = path.join(tempBase, "missing-prod-host-role");
  const res = runPromoteProd({
    extraEnv: { MIZYUN_DEPLOY_HOST_ROLE_FILE: missingMarker },
  });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(res.stderr.includes("deployment authority"), "expected host guard");
});

await test("promote-production.sh: Reject execution against dev service", () => {
  const badEnv = path.join(tempBase, "bad-service-prod.env");
  writeFileSync(
    badEnv,
    `NODE_ENV="production"
MIZYUN_PRODUCTION_DB_URL="postgresql://..."
MIZYUN_API_SERVICE="mizyun-api-dev"
`,
  );
  const res = runPromoteProd({ envFile: badEnv });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes(
      "Refusing to run production promotion against dev service",
    ),
    "expected service guard error",
  );
});

await test("promote-production.sh: Reject execution against dev service with .service alias", () => {
  const badEnv = path.join(tempBase, "bad-service-alias-prod.env");
  writeFileSync(
    badEnv,
    `NODE_ENV="production"
MIZYUN_PRODUCTION_DB_URL="postgresql://..."
MIZYUN_API_SERVICE="mizyun-api-dev.service"
`,
  );
  const res = runPromoteProd({ envFile: badEnv });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes(
      "Refusing to run production promotion against dev service",
    ),
    "expected service guard error",
  );
});

await test("promote-production.sh: Reject execution when MIZYUN_PRODUCTION_DB_URL points to dev DB port 5433", () => {
  const badEnv = path.join(tempBase, "bad-port-prod.env");
  writeFileSync(
    badEnv,
    `NODE_ENV="production"
MIZYUN_PRODUCTION_DB_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
MIZYUN_API_SERVICE="mizyun-api"
`,
  );
  const res = runPromoteProd({ envFile: badEnv });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes("points to dev database port 5433"),
    "expected port guard error",
  );
});

await test("promote-production.sh: Reject execution when cwd is dev checkout", () => {
  const fakeDevDir = path.join(tempBase, "mizyun-dev/repo");
  mkdirSync(fakeDevDir, { recursive: true });
  const res = runPromoteProd({ cwd: fakeDevDir });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes("is a dev checkout"),
    `expected dev directory rejection, got: "${res.stderr}"`,
  );
});

await test("promote-production.sh: Reject execution when NODE_ENV is not production", () => {
  const nonProdEnv = path.join(tempBase, "non-prod.env");
  writeFileSync(
    nonProdEnv,
    `NODE_ENV="development"
MIZYUN_PRODUCTION_DB_URL="postgresql://..."
MIZYUN_API_SERVICE="mizyun-api"
`,
  );
  const res = runPromoteProd({ envFile: nonProdEnv });
  assert(res.status === 2, `expected exit 2, got ${res.status}`);
  assert(
    res.stderr.includes("NODE_ENV is not production"),
    "expected NODE_ENV rejection",
  );
});

await test("promote-production.sh: Applies migrations non-interactively before restarting API", () => {
  const supabaseLog = path.join(tempBase, "supabase.log");
  const systemctlLog = path.join(tempBase, "systemctl.log");
  if (existsSync(supabaseLog)) rmSync(supabaseLog);
  if (existsSync(systemctlLog)) rmSync(systemctlLog);

  const res = runPromoteProd({});
  assert(
    res.status === 0,
    `production promotion should succeed, got ${res.status}: ${res.stderr}`,
  );

  const supabaseContent = readFileSync(supabaseLog, "utf8");
  const supabaseCalls = supabaseContent.trim().split("\n");
  assert(
    supabaseCalls.length === 2 &&
      supabaseCalls.every(
        (call) => call.includes("db push --db-url") && call.includes("--yes"),
      ) &&
      supabaseCalls.some((call) => call.includes("--dry-run")) &&
      supabaseCalls.some((call) => !call.includes("--dry-run")),
    "production migration dry-run and apply must both pass --yes so neither can consume the streamed shell script",
  );
  const systemctlContent = readFileSync(systemctlLog, "utf8");
  assert(
    systemctlContent.includes("restart mizyun-api"),
    "production API must restart after migrations",
  );
});

await test("promote-production.sh: Concurrency lock blocks simultaneous production promotion with code 75", async () => {
  const locker = spawn(
    "python3",
    [
      "-c",
      `import sys, fcntl, time
f = open("${prodLockFile}", "w")
fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
sys.stdout.write("locked\\n")
sys.stdout.flush()
time.sleep(5)
`,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );

  await new Promise((resolve) => {
    locker.stdout.once("data", () => resolve());
  });

  try {
    const res = runPromoteProd({});
    assert(res.status === 75, `expected exit 75, got ${res.status}`);
    assert(
      res.stderr.includes("is held by another process"),
      "expected lock contention error",
    );
  } finally {
    locker.kill("SIGKILL");
  }
});

await test("promote-production.sh: invalid database container fails before backup or API stop", () => {
  const events = path.join(tempBase, "promotion-events.log");
  if (existsSync(events)) rmSync(events);
  git(["checkout", "--detach", prodCommit1], prodRepoDir);
  const invalidEnv = path.join(tempBase, "invalid-container.env");
  writeFileSync(
    invalidEnv,
    readFileSync(prodEnvFile, "utf8").replace(
      'MIZYUN_PRODUCTION_DB_DIRECT_CONTAINER="false"',
      'MIZYUN_PRODUCTION_DB_DIRECT_CONTAINER="true"',
    ),
  );
  const res = runPromoteProd({
    envFile: invalidEnv,
    extraEnv: { MIZYUN_DB_CONTAINER: "wrong-db" },
  });
  assert(res.status === 2, "invalid container must fail preflight");
  assert(
    !existsSync(events),
    "invalid database target must not reach backup or API stop",
  );
  assert(
    git(["rev-parse", "HEAD"], prodRepoDir) === prodCommit1,
    "invalid target must retain prior code",
  );
});

await test("promote-production.sh: backup recovery restarts only previous code before migration", () => {
  const events = path.join(tempBase, "promotion-events.log");
  if (existsSync(events)) rmSync(events);
  git(["checkout", "--detach", prodCommit1], prodRepoDir);
  const res = runPromoteProd({});
  assert(res.status === 0, `promotion failed: ${res.stderr}`);
  const lines = readFileSync(events, "utf8").trim().split("\n");
  assert(
    lines[0] === `backup-resume ${prodCommit1}`,
    `backup exposed candidate code: ${lines[0]}`,
  );
  assert(
    lines[1] === `api-stop ${prodCommit1}`,
    "API must stop before candidate checkout",
  );
  assert(
    lines
      .slice(2, -1)
      .every((line) => line.startsWith(`migration ${prodCommit2} `)),
    "migrations must use the candidate after backup",
  );
  assert(
    lines.at(-1) === `tunnel-start ${prodCommit2}`,
    "public tunnel must resume on candidate",
  );
});

await test("promote-production.sh: backup failure never reaches candidate migrations", () => {
  const events = path.join(tempBase, "promotion-events.log");
  if (existsSync(events)) rmSync(events);
  git(["checkout", "--detach", prodCommit1], prodRepoDir);
  const res = runPromoteProd({
    extraEnv: { MIZYUN_FIXTURE_BACKUP_FAIL: "true" },
  });
  assert(res.status !== 0, "failed backup must stop promotion");
  assert(
    git(["rev-parse", "HEAD"], prodRepoDir) === prodCommit1,
    "backup failure must retain previous code",
  );
  assert(
    readFileSync(events, "utf8").trim() ===
      `backup-resume ${prodCommit1}\ntunnel-start ${prodCommit1}`,
    "backup must run before checkout and no migration may run",
  );
});

await test("promote-production.sh: a partially failed migration is journaled conservatively", () => {
  git(["checkout", "--detach", prodCommit1], prodRepoDir);
  const res = runPromoteProd({
    extraEnv: { MIZYUN_FIXTURE_PARTIAL_MIGRATION: "true" },
  });
  assert(res.status !== 0, "partial migration must fail promotion");
  const journal = readFileSync(
    path.join(prodRepoDir, ".git/mizyun-production-release-journal.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert(
    journal.at(-1).migrationState === "attempted",
    "partial migration cannot be reported as unstarted or complete",
  );
  assert(
    journal.at(-1).migrationsApplied === true,
    "partial application must be treated as possible",
  );
  assert(
    res.stderr.includes("may have committed"),
    "forward-only partial-migration warning required",
  );
  assert(
    readFileSync(path.join(tempBase, "promotion-events.log"), "utf8")
      .trim()
      .split("\n")
      .at(-1) === `tunnel-start ${prodCommit1}`,
    "rollback must restore previous public tunnel",
  );
});

// --- Remote Promotion Command & Stdin Isolation Tests (Issue #101) ---

await test("buildRemotePromotionCommand: rejects non-absolute or invalid remoteDir", () => {
  let threw = false;
  try {
    buildRemotePromotionCommand({
      remoteDir: "relative/path",
      targetSha: "1111111111222222222233333333334444444444",
    });
  } catch (err) {
    threw = true;
    assert(
      err.message.includes("safe absolute Linux path"),
      "expected safe absolute path error",
    );
  }
  assert(threw, "should reject relative path");

  threw = false;
  try {
    buildRemotePromotionCommand({
      remoteDir: "/bad;path/with$special",
      targetSha: "1111111111222222222233333333334444444444",
    });
  } catch (err) {
    threw = true;
    assert(
      err.message.includes("safe absolute Linux path"),
      "expected safe absolute path error",
    );
  }
  assert(threw, "should reject path with unsafe characters");
});

await test("buildRemotePromotionCommand: rejects invalid targetSha", () => {
  let threw = false;
  try {
    buildRemotePromotionCommand({
      remoteDir: "/home/mizyun/mizyun",
      targetSha: "not-a-valid-sha",
    });
  } catch (err) {
    threw = true;
    assert(err.message.includes("Invalid targetSha"), "expected sha error");
  }
  assert(threw, "should reject invalid targetSha");
});

await test("buildRemoteHostRoleCommand: validates and checks the exact marker", () => {
  const command = buildRemoteHostRoleCommand({
    hostRoleFile: "/etc/mizyun/host-role",
    expectedHostRole,
  });
  assert(command.includes('test -r "/etc/mizyun/host-role"'));
  assert(command.includes(expectedHostRole));

  let threw = false;
  try {
    buildRemoteHostRoleCommand({
      hostRoleFile: "/etc/mizyun/host-role;true",
      expectedHostRole,
    });
  } catch {
    threw = true;
  }
  assert(threw, "unsafe host-role path must be rejected");
});

await test("buildRemotePromotionCommand: generates secure materialized runner with stdin from /dev/null", () => {
  const targetSha = "1111111111222222222233333333334444444444";
  const cmd = buildRemotePromotionCommand({
    remoteDir: "/home/mizyun/mizyun",
    targetSha,
    environment: "production",
  });
  assert(cmd.includes("set -eu"), "must set -eu");
  assert(
    cmd.includes(
      'remote_script="$(mktemp /tmp/mizyun-promote-production-XXXXXX.sh)"',
    ),
    "must create production temp script",
  );
  assert(
    cmd.includes("trap 'rm -f \"$remote_script\"' EXIT INT TERM"),
    "must register cleanup trap",
  );
  assert(
    cmd.includes('cat > "$remote_script"'),
    "must stream candidate script into file via cat",
  );
  assert(
    cmd.includes('chmod 700 "$remote_script"'),
    "must restrict permissions to 700",
  );
  assert(cmd.includes('cd "/home/mizyun/mizyun"'), "must enter remoteDir");
  assert(
    cmd.includes(`bash "$remote_script" "${targetSha}" < /dev/null`),
    "must execute script with stdin from /dev/null",
  );

  const devCmd = buildRemotePromotionCommand({
    remoteDir: "/var/lib/mizyun/dev/repo",
    targetSha,
    environment: "dev",
  });
  assert(
    devCmd.includes("mizyun-promote-dev-XXXXXX.sh"),
    "must create dev temp script",
  );
});

await test("orchestration regression: legacy bash -s streaming allows child prompt to skip release commands (negative reproduction)", () => {
  const restartMarker = path.join(tempBase, "vuln_restart_marker");
  if (existsSync(restartMarker)) rmSync(restartMarker);

  // Script where an unexpected child prompt reads stdin, consuming subsequent release lines
  const vulnerableScript = `
echo "step 1: starting migration"
read -r answer
touch "${restartMarker}"
echo "step 2: api restarted"
`;

  const res = spawnSync("bash", ["-s", "--", "fake-sha"], {
    input: vulnerableScript,
    encoding: "utf8",
  });

  assert(res.status === 0, `legacy bash -s exited ${res.status}`);
  assert(
    !existsSync(restartMarker),
    "VULNERABILITY REPRODUCED: the child prompt consumed the touch command from stdin, skipping release execution while script exited 0",
  );
});

await test("orchestration regression: materialized runner fails closed and cannot skip release commands on unexpected prompt", () => {
  const restartMarker = path.join(tempBase, "safe_restart_marker");
  const failureLog = path.join(tempBase, "safe_failure_marker");
  if (existsSync(restartMarker)) rmSync(restartMarker);
  if (existsSync(failureLog)) rmSync(failureLog);

  // Script with set -e, error trap, and unexpected child prompt
  const candidateScript = `#!/bin/bash
set -Eeuo pipefail
trap 'echo "trapped failure" > "${failureLog}"' ERR

echo "step 1: starting migration"
read -r answer
touch "${restartMarker}"
echo "step 2: api restarted"
`;

  const targetSha = "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd";
  const remoteCommand = buildRemotePromotionCommand({
    remoteDir: tempBase,
    targetSha,
    environment: "production",
    hostRoleFile,
    expectedHostRole,
  });

  const res = spawnSync("bash", ["-c", remoteCommand], {
    input: candidateScript,
    encoding: "utf8",
  });

  assert(
    res.status !== 0,
    `expected materialized runner to fail closed with non-zero exit, got ${res.status}`,
  );
  assert(
    !existsSync(restartMarker),
    "restart command was not executed normally because prompt failed closed",
  );
  assert(
    existsSync(failureLog),
    "error trap MUST be executed when prompt fails closed (cannot be bypassed)",
  );

  // Check that temporary file was cleaned up by the trap
  const tempFiles = spawnSync(
    "sh",
    ["-c", "ls -1 /tmp/mizyun-promote-production-*.sh 2>/dev/null || true"],
    { encoding: "utf8" },
  ).stdout.trim();
  assert(
    tempFiles === "",
    `temporary script should be cleaned up immediately, found: ${tempFiles}`,
  );
});

await test("promote-production.sh: unexpected child prompt fails closed, triggers rollback, and records journal (cannot skip API restart or release journal)", () => {
  // Create a prompting pnpm override that prompts for confirmation if not passed --yes
  const promptBinDir = path.join(tempBase, "prompt-bin");
  mkdirSync(promptBinDir, { recursive: true });

  const promptingPnpm = path.join(promptBinDir, "pnpm");
  writeFileSync(
    promptingPnpm,
    `#!/bin/sh
if [ "$1" = "exec" ] && [ "$2" = "supabase" ] && [ "$3" = "db" ] && [ "$4" = "push" ]; then
  # Check if --yes was passed
  has_yes=false
  for arg in "$@"; do
    if [ "$arg" = "--yes" ]; then
      has_yes=true
    fi
  done
  if [ "$has_yes" = "false" ]; then
    echo "Prompting user on stdin: Do you want to apply migrations? [y/N]" >&2
    if read -r confirmation; then
      if [ "$confirmation" = "y" ] || [ "$confirmation" = "yes" ]; then
        exit 0
      fi
    fi
    echo "Migration cancelled or EOF on stdin" >&2
    exit 1
  fi
  exit 0
fi
exit 0
`,
  );
  chmodSync(promptingPnpm, 0o755);

  const journalPath = path.join(
    prodRepoDir,
    ".git/mizyun-production-release-journal.jsonl",
  );
  const linesBefore = existsSync(journalPath)
    ? readFileSync(journalPath, "utf8").trim().split("\n").length
    : 0;

  // Create a test script in tempBase (outside prodRepoDir so prod checkout stays pristine)
  const testScriptPath = path.join(tempBase, "test-prompt-promote.sh");
  const realPromoteContent = readFileSync(
    path.resolve("scripts/promote-production.sh"),
    "utf8",
  );
  // Remove --yes to simulate an unflagged interactive prompt
  const promptedContent = realPromoteContent.replaceAll(" --yes", "");
  writeFileSync(testScriptPath, promptedContent);
  chmodSync(testScriptPath, 0o755);

  const res = spawnSync("bash", [testScriptPath, prodCommit2], {
    cwd: prodRepoDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: tempBase,
      GIT_CONFIG_GLOBAL: "/dev/null",
      PATH: `${promptBinDir}:${mockBinDir}:${process.env.PATH}`,
      MIZYUN_PRODUCTION_ENV_FILE: prodEnvFile,
      MIZYUN_PRODUCTION_LOCK_FILE: prodLockFile,
      MIZYUN_REMOTE_DIR: prodRepoDir,
      MIZYUN_DEPLOY_HOST_ROLE_FILE: hostRoleFile,
      MIZYUN_EXPECTED_DEPLOY_HOST_ROLE: expectedHostRole,
    },
  });

  rmSync(testScriptPath);
  rmSync(promptBinDir, { recursive: true, force: true });

  assert(
    res.status !== 0,
    `promotion MUST fail closed on unconfirmed prompt, got exit ${res.status}`,
  );
  assert(
    res.stderr.includes("restoring API code"),
    "rollback_code MUST be invoked on unexpected prompt failure",
  );

  // Verify journal logged rollback
  assert(existsSync(journalPath), "journal file should exist");
  const linesAfter = readFileSync(journalPath, "utf8").trim().split("\n");
  assert(
    linesAfter.length > linesBefore,
    "rollback journal entry must be recorded",
  );
  const lastEntry = JSON.parse(linesAfter[linesAfter.length - 1]);
  assert(
    lastEntry.status === "rolled_back",
    `journal status should be rolled_back, got ${lastEntry.status}`,
  );
});

await test("test-build-matrix.mjs: passes from clean checkout without generated apps/mobile/android directory (#109)", () => {
  const cleanRepo = mkdtempSync(path.join(tempBase, "clean-repo-"));
  const root = path.resolve(
    import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
    "..",
  );
  try {
    mkdirSync(path.join(cleanRepo, "apps/mobile/plugins"), {
      recursive: true,
    });
    mkdirSync(path.join(cleanRepo, "apps/mobile/src/features/workouts"), {
      recursive: true,
    });
    mkdirSync(path.join(cleanRepo, "scripts"), { recursive: true });

    writeFileSync(
      path.join(cleanRepo, "package.json"),
      readFileSync(path.join(root, "package.json")),
    );
    writeFileSync(
      path.join(cleanRepo, "apps/mobile/app.config.js"),
      readFileSync(path.join(root, "apps/mobile/app.config.js")),
    );
    writeFileSync(
      path.join(cleanRepo, "apps/mobile/app.json"),
      readFileSync(path.join(root, "apps/mobile/app.json")),
    );
    writeFileSync(
      path.join(cleanRepo, "apps/mobile/eas.json"),
      readFileSync(path.join(root, "apps/mobile/eas.json")),
    );
    for (const source of [
      "workout-notification.ts",
      "workout-live-activity.ios.tsx",
      "workout-live-activity.tsx",
    ]) {
      writeFileSync(
        path.join(cleanRepo, "apps/mobile/src/features/workouts", source),
        readFileSync(
          path.join(root, "apps/mobile/src/features/workouts", source),
        ),
      );
    }
    writeFileSync(
      path.join(
        cleanRepo,
        "apps/mobile/plugins/with-android-release-signing.js",
      ),
      readFileSync(
        path.join(root, "apps/mobile/plugins/with-android-release-signing.js"),
      ),
    );

    for (const s of [
      "mobile-founder-dev-ios.sh",
      "mobile-founder-production-ios.sh",
      "build-production-ios-ipa.sh",
      "mobile-founder-production-android.sh",
      "mobile-founder-dev-android.sh",
    ]) {
      writeFileSync(
        path.join(cleanRepo, "scripts", s),
        readFileSync(path.join(root, "scripts", s)),
      );
    }

    // Link node_modules so require works in cleanRepo
    symlinkSync(
      path.join(root, "node_modules"),
      path.join(cleanRepo, "node_modules"),
      "junction",
    );
    symlinkSync(
      path.join(root, "apps/mobile/node_modules"),
      path.join(cleanRepo, "apps/mobile/node_modules"),
      "junction",
    );

    // Verify apps/mobile/android does NOT exist in cleanRepo
    assert(
      !existsSync(path.join(cleanRepo, "apps/mobile/android")),
      "cleanRepo fixture must not contain generated android directory",
    );

    const out = execFileSync(
      "node",
      [path.join(root, "scripts/test-build-matrix.mjs")],
      {
        env: { ...process.env, MIZYUN_REPO_ROOT: cleanRepo },
        encoding: "utf-8",
      },
    );
    assert(
      out.includes(
        "All build matrix, native identity, and environment isolation checks PASSED!",
      ),
      "test-build-matrix.mjs must pass in clean checkout without android directory",
    );
  } finally {
    rmSync(cleanRepo, { recursive: true, force: true });
  }
});

// Required journal receipts are part of the promotion boundary, including recovery.
const journalFixtures = [
  {
    name: "dev",
    repo: devRepoDir,
    previous: commit1,
    target: commit2,
    journal: "mizyun-dev-release-journal.jsonl",
    marker: "mizyun-dev-sha",
    lock: devLockFile,
    run: runPromoteDev,
    backup: "not_required",
  },
  {
    name: "production",
    repo: prodRepoDir,
    previous: prodCommit1,
    target: prodCommit2,
    journal: "mizyun-production-release-journal.jsonl",
    marker: "mizyun-production-sha",
    lock: prodLockFile,
    run: runPromoteProd,
    backup: "complete",
  },
];
const journalNode = path.join(mockBinDir, "node");
const readFixtureLog = (file) =>
  existsSync(file) ? readFileSync(file, "utf8") : "";
const readReceipts = (file) =>
  readFixtureLog(file)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

for (const fixture of journalFixtures) {
  await test(`promote-${fixture.name}.sh: initial journal failure prevents promotion side effects`, () => {
    git(["checkout", "--detach", fixture.previous], fixture.repo);
    const journal = path.join(fixture.repo, ".git", fixture.journal);
    const original = existsSync(journal) ? readFileSync(journal) : null;
    rmSync(journal, { force: true });
    mkdirSync(journal);
    const serviceLog = path.join(tempBase, "systemctl.log");
    const migrationLog = path.join(tempBase, "supabase.log");
    const servicesBefore = readFixtureLog(serviceLog);
    const migrationsBefore = readFixtureLog(migrationLog);
    try {
      const res = fixture.run({ targetSha: fixture.target });
      assert(res.status !== 0, "journal failure must fail promotion");
      assert(
        res.stderr.includes("Required release journal write failed (started)"),
        "required receipt error must be explicit",
      );
      assert(
        !res.stdout.includes("succeeded:"),
        "must not report promotion success",
      );
      assert(
        git(["rev-parse", "HEAD"], fixture.repo) === fixture.previous,
        "must not change checkout",
      );
      assert(
        readFixtureLog(serviceLog) === servicesBefore,
        "must not touch services",
      );
      assert(
        readFixtureLog(migrationLog) === migrationsBefore,
        "must not apply migrations",
      );
    } finally {
      rmSync(journal, { recursive: true, force: true });
      if (original !== null) writeFileSync(journal, original);
    }
  });

  for (const failRecoveryReceipt of [false, true]) {
    await test(`promote-${fixture.name}.sh: terminal journal failure ${failRecoveryReceipt ? "keeps lock through failed recovery receipt" : "rolls back with truthful receipt"}`, () => {
      git(["checkout", "--detach", fixture.previous], fixture.repo);
      const journal = path.join(fixture.repo, ".git", fixture.journal);
      const receiptCount = readReceipts(journal).length;
      const lockProbe = path.join(
        tempBase,
        `journal-lock-probe-${fixture.name}`,
      );
      // Fail the actual terminal writer after migrations/restart/health, then
      // probe the still-held lock in a distinct process during recovery.
      writeFileSync(
        journalNode,
        `#!/bin/sh
if [ "$1" = "-" ] && [ "$3" = "success" ]; then exit 1; fi
if [ "$1" = "-" ] && [ "$3" = "rolled_back" ]; then
  python3 - "$MIZYUN_FIXTURE_LOCK_FILE" "$MIZYUN_FIXTURE_LOCK_PROBE" <<'LOCK_PROBE'
import fcntl, sys
with open(sys.argv[1], "a") as lock:
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = "released"
    except BlockingIOError:
        result = "held"
with open(sys.argv[2], "w") as output:
    output.write(result)
LOCK_PROBE
  ${failRecoveryReceipt ? "exit 1" : ":"}
fi
exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"
`,
      );
      chmodSync(journalNode, 0o755);
      try {
        const res = fixture.run({
          targetSha: fixture.target,
          extraEnv: {
            MIZYUN_FIXTURE_LOCK_FILE: fixture.lock,
            MIZYUN_FIXTURE_LOCK_PROBE: lockProbe,
            MIZYUN_HEALTH_RETRIES: "1",
            MIZYUN_HEALTH_SLEEP: "0",
          },
        });
        assert(
          res.status !== 0,
          "terminal receipt failure must fail promotion",
        );
        assert(
          !res.stdout.includes("succeeded:"),
          "must not report promotion success",
        );
        assert(
          git(["rev-parse", "HEAD"], fixture.repo) === fixture.previous,
          "must restore previous checkout",
        );
        assert(
          readFileSync(
            path.join(fixture.repo, ".git", fixture.marker),
            "utf8",
          ).trim() === fixture.previous,
          "marker must describe restored checkout",
        );
        assert(
          readFileSync(lockProbe, "utf8") === "held",
          "deployment lock must remain held through recovery receipt",
        );
        const receipts = readReceipts(journal).slice(receiptCount);
        assert(
          receipts[0]?.status === "started",
          "must retain initial receipt",
        );
        assert(
          receipts.every((entry) => entry.status !== "success"),
          "failed success receipt must not be accepted",
        );
        if (failRecoveryReceipt) {
          assert(
            receipts.length === 1,
            "failed recovery receipt must not invent completion",
          );
          assert(
            res.stderr.includes(
              "Rollback completed but its required release journal receipt failed",
            ),
            "missing recovery receipt must be explicit",
          );
        } else {
          const recovery = receipts.at(-1);
          assert(recovery.status === "rolled_back", "must record recovery");
          assert(
            recovery.previousSha === fixture.previous &&
              recovery.targetSha === fixture.target &&
              recovery.checkedOutSha === fixture.previous,
            "retain attempted and restored SHA identities",
          );
          assert(
            recovery.backupState === fixture.backup &&
              recovery.migrationState === "complete" &&
              recovery.migrationsApplied === true,
            "retain backup and migration facts after rollback",
          );
          assert(
            recovery.readinessResult === "passed" &&
              recovery.rollbackReadiness === "passed" &&
              recovery.rollbackOutcome === "code_restored_health_passed",
            "separate candidate readiness from rollback",
          );
          assert(
            recovery.runningSha === null &&
              recovery.runningReleaseVerified === false &&
              recovery.backupReference === null &&
              recovery.migrationIds === null &&
              recovery.migrationChecksums === null,
            "must not invent unmeasured release evidence",
          );
        }
      } finally {
        rmSync(journalNode, { force: true });
        rmSync(lockProbe, { force: true });
      }
    });
  }
}

// Cleanup temp test files
rmSync(tempBase, { recursive: true, force: true });

// eslint-disable-next-line no-console
console.log(
  `\nSafeguard test summary: ${passedCount} passed, ${failedCount} failed.`,
);
if (failedCount > 0) {
  exit(1);
}
