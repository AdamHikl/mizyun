#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadFeatureMap, findFeature, getRepoRoot } from "./feature-map.mjs";

function printUsage() {
  console.log(`Mizyun Developer Feature Context CLI

Usage:
  pnpm context --list                List all mapped features
  pnpm context <feature-id>          Display focused context for a feature
  pnpm context <feature-id> --json   Output structured machine-readable JSON
  pnpm context <feature-id> --all    Display complete untruncated context

Options:
  --list       List all mapped features with title and aliases
  --json       Output raw JSON representation
  --all        Do not truncate output to 120 lines
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

export function formatContext(
  feature,
  repoRoot = getRepoRoot(),
  isAll = false,
) {
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
  const featureQuery = args.find((a) => !a.startsWith("--"));

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

  if (isJson) {
    const reviewState = checkReviewState(feature, repoRoot);
    const outputObj = {
      feature,
      nestedInstructions: discoverNestedInstructions(feature, repoRoot),
      reviewState,
      reviewStaleness: reviewState.committed,
    };
    console.log(JSON.stringify(outputObj, null, 2));
  } else {
    console.log(formatContext(feature, repoRoot, isAll));
  }
}

// Guard main execution: only execute when run directly as CLI
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
