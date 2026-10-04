#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { getRepositoryIndex } from "./repository-index.mjs";
import {
  loadFeatureMap,
  getFeaturesForPath,
  getRepoRoot,
} from "./feature-map.mjs";
import { checkReviewState } from "./context.mjs";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
]);
const COVERAGE_ROOTS = ["apps", "packages", "scripts"];
const COVERAGE_EXEMPTIONS = [
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|coverage|\.expo)\//,
  /(^|\/)generated\//,
  /(^|\/)__snapshots__\//,
  /\.d\.ts$/,
];

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function extractHeadings(markdownContent) {
  const headings = new Set();
  const slugCounts = new Map();
  const lines = markdownContent.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Check for markdown headings # ... ######
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      // Remove inline links or code formatting from heading
      const cleanHeading = headingMatch[1]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();
      const baseSlug = slugifyHeading(cleanHeading);
      if (baseSlug) {
        const count = slugCounts.get(baseSlug) || 0;
        const slugWithCount = count === 0 ? baseSlug : `${baseSlug}-${count}`;
        slugCounts.set(baseSlug, count + 1);
        headings.add(slugWithCount);
        headings.add(baseSlug);
      }
    }

    // Check for explicit HTML anchors <a name="foo"> or <a id="foo">
    const anchorRegex = /<a\s+(?:name|id)=["']([^"']+)["']/gi;
    let anchorMatch;
    while ((anchorMatch = anchorRegex.exec(line)) !== null) {
      headings.add(anchorMatch[1].toLowerCase());
      headings.add(anchorMatch[1]);
    }
  }

  return headings;
}

