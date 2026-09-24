#!/usr/bin/env node

// Fast, non-destructive preflight checker for Hetzner Production promotion.
// Designed to give human operators and AI agents instant (<1s) diagnostics
// and the exact command to run without burning tokens on discovery.

import { spawnSync } from "node:child_process";
import { exit } from "node:process";
import {
  DEPLOYMENT_MANIFEST,
  buildRemoteHostRoleCommand,
  parseDeploymentArgs,
  resolvePromotionCandidate,
} from "./deployment-manifest.mjs";

const config = DEPLOYMENT_MANIFEST.production;

let positionalSha = null;
try {
  const parsed = parseDeploymentArgs(process.argv.slice(2));
  positionalSha = parsed.positionalSha;
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`Invalid arguments: ${err.message}`);
  exit(2);
}

const sshAlias =
  process.env.MIZYUN_PRODUCTION_SSH_ALIAS ?? config.defaultSshAlias;
const hostRoleFile =
  process.env.MIZYUN_DEPLOY_HOST_ROLE_FILE ?? config.hostRoleFile;
const expectedHostRole =
  process.env.MIZYUN_EXPECTED_DEPLOY_HOST_ROLE ?? config.expectedHostRole;
const publicApiUrl =
  process.env.MIZYUN_PRODUCTION_API_URL ?? config.publicApiUrl;

const output = (command, args) => {
  const res = spawnSync(command, args, { encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
};

// eslint-disable-next-line no-console
console.log("=== Mizyun Production Promotion Preflight ===\n");

let canDeploy = true;
const checks = [];

// 1. Working tree cleanliness
const porcelain = output("git", ["status", "--porcelain"]);
if (porcelain === null) {
  checks.push({
    name: "Git Repository",
    status: "FAIL",
    detail: "Not inside a git repository",
  });
  canDeploy = false;
} else if (porcelain !== "") {
  const fileCount = porcelain.split("\n").filter(Boolean).length;
  checks.push({
    name: "Working Tree",
    status: "FAIL",
    detail: `Dirty (${fileCount} modified/untracked files). Must commit or stash before production promotion.`,
  });
  canDeploy = false;
} else {
  checks.push({
    name: "Working Tree",
    status: "PASS",
    detail: "Clean",
  });
}

// 2. Candidate commit resolution and origin/main ancestor verification
let targetSha = null;

// Fetch canonical origin/main first (matching deploy-remote.mjs)
spawnSync("git", ["fetch", "origin", "main"], { encoding: "utf8" });

try {
  targetSha = resolvePromotionCandidate({
    environment: "production",
    positionalSha,
  });
  const subject = output("git", ["log", "-1", "--format=%s", targetSha]);
  checks.push({
    name: "Candidate SHA",
    status: "PASS",
    detail: `${targetSha.slice(0, 8)} - ${subject ?? "no commit message"}`,
  });

  // Fetch origin main before checking ancestor status
  const fetchRes = spawnSync("git", ["fetch", "origin", "main"], {
    encoding: "utf8",
  });
  if (fetchRes.status !== 0) {
    checks.push({
      name: "origin/main Fetch",
      status: "FAIL",
      detail: `Failed to fetch origin/main: ${fetchRes.stderr?.trim() || "network or credential failure"}`,
    });
    canDeploy = false;
  }

  // Verify candidate is reachable from origin/main
  const isAncestor = spawnSync("git", [
    "merge-base",
    "--is-ancestor",
    targetSha,
    "origin/main",
  ]);
  if (isAncestor.status === 0) {
    checks.push({
      name: "origin/main Ancestor",
      status: "PASS",
      detail: "Confirmed: candidate is an accepted ancestor of origin/main",
    });
  } else {
    checks.push({
      name: "origin/main Ancestor",
      status: "FAIL",
      detail:
        "Candidate is NOT an ancestor of origin/main (refusing unmerged branch)",
    });
    canDeploy = false;
  }
} catch (err) {
  checks.push({
    name: "Candidate SHA",
    status: "FAIL",
    detail: err.message,
  });
  canDeploy = false;
}

// 3. SSH Host & Role Check
const hostRoleCmd = buildRemoteHostRoleCommand({
  hostRoleFile,
  expectedHostRole,
});
const sshCheck = spawnSync(
  "ssh",
  ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", sshAlias, hostRoleCmd],
  { encoding: "utf8" },
);

if (sshCheck.status === 0) {
  checks.push({
    name: "Hetzner Prod Host",
    status: "PASS",
    detail: `${sshAlias} reachable & Hetzner primary marker verified`,
  });
} else {
  const stderr =
    sshCheck.stderr?.trim() || "Host unreachable or marker mismatch";
  checks.push({
    name: "Hetzner Prod Host",
    status: "FAIL",
    detail: `${sshAlias}: ${stderr}`,
  });
  canDeploy = false;
}

// 4. Public API Current Health
const healthRes = spawnSync(
  "curl",
  [
    "--silent",
    "--show-error",
    "--fail",
    "--max-time",
    "5",
    `${publicApiUrl}/v1/health`,
  ],
  { encoding: "utf8" },
);

if (healthRes.status === 0) {
  checks.push({
    name: "Public Prod API",
    status: "PASS",
    detail: `${publicApiUrl}/v1/health is HTTP 200 (healthy)`,
  });
} else {
  checks.push({
    name: "Public Prod API",
    status: "WARN",
    detail: `${publicApiUrl}/v1/health returned error or timed out`,
  });
}

// Render Results
for (const check of checks) {
  const symbol =
    check.status === "PASS"
      ? "✓"
      : check.status === "FAIL"
        ? "✗"
        : check.status === "WARN"
          ? "!"
          : "ℹ";
  // eslint-disable-next-line no-console
  console.log(`[${symbol}] ${check.name.padEnd(22)} ${check.detail}`);
}

// eslint-disable-next-line no-console
console.log("");
if (canDeploy) {
  // eslint-disable-next-line no-console
  console.log(
    `SUCCESS: Ready to promote to Hetzner Production!\nExecute: pnpm deploy:production ${targetSha}`,
  );
  exit(0);
} else {
  // eslint-disable-next-line no-console
  console.log(
    "BLOCKED: Resolve the failures above before promoting to production.",
  );
  exit(1);
}
