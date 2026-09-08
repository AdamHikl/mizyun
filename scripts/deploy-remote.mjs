#!/usr/bin/env node

// Promote the exact verified commit to the production environment.
// Production promotion strictly requires an explicit 40-character SHA that is
// an accepted ancestor of origin/main. Secrets never cross the SSH command line.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exit } from "node:process";
import {
  DEPLOYMENT_MANIFEST,
  parseDeploymentArgs,
  resolvePromotionCandidate,
} from "./deployment-manifest.mjs";

const config = DEPLOYMENT_MANIFEST.production;

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

const sshAlias =
  process.env.MIZYUN_PRODUCTION_SSH_ALIAS ?? config.defaultSshAlias;
const remoteDir = process.env.MIZYUN_REMOTE_DIR ?? config.defaultRemoteDir;
const publicApiUrl =
  process.env.MIZYUN_PRODUCTION_API_URL ?? config.publicApiUrl;

if (!/^[A-Za-z0-9_./-]+$/.test(remoteDir) || !remoteDir.startsWith("/")) {
  // eslint-disable-next-line no-console
  console.error("MIZYUN_REMOTE_DIR must be a safe absolute Linux path.");
  exit(2);
}

const run = (command, args, options = {}) => {
  // eslint-disable-next-line no-console
  console.log(`\n> ${command} ${args.join(" ")}`);
  return spawnSync(command, args, { stdio: "inherit", ...options });
};

const output = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    exit(2);
  }
  return result.stdout.trim();
};

const fail = (message, code = 2) => {
  // eslint-disable-next-line no-console
  console.error(`\nPromotion stopped: ${message}`);
  exit(code);
};

if (output("git", ["status", "--porcelain"]) !== "") {
  fail(
    "the Mac working tree is dirty; commit or remove local-only changes first",
  );
}

// Fetch canonical origin/main before resolving or checking candidate
run("git", ["fetch", "origin", "main"]);

let targetSha;
try {
  targetSha = resolvePromotionCandidate({
    environment: "production",
    positionalSha,
  });
} catch (err) {
  fail(err.message);
}

const steps = [
  `verify candidate commit ${targetSha}`,
  `run pnpm check and db:verify on exact candidate ${targetSha}`,
  `confirm candidate is accepted ancestor of origin/main (no branch rewinding)`,
  `ask remote host to back up, apply pending migrations, and restart API`,
  `smoke-test ${publicApiUrl}/v1/health`,
];

if (dryRun) {
  // eslint-disable-next-line no-console
  console.log(
    ["Production promotion dry run:", ...steps.map((s) => `  - ${s}`)].join(
      "\n",
    ),
  );
  exit(0);
}

const currentHead = output("git", ["rev-parse", "HEAD"]);

// Candidate verification: run on exact candidate commit
if (currentHead === targetSha) {
  if (run("pnpm", ["check"]).status !== 0)
    fail("pnpm check failed on candidate commit");
  if (run("pnpm", ["db:verify"]).status !== 0) {
    fail(
      "the disposable Mac development database verification failed on candidate commit",
    );
  }
} else {
  // Use a temporary worktree to verify the candidate commit in complete isolation
  // eslint-disable-next-line no-console
  console.log(
    `\n> verifying candidate commit ${targetSha} in isolated temporary worktree`,
  );
  const tempWorktree = mkdtempSync(path.join(tmpdir(), "mizyun-prod-verify-"));
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

    const dbVerify = run("pnpm", ["db:verify"], { cwd: tempWorktree });
    if (dbVerify.status !== 0)
      fail("pnpm db:verify failed on candidate commit");
  } finally {
    run("git", ["worktree", "remove", "--force", tempWorktree]);
  }
}

const sshCheck = run("ssh", ["-o", "BatchMode=yes", sshAlias, "true"]);
if (sshCheck.status !== 0) fail(`SSH host ${sshAlias} is not reachable`);

const promotionScript = output("git", [
  "show",
  `${targetSha}:scripts/promote-production.sh`,
]);

// eslint-disable-next-line no-console
console.log(`\n> promote ${targetSha} on ${sshAlias}`);
const promote = spawnSync(
  "ssh",
  [
    "-o",
    "BatchMode=yes",
    sshAlias,
    `cd ${remoteDir} && bash -s -- ${targetSha}`,
  ],
  {
    input: `${promotionScript}\n`,
    stdio: ["pipe", "inherit", "inherit"],
  },
);
if (promote.status !== 0) {
  fail("the remote promotion failed; inspect remote service logs", 3);
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
  fail(`the public smoke test failed; inspect the service and tunnel`, 4);
}

// eslint-disable-next-line no-console
console.log(`\nProduction now runs ${targetSha}.`);
