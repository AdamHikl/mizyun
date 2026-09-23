#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadFeatureMap,
  classifyFeaturesForPath,
  getRepoRoot,
} from "./feature-map.mjs";

function runGit(args, cwd, env = process.env) {
  try {
    return execFileSync("git", args, {
      cwd,
      env: { ...env, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1" },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  }
}

function parseNulDelimitedDiff(rawOutput) {
  // Output format from `git diff-tree -z --name-status -r` or `git diff -z --name-status`
  // Status, path, or for R/C: Status, oldPath, newPath
  const tokens = rawOutput.split("\0").filter((t) => t.length > 0);
  const changedFiles = new Set();

  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i];
    if (!status) {
      i++;
      continue;
    }
    const statusCode = status[0];
    if (statusCode === "R" || statusCode === "C") {
      // Renamed or copied: next two tokens are oldPath and newPath
      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (oldPath) changedFiles.add(oldPath);
      if (newPath) changedFiles.add(newPath);
      i += 3;
    } else {
      const filePath = tokens[i + 1];
      if (filePath) changedFiles.add(filePath);
      i += 2;
    }
  }

  return Array.from(changedFiles);
}

function getChangedFiles(repoRoot, sinceRef) {
  const headSha = runGit(["rev-parse", "HEAD"], repoRoot).trim();
  let baseSha = null;

  if (sinceRef) {
    try {
      baseSha = runGit(["merge-base", sinceRef, "HEAD"], repoRoot).trim();
    } catch (err) {
      throw new Error(
        `Cannot find merge-base between '${sinceRef}' and HEAD: ${err.message}`,
      );
    }
  }

  const fileSet = new Set();

  // 1. Committed diff if baseSha is known
  if (baseSha && baseSha !== headSha) {
    const committedOutput = runGit(
      [
        "diff-tree",
        "-z",
        "--name-status",
        "-r",
        "--no-commit-id",
        baseSha,
        headSha,
      ],
      repoRoot,
    );
    for (const f of parseNulDelimitedDiff(committedOutput)) {
      fileSet.add(f);
    }
  }

  // 2. Staged changes
  const stagedOutput = runGit(
    ["diff", "--cached", "-z", "--name-status"],
    repoRoot,
  );
  for (const f of parseNulDelimitedDiff(stagedOutput)) {
    fileSet.add(f);
  }

  // 3. Unstaged tracked changes
  const unstagedOutput = runGit(["diff", "-z", "--name-status"], repoRoot);
  for (const f of parseNulDelimitedDiff(unstagedOutput)) {
    fileSet.add(f);
  }

  // 4. Untracked non-ignored files
  const untrackedOutput = runGit(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    repoRoot,
  );
  const untrackedTokens = untrackedOutput
    .split("\0")
    .filter((t) => t.length > 0);
  for (const f of untrackedTokens) {
    fileSet.add(f);
  }

  return {
    headSha,
    baseSha,
    files: Array.from(fileSet).sort(),
    hasLocalChanges:
      stagedOutput.length > 0 ||
      unstagedOutput.length > 0 ||
      untrackedTokens.length > 0,
  };
}

const SENSITIVE_OR_IGNORED_PATTERNS = [
  /^\.git\//,
  /^node_modules\//,
  /\.env(\..+)?$/,
  /\.(pem|key|crt)$/,
  /^dist\//,
  /^\.expo\//,
  /\.log$/,
];

function isPermittedPath(filePath) {
  for (const pat of SENSITIVE_OR_IGNORED_PATTERNS) {
    if (pat.test(filePath)) return false;
  }
  return true;
}

export function loadWorkspacePackages(repoRoot) {
  const packages = new Map(); // pkgName -> { name, relDir, deps: Set }
  const dirToPkg = new Map(); // relDir -> pkgName

  const searchDirs = [
    "packages",
    "packages/adapters",
    "packages/providers",
    "apps",
  ];
  for (const sDir of searchDirs) {
    const fullSearchDir = path.join(repoRoot, sDir);
    if (!fs.existsSync(fullSearchDir)) continue;
    const entries = fs.readdirSync(fullSearchDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const pkgJsonPath = path.join(fullSearchDir, ent.name, "package.json");
        if (fs.existsSync(pkgJsonPath)) {
          try {
            const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
            const relDir = path.relative(
              repoRoot,
              path.join(fullSearchDir, ent.name),
            );
            const deps = new Set([
              ...Object.keys(pkgJson.dependencies || {}),
              ...Object.keys(pkgJson.devDependencies || {}),
            ]);
            packages.set(pkgJson.name, {
              name: pkgJson.name,
              relDir,
              deps,
            });
            dirToPkg.set(relDir, pkgJson.name);
          } catch {
            // Ignore invalid package.json
          }
        }
      }
    }
  }

  // Reverse dependencies: pkgName -> Set<consumerPkgName>
  const reverseDeps = new Map();
  for (const [consumerName, info] of packages.entries()) {
    for (const depName of info.deps) {
      if (packages.has(depName)) {
        if (!reverseDeps.has(depName)) reverseDeps.set(depName, new Set());
        reverseDeps.get(depName).add(consumerName);
      }
    }
  }

  return { packages, dirToPkg, reverseDeps };
}

function findPackageForFile(file, dirToPkg) {
  // Find longest matching directory prefix
  let matchedPkg = null;
  let matchedLen = 0;
  for (const [relDir, pkgName] of dirToPkg.entries()) {
    if (file === relDir || file.startsWith(relDir + "/")) {
      if (relDir.length > matchedLen) {
        matchedLen = relDir.length;
        matchedPkg = pkgName;
      }
    }
  }
  return matchedPkg;
}

function findFeaturesForPackage(pkgInfo, mapData) {
  const matched = new Set();
  const pkgDir = pkgInfo.relDir;

  for (const feat of mapData.features) {
    const allPaths = [
      ...(feat.ownedPaths || []),
      ...(feat.entryPoints || []),
      ...(feat.contracts || []),
      ...(feat.domainPort || []),
      ...(feat.api || []),
      ...(feat.ui || []),
      ...(feat.adapters || []),
      ...(feat.tests || []),
    ];
    for (const p of allPaths) {
      if (p === pkgDir || p.startsWith(pkgDir + "/")) {
        matched.add(feat.id);
        break;
      }
    }
  }
  return Array.from(matched);
}

export function analyzeImpact(repoRoot, sinceRef) {
  const mapData = loadFeatureMap(repoRoot);
  const gitInfo = getChangedFiles(repoRoot, sinceRef);
  const ws = loadWorkspacePackages(repoRoot);

  const directImpacts = new Map(); // featureId -> { feature, files: [], signals: Set }
  const referencedImpacts = new Map(); // featureId -> { feature, files: [], signal }
  const propagatedImpacts = new Map(); // featureId -> { feature, reasonChain: string, signal: string }
  const unmappedFiles = [];

  for (const file of gitInfo.files) {
    if (!isPermittedPath(file)) continue;

    const { owners, consumers } = classifyFeaturesForPath(mapData, file);

    if (owners.length > 0 || consumers.length > 0) {
      for (const feat of owners) {
        if (!directImpacts.has(feat.id)) {
          directImpacts.set(feat.id, {
            feature: feat,
            files: [],
            signals: new Set(["direct-owner", "direct-ownership"]),
          });
        }
        const impact = directImpacts.get(feat.id);
        impact.signals.add("direct-owner");
        impact.signals.add("direct-ownership");
        if (!impact.files.includes(file)) impact.files.push(file);
      }
      for (const feat of consumers) {
        if (!referencedImpacts.has(feat.id)) {
          referencedImpacts.set(feat.id, {
            feature: feat,
            files: [],
            signal: "referenced-consumer",
          });
        }
        const impact = referencedImpacts.get(feat.id);
        if (!impact.files.includes(file)) impact.files.push(file);
      }
    } else {
      unmappedFiles.push(file);
    }

    // Also trace package-level reverse dependencies
    const producerPkgName = findPackageForFile(file, ws.dirToPkg);
    if (producerPkgName && ws.reverseDeps.has(producerPkgName)) {
      const consumers = ws.reverseDeps.get(producerPkgName);
      for (const consumerPkgName of consumers) {
        const consumerInfo = ws.packages.get(consumerPkgName);
        if (consumerInfo) {
          const consumerFeatures = findFeaturesForPackage(
            consumerInfo,
            mapData,
          );
          for (const cfId of consumerFeatures) {
            if (
              !directImpacts.has(cfId) &&
              !referencedImpacts.has(cfId) &&
              !propagatedImpacts.has(cfId)
            ) {
              const cfFeat = mapData.featuresById.get(cfId);
              if (cfFeat) {
                propagatedImpacts.set(cfId, {
                  feature: cfFeat,
                  reasonChain: `${file} -> ${producerPkgName} -> ${consumerPkgName} -> ${cfId}`,
                  signal: "package-reverse-dep",
                });
              }
            }
          }
        }
      }
    }
  }

  // Forward semantic affects propagation from directImpacts and reverseImpacts
  const queue = [
    ...Array.from(directImpacts.keys()),
    ...Array.from(referencedImpacts.keys()),
    ...Array.from(propagatedImpacts.keys()),
  ];
  const visited = new Set(queue);

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentFeature = mapData.featuresById.get(currentId);
    if (!currentFeature) continue;

    for (const rel of currentFeature.relations || []) {
      if (rel.type === "affects") {
        const targetFeat = mapData.featuresById.get(rel.target);
        if (targetFeat && !visited.has(rel.target)) {
          visited.add(rel.target);
          propagatedImpacts.set(rel.target, {
            feature: targetFeat,
            reasonChain: `${currentId} -> [affects] ${rel.target} (${rel.reason})`,
            signal: "semantic-affects",
          });
          queue.push(rel.target);
        }
      }
    }
  }

  // Collect suggested tests & commands
  const suggestedTests = new Set();
  const suggestedCommands = new Set();

  const allAffected = [
    ...Array.from(directImpacts.values()).map((v) => v.feature),
    ...Array.from(referencedImpacts.values()).map((v) => v.feature),
    ...Array.from(propagatedImpacts.values()).map((v) => v.feature),
  ];

  for (const feat of allAffected) {
    for (const t of feat.tests || []) suggestedTests.add(t);
    for (const c of feat.verificationCommands || []) suggestedCommands.add(c);
  }

  return {
    git: {
      headSha: gitInfo.headSha,
      baseSha: gitInfo.baseSha,
      hasLocalChanges: gitInfo.hasLocalChanges,
      totalFilesChanged: gitInfo.files.length,
    },
    directImpacts: Array.from(directImpacts.values()).map((v) => ({
      id: v.feature.id,
      title: v.feature.title,
      signals: Array.from(v.signals),
      changedFiles: v.files,
    })),
    referencedImpacts: Array.from(referencedImpacts.values()).map((v) => ({
      id: v.feature.id,
      title: v.feature.title,
      signal: v.signal,
      changedFiles: v.files,
    })),
    propagatedImpacts: Array.from(propagatedImpacts.values()).map((v) => ({
      id: v.feature.id,
      title: v.feature.title,
      signal: v.signal,
      reasonChain: v.reasonChain,
    })),
    unmappedFiles,
    suggestedTests: Array.from(suggestedTests).sort(),
    suggestedCommands: Array.from(suggestedCommands).sort(),
  };
}

