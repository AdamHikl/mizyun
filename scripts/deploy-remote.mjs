#!/usr/bin/env node

// Promote the exact verified commit on the Mac to the Windows/WSL production
// host. The remote half lives in promote-production.sh so secrets never cross
// the SSH command line.

import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positionalSha = args.find((arg) => !arg.startsWith("--"));
const sshAlias = process.env.MIZYUN_PRODUCTION_SSH_ALIAS ?? "rpserver";
const remoteDir = process.env.MIZYUN_REMOTE_DIR ?? "/home/mizyun/mizyun";
const publicApiUrl =
  process.env.MIZYUN_PRODUCTION_API_URL ?? "https://mizyun-api.phiskel.com";

if (!/^[A-Za-z0-9_./-]+$/.test(remoteDir) || !remoteDir.startsWith("/")) {
  // eslint-disable-next-line no-console
  console.error("MIZYUN_REMOTE_DIR must be a safe absolute Linux path.");
  exit(2);
}

const steps = [
  "require a clean local main branch",
  "run pnpm check on the Mac",
  "run pnpm db:verify against the Mac development database",
  "push the exact local commit to origin/main",
  "ask the PC to back up, apply pending migrations, and restart the API",
  `smoke-test ${publicApiUrl ?? "<MIZYUN_PRODUCTION_API_URL>"}/v1/health`,
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

const run = (command, args, options = {}) => {
  // eslint-disable-next-line no-console
  console.log(`\n> ${command} ${args.join(" ")}`);
  return spawnSync(command, args, { stdio: "inherit", ...options });
};

const output = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
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

const branch = output("git", ["branch", "--show-current"]);
if (branch !== "main") {
  fail(
    `only main can be promoted; current branch is ${branch || "detached HEAD"}`,
  );
}

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
  fail("could not resolve a valid commit SHA");
}

const isAncestor = run("git", [
  "merge-base",
  "--is-ancestor",
  targetSha,
  "HEAD",
]);
if (isAncestor.status !== 0) {
  fail(`target commit ${targetSha} is not in current main branch history`);
}

const sshCheck = run("ssh", ["-o", "BatchMode=yes", sshAlias, "true"]);
if (sshCheck.status !== 0) fail(`SSH host ${sshAlias} is not reachable`);

if (run("pnpm", ["check"]).status !== 0) fail("pnpm check failed");
if (run("pnpm", ["db:verify"]).status !== 0) {
  fail("the disposable Mac development database verification failed");
}

if (run("git", ["push", "origin", `${targetSha}:main`]).status !== 0) {
  fail("git push failed", 3);
}

const promotionScript = output("git", [
  "show",
  `${targetSha}:scripts/promote-production.sh`,
]);
// Stream the promotion code from the verified target commit. This also
// bootstraps the first deployment where the PC checkout does not contain the
// new script yet.
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
if (promote.status !== 0)
  fail("the PC promotion failed; production was rolled back where possible", 3);

const smoke = run("curl", [
  "--silent",
  "--show-error",
  "--fail",
  "--max-time",
  "15",
  `${publicApiUrl}/v1/health`,
]);
if (smoke.status !== 0) {
  fail(`the public smoke test failed; inspect the PC service and tunnel`, 4);
}

// eslint-disable-next-line no-console
console.log(`\nProduction now runs ${targetSha}.`);