export function validateFeatureMapStructure(repoRoot) {
  const errors = [];
  const warnings = [];

  let mapData;
  try {
    mapData = loadFeatureMap(repoRoot);
  } catch (err) {
    errors.push(`Feature map loading error: ${err.message}`);
    return { errors, warnings };
  }

  if (mapData.schemaVersion !== 1) {
    errors.push(
      `Invalid schemaVersion: expected 1, got ${mapData.schemaVersion}`,
    );
  }

  const featureIds = new Set(mapData.features.map((f) => f.id));
  const realRepoRoot = fs.existsSync(repoRoot)
    ? fs.realpathSync(repoRoot)
    : repoRoot;

  // Track covered directories
  const coveredMobileDirs = new Set();
  const coveredApiDirs = new Set();

  for (const feature of mapData.features) {
    // Check required fields
    const required = [
      "id",
      "title",
      "summary",
      "aliases",
      "entryPoints",
      "ownedPaths",
      "relations",
      "verificationCommands",
      "lastReviewedSha",
      "lastReviewedDate",
    ];

    for (const req of required) {
      if (feature[req] === undefined || feature[req] === null) {
        errors.push(
          `Feature '${feature.id || "unknown"}' is missing required field '${req}'`,
        );
      }
    }

    // Check array field types
    const arrayFields = [
      "aliases",
      "entryPoints",
      "ownedPaths",
      "contracts",
      "domainPort",
      "api",
      "ui",
      "adapters",
      "dataTables",
      "migrationPaths",
      "tests",
      "relations",
      "docs",
      "verificationCommands",
    ];
    for (const af of arrayFields) {
      if (feature[af] !== undefined && !Array.isArray(feature[af])) {
        errors.push(
          `Feature '${feature.id}' field '${af}' must be an array, got ${typeof feature[
            af
          ]}`,
        );
      }
    }

    // Validate SHA format (40-char hex)
    if (
      typeof feature.lastReviewedSha !== "string" ||
      !/^[a-f0-9]{40}$/.test(feature.lastReviewedSha)
    ) {
      errors.push(
        `Feature '${feature.id}' invalid lastReviewedSha: '${feature.lastReviewedSha}' (must be 40-character hex commit SHA)`,
      );
    }

    // Validate date format (YYYY-MM-DD)
    if (
      typeof feature.lastReviewedDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(feature.lastReviewedDate)
    ) {
      errors.push(
        `Feature '${feature.id}' invalid lastReviewedDate: '${feature.lastReviewedDate}' (must be YYYY-MM-DD)`,
      );
    }

    // Check relations
    for (const rel of feature.relations || []) {
      if (
        !rel.type ||
        !["dependsOn", "affects", "relatedTo"].includes(rel.type)
      ) {
        errors.push(
          `Feature '${feature.id}' declares invalid relation type '${rel.type}' (must be dependsOn, affects, or relatedTo)`,
        );
      }
      if (!rel.target || !featureIds.has(rel.target)) {
        errors.push(
          `Feature '${feature.id}' declares relation of type '${rel.type}' to unknown target '${rel.target}'`,
        );
      }
    }

    // Collect all paths to check existence, containment, and escaping
    const pathCategories = [
      { name: "entryPoints", paths: feature.entryPoints },
      { name: "ownedPaths", paths: feature.ownedPaths },
      { name: "contracts", paths: feature.contracts },
      { name: "domainPort", paths: feature.domainPort },
      { name: "api", paths: feature.api },
      { name: "ui", paths: feature.ui },
      { name: "adapters", paths: feature.adapters },
      { name: "migrationPaths", paths: feature.migrationPaths },
      { name: "tests", paths: feature.tests },
    ];

    for (const cat of pathCategories) {
      for (const relPath of cat.paths || []) {
        if (typeof relPath !== "string") {
          errors.push(
            `Feature '${feature.id}' in ${cat.name}: path must be string, got ${typeof relPath}`,
          );
          continue;
        }

        // Track directory coverage
        if (relPath.startsWith("apps/mobile/src/features/")) {
          const sub = relPath
            .replace("apps/mobile/src/features/", "")
            .split("/")[0];
          if (sub) coveredMobileDirs.add(sub);
        }
        if (relPath.startsWith("apps/api/src/modules/")) {
          const sub = relPath
            .replace("apps/api/src/modules/", "")
            .split("/")[0];
          if (sub) coveredApiDirs.add(sub);
        }

        // Lexical containment
        const resolvedPath = path.resolve(repoRoot, relPath);
        if (!resolvedPath.startsWith(repoRoot)) {
          errors.push(
            `Feature '${feature.id}' path '${relPath}' escapes repository root`,
          );
          continue;
        }

        // Existence
        if (!fs.existsSync(resolvedPath)) {
          errors.push(
            `Feature '${feature.id}' references non-existent path in ${cat.name}: '${relPath}'`,
          );
          continue;
        }

        // Realpath containment (symlink escape prevention)
        try {
          const real = fs.realpathSync(resolvedPath);
          if (!real.startsWith(realRepoRoot)) {
            errors.push(
              `Feature '${feature.id}' path '${relPath}' symlink resolves outside repository: '${real}'`,
            );
          }
        } catch {
          // handled by existence check
        }

        // Sensitive files
        if (
          relPath.includes(".env") ||
          relPath.endsWith(".key") ||
          relPath.endsWith(".pem")
        ) {
          errors.push(
            `Feature '${feature.id}' references sensitive file: '${relPath}'`,
          );
        }
      }
    }

    // Docs paths (strip #anchor before checking existence)
    for (const docRef of feature.docs || []) {
      const cleanDocPath = docRef.split("#")[0];
      if (!cleanDocPath) continue;

      const resolvedDoc = path.resolve(repoRoot, cleanDocPath);
      if (!resolvedDoc.startsWith(repoRoot)) {
        errors.push(
          `Feature '${feature.id}' doc reference '${docRef}' escapes repository root`,
        );
      } else if (!fs.existsSync(resolvedDoc)) {
        errors.push(
          `Feature '${feature.id}' references non-existent doc: '${cleanDocPath}'`,
        );
      }
    }

    // Review drift is split between committed changes and local worktree changes.
    if (
      feature.ownedPaths &&
      feature.ownedPaths.length > 0 &&
      fs.existsSync(path.join(repoRoot, ".git"))
    ) {
      const reviewState = checkReviewState(feature, repoRoot);
      if (reviewState.committed) {
        warnings.push(
          `Feature '${feature.id}': ${reviewState.committed.changedPaths.length} owned path(s) changed after reviewed SHA ${feature.lastReviewedSha.slice(0, 8)}. Review SHA may need refresh.`,
        );
      }
      if (reviewState.committedUnavailable) {
        warnings.push(
          `Feature '${feature.id}': committed freshness unavailable because reviewed SHA ${feature.lastReviewedSha.slice(0, 8)} is not present in this checkout.`,
        );
      }
      if (reviewState.local) {
        warnings.push(
          `Feature '${feature.id}': ${reviewState.local.changedPaths.length} owned path(s) have local staged, unstaged, or untracked changes.`,
        );
      }
    }
  }

  // Verify feature directory coverage for apps/mobile/src/features
  const mobileFeaturesDir = path.join(repoRoot, "apps/mobile/src/features");
  if (fs.existsSync(mobileFeaturesDir)) {
    const entries = fs.readdirSync(mobileFeaturesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !coveredMobileDirs.has(entry.name)) {
        errors.push(
          `Directory coverage gap: 'apps/mobile/src/features/${entry.name}' is not covered by any feature in feature-map.json`,
        );
      }
    }
  }

  // Verify module coverage for apps/api/src/modules
  const apiModulesDir = path.join(repoRoot, "apps/api/src/modules");
  if (fs.existsSync(apiModulesDir)) {
    const entries = fs.readdirSync(apiModulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !coveredApiDirs.has(entry.name)) {
        errors.push(
          `Directory coverage gap: 'apps/api/src/modules/${entry.name}' is not covered by any feature in feature-map.json`,
        );
      }
    }
  }

  return { errors, warnings };
}

