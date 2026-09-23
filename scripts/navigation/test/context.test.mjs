import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  loadFeatureMap,
  findFeature,
  getFeaturesForPath,
  getRepoRoot,
} from "../feature-map.mjs";
import {
  checkReviewState,
  discoverNestedInstructions,
  formatContext,
} from "../context.mjs";

test("loadFeatureMap loads valid manifest from repository root", () => {
  const root = getRepoRoot();
  const mapData = loadFeatureMap(root);

  assert.equal(mapData.raw.schemaVersion, 1);
  assert.ok(Array.isArray(mapData.features));
  assert.ok(mapData.features.length >= 12);
  assert.ok(mapData.featuresById.has("meal-logging"));
  assert.ok(mapData.featuresById.has("workouts-sets"));
  assert.ok(mapData.featuresById.has("account-lifecycle"));
});

test("findFeature resolves exact feature ID", () => {
  const root = getRepoRoot();
  const mapData = loadFeatureMap(root);

  const result = findFeature(mapData, "meal-logging");
  assert.equal(result.found, true);
  assert.equal(result.feature.id, "meal-logging");
  assert.equal(result.feature.title, "Meal & Nutrition Logging");
});

test("findFeature resolves exact alias", () => {
  const root = getRepoRoot();
  const mapData = loadFeatureMap(root);

  const result = findFeature(mapData, "macros");
  assert.equal(result.found, true);
  assert.equal(result.feature.id, "meal-logging");
});

test("findFeature returns nonzero suggestions for unknown feature without fabricating", () => {
  const root = getRepoRoot();
  const mapData = loadFeatureMap(root);

  const result = findFeature(mapData, "nonexistent-feature-xyz");
  assert.equal(result.found, false);
  assert.equal(result.feature, null);
  assert.ok(Array.isArray(result.suggestions));
});

