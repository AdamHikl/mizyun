#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadFeatureMap,
  classifyFeaturesForPath,
  getRepoRoot,
} from "./feature-map.mjs";
import { getRepositoryIndex } from "./repository-index.mjs";

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
    .filter((t) => t.length > 0 && !t.startsWith(".cache/mizyun-navigation/"));
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

export function loadWorkspacePackages(
  repoRoot,
  index = getRepositoryIndex(repoRoot),
) {
  const packages = new Map();
  const dirToPkg = new Map();
  for (const pkg of index.packages) {
    packages.set(pkg.name, {
      name: pkg.name,
      relDir: pkg.path,
      deps: new Set(pkg.dependencies),
    });
    dirToPkg.set(pkg.path, pkg.name);
  }
  const reverseDeps = new Map();
  for (const [consumerName, info] of packages) {
    for (const depName of info.deps) {
      if (!packages.has(depName)) continue;
      if (!reverseDeps.has(depName)) reverseDeps.set(depName, new Set());
      reverseDeps.get(depName).add(consumerName);
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

const GRAPH_LIMITS = { maxStates: 10000, maxDepth: 64 };

function missingRelativeCandidates(file, specifier) {
  if (!specifier?.startsWith(".")) return [];
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(file), specifier),
  );
  const candidates = [base];
  const ext = path.posix.extname(base);
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    const stem = base.slice(0, -ext.length);
    candidates.push(
      ...[".ts", ".tsx", ".mts", ".cts"].map((suffix) => stem + suffix),
    );
  }
  if (!ext) {
    for (const suffix of [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".mts",
      ".cts",
    ]) {
      candidates.push(base + suffix, `${base}/index${suffix}`);
    }
  }
  return candidates;
}

function traceSourceImpacts(index, changedFiles) {
  const reverse = new Map();
  const addEdge = (edge) => {
    if (!isPermittedPath(edge.from) || !isPermittedPath(edge.to)) return;
    if (!reverse.has(edge.to)) reverse.set(edge.to, []);
    reverse.get(edge.to).push(edge);
  };
  for (const edge of index.edges) addEdge(edge);
  const indexed = new Set(index.files.map((file) => file.path));
  const missingChanged = new Set(
    changedFiles.filter((file) => !indexed.has(file)),
  );
  for (const file of index.files) {
    for (const imported of file.imports || []) {
      // Inspect every import, including those that currently resolve to a
      // fallback. A vanished higher-priority module may have changed meaning.
      for (const candidate of imported.candidates ||
        missingRelativeCandidates(file.path, imported.specifier)) {
        if (!missingChanged.has(candidate)) continue;
        addEdge({
          from: file.path,
          to: candidate,
          specifier: imported.specifier,
          line: imported.line,
          typeOnly: !!imported.typeOnly,
          unresolved: true,
        });
      }
    }
  }
  const queue = changedFiles.slice(0, GRAPH_LIMITS.maxStates).map((file) => ({
    file,
    origin: file,
    edges: [],
    typeOnly: false,
    unresolved: false,
  }));
  const visited = new Set(
    queue.map((state) => `${state.file}:runtime:resolved`),
  );
  const impacts = new Map();
  let truncated = changedFiles.length > GRAPH_LIMITS.maxStates;
  let cursor = 0;
  while (cursor < queue.length) {
    const state = queue[cursor++];
    const edges = reverse.get(state.file) || [];
    if (state.edges.length >= GRAPH_LIMITS.maxDepth && edges.length) {
      truncated = true;
      continue;
    }
    for (const edge of edges) {
      const typeOnly = state.typeOnly || edge.typeOnly;
      const mode = typeOnly ? "type-only" : "runtime";
      const conservative = state.unresolved || !!edge.unresolved;
      const key = `${edge.from}:${mode}:${conservative ? "unresolved" : "resolved"}`;
      if (visited.has(key)) continue;
      if (visited.size >= GRAPH_LIMITS.maxStates) {
        truncated = true;
        continue;
      }
      visited.add(key);
      const next = {
        file: edge.from,
        origin: state.origin,
        edges: [...state.edges, edge],
        typeOnly,
        unresolved: conservative,
      };
      queue.push(next);
      if (!impacts.has(next.file))
        impacts.set(next.file, {
          path: next.file,
          signals: new Set(),
          reasons: [],
        });
      const impact = impacts.get(next.file);
      impact.signals.add(typeOnly ? "type-import" : "runtime-import");
      if (next.unresolved) impact.signals.add("unresolved-import");
      impact.reasons.push({
        origin: next.origin,
        signal: mode,
        conservative: next.unresolved,
        reasonChain: [next.origin, ...next.edges.map((item) => item.from)].join(
          " -> ",
        ),
        edges: next.edges,
      });
    }
  }
  return {
    impacts: Array.from(impacts.values(), (impact) => ({
      ...impact,
      signals: [...impact.signals],
    })),
    traversal: { ...GRAPH_LIMITS, visitedStates: visited.size, truncated },
  };
}