function collectSourceFiles(repoRoot, relativeDir, files) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) return;
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (COVERAGE_EXEMPTIONS.some((pattern) => pattern.test(relativePath)))
      continue;
    if (entry.isDirectory()) {
      collectSourceFiles(repoRoot, relativePath, files);
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      files.push(relativePath);
    }
  }
}

export function validateMappedSourceCoverage(repoRoot) {
  const errors = [];
  const warnings = [];
  let mapData;
  try {
    mapData = loadFeatureMap(repoRoot);
  } catch (error) {
    return {
      errors: [`Feature map loading error: ${error.message}`],
      warnings,
      unmappedPaths: [],
    };
  }

  const sourceFiles = [];
  for (const coverageRoot of COVERAGE_ROOTS) {
    collectSourceFiles(repoRoot, coverageRoot, sourceFiles);
  }
  const unmappedPaths = sourceFiles
    .filter(
      (sourcePath) => getFeaturesForPath(mapData, sourcePath).length === 0,
    )
    .sort();

  if (unmappedPaths.length > 0) {
    const examples = unmappedPaths.slice(0, 12).join(", ");
    const remainder = Math.max(0, unmappedPaths.length - 12);
    warnings.push(
      `Mapped source coverage: ${unmappedPaths.length}/${sourceFiles.length} relevant source files are unmapped. Examples: ${examples}${remainder > 0 ? `, and ${remainder} more` : ""}. Generated output, snapshots, declarations, dependencies, and build artifacts are exempt.`,
    );
  }

  return {
    errors,
    warnings,
    unmappedPaths,
    totalSourceFiles: sourceFiles.length,
  };
}

