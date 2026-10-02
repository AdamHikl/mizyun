#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadFeatureMap, findFeature, getRepoRoot } from "./feature-map.mjs";
import {
  createTaskPacket,
  renderTaskPacket,
  renderFeaturePacket,
} from "./packet.mjs";

function printUsage() {
  console.log(`Mizyun Developer Feature Context CLI

Usage:
  pnpm context --list                List all mapped features
  pnpm context <feature-id>          Display focused context for a feature
  pnpm context <feature-id> --json   Output structured machine-readable JSON
  pnpm context <feature-id> --all    Display complete untruncated context
  pnpm context --query "follow back approval"  Rank current source and docs
  pnpm context --path <file>         Trace a file and its direct consumers
  pnpm context --symbol <name>       Locate declarations and related files
  pnpm context community --query "follow back"  Narrow a feature packet

Options:
  --list       List all mapped features with title and aliases
  --json       Output raw JSON representation
  --all        Do not truncate output to 120 lines
  --budget-bytes <n>  Text budget (default 8192; minimum 2048)
  --no-cache   Refresh without reading or writing the local parse cache
  --help, -h   Show this help message
`);
}

function listFeatures(mapData) {
  console.log("=== Mizyun Mapped Features ===");
  console.log("");
  for (const feature of mapData.features) {
    const aliasStr =
      feature.aliases && feature.aliases.length > 0
        ? ` (aliases: ${feature.aliases.join(", ")})`
        : "";
    console.log(`  • ${feature.id.padEnd(30)} ${feature.title}${aliasStr}`);
  }
  console.log("");
  console.log(`Total features mapped: ${mapData.features.length}`);
}