function isTestPath(file) {
  return /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)|(?:\.|-)(?:test|spec)\.[cm]?[jt]sx?$/.test(
    file,
  );
}

function configurationScope(file, index, ws) {
  if (
    !/(?:^|\/)(?:package\.json|app\.json|eas\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|tsconfig[^/]*\.json|(?:babel|metro|jest|vitest|vite|eslint|prettier|app)\.config\.[^/]+)$/.test(
      file,
    )
  )
    return null;
  const pkg = findPackageForFile(file, ws.dirToPkg);
  const scope = pkg ? ws.packages.get(pkg).relDir : ".";
  const files = index.files
    .filter(
      (entry) =>
        /\.[cm]?[jt]sx?$/.test(entry.path) &&
        (scope === "." || entry.path.startsWith(scope + "/")),
    )
    .map((entry) => entry.path);
  return {
    path: file,
    scope,
    signal: "configuration-scope",
    coarse: true,
    impactedFiles: files.slice(0, GRAPH_LIMITS.maxStates),
    totalScopedFiles: files.length,
    truncated: files.length > GRAPH_LIMITS.maxStates,
  };
}

export function analyzeImpact(repoRoot, sinceRef = "HEAD", options = {}) {
  const mapPath = path.join(repoRoot, "docs/feature-map.json");
  const mapHash = () =>
    crypto.createHash("sha256").update(fs.readFileSync(mapPath)).digest("hex");
  const initialMapHash = mapHash();
  const mapData = loadFeatureMap(repoRoot);
  const gitInfo = getChangedFiles(repoRoot, sinceRef);
  const index = getRepositoryIndex(repoRoot, { cache: true });
  if (
    mapHash() !== initialMapHash ||
    index.files.find((file) => file.path === "docs/feature-map.json")?.hash !==
      initialMapHash ||
    index.snapshot.headSha !== gitInfo.headSha
  ) {
    throw new Error(
      "Repository changed during impact capture; retry on a stable working tree.",
    );
  }
  const ws = loadWorkspacePackages(repoRoot, index);
  const explicitPaths = options.paths || (options.path ? [options.path] : []);
  const analyzedFiles = [
    ...new Set([
      ...gitInfo.files,
      ...explicitPaths.map((file) => {
        const relative = path
          .relative(repoRoot, path.resolve(repoRoot, file))
          .split(path.sep)
          .join("/");
        if (relative === ".." || relative.startsWith("../") || !relative)
          throw new Error(`Path must be inside the repository: ${file}`);
        return relative;
      }),
    ]),
  ].sort();
  const permittedFiles = analyzedFiles.filter(isPermittedPath);
  const source = traceSourceImpacts(index, permittedFiles);
  const configurationImpacts = permittedFiles
    .map((file) => configurationScope(file, index, ws))
    .filter(Boolean);

  const directImpacts = new Map(); // featureId -> { feature, files: [], signals: Set }
  const referencedImpacts = new Map(); // featureId -> { feature, files: [], signal }
  const propagatedImpacts = new Map(); // featureId -> { feature, reasonChain: string, signal: string }
  const unmappedFiles = [];

  for (const file of analyzedFiles) {
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
  }

  // Source importers are concrete file signals, even within a single package
  // and even when the feature manifest has no relation or ownership entry.
  for (const impact of source.impacts) {
    const { owners, consumers } = classifyFeaturesForPath(mapData, impact.path);
    for (const feat of [...owners, ...consumers]) {
      if (directImpacts.has(feat.id) || referencedImpacts.has(feat.id))
        continue;
      if (!propagatedImpacts.has(feat.id)) {
        propagatedImpacts.set(feat.id, {
          feature: feat,
          signal: "source-reverse-dep",
          signals: new Set(),
          reasons: [],
          files: [],
        });
      }
      const target = propagatedImpacts.get(feat.id);
      impact.signals.forEach((signal) => target.signals.add(signal));
      target.reasons.push(...impact.reasons);
      target.files.push(impact.path);
      target.reasonChain ||= impact.reasons[0].reasonChain;
    }
  }

  // Manifests are a coarse fallback: a declared dependency alone does not
  // prove an import or a file-level impact. Preserve it as a separate signal.
  for (const file of permittedFiles) {
    const producer = findPackageForFile(file, ws.dirToPkg);
    if (!producer) continue;
    const queue = [{ name: producer, chain: [file, producer] }];
    const visited = new Set([producer]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      for (const consumer of ws.reverseDeps.get(current.name) || []) {
        if (visited.has(consumer)) continue;
        visited.add(consumer);
        const chain = [...current.chain, consumer];
        queue.push({ name: consumer, chain });
        for (const id of findFeaturesForPackage(
          ws.packages.get(consumer),
          mapData,
        )) {
          if (
            directImpacts.has(id) ||
            referencedImpacts.has(id) ||
            propagatedImpacts.has(id)
          )
            continue;
          propagatedImpacts.set(id, {
            feature: mapData.featuresById.get(id),
            signal: "package-reverse-dep",
            coarse: true,
            reasonChain: `${chain.join(" -> ")} -> ${id} (coarse package-manifest fallback)`,
          });
        }
      }
    }
  }

  for (const config of configurationImpacts) {
    for (const file of config.impactedFiles) {
      const { owners, consumers } = classifyFeaturesForPath(mapData, file);
      for (const feat of [...owners, ...consumers]) {
        if (
          directImpacts.has(feat.id) ||
          referencedImpacts.has(feat.id) ||
          propagatedImpacts.has(feat.id)
        )
          continue;
        propagatedImpacts.set(feat.id, {
          feature: feat,
          signal: "configuration-scope",
          coarse: true,
          reasonChain: `${config.path} -> ${config.scope} configuration scope -> ${file}`,
        });
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
            reasonChain: `${propagatedImpacts.get(currentId)?.reasonChain || directImpacts.get(currentId)?.files[0] || referencedImpacts.get(currentId)?.files[0] || currentId} -> ${currentId} -> [affects] ${rel.target} (${rel.reason})`,
            signal: "semantic-affects",
          });
          queue.push(rel.target);
        }
      }
    }
  }

  // Collect suggested tests & commands
  const suggestedTests = new Set(
    [
      ...permittedFiles,
      ...source.impacts.map((impact) => impact.path),
      ...configurationImpacts.flatMap((impact) => impact.impactedFiles),
    ].filter(isTestPath),
  );
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

  const report = {
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
      ...(v.coarse ? { coarse: true } : {}),
      ...(v.signals
        ? {
            signals: [...v.signals],
            impactedFiles: v.files,
            reasons: v.reasons,
          }
        : {}),
    })),
    unmappedFiles,
    analyzedFiles: permittedFiles,
    sourceImpacts: source.impacts,
    configurationImpacts,
    coverage: {
      snapshot: index.snapshot,
      traversal: source.traversal,
      reasonPolicy:
        "Shortest complete chain per reached file, type/runtime and resolved/conservative signal; alternate origins and paths are not enumerated.",
      unresolvedImports: index.unresolved,
      unmappedImpactedFiles: source.impacts
        .map((impact) => impact.path)
        .filter((file) => {
          const { owners, consumers } = classifyFeaturesForPath(mapData, file);
          return !owners.length && !consumers.length;
        }),
      excludedChangedFiles: analyzedFiles.filter(
        (file) => !isPermittedPath(file),
      ),
      unindexedChangedFiles: permittedFiles.filter(
        (file) => !index.files.some((indexed) => indexed.path === file),
      ),
      warnings: [
        ...index.warnings,
        "Static source and package-manifest signals are advisory; dynamic imports, generated code, configuration and runtime behavior may be incomplete.",
        ...(source.traversal.truncated
          ? [
              "Source traversal reached its bound; inspect omitted downstream paths manually.",
            ]
          : []),
      ],
    },
    suggestedTests: Array.from(suggestedTests).sort(),
    suggestedCommands: Array.from(suggestedCommands).sort(),
  };
  const finalIndex = getRepositoryIndex(repoRoot, { cache: true });
  if (
    finalIndex.snapshot.id !== index.snapshot.id ||
    mapHash() !== initialMapHash ||
    JSON.stringify(getChangedFiles(repoRoot, sinceRef)) !==
      JSON.stringify(gitInfo)
  ) {
    throw new Error(
      "Repository changed during impact capture; retry on a stable working tree.",
    );
  }
  return report;
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

  console.log(
    `--- Source Import Impacts (${report.sourceImpacts?.length || 0}) ---`,
  );
  for (const impact of (report.sourceImpacts || []).slice(0, 15)) {
    console.log(`  • ${impact.path} [${impact.signals.join(", ")}]`);
    for (const reason of impact.reasons)
      console.log(`      ${reason.reasonChain}`);
  }
  if ((report.sourceImpacts?.length || 0) > 15)
    console.log(
      `  ... ${report.sourceImpacts.length - 15} more source impact(s); use --json for complete results.`,
    );
  for (const config of report.configurationImpacts || [])
    console.log(
      `  Configuration: ${config.path} -> ${config.scope} (${config.totalScopedFiles} scoped files; coarse).`,
    );
  console.log(
    `Coverage: ${report.coverage?.unresolvedImports.length || 0} unresolved imports; ${report.coverage?.unmappedImpactedFiles.length || 0} unmapped impacted files.`,
  );
  for (const warning of report.coverage?.warnings || [])
    console.log(`  Warning: ${warning}`);
  console.log("");
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
    const paths = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] !== "--path") continue;
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error("--path requires a repository file path");
      paths.push(args[++i]);
    }
    const report = analyzeImpact(repoRoot, sinceRef, { paths });
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