export function validateStartupSize(repoRoot) {
  const errors = [];
  const warnings = [];
  const files = ["AGENTS.md", "status.md", "docs/START_HERE.md"];
  const measurements = files.map((relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath))
      return { path: relativePath, lines: 0, bytes: 0 };
    const content = fs.readFileSync(absolutePath, "utf8");
    const lineCount =
      content.length === 0
        ? 0
        : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    return {
      path: relativePath,
      lines: lineCount,
      bytes: Buffer.byteLength(content),
    };
  });
  const totalLines = measurements.reduce((sum, item) => sum + item.lines, 0);
  const totalBytes = measurements.reduce((sum, item) => sum + item.bytes, 0);
  const status = measurements.find((item) => item.path === "status.md");
  if (status && status.lines > 120) {
    errors.push(
      `Startup size limit: status.md has ${status.lines} lines (maximum 120). Move detailed evidence to linked documents or a dated archive; preserve current authorities and open gates.`,
    );
  }
  if (totalLines > 350) {
    warnings.push(
      `Startup size advisory: normal startup set has ${totalLines} lines (target <= 350).`,
    );
  }
  if (status && status.bytes > 12288)
    errors.push(
      `Startup size limit: status.md has ${status.bytes} bytes (maximum 12288). Move detailed evidence to linked documents or a dated archive; preserve current authorities and open gates.`,
    );
  if (totalBytes > 32768)
    warnings.push(
      `Startup size advisory: normal startup set has ${totalBytes} bytes (target <= 32768).`,
    );
  return { errors, warnings, measurements, totalLines, totalBytes };
}

