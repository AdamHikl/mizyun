#!/usr/bin/env node

// Deploy the exact verified commit to the Raspberry Pi development environment.
// Unlike production, dev deployment allows feature branches and commits under test.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exit } from "node:process";
import {
  DEPLOYMENT_MANIFEST,
  buildRemotePromotionCommand,
  parseDeploymentArgs,
  resolvePromotionCandidate,
} from "./deployment-manifest.mjs";

const config = DEPLOYMENT_MANIFEST.dev;

let dryRun = false;
let positionalSha = null;

try {
  const parsed = parseDeploymentArgs(process.argv.slice(2));
  dryRun = parsed.dryRun;
  positionalSha = parsed.positionalSha;
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`\nInvalid deployment arguments: ${err.message}`);
  exit(2);
}

const sshAlias = process.env.MIZYUN_DEV_SSH_ALIAS ?? config.defaultSshAlias;
const remoteDir = process.env.MIZYUN_DEV_REMOTE_DIR ?? config.defaultRemoteDir;
const publicApiUrl = process.env.MIZYUN_DEV_API_URL ?? config.publicApiUrl;

if (!/^[A-Za-z0-9_./-]+$/.test(remoteDir) || !remoteDir.startsWith("/")) {
  // eslint-disable-next-line no-console
  console.error("MIZYUN_DEV_REMOTE_DIR must be a safe absolute Linux path.");
  exit(2);
}

const run = (command, cmdArgs, options = {}) => {
  // eslint-disable-next-line no-console
  console.log(`\n> ${command} ${cmdArgs.join(" ")}`);
  return spawnSync(command, cmdArgs, { stdio: "inherit", ...options });
};

const output = (command, cmdArgs, options = {}) => {
  const result = spawnSync(command, cmdArgs, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    exit(2);
  }
  return result.stdout.trim();
};

const fail = (message, code = 2) => {
  // eslint-disable-next-line no-console
  console.error(`\nDev deployment stopped: ${message}`);
  exit(code);
};

if (output("git", ["status", "--porcelain"]) !== "") {
  fail(
    "the Mac working tree is dirty; commit or stash local-only changes before deploying",
  );
}

let targetSha;
try {
  targetSha = resolvePromotionCandidate({
    environment: "dev",
    positionalSha,
  });
} catch (err) {
  fail(err.message);
}

const steps = [
  `verify commit ${targetSha}`,
  `run pnpm check on candidate commit ${targetSha}`,
  "ensure commit is pushed to origin",
  `deploy to Pi Dev at ${remoteDir}`,
  `smoke-test ${publicApiUrl}/v1/health`,
];

if (dryRun) {
  // eslint-disable-next-line no-console
  console.log(
    ["Dev deployment dry run:", ...steps.map((s) => `  - ${s}`)].join("\n"),
  );
  exit(0);
}

const currentHead = output("git", ["rev-parse", "HEAD"]);

// Candidate verification: run pnpm check on the exact candidate commit
if (currentHead === targetSha) {
  if (run("pnpm", ["check"]).status !== 0)
    fail("pnpm check failed on candidate commit");
} else {
  // eslint-disable-next-line no-console
  console.log(
    `\n> verifying candidate commit ${targetSha} in isolated temporary worktree`,
  );
  const tempWorktree = mkdtempSync(path.join(tmpdir(), "mizyun-dev-verify-"));
  try {
    const addWorktree = run("git", [
      "worktree",
      "add",
      "--detach",
      tempWorktree,
      targetSha,
    ]);
    if (addWorktree.status !== 0)
      fail("failed to create temporary worktree for candidate");

    const pnpmInstall = run("pnpm", ["install", "--frozen-lockfile"], {
      cwd: tempWorktree,
    });
    if (pnpmInstall.status !== 0)
      fail("pnpm install failed in candidate worktree");

    const pnpmCheck = run("pnpm", ["check"], { cwd: tempWorktree });
    if (pnpmCheck.status !== 0) fail("pnpm check failed on candidate commit");
  } finally {
    run("git", ["worktree", "remove", "--force", tempWorktree]);
  }
}

const sshCheck = run("ssh", [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=10",
  sshAlias,
  "true",
]);
if (sshCheck.status !== 0) fail(`SSH host ${sshAlias} is not reachable`);

// Push commit to origin if needed so the Pi can fetch it
const currentBranch = output("git", ["branch", "--show-current"]);
if (currentBranch) {
  // eslint-disable-next-line no-console
  console.log(`\n> pushing ${currentBranch} to origin`);
  if (run("git", ["push", "origin", currentBranch]).status !== 0) {
    fail("git push failed", 3);
  }
} else {
  // Detached HEAD: push target commit directly
  // eslint-disable-next-line no-console
  console.log(`\n> pushing commit ${targetSha} to origin`);
  if (
    run("git", [
      "push",
      "origin",
      `${targetSha}:refs/heads/deploy-tmp-${targetSha.slice(0, 8)}`,
    ]).status !== 0
  ) {
    fail("git push of detached commit failed", 3);
  }
}

const promotionScript = output("git", [
  "show",
  `${targetSha}:scripts/promote-dev.sh`,
]);

const remoteCommand = buildRemotePromotionCommand({
  remoteDir,
  targetSha,
  environment: "dev",
});

// eslint-disable-next-line no-console
console.log(`\n> deploy ${targetSha} on ${sshAlias} (${remoteDir})`);
const promote = spawnSync(
  "ssh",
  ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", sshAlias, remoteCommand],
  {
    input: `${promotionScript}\n`,
    stdio: ["pipe", "inherit", "inherit"],
  },
);
if (promote.status !== 0) {
  fail("the Pi development deployment failed; inspect remote service logs", 3);
}

const smoke = run("curl", [
  "--silent",
  "--show-error",
  "--fail",
  "--max-time",
  "15",
  `${publicApiUrl}/v1/health`,
]);
if (smoke.status !== 0) {
  fail(`the public Dev API smoke test failed at ${publicApiUrl}/v1/health`, 4);
}

// eslint-disable-next-line no-console
console.log(`\nPi Dev now runs ${targetSha}.`);
