#!/usr/bin/env node

// Deploy the exact verified commit to the Raspberry Pi development environment.
// Unlike production, dev deployment allows feature branches and commits under test.

import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positionalSha = args.find((arg) => !arg.startsWith("--"));

const sshAlias = process.env.MIZYUN_DEV_SSH_ALIAS ?? "rpserver";
const remoteDir =
  process.env.MIZYUN_DEV_REMOTE_DIR ?? "/var/lib/mizyun/dev/repo";
const publicApiUrl =
  process.env.MIZYUN_DEV_API_URL ?? "https://mizyun-api-dev.phiskel.com";

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

const output = (command, cmdArgs) => {
  const result = spawnSync(command, cmdArgs, { encoding: "utf8" });
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

let targetSha = positionalSha;
if (!targetSha || targetSha === "HEAD") {
  targetSha = output("git", ["rev-parse", "HEAD"]);
} else {
  try {
    targetSha = output("git", ["rev-parse", `${targetSha}^{commit}`]);
  } catch {
    fail(`Could not resolve '${positionalSha}' to a valid commit.`);
  }
}

if (!/^[0-9a-f]{40}$/.test(targetSha)) {
  fail("Target SHA must be a valid 40-character commit hash.");
}

const steps = [
  `verify commit ${targetSha}`,
  "run pnpm check on the Mac",
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

if (output("git", ["status", "--porcelain"]) !== "") {
  fail(
    "the Mac working tree is dirty; commit or stash local-only changes before deploying",
  );
}

const sshCheck = run("ssh", ["-o", "BatchMode=yes", sshAlias, "true"]);
if (sshCheck.status !== 0) fail(`SSH host ${sshAlias} is not reachable`);

if (run("pnpm", ["check"]).status !== 0) fail("pnpm check failed");

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

// eslint-disable-next-line no-console
console.log(`\n> deploy ${targetSha} on ${sshAlias} (${remoteDir})`);
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