// Added/renamed paths must have intent ownership. Existing legacy gaps remain
// visible in validateMappedSourceCoverage rather than becoming a moving baseline.
export function validateNewSourceCoverage(repoRoot, sinceRef) {
  const errors = [];
  try {
    const git = (args) =>
      execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const reference = git([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${sinceRef}^{commit}`,
    ]).trim();
    const base = git(["merge-base", reference, "HEAD"]).trim();
    const baseline = new Set(
      git(["ls-tree", "-r", "--name-only", "-z", base])
        .split("\0")
        .filter(Boolean),
    );
    const index = getRepositoryIndex(repoRoot, { cache: false });
    const coverageRoots = [
      ...new Set([...COVERAGE_ROOTS, ...index.packages.map((pkg) => pkg.path)]),
    ];
    const map = loadFeatureMap(repoRoot);
    const addedPaths = index.files
      .filter((file) => file.kind === "source")
      .map((file) => file.path)
      .filter(
        (file) =>
          !baseline.has(file) &&
          coverageRoots.some(
            (prefix) => prefix === "." || file.startsWith(`${prefix}/`),
          ),
      )
      .sort();
    for (const file of addedPaths)
      if (!getFeaturesForPath(map, file).length)
        errors.push(
          `New source ownership gap: '${file}' is not mapped; add an owned path or explicit feature reference.`,
        );
    return { errors, warnings: [], addedPaths, base };
  } catch (error) {
    return {
      errors: [`New source coverage unavailable: ${error.message}`],
      warnings: [],
      addedPaths: [],
    };
  }
}

export function validateMarkdownLinks(repoRoot) {
  const errors = [];
  const warnings = [];

  const docsToValidate = [
    "AGENTS.md",
    "status.md",
    "docs/START_HERE.md",
    "docs/ARCHITECTURE.md",
    "docs/SESSION_GUIDE.md",
    "docs/adr/README.md",
    "docs/tutorials/README.md",
    "docs/patterns/README.md",
    "docs/AGENT_NAVIGATION_ACCEPTANCE.md",
    "docs/AGENT_NAVIGATION_GUIDE.md",
  ];

  // Discover all archive markdown files
  const archiveDir = path.join(repoRoot, "docs/archive");
  if (fs.existsSync(archiveDir)) {
    const findArchiveMds = (dir) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          findArchiveMds(full);
        } else if (item.name.endsWith(".md")) {
          docsToValidate.push(path.relative(repoRoot, full));
        }
      }
    };
    findArchiveMds(archiveDir);
  }

  // Pattern for markdown links: [text](link)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (const docRelPath of docsToValidate) {
    const docFullPath = path.join(repoRoot, docRelPath);
    if (!fs.existsSync(docFullPath)) {
      errors.push(`Document to validate not found: ${docRelPath}`);
      continue;
    }

    const content = fs.readFileSync(docFullPath, "utf8");
    const docDir = path.dirname(docFullPath);

    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const rawTarget = match[2].trim();

      // Skip external URLs, mailto, tel
      if (
        rawTarget.startsWith("http://") ||
        rawTarget.startsWith("https://") ||
        rawTarget.startsWith("mailto:") ||
        rawTarget.startsWith("tel:")
      ) {
        continue;
      }

      // Split path and fragment anchor
      const [targetPathPart, fragment] = rawTarget.split("#");

      let targetFullPath;
      if (targetPathPart === "") {
        // Self-reference anchor, e.g. #pat-001
        targetFullPath = docFullPath;
      } else {
        targetFullPath = path.resolve(docDir, targetPathPart);
      }

      if (!fs.existsSync(targetFullPath)) {
        errors.push(
          `In '${docRelPath}': Link target does not exist: '${rawTarget}' (resolved to '${path.relative(
            repoRoot,
            targetFullPath,
          )}')`,
        );
        continue;
      }

      // If anchor is specified and target is a markdown file, check anchor
      if (fragment && targetFullPath.endsWith(".md")) {
        const targetContent = fs.readFileSync(targetFullPath, "utf8");
        const headings = extractHeadings(targetContent);
        const targetSlug = slugifyHeading(fragment);

        if (
          !headings.has(targetSlug) &&
          !headings.has(fragment) &&
          !headings.has(fragment.toLowerCase())
        ) {
          errors.push(
            `In '${docRelPath}': Anchor '#${fragment}' not found in target '${path.relative(
              repoRoot,
              targetFullPath,
            )}'`,
          );
        }
      }
    }
  }

  // Validate canonical code paths cited in docs/patterns/README.md
  const patternsPath = path.join(repoRoot, "docs/patterns/README.md");
  if (fs.existsSync(patternsPath)) {
    const patternsContent = fs.readFileSync(patternsPath, "utf8");
    const lines = patternsContent.split("\n");
    let inSourcesOrTests = false;

    for (const line of lines) {
      if (
        line.includes("Canonical Sources") ||
        line.includes("Relevant Tests")
      ) {
        inSourcesOrTests = true;
        continue;
      }
      if (
        line.startsWith("- **") ||
        line.startsWith("---") ||
        line.startsWith("### ")
      ) {
        inSourcesOrTests = false;
      }

      if (inSourcesOrTests) {
        // Match inline backtick code paths `some/path`
        const codeMatches = line.match(/`([^`]+)`/g);
        if (codeMatches) {
          for (const m of codeMatches) {
            const citedPath = m.replace(/`/g, "").trim();
            // Skip CLI commands or generic flags
            if (citedPath.includes("/") && !citedPath.startsWith("pnpm")) {
              const fullCited = path.resolve(repoRoot, citedPath);
              if (!fs.existsSync(fullCited)) {
                errors.push(
                  `In 'docs/patterns/README.md': Canonical pattern path does not exist: '${citedPath}'`,
                );
              }
            }
          }
        }
      }
    }
  }

  return { errors, warnings };
}

function extractAllImports(code) {
  try {
    const info = ts.preProcessFile(code, true, true);
    return info.importedFiles.map((f) => f.fileName);
  } catch {
    return [];
  }
}