export function discoverNestedInstructions(feature, repoRoot) {
  const instructions = new Map();
  const resolvedRoot = path.resolve(repoRoot);
  const realRoot = fs.realpathSync(resolvedRoot);
  const isInsideRepo = (candidate) =>
    candidate === resolvedRoot ||
    candidate.startsWith(`${resolvedRoot}${path.sep}`);
  const resolvesInsideRepo = (candidate) => {
    let existing = candidate;
    while (!fs.existsSync(existing) && existing !== path.dirname(existing)) {
      existing = path.dirname(existing);
    }
    try {
      const real = fs.realpathSync(existing);
      return real === realRoot || real.startsWith(`${realRoot}${path.sep}`);
    } catch {
      return false;
    }
  };
  const allPaths = [
    ...(feature.entryPoints || []),
    ...(feature.ownedPaths || []),
    ...(feature.contracts || []),
    ...(feature.domainPort || []),
    ...(feature.ui || []),
    ...(feature.api || []),
    ...(feature.adapters || []),
    ...(feature.tests || []),
  ];

  for (const mappedPath of allPaths) {
    const cleanPath = mappedPath.split("#")[0];
    if (!cleanPath) continue;

    const resolved = path.resolve(repoRoot, cleanPath);
    if (!isInsideRepo(resolved) || !resolvesInsideRepo(resolved)) continue;
    let current =
      fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
        ? resolved
        : path.dirname(resolved);

    while (isInsideRepo(current)) {
      const agentsPath = path.join(current, "AGENTS.md");
      if (
        fs.existsSync(agentsPath) &&
        resolvesInsideRepo(agentsPath) &&
        fs.statSync(agentsPath).isFile()
      ) {
        const relativeInstruction =
          path.relative(repoRoot, agentsPath) || "AGENTS.md";
        instructions.set(relativeInstruction, {
          path: relativeInstruction,
          reason:
            relativeInstruction === "AGENTS.md"
              ? "Repository-wide engineering instructions"
              : `Applies to ${path.relative(repoRoot, current)}/ and descendants`,
        });
      }
      if (current === resolvedRoot) break;
      current = path.dirname(current);
    }
  }

  return Array.from(instructions.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
}

function runGit(args, repoRoot) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    env: { ...process.env, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function parseStatusPaths(rawStatus) {
  const tokens = rawStatus.split("\0");
  const paths = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const status = token.slice(0, 2);
    const filePath = token.slice(3);
    if (filePath) paths.add(filePath);
    if (status.includes("R") || status.includes("C")) {
      const destination = tokens[index + 1];
      if (destination) paths.add(destination);
      index += 1;
    }
  }
  return Array.from(paths).sort();
}

export function checkReviewState(feature, repoRoot) {
  if (
    !feature.ownedPaths ||
    feature.ownedPaths.length === 0 ||
    !fs.existsSync(path.join(repoRoot, ".git"))
  ) {
    return { committed: null, committedUnavailable: null, local: null };
  }

  let local = null;
  try {
    const localPaths = parseStatusPaths(
      runGit(
        [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--",
          ...feature.ownedPaths,
        ],
        repoRoot,
      ),
    );
    if (localPaths.length > 0) {
      local = {
        changedPaths: localPaths,
        reviewedSha: feature.lastReviewedSha,
      };
    }
  } catch {
    // Local status is best-effort and independent from reviewed-SHA availability.
  }

  try {
    runGit(["cat-file", "-e", `${feature.lastReviewedSha}^{commit}`], repoRoot);
    const changedPaths = runGit(
      [
        "diff",
        "--name-only",
        "-z",
        `${feature.lastReviewedSha}..HEAD`,
        "--",
        ...feature.ownedPaths,
      ],
      repoRoot,
    )
      .split("\0")
      .filter(Boolean)
      .sort();
    return {
      committed:
        changedPaths.length > 0
          ? {
              changedPaths,
              reviewedSha: feature.lastReviewedSha,
              reviewedDate: feature.lastReviewedDate,
            }
          : null,
      committedUnavailable: null,
      local,
    };
  } catch {
    return {
      committed: null,
      committedUnavailable: { reviewedSha: feature.lastReviewedSha },
      local,
    };
  }
}

export function checkReviewStaleness(feature, repoRoot) {
  return checkReviewState(feature, repoRoot).committed;
}

function formatFullContext(feature, repoRoot = getRepoRoot(), isAll = false) {
  const lines = [];

  lines.push(
    `================================================================================`,
  );
  lines.push(`FEATURE: ${feature.title} [${feature.id}]`);
  lines.push(
    `================================================================================`,
  );
  lines.push(`Summary: ${feature.summary}`);
  lines.push(
    `Reviewed: ${feature.lastReviewedDate} (SHA: ${feature.lastReviewedSha ? feature.lastReviewedSha.slice(0, 8) : "none"})`,
  );
  if (feature.aliases && feature.aliases.length > 0) {
    lines.push(`Aliases: ${feature.aliases.join(", ")}`);
  }

  // Staleness warning
  const reviewState = checkReviewState(feature, repoRoot);
  if (reviewState.committed) {
    lines.push("");
    lines.push(
      `> [!WARNING] Stale committed review: ${reviewState.committed.changedPaths.length} owned path(s) changed after reviewed SHA ${reviewState.committed.reviewedSha.slice(0, 8)}.`,
    );
  }
  if (reviewState.committedUnavailable) {
    lines.push("");
    lines.push(
      `> [!WARNING] Committed review unavailable: reviewed SHA ${reviewState.committedUnavailable.reviewedSha.slice(0, 8)} is not present in this checkout.`,
    );
  }
  if (reviewState.local) {
    lines.push("");
    lines.push(
      `> [!WARNING] Local review drift: ${reviewState.local.changedPaths.length} owned path(s) have staged, unstaged, or untracked changes.`,
    );
  }

  if (feature.limitations) {
    lines.push("");
    lines.push(`Limitations: ${feature.limitations}`);
  }
  lines.push("");

  // Applicable Nested Instructions
  const nestedInstructions = discoverNestedInstructions(feature, repoRoot);
  if (nestedInstructions.length > 0) {
    lines.push(`--- Applicable Nested Instructions ---`);
    for (const inst of nestedInstructions) {
      lines.push(`  • ${inst.path}: ${inst.reason}`);
    }
    lines.push("");
  }

  // Requirements & Work Items
  if (feature.requirements && feature.requirements.length > 0) {
    lines.push(`--- Requirements & Work Items ---`);
    for (const req of feature.requirements) {
      lines.push(`  • ${req}`);
    }
    lines.push("");
  }

  // Open Acceptance Gates & Findings
  if (feature.openAcceptance && feature.openAcceptance.length > 0) {
    lines.push(`--- Open Acceptance Gates & Findings ---`);
    for (const gate of feature.openAcceptance) {
      lines.push(`  • ${gate}`);
    }
    lines.push("");
  }

  // Prioritized Read List / Entry Points
  lines.push(`--- Primary Entry Points ---`);
  for (const ep of feature.entryPoints || []) {
    lines.push(`  • ${ep}`);
  }
  lines.push("");

  // Architecture & Layers
  lines.push(`--- Implementation Components ---`);
  if (feature.contracts && feature.contracts.length > 0) {
    lines.push(`  Contracts: ${feature.contracts.join(", ")}`);
  }
  if (feature.domainPort && feature.domainPort.length > 0) {
    lines.push(`  Domain / Ports: ${feature.domainPort.join(", ")}`);
  }
  if (feature.api && feature.api.length > 0) {
    lines.push(`  API Routes / Services: ${feature.api.join(", ")}`);
  }
  if (feature.ui && feature.ui.length > 0) {
    lines.push(`  Mobile UI / Hooks: ${feature.ui.join(", ")}`);
  }
  if (feature.adapters && feature.adapters.length > 0) {
    lines.push(`  Adapters: ${feature.adapters.join(", ")}`);
  }
  if (feature.dataTables && feature.dataTables.length > 0) {
    lines.push(`  Database Tables: ${feature.dataTables.join(", ")}`);
  }
  if (feature.migrationPaths && feature.migrationPaths.length > 0) {
    lines.push(`  Migrations: ${feature.migrationPaths.join(", ")}`);
  }
  lines.push("");

  // Relationships
  lines.push(`--- Direct Relationships ---`);
  if (feature.relations && feature.relations.length > 0) {
    for (const rel of feature.relations) {
      lines.push(`  • [${rel.type}] -> ${rel.target}: ${rel.reason}`);
    }
  } else {
    lines.push(`  (None)`);
  }
  lines.push("");

  // Documentation & Patterns
  lines.push(`--- Documentation, Decisions & Patterns ---`);
  if (feature.docs && feature.docs.length > 0) {
    for (const doc of feature.docs) {
      lines.push(`  • ${doc}`);
    }
  } else {
    lines.push(`  (None)`);
  }
  lines.push("");

  // Tests & Verification
  lines.push(`--- Relevant Tests & Advisory Checks ---`);
  if (feature.tests && feature.tests.length > 0) {
    for (const t of feature.tests) {
      lines.push(`  Test: ${t}`);
    }
  }
  if (feature.verificationCommands && feature.verificationCommands.length > 0) {
    for (const cmd of feature.verificationCommands) {
      lines.push(`  Command: ${cmd}`);
    }
  }
  lines.push("");

  // Bound output if needed (target <= 120 lines)
  const MAX_LINES = 115;
  if (!isAll && lines.length > MAX_LINES) {
    const omittedCount = lines.length - MAX_LINES;
    const truncated = lines.slice(0, MAX_LINES);
    truncated.push(
      `... [Truncated ${omittedCount} lines. Use --all or --json to view complete output]`,
    );
    return truncated.join("\n");
  }

  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let repoRoot;
  let mapData;
  try {
    repoRoot = getRepoRoot();
    mapData = loadFeatureMap(repoRoot);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (args.includes("--list")) {
    listFeatures(mapData);
    process.exit(0);
  }

  const isJson = args.includes("--json");
  const isAll = args.includes("--all");
  const values = new Map();
  const positionals = [];
  const switches = new Set([
    "--list",
    "--json",
    "--all",
    "--no-cache",
    "--help",
    "-h",
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--query", "--path", "--symbol", "--budget-bytes"].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) {
        console.error(`Error: ${arg} requires a value.`);
        process.exit(1);
      }
      values.set(arg, args[++i]);
    } else if (!arg.startsWith("-")) positionals.push(arg);
    else if (!switches.has(arg)) {
      console.error(`Error: Unknown option '${arg}'.`);
      process.exit(1);
    }
  }
  if (positionals.length > 1) {
    console.error("Error: Use --query for a task description.");
    process.exit(1);
  }
  const featureQuery = positionals[0];
  const budgetBytes = values.has("--budget-bytes")
    ? Number(values.get("--budget-bytes"))
    : 8192;
  if (
    !Number.isSafeInteger(budgetBytes) ||
    budgetBytes < 2048 ||
    budgetBytes > 1048576
  ) {
    console.error(
      "Error: --budget-bytes must be an integer between 2048 and 1048576.",
    );
    process.exit(1);
  }
  const taskSelection = ["--query", "--path", "--symbol"].some((option) =>
    values.has(option),
  );

  if (taskSelection) {
    try {
      const packet = createTaskPacket(repoRoot, {
        feature: featureQuery,
        query: values.get("--query"),
        path: values.get("--path"),
        symbol: values.get("--symbol"),
        cache: !args.includes("--no-cache"),
      });
      packet.instructions = discoverNestedInstructions(
        { entryPoints: packet.files.map((file) => file.path) },
        repoRoot,
      );
      packet.reviewStates = packet.features.map((feature) => ({
        id: feature.id,
        ...checkReviewState(feature, repoRoot),
      }));
      console.log(
        isJson
          ? JSON.stringify(packet, null, 2)
          : renderTaskPacket(packet, { budgetBytes, all: isAll }),
      );
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
    return;
  }

  if (!featureQuery) {
    console.error("Error: Please specify a feature ID or alias.");
    printUsage();
    process.exit(1);
  }

  const lookup = findFeature(mapData, featureQuery);

  if (!lookup.found) {
    console.error(
      `Error: Unknown feature '${featureQuery}'. Feature was not found in docs/feature-map.json.`,
    );
    if (lookup.suggestions && lookup.suggestions.length > 0) {
      console.error("");
      console.error("Did you mean one of these?");
      for (const s of lookup.suggestions) {
        const suggestion = mapData.featuresById.get(s);
        console.error(
          suggestion
            ? `  • ${suggestion.id} (${suggestion.title})`
            : `  • ${s}`,
        );
      }
    }
    console.error("");
    console.error("Run 'pnpm context --list' to see all available features.");
    process.exit(1);
  }

  const feature = lookup.feature;
  const assertIntentSnapshot = (packet) => {
    if (
      createHash("sha256").update(JSON.stringify(mapData.raw)).digest("hex") !==
      packet.intentHash
    )
      throw new Error(
        "Feature intent changed during context selection. Retry after writes settle.",
      );
  };

  if (isJson) {
    const packet = createTaskPacket(repoRoot, {
      feature: feature.id,
      cache: !args.includes("--no-cache"),
    });
    assertIntentSnapshot(packet);
    const reviewState = checkReviewState(feature, repoRoot);
    const outputObj = {
      feature,
      nestedInstructions: discoverNestedInstructions(feature, repoRoot),
      reviewState,
      reviewStaleness: reviewState.committed,
      discovery: packet,
    };
    console.log(JSON.stringify(outputObj, null, 2));
  } else {
    const packet = createTaskPacket(repoRoot, {
      feature: feature.id,
      cache: !args.includes("--no-cache"),
    });
    assertIntentSnapshot(packet);
    console.log(
      formatContext(feature, repoRoot, isAll, {
        budgetBytes,
        discovery: packet,
      }),
    );
  }
}

export function formatContext(
  feature,
  repoRoot = getRepoRoot(),
  isAll = false,
  options = {},
) {
  if (isAll) return formatFullContext(feature, repoRoot, true);
  return renderFeaturePacket(feature, {
    ...options,
    instructions: discoverNestedInstructions(feature, repoRoot),
    reviewState: checkReviewState(feature, repoRoot),
  });
}

// Guard main execution: only execute when run directly as CLI
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
