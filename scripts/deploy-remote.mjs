#!/usr/bin/env node
//
// Mac → Slovakia PC deploy orchestrator (INFRA-SELFHOST-001).
//
// Pre-flight + SSH orchestration + smoke test. Wraps the
// git-push → ssh → git-pull → db:verify → db:push → API restart
// → smoke-test pipeline so Adam can ship a stable Mac-side
// commit to the alpha PC in one command.
//
// Usage:
//   pnpm deploy:remote
//
// Required env / setup:
//   - `~/.ssh/config` has a `mizyun-pc` Host alias.
//   - `~/.ssh/id_ed25519_mizyun` is the deploy key (mode 0600).
//   - The PC has the self-hosted Mizyun stack configured per
//     `docs/tutorials/SELFHOSTED_RUNBOOK.md`.
//
// Exit codes:
//   0  deploy succeeded, smoke test green.
//   2  preflight failed (no SSH, dirty tree, tunnel down, etc.).
//   3  remote step failed (git pull / db:verify / db:push).
//   4  smoke test failed; rollback hint printed.
//
// This script never force-pushes and never force-restarts the API
// unless every prior step succeeded.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { exit } from "node:process";

const SSH_ALIAS = "mizyun-pc";
const SSH_KEY = `${process.env.HOME}/.ssh/id_ed25519_mizyun`;
const REMOTE_DIR = process.env.MIZYUN_REMOTE_DIR ?? "~/mizyun";
const TUNNEL_NAME = "mizyun-alpha";
const TUNNEL_URL = process.env.MIZYUN_TUNNEL_URL ?? "https://alpha.mizyun.app";

const failures = [];
const ok = (msg) => {
  // eslint-disable-next-line no-console
  console.log(`  ok  ${msg}`);
};
const fail = (msg) => {
  failures.push(msg);
  // eslint-disable-next-line no-console
  console.error(`  FAIL ${msg}`);
};

