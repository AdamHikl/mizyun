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

import { spawnSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exit } from "node:process";
import {
  DEPLOYMENT_MANIFEST,
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

// Create mock bin directory
const mockBinDir = path.join(tempBase, "bin");
mkdirSync(mockBinDir, { recursive: true });

// Mock systemctl
const mockSystemctl = path.join(mockBinDir, "systemctl");
writeFileSync(
  mockSystemctl,
  `#!/bin/sh
echo "mock systemctl called with: $@" >> "${path.join(tempBase, "systemctl.log")}"
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
MIZYUN_API_SERVICE="mizyun-api-dev"
MIZYUN_LOCAL_API_URL="http://127.0.0.1:4100"
`,
);

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
      GIT_CONFIG_GLOBAL: "/dev/null",
      PATH: `${mockBinDir}:${process.env.PATH}`,
      MIZYUN_DEV_ENV_FILE: envFile,
      MIZYUN_DEV_LOCK_FILE: lockFile,
      MIZYUN_DEV_REMOTE_DIR: devRepoDir,
      ...extraEnv,
    },
  });
};

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
    lastEntry.service === "mizyun-api-dev",
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
      ...extraEnv,
    },
  });
};

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

// Cleanup temp test files
rmSync(tempBase, { recursive: true, force: true });

// eslint-disable-next-line no-console
console.log(
  `\nSafeguard test summary: ${passedCount} passed, ${failedCount} failed.`,
);
if (failedCount > 0) {
  exit(1);
}