export function validateImportBoundaries(repoRoot) {
  const errors = [];
  const warnings = [];

  // 1. packages/core boundary: pure domain logic, no frameworks/db/vendor SDKs
  const coreSrc = path.join(repoRoot, "packages/core/src");
  if (fs.existsSync(coreSrc)) {
    const files = fs.readdirSync(coreSrc, { recursive: true });
    for (const file of files) {
      if (
        typeof file === "string" &&
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.endsWith(".test.ts")
      ) {
        const fullPath = path.join(coreSrc, file);
        const code = fs.readFileSync(fullPath, "utf8");
        const imports = extractAllImports(code);

        for (const imp of imports) {
          if (
            imp.startsWith("@mizyun/adapter-") ||
            imp.startsWith("@mizyun/provider-") ||
            imp.startsWith("@supabase/") ||
            imp === "@google/genai" ||
            imp === "@mistralai/mistralai" ||
            imp === "fastify" ||
            imp === "react-native" ||
            imp === "expo"
          ) {
            errors.push(
              `packages/core boundary violation in '${file}': imports forbidden dependency '${imp}'`,
            );
          }
        }
      }
    }
  }

  // 2. packages/agent-runtime & packages/memory: provider-neutral, no vendor SDKs
  const neutralPackages = ["packages/agent-runtime/src", "packages/memory/src"];
  for (const pkgRel of neutralPackages) {
    const pkgSrc = path.join(repoRoot, pkgRel);
    if (fs.existsSync(pkgSrc)) {
      const files = fs.readdirSync(pkgSrc, { recursive: true });
      for (const file of files) {
        if (
          typeof file === "string" &&
          (file.endsWith(".ts") || file.endsWith(".tsx")) &&
          !file.endsWith(".test.ts")
        ) {
          const fullPath = path.join(pkgSrc, file);
          const code = fs.readFileSync(fullPath, "utf8");
          const imports = extractAllImports(code);

          for (const imp of imports) {
            if (
              imp.startsWith("@mizyun/provider-") ||
              imp === "@google/genai" ||
              imp === "@mistralai/mistralai"
            ) {
              errors.push(
                `${pkgRel} provider-neutral violation in '${file}': imports vendor SDK '${imp}'`,
              );
            }
          }
        }
      }
    }
  }

  // 3. apps/mobile boundary: presentation layer, must never import server database adapter or server secrets
  const mobileSrc = path.join(repoRoot, "apps/mobile/src");
  if (fs.existsSync(mobileSrc)) {
    const files = fs.readdirSync(mobileSrc, { recursive: true });
    for (const file of files) {
      if (
        typeof file === "string" &&
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.endsWith(".test.ts")
      ) {
        const fullPath = path.join(mobileSrc, file);
        const code = fs.readFileSync(fullPath, "utf8");
        const imports = extractAllImports(code);

        for (const imp of imports) {
          if (
            imp === "@mizyun/adapter-supabase-server" ||
            imp === "@mizyun/adapters-supabase-server" ||
            (imp.startsWith("@mizyun/adapter-") &&
              imp !== "@mizyun/adapter-supabase-mobile") ||
            imp.includes("supabase-server")
          ) {
            errors.push(
              `apps/mobile server-secret boundary violation in '${file}': imports server adapter '${imp}'`,
            );
          }
        }
      }
    }
  }

  return { errors, warnings };
}

