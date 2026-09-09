#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { loadFeatureMap, getRepoRoot } from "./feature-map.mjs";

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

    // Stale source detection (check if git commits touched owned files after lastReviewedDate)
    if (
      feature.ownedPaths &&
      feature.ownedPaths.length > 0 &&
      fs.existsSync(path.join(repoRoot, ".git"))
    ) {
      try {
        const stdout = execFileSync(
          "git",
          [
            "log",
            "-n",
            "1",
            `--since=${feature.lastReviewedDate} 23:59:59`,
            "--format=%H",
            "--",
            ...feature.ownedPaths,
          ],
          {
            cwd: repoRoot,
            env: { ...process.env, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1" },
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          },
        ).trim();
        if (stdout && stdout !== feature.lastReviewedSha) {
          warnings.push(
            `Feature '${feature.id}': files modified since review date (${feature.lastReviewedDate}). Review SHA may need refresh.`,
          );
        }
      } catch {
        // Git check best-effort
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

export function runAllChecks(repoRoot = getRepoRoot()) {
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

  // 2. Markdown links & anchors
  console.log(
    "2. Validating local markdown links and anchors in navigation docs...",
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

  // 3. Architectural import boundaries
  console.log("3. Validating architectural import boundaries...");
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

  const success = runAllChecks(repoRoot);
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
