// Central deployment manifest, argument validation, and release journal helpers.

import { spawnSync } from "node:child_process";

export const DEPLOYMENT_MANIFEST = {
  dev: {
    environment: "dev",
    defaultSshAlias: "rpserver",
    defaultRemoteDir: "/var/lib/mizyun/dev/repo",
    defaultEnvFile: "/etc/mizyun/dev.env",
    serviceName: "mizyun-api-dev",
    forbiddenServiceName: "mizyun-api",
    localPort: 4100,
    localHealthUrl: "http://127.0.0.1:4100/v1/health",
    publicApiUrl: "https://mizyun-api-dev.phiskel.com",
    lockFile: "/tmp/mizyun-deploy-dev.lock",
    journalFile: ".git/mizyun-dev-release-journal.jsonl",
    shaFile: ".git/mizyun-dev-sha",
    requireMain: false,
    requireExplicitSha: false,
  },
  production: {
    environment: "production",
    defaultSshAlias: "rpserver",
    defaultRemoteDir: "/home/mizyun/mizyun",
    defaultEnvFile: "/etc/mizyun/production.env",
    serviceName: "mizyun-api",
    forbiddenServiceName: "mizyun-api-dev",
    localPort: 4000,
    localHealthUrl: "http://127.0.0.1:4000/v1/health",
    publicApiUrl: "https://mizyun-api.phiskel.com",
    lockFile: "/tmp/mizyun-deploy-production.lock",
    journalFile: ".git/mizyun-production-release-journal.jsonl",
    shaFile: ".git/mizyun-production-sha",
    dbContainer: "supabase-db",
    requireMain: true,
    requireExplicitSha: true,
  },
};

export const validateCommitSha = (sha) => {
  return typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha.trim());
};

const defaultGitRunner = {
  run: (args, options = {}) => {
    return spawnSync("git", args, { encoding: "utf8", ...options });
  },
  output: (args, options = {}) => {
    const res = spawnSync("git", args, { encoding: "utf8", ...options });
    if (res.status !== 0) {
      throw new Error(
        res.stderr ? res.stderr.trim() : `git ${args.join(" ")} failed`,
      );
    }
    return res.stdout.trim();
  },
};

export const parseDeploymentArgs = (argv) => {
  let dryRun = false;
  let positionalSha = null;
  const unknownArgs = [];

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("-")) {
      unknownArgs.push(arg);
    } else if (!positionalSha) {
      positionalSha = arg;
    } else {
      unknownArgs.push(arg);
    }
  }

  if (unknownArgs.length > 0) {
    throw new Error(
      `Unrecognized deployment arguments: ${unknownArgs.join(", ")}`,
    );
  }

  return { dryRun, positionalSha };
};

export const resolvePromotionCandidate = ({
  environment,
  positionalSha,
  gitRunner = defaultGitRunner,
}) => {
  const config = DEPLOYMENT_MANIFEST[environment];
  if (!config) {
    throw new Error(`Unknown environment: ${environment}`);
  }

  if (config.requireExplicitSha) {
    if (!positionalSha || positionalSha.trim() === "HEAD") {
      throw new Error(
        "Production promotion strictly requires an explicit 40-character commit SHA argument. Promoting HEAD or omitting the SHA is not permitted.",
      );
    }
  }

  let resolvedSha;
  if (!positionalSha || positionalSha.trim() === "HEAD") {
    try {
      resolvedSha = gitRunner.output(["rev-parse", "HEAD"]);
    } catch (err) {
      throw new Error(`Failed to resolve HEAD: ${err.message}`);
    }
  } else {
    try {
      resolvedSha = gitRunner.output([
        "rev-parse",
        `${positionalSha.trim()}^{commit}`,
      ]);
    } catch {
      throw new Error(
        `Could not resolve '${positionalSha}' to a valid commit.`,
      );
    }
  }

  if (!validateCommitSha(resolvedSha)) {
    throw new Error(
      `Resolved SHA is not a valid 40-character hex commit: '${resolvedSha}'`,
    );
  }

  // Canonical origin reachability for production
  if (config.requireMain) {
    const isAncestorResult = gitRunner.run([
      "merge-base",
      "--is-ancestor",
      resolvedSha,
      "origin/main",
    ]);
    if (isAncestorResult.status !== 0) {
      throw new Error(
        `Target candidate ${resolvedSha} is not reachable from origin/main. Production candidates must be merged and accepted on origin/main before promotion.`,
      );
    }
  }

  return resolvedSha;
};

export const formatJournalEntry = ({
  timestamp = new Date().toISOString(),
  status,
  environment,
  targetSha,
  previousSha,
  service,
  migrationsApplied = false,
  message = "",
}) => {
  return JSON.stringify({
    timestamp,
    status,
    environment,
    targetSha,
    previousSha: previousSha || "none",
    service,
    migrationsApplied,
    message,
  });
};

export const buildRemotePromotionCommand = ({
  remoteDir,
  targetSha,
  environment = "production",
}) => {
  if (
    typeof remoteDir !== "string" ||
    !/^[A-Za-z0-9_./-]+$/.test(remoteDir) ||
    !remoteDir.startsWith("/")
  ) {
    throw new Error("remoteDir must be a safe absolute Linux path.");
  }
  if (!validateCommitSha(targetSha)) {
    throw new Error(`Invalid targetSha: '${targetSha}'`);
  }
  const prefix =
    environment === "dev" ? "mizyun-promote-dev" : "mizyun-promote-production";
  return [
    "set -eu",
    `remote_script="$(mktemp /tmp/${prefix}-XXXXXX.sh)"`,
    "trap 'rm -f \"$remote_script\"' EXIT INT TERM",
    'cat > "$remote_script"',
    'chmod 700 "$remote_script"',
    `cd "${remoteDir}"`,
    `bash "$remote_script" "${targetSha}" < /dev/null`,
  ].join("\n");
};