export function printTextReport(report) {
  console.log(
    "================================================================================",
  );
  console.log("MIZYUN ADVISORY IMPACT ANALYSIS");
  console.log(
    "================================================================================",
  );
  console.log(
    `Comparison base: ${
      report.git.baseSha ? `${report.git.baseSha.slice(0, 8)} -> ` : ""
    }HEAD (${report.git.headSha.slice(0, 8)})`,
  );
  console.log(
    `Includes local changes: ${
      report.git.hasLocalChanges ? "YES (staged/unstaged/untracked)" : "NO"
    }`,
  );
  console.log(`Total changed files: ${report.git.totalFilesChanged}`);
  console.log("");

  console.log("--- Directly Affected Features ---");
  if (report.directImpacts.length > 0) {
    for (const imp of report.directImpacts) {
      console.log(`  • ${imp.title} [${imp.id}] (${imp.signals.join(", ")})`);
      for (const f of imp.changedFiles.slice(0, 5)) {
        console.log(`      - ${f}`);
      }
      if (imp.changedFiles.length > 5) {
        console.log(
          `      ... and ${imp.changedFiles.length - 5} more file(s)`,
        );
      }
    }
  } else {
    console.log("  (None detected)");
  }
  console.log("");

  console.log("--- Referenced Consumers ---");
  if (report.referencedImpacts.length > 0) {
    for (const imp of report.referencedImpacts) {
      console.log(`  • ${imp.title} [${imp.id}] [${imp.signal}]`);
      for (const f of imp.changedFiles.slice(0, 5)) console.log(`      - ${f}`);
      if (imp.changedFiles.length > 5) {
        console.log(
          `      ... and ${imp.changedFiles.length - 5} more file(s)`,
        );
      }
    }
  } else {
    console.log("  (None detected)");
  }
  console.log("");

  console.log("--- Propagated Downstream Impacts ---");
  if (report.propagatedImpacts.length > 0) {
    for (const imp of report.propagatedImpacts) {
      console.log(`  • ${imp.title} [${imp.id}] [${imp.signal}]`);
      console.log(`      Reason: ${imp.reasonChain}`);
    }
  } else {
    console.log("  (None detected)");
  }
  console.log("");

  if (report.unmappedFiles.length > 0) {
    console.log(
      `--- Unmapped Permitted Files (${report.unmappedFiles.length}) ---`,
    );
    for (const uf of report.unmappedFiles.slice(0, 8)) {
      console.log(`  ? ${uf}`);
    }
    if (report.unmappedFiles.length > 8) {
      console.log(`  ... and ${report.unmappedFiles.length - 8} more`);
    }
    console.log("");
  }

  console.log("--- Advisory Verification Commands ---");
  if (report.suggestedCommands.length > 0) {
    for (const cmd of report.suggestedCommands) {
      console.log(`  • ${cmd}`);
    }
  } else {
    console.log("  Run standard verification: pnpm check");
  }
  console.log("");
  console.log(
    "Note: Impact results and commands are advisory. They do NOT waive pnpm check or release gates.",
  );
}

function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");

  let sinceRef = "HEAD";
  const sinceIdx = args.indexOf("--since");
  if (
    sinceIdx !== -1 &&
    args[sinceIdx + 1] &&
    !args[sinceIdx + 1].startsWith("--")
  ) {
    sinceRef = args[sinceIdx + 1];
  } else if (sinceIdx !== -1) {
    console.error(
      "Error: --since requires a git ref (e.g. --since origin/main)",
    );
    process.exit(1);
  }

  let repoRoot;
  try {
    repoRoot = getRepoRoot();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  try {
    const report = analyzeImpact(repoRoot, sinceRef);
    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report);
    }
  } catch (err) {
    console.error(`Impact analysis failed: ${err.message}`);
    process.exit(1);
  }
}

// Guard main execution: only execute when run directly as CLI
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