test("context CLI renders real typo and ambiguous-alias suggestions", () => {
  const root = getRepoRoot();
  const cli = path.join(root, "scripts/navigation/context.mjs");
  for (const [query, expectedIds] of [
    ["meal-loggin", ["meal-logging"]],
    ["tokens", ["auth", "coach-consent-budgets"]],
    ["unknown-no-match-xyz", []],
  ]) {
    const result = spawnSync(process.execPath, [cli, query], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /undefined/);
    for (const expectedId of expectedIds)
      assert.match(result.stderr, new RegExp(expectedId));
    if (expectedIds.length === 0) {
      assert.doesNotMatch(result.stderr, /Did you mean/);
      assert.match(result.stderr, /pnpm context --list/);
    }
  }

  const jsonResult = spawnSync(
    process.execPath,
    [cli, "system-health", "--json"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.equal(jsonResult.status, 0);
  const parsed = JSON.parse(jsonResult.stdout);
  assert.ok(Object.hasOwn(parsed, "reviewState"));
  assert.ok(Object.hasOwn(parsed, "reviewStaleness"));
  assert.deepEqual(parsed.reviewStaleness, parsed.reviewState.committed);
});

test("getFeaturesForPath maps paths to matching features", () => {
  const root = getRepoRoot();
  const mapData = loadFeatureMap(root);

  const mealMatches = getFeaturesForPath(
    mapData,
    "apps/api/src/modules/food-entries/routes.ts",
  );
  assert.ok(mealMatches.some((f) => f.id === "meal-logging"));

  const workoutMatches = getFeaturesForPath(
    mapData,
    "apps/api/src/modules/workouts/routes.ts",
  );
  assert.ok(workoutMatches.some((f) => f.id === "workouts-sets"));
});

test("duplicate feature ID in manifest throws descriptive error", () => {
  const tmpDir = path.join("/tmp", `test-map-${Date.now()}`);
  fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });

  const invalidManifest = {
    schemaVersion: 1,
    features: [
      {
        id: "feat-a",
        title: "A",
        summary: "A",
        aliases: [],
        entryPoints: [],
        ownedPaths: [],
        relations: [],
        verificationCommands: [],
        lastReviewedSha: "0123456789abcdef0123456789abcdef01234567",
        lastReviewedDate: "2026-09-09",
      },
      {
        id: "feat-a",
        title: "A duplicate",
        summary: "A",
        aliases: [],
        entryPoints: [],
        ownedPaths: [],
        relations: [],
        verificationCommands: [],
        lastReviewedSha: "0123456789abcdef0123456789abcdef01234567",
        lastReviewedDate: "2026-09-09",
      },
    ],
  };

  fs.writeFileSync(
    path.join(tmpDir, "docs/feature-map.json"),
    JSON.stringify(invalidManifest),
    "utf8",
  );

  assert.throws(
    () => loadFeatureMap(tmpDir),
    /Duplicate feature id found: feat-a/,
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("discoverNestedInstructions discovers apps/mobile/AGENTS.md for features touching apps/mobile/", () => {
  const root = getRepoRoot();
  const mobileFeature = {
    id: "test-mobile",
    title: "Mobile Feature",
    entryPoints: ["apps/mobile/src/index.ts"],
    ownedPaths: ["apps/mobile/src/features/test"],
  };

  const instructions = discoverNestedInstructions(mobileFeature, root);
  assert.ok(
    instructions.some((i) => i.path === "apps/mobile/AGENTS.md"),
    "Expected apps/mobile/AGENTS.md to be discovered",
  );

  const nonMobileFeature = {
    id: "test-backend",
    title: "Backend Feature",
    entryPoints: ["apps/api/src/index.ts"],
    ownedPaths: ["apps/api/src/modules/test"],
  };
  const nonMobileInstructions = discoverNestedInstructions(
    nonMobileFeature,
    root,
  );
  assert.ok(
    !nonMobileInstructions.some((i) => i.path === "apps/mobile/AGENTS.md"),
    "Did not expect apps/mobile/AGENTS.md for backend feature",
  );
});

test("discoverNestedInstructions walks real ancestors, deduplicates, and ignores unrelated directories", () => {
  const tmpDir = fs.mkdtempSync(path.join("/tmp", "mizyun-instructions-"));
  try {
    const targetDir = path.join(tmpDir, "apps/api/src/modules/example");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "apps/api/docs"), { recursive: true });
    for (const instruction of [
      "AGENTS.md",
      "apps/AGENTS.md",
      "apps/api/AGENTS.md",
      "apps/api/src/modules/example/AGENTS.md",
      "apps/api/docs/AGENTS.md",
    ]) {
      fs.writeFileSync(
        path.join(tmpDir, instruction),
        "# Instructions\n",
        "utf8",
      );
    }
    fs.writeFileSync(path.join(targetDir, "routes.ts"), "export {};\n", "utf8");
    const result = discoverNestedInstructions(
      {
        entryPoints: ["apps/api/src/modules/example/routes.ts"],
        ownedPaths: ["apps/api/src/modules/example"],
      },
      tmpDir,
    );
    assert.deepEqual(
      result.map((item) => item.path),
      [
        "AGENTS.md",
        "apps/AGENTS.md",
        "apps/api/AGENTS.md",
        "apps/api/src/modules/example/AGENTS.md",
      ],
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("discoverNestedInstructions ignores mapped symlinks that resolve outside the repository", () => {
  const tmpDir = fs.mkdtempSync(
    path.join("/tmp", "mizyun-instruction-symlink-"),
  );
  const outsideDir = fs.mkdtempSync(
    path.join("/tmp", "mizyun-outside-instructions-"),
  );
  try {
    fs.mkdirSync(path.join(tmpDir, "apps"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "AGENTS.md"),
      "# Root instructions\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(outsideDir, "AGENTS.md"),
      "# Outside instructions\n",
      "utf8",
    );
    fs.symlinkSync(outsideDir, path.join(tmpDir, "apps/link"));
    const result = discoverNestedInstructions(
      { entryPoints: ["apps/link"], ownedPaths: ["apps/link"] },
      tmpDir,
    );
    assert.deepEqual(result, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("review state reports local mapped changes separately from committed drift", () => {
  const tmpDir = fs.mkdtempSync(path.join("/tmp", "mizyun-review-state-"));
  const runGit = (args) =>
    execFileSync("git", args, {
      cwd: tmpDir,
      env: { ...process.env, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1" },
      encoding: "utf8",
    });
  try {
    fs.mkdirSync(path.join(tmpDir, "feature"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "feature/index.ts"),
      "export const v = 1;\n",
      "utf8",
    );
    runGit(["init"]);
    runGit(["config", "user.email", "test@example.com"]);
    runGit(["config", "user.name", "Test User"]);
    runGit(["add", "."]);
    runGit(["commit", "-m", "baseline"]);
    const reviewedSha = runGit(["rev-parse", "HEAD"]).trim();
    const feature = {
      ownedPaths: ["feature"],
      lastReviewedSha: reviewedSha,
      lastReviewedDate: "2026-09-23",
    };
    assert.deepEqual(checkReviewState(feature, tmpDir), {
      committed: null,
      committedUnavailable: null,
      local: null,
    });
    fs.appendFileSync(
      path.join(tmpDir, "feature/index.ts"),
      "export const w = 2;\n",
      "utf8",
    );
    const dirtyState = checkReviewState(feature, tmpDir);
    assert.equal(dirtyState.committed, null);
    assert.equal(dirtyState.committedUnavailable, null);
    assert.deepEqual(dirtyState.local.changedPaths, ["feature/index.ts"]);
    runGit(["add", "."]);
    runGit(["commit", "-m", "new commit"]);
    const committedState = checkReviewState(feature, tmpDir);
    assert.deepEqual(committedState.committed.changedPaths, [
      "feature/index.ts",
    ]);
    assert.equal(committedState.local, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("review state preserves local drift when the reviewed SHA is unavailable", () => {
  const tmpDir = fs.mkdtempSync(
    path.join("/tmp", "mizyun-review-unavailable-"),
  );
  const runGit = (args) =>
    execFileSync("git", args, {
      cwd: tmpDir,
      env: { ...process.env, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1" },
      encoding: "utf8",
    });
  try {
    fs.mkdirSync(path.join(tmpDir, "feature"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "feature/index.ts"),
      "export const v = 1;\n",
      "utf8",
    );
    runGit(["init"]);
    runGit(["config", "user.email", "test@example.com"]);
    runGit(["config", "user.name", "Test User"]);
    runGit(["add", "."]);
    runGit(["commit", "-m", "baseline"]);
    fs.appendFileSync(
      path.join(tmpDir, "feature/index.ts"),
      "export const w = 2;\n",
      "utf8",
    );
    const missingSha = "0123456789abcdef0123456789abcdef01234567";
    const state = checkReviewState(
      {
        ownedPaths: ["feature"],
        lastReviewedSha: missingSha,
        lastReviewedDate: "2026-09-23",
      },
      tmpDir,
    );
    assert.equal(state.committed, null);
    assert.equal(state.committedUnavailable.reviewedSha, missingSha);
    assert.deepEqual(state.local.changedPaths, ["feature/index.ts"]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("formatContext formats Requirements & Work Items and Open Acceptance Gates & Findings", () => {
  const root = getRepoRoot();
  const feature = {
    id: "test-requirements-gates",
    title: "Requirements & Gates Test Feature",
    summary: "Testing section formatting in context CLI",
    lastReviewedSha: "0123456789abcdef0123456789abcdef01234567",
    lastReviewedDate: "2026-09-09",
    requirements: [
      "DOCS-NAV-001: Machine-readable feature map",
      "DOCS-NAV-002: Context command with nested instructions",
    ],
    openAcceptance: [
      "N1: Server-secret boundary check",
      "N7: Disposable Git fixture tests for impact",
    ],
  };

  const output = formatContext(feature, root);

  assert.ok(output.includes("--- Requirements & Work Items ---"));
  assert.ok(output.includes("• DOCS-NAV-001: Machine-readable feature map"));
  assert.ok(
    output.includes("• DOCS-NAV-002: Context command with nested instructions"),
  );

  assert.ok(output.includes("--- Open Acceptance Gates & Findings ---"));
  assert.ok(output.includes("• N1: Server-secret boundary check"));
  assert.ok(output.includes("• N7: Disposable Git fixture tests for impact"));
});

test("formatContext truncates output at <= 120 lines when feature has many components unless isAll = true", () => {
  const root = getRepoRoot();
  const largeFeature = {
    id: "massive-feature",
    title: "Massive Feature",
    summary:
      "Feature with extensive components and commands to test truncation",
    lastReviewedSha: "0123456789abcdef0123456789abcdef01234567",
    lastReviewedDate: "2026-09-09",
    verificationCommands: Array.from(
      { length: 150 },
      (_, i) => `pnpm test:suite:part-${i}`,
    ),
  };

  const truncatedOutput = formatContext(largeFeature, root, false);
  const truncatedLines = truncatedOutput.split("\n");
  assert.ok(
    truncatedLines.length <= 120,
    `Expected <= 120 lines for truncated output, got ${truncatedLines.length}`,
  );
  assert.ok(
    truncatedOutput.includes("[Truncated"),
    "Expected truncation notice in default bounded mode",
  );

  const fullOutput = formatContext(largeFeature, root, true);
  const fullLines = fullOutput.split("\n");
  assert.ok(
    fullLines.length > 120,
    `Expected > 120 lines for untruncated output, got ${fullLines.length}`,
  );
  assert.ok(
    !fullOutput.includes("[Truncated"),
    "Did not expect truncation notice when isAll = true",
  );
});