const run = (cmd, args, opts = {}) => {
  const result = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? "";
    fail(
      `${cmd} ${args.join(" ")} exited ${result.status}${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return result;
};

const ssh = (args) => {
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", SSH_ALIAS, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? "";
    fail(
      `ssh ${args.join(" ")} exited ${result.status}${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return result;
};

// ----- preflight -----

// eslint-disable-next-line no-console
console.log("Preflight:");

if (!existsSync(SSH_KEY)) {
  fail(
    `SSH key ${SSH_KEY} not found; see SELFHOSTED_RUNBOOK §"Local operator setup"`,
  );
} else {
  try {
    const stat = statSync(SSH_KEY);
    const bits = stat.mode & 0o777;
    if (bits !== 0o600) {
      fail(
        `SSH key ${SSH_KEY} has permissions ${bits.toString(8)}; expected 0600`,
      );
    } else {
      ok(`SSH key ${SSH_KEY} mode 0600`);
    }
  } catch {
    fail(`cannot stat SSH key ${SSH_KEY}`);
  }
}

const sshCheck = ssh(["echo ok"]);
if (sshCheck.status === 0) {
  ok(`ssh ${SSH_ALIAS} reachable`);
} else {
  fail(`ssh ${SSH_ALIAS} unreachable`);
}

const tunnelCheck = ssh(["cloudflared", "tunnel", "info", TUNNEL_NAME]);
const tunnelText = tunnelCheck.stdout?.toString() ?? "";
if (/HEALTHY/i.test(tunnelText)) {
  ok(`cloudflared tunnel ${TUNNEL_NAME} is HEALTHY`);
} else {
  fail(
    `cloudflared tunnel ${TUNNEL_NAME} not HEALTHY; got: ${tunnelText.trim() || "(empty)"}`,
  );
}

const gitStatus = run("git", ["status", "--porcelain"]);
if (gitStatus.stdout && gitStatus.stdout.length > 0) {
  fail("local working tree is dirty; commit or stash before deploying");
} else {
  ok("local working tree clean");
}

const aheadCheck = run("git", ["rev-parse", "--abbrev-ref", "@{u}"]);
if (aheadCheck.status !== 0) {
  fail("no upstream tracking branch; `git push` the canonical remote first");
} else {
  ok(`upstream tracking branch: ${aheadCheck.stdout.toString().trim()}`);
}

if (failures.length > 0) {
  // eslint-disable-next-line no-console
  console.error("\nPreflight failed. Aborting.");
  exit(2);
}

// eslint-disable-next-line no-console
console.log("\nPreflight passed.\n");

// ----- step 1: push to canonical remote -----

// eslint-disable-next-line no-console
console.log("Step 1: git push to canonical remote");
const push = run("git", ["push"]);
if (push.status !== 0) {
  // eslint-disable-next-line no-console
  console.error("\ngit push failed. Aborting.");
  exit(3);
}
ok("git push");

// ----- step 2: git pull on PC -----

// eslint-disable-next-line no-console
console.log("\nStep 2: git pull on PC");
const pull = ssh(["cd", REMOTE_DIR, "&&", "git", "pull", "--ff-only"]);
if (pull.status !== 0) {
  // eslint-disable-next-line no-console
  console.error("\nRemote git pull failed. Aborting.");
  exit(3);
}
ok("git pull --ff-only");

// ----- step 3: pnpm install on PC -----

// eslint-disable-next-line no-console
console.log("\nStep 3: pnpm install --frozen-lockfile on PC");
const install = ssh([
  "cd",
  REMOTE_DIR,
  "&&",
  "pnpm",
  "install",
  "--frozen-lockfile",
]);
if (install.status !== 0) {
  // eslint-disable-next-line no-console
  console.error("\nRemote pnpm install failed. Aborting.");
  exit(3);
}
ok("pnpm install --frozen-lockfile");

// ----- step 4: pnpm db:verify on PC -----

// eslint-disable-next-line no-console
console.log("\nStep 4: pnpm db:verify on PC");
const verify = ssh(["cd", REMOTE_DIR, "&&", "pnpm", "db:verify"]);
if (verify.status !== 0) {
  // eslint-disable-next-line no-console
  console.error(
    "\nRemote db:verify failed. Aborting — do not push migrations on a broken local stack.",
  );
  exit(3);
}
ok("pnpm db:verify");

// ----- step 5: pnpm db:push on PC -----

// eslint-disable-next-line no-console
console.log("\nStep 5: pnpm db:push on PC");
const pushMigrations = ssh(["cd", REMOTE_DIR, "&&", "pnpm", "db:push"]);
if (pushMigrations.status !== 0) {
  // eslint-disable-next-line no-console
  console.error(
    "\nRemote db:push failed. Inspect the migration history on the PC and retry.",
  );
  exit(3);
}
ok("pnpm db:push");

// ----- step 6: restart API -----

// eslint-disable-next-line no-console
console.log("\nStep 6: systemctl restart mizyun-api on PC");
const restart = ssh(["sudo", "systemctl", "restart", "mizyun-api"]);
if (restart.status !== 0) {
  // eslint-disable-next-line no-console
  console.error(
    "\nAPI restart failed. Inspect `journalctl -u mizyun-api -n 50` on the PC.",
  );
  exit(3);
}
ok("systemctl restart mizyun-api");

// ----- step 7: smoke test against the tunnel -----

// eslint-disable-next-line no-console
console.log("\nStep 7: smoke test against the tunnel");
const smoke = run("curl", [
  "--silent",
  "--show-error",
  "--fail",
  "--max-time",
  "10",
  `${TUNNEL_URL}/v1/system/status`,
]);
if (smoke.status !== 0) {
  // eslint-disable-next-line no-console
  console.error(
    `\nSmoke test failed against ${TUNNEL_URL}. The API may be up but the tunnel may not be routing.`,
  );
  // eslint-disable-next-line no-console
  console.error(
    "Rollback hint: ssh mizyun-pc 'git log -1 --format=%H' to capture the deployed commit.",
  );
  exit(4);
}
ok(`smoke test against ${TUNNEL_URL}`);

// eslint-disable-next-line no-console
console.log("\nDeploy succeeded.");

// eslint-disable-next-line no-console
console.log(
  [
    "",
    "Next steps:",
    `  - verify the AI limiter smoke: SUPABASE_URL=${TUNNEL_URL} SUPABASE_PUBLISHABLE_KEY=<anon> bash scripts/ai-ops-001-smoke.sh`,
    "  - check the tunnel routing on Cloudflare dashboard",
    "  - update docs/status.md with the deployed commit + smoke evidence",
  ].join("\n"),
);