export function runAllChecks(repoRoot = getRepoRoot(), options = {}) {
  console.log("=== Mizyun Navigation & Boundary Checks ===");
  console.log("");

  let totalErrors = 0;
  let totalWarnings = 0;

  // 1. Feature map structure
  console.log("1. Validating feature-map.json structure and references...");
  const mapResult = validateFeatureMapStructure(repoRoot);
  if (mapResult.errors.length > 0) {
    for (const e of mapResult.errors) console.error(`  FAIL: ${e}`);
    totalErrors += mapResult.errors.length;
  } else {
    console.log("  PASS: Feature map structure and path references are valid.");
  }
  for (const w of mapResult.warnings) console.warn(`  WARN: ${w}`);
  totalWarnings += mapResult.warnings.length;
  console.log("");

  // 2. Mapped source coverage
  console.log("2. Checking mapped source coverage...");
  const coverageResult = validateMappedSourceCoverage(repoRoot);
  for (const e of coverageResult.errors) console.error(`  FAIL: ${e}`);
  totalErrors += coverageResult.errors.length;
  if (coverageResult.warnings.length === 0) {
    console.log(
      `  PASS: ${coverageResult.totalSourceFiles} relevant source files are mapped.`,
    );
  }
  for (const w of coverageResult.warnings) console.warn(`  WARN: ${w}`);
  totalWarnings += coverageResult.warnings.length;
  if (options.since) {
    const newResult = validateNewSourceCoverage(repoRoot, options.since);
    for (const error of newResult.errors) console.error(`  FAIL: ${error}`);
    totalErrors += newResult.errors.length;
    if (!newResult.errors.length)
      console.log(
        `  PASS: ${newResult.addedPaths.length} new source paths have intent ownership since ${newResult.base.slice(0, 8)}.`,
      );
  }
  console.log("");

  // 3. Startup size advisory
  console.log("3. Measuring normal startup context size...");
  const startupResult = validateStartupSize(repoRoot);
  for (const e of startupResult.errors) console.error(`  FAIL: ${e}`);
  totalErrors += startupResult.errors.length;
  console.log(
    `  INFO: ${startupResult.totalLines} lines / ${startupResult.totalBytes} bytes across AGENTS.md, status.md, and docs/START_HERE.md.`,
  );
  for (const w of startupResult.warnings) console.warn(`  WARN: ${w}`);
  totalWarnings += startupResult.warnings.length;
  console.log("");

  // 4. Markdown links & anchors
  console.log(
    "4. Validating local markdown links and anchors in navigation docs...",
  );
  const linkResult = validateMarkdownLinks(repoRoot);
  if (linkResult.errors.length > 0) {
    for (const e of linkResult.errors) console.error(`  FAIL: ${e}`);
    totalErrors += linkResult.errors.length;
  } else {
    console.log("  PASS: All internal markdown links resolve.");
  }
  for (const w of linkResult.warnings) console.warn(`  WARN: ${w}`);
  totalWarnings += linkResult.warnings.length;
  console.log("");

  // 5. Architectural import boundaries
  console.log("5. Validating architectural import boundaries...");
  const boundaryResult = validateImportBoundaries(repoRoot);
  if (boundaryResult.errors.length > 0) {
    for (const e of boundaryResult.errors) console.error(`  FAIL: ${e}`);
    totalErrors += boundaryResult.errors.length;
  } else {
    console.log(
      "  PASS: Pure core, provider neutrality, and mobile boundaries strictly respected.",
    );
  }
  for (const w of boundaryResult.warnings) console.warn(`  WARN: ${w}`);
  totalWarnings += boundaryResult.warnings.length;
  console.log("");

  console.log("6. Refreshing source/config discovery...");
  try {
    const index = getRepositoryIndex(repoRoot, { cache: false });
    console.log(
      `  PASS: Current snapshot ${index.snapshot.id}; ${index.files.length} files / ${index.edges.length} source edges / ${index.packages.length} workspace packages.`,
    );
    console.log(
      `  INFO: ${index.unresolved.length} unresolved imports (includes external/nonliteral imports; static graph is advisory).`,
    );
    for (const warning of index.warnings) console.warn(`  WARN: ${warning}`);
    totalWarnings += index.warnings.length;
  } catch (error) {
    console.error(`  FAIL: Discovery refresh unavailable: ${error.message}`);
    totalErrors++;
  }

  console.log(
    "--------------------------------------------------------------------------------",
  );
  if (totalErrors > 0) {
    console.error(
      `Checks FAILED: ${totalErrors} error(s), ${totalWarnings} warning(s).`,
    );
    return false;
  }

  console.log(`Checks PASSED: 0 errors, ${totalWarnings} warning(s).`);
  return true;
}

function main() {
  let repoRoot;
  try {
    repoRoot = getRepoRoot();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--since" || !args[1])) {
    console.error("Usage: pnpm navigation:check [--since <Git ref>]");
    process.exit(1);
  }
  const success = runAllChecks(repoRoot, { since: args[1] });
  process.exit(success ? 0 : 1);
}

// Only run main when executed as CLI script
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname)
) {
  main();
}
