import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeImpact } from "../impact.mjs";
import { getRepoRoot } from "../feature-map.mjs";

function createGitFixture() {
  const dir = fs.mkdtempSync(path.join("/tmp", "mizyun-impact-fixture-"));

  const runGit = (args) => {
    return execFileSync("git", args, {
      cwd: dir,
      env: { ...process.env, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  };

  runGit(["init"]);
  runGit(["config", "user.email", "test@example.com"]);
  runGit(["config", "user.name", "Test User"]);
  runGit(["config", "commit.gpgsign", "false"]);

  // Create producer package in packages/producer
  const producerDir = path.join(dir, "packages/producer");
  fs.mkdirSync(path.join(producerDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(producerDir, "package.json"),
    JSON.stringify(
      {
        name: "@fixture/producer",
        version: "1.0.0",
        dependencies: {},
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    path.join(producerDir, "src/index.ts"),
    `export const util = () => "producer-core";\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(producerDir, "src/cycle-a.ts"),
    `export const a = 1;\n`,
    "utf8",
  );

  // Create consumer package in packages/consumer
  const consumerDir = path.join(dir, "packages/consumer");
  fs.mkdirSync(path.join(consumerDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "@fixture/consumer",
        version: "1.0.0",
        dependencies: {
          "@fixture/producer": "workspace:*",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    path.join(consumerDir, "src/index.ts"),
    `import { util } from "@fixture/producer";\nexport const run = () => util();\n`,
    "utf8",
  );

  // Create docs/feature-map.json
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  const featureMap = {
    schemaVersion: 1,
    features: [
      {
        id: "producer-feat",
        title: "Producer Feature",
        summary: "Producer package feature",
        aliases: [],
        entryPoints: ["packages/producer/src/index.ts"],
        ownedPaths: ["packages/producer/src"],
        relations: [
          {
            type: "affects",
            target: "downstream-feat",
            reason: "producer changes affect downstream",
          },
        ],
        verificationCommands: ["pnpm --filter @fixture/producer test"],
        lastReviewedSha: "0123456789abcdef0123456789abcdef01234567",
        lastReviewedDate: "2026-09-09",
      },
      {
        id: "consumer-feat",
        title: "Consumer Feature",
        summary:
          "Consumer package feature with NO explicit dependsOn in manifest",
        aliases: [],
        entryPoints: ["packages/consumer/src/index.ts"],
        ownedPaths: ["packages/consumer/src"],
        relations: [],
        verificationCommands: ["pnpm --filter @fixture/consumer test"],
        lastReviewedSha: "0123456789abcdef0123456789abcdef01234567",
        lastReviewedDate: "2026-09-09",
      },
      {
        id: "downstream-feat",
        title: "Downstream Feature",
        summary: "Feature downstream of producer",
        aliases: [],
        entryPoints: [],
        ownedPaths: [],
        relations: [],
        verificationCommands: ["pnpm test:downstream"],
        lastReviewedSha: "0123456789abcdef0123456789abcdef01234567",
        lastReviewedDate: "2026-09-09",
      },
      {
        id: "cycle-a",
        title: "Cycle Feature A",
        summary: "Cycle A affects B",
        aliases: [],
        entryPoints: ["packages/producer/src/cycle-a.ts"],
        ownedPaths: ["packages/producer/src/cycle-a.ts"],
        relations: [
          {
            type: "affects",
            target: "cycle-b",
            reason: "A affects B",
          },
        ],
        verificationCommands: [],
        lastReviewedSha: "0123456789abcdef0123456789abcdef01234567",
        lastReviewedDate: "2026-09-09",
      },
      {
        id: "cycle-b",
        title: "Cycle Feature B",
        summary: "Cycle B affects A",
        aliases: [],
        entryPoints: [],
        ownedPaths: [],
        relations: [
          {
            type: "affects",
            target: "cycle-a",
            reason: "B affects A",
          },
        ],
        verificationCommands: [],
        lastReviewedSha: "0123456789abcdef0123456789abcdef01234567",
        lastReviewedDate: "2026-09-09",
      },
    ],
  };

  fs.writeFileSync(
    path.join(dir, "docs/feature-map.json"),
    JSON.stringify(featureMap, null, 2),
    "utf8",
  );

  runGit(["add", "."]);
  runGit(["commit", "-m", "Initial baseline commit"]);

  return { dir, runGit };
}

test("analyzeImpact executes safely against repository HEAD", () => {
  const root = getRepoRoot();
  const report = analyzeImpact(root, "HEAD");

  assert.ok(report.git);
  assert.equal(typeof report.git.headSha, "string");
  assert.equal(report.git.headSha.length, 40);
  assert.ok(Array.isArray(report.directImpacts));
  assert.ok(Array.isArray(report.propagatedImpacts));
  assert.ok(Array.isArray(report.unmappedFiles));
  assert.ok(Array.isArray(report.suggestedTests));
  assert.ok(Array.isArray(report.suggestedCommands));
});

test("synthetic fixture: producer package change triggers reverse dependency impact on consumer without manual dependsOn", () => {
  const { dir, runGit } = createGitFixture();
  try {
    const baseSha = runGit(["rev-parse", "HEAD"]).trim();

    // Modify a file in producer package
    const producerIndex = path.join(dir, "packages/producer/src/index.ts");
    fs.appendFileSync(
      producerIndex,
      "\nexport const extra = () => 42;\n",
      "utf8",
    );
    runGit(["add", "packages/producer/src/index.ts"]);
    runGit(["commit", "-m", "Update producer utilities"]);

    const report = analyzeImpact(dir, baseSha);

    // 1. Direct impact on producer-feat
    assert.ok(
      report.directImpacts.some((i) => i.id === "producer-feat"),
      "Expected direct impact on producer-feat",
    );

    // 2. Propagated reverse dependency impact on consumer-feat
    const consumerImpact = report.propagatedImpacts.find(
      (i) => i.id === "consumer-feat",
    );
    assert.ok(
      consumerImpact,
      "Expected reverse dependency impact on consumer-feat without manual dependsOn",
    );
    assert.equal(consumerImpact.signal, "package-reverse-dep");
    assert.ok(
      consumerImpact.reasonChain.includes("@fixture/producer"),
      "Reason chain should cite producer package",
    );
    assert.ok(
      consumerImpact.reasonChain.includes("@fixture/consumer"),
      "Reason chain should cite consumer package",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("synthetic fixture: renamed and copied files are correctly parsed and mapped", () => {
  const { dir, runGit } = createGitFixture();
  try {
    const baseSha = runGit(["rev-parse", "HEAD"]).trim();

    // Perform git rename (R status in git diff-tree)
    runGit([
      "mv",
      "packages/producer/src/index.ts",
      "packages/producer/src/index-renamed.ts",
    ]);
    runGit(["commit", "-m", "Rename producer index"]);

    const reportCommitted = analyzeImpact(dir, baseSha);
    assert.ok(
      reportCommitted.directImpacts.some((i) => i.id === "producer-feat"),
      "Expected producer-feat to be directly impacted by committed rename",
    );
    assert.ok(
      reportCommitted.directImpacts.some((i) =>
        i.changedFiles.includes("packages/producer/src/index-renamed.ts"),
      ),
      "Expected new renamed path to be recorded in changedFiles",
    );

    // Also test staged rename (R status in git diff --cached)
    runGit([
      "mv",
      "packages/consumer/src/index.ts",
      "packages/consumer/src/index-consumer-renamed.ts",
    ]);
    const reportStaged = analyzeImpact(dir, "HEAD");
    assert.equal(reportStaged.git.hasLocalChanges, true);
    assert.ok(
      reportStaged.directImpacts.some((i) => i.id === "consumer-feat"),
      "Expected consumer-feat to be directly impacted by staged rename",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("synthetic fixture: untracked non-ignored files are captured and mapped", () => {
  const { dir } = createGitFixture();
  try {
    const untrackedFile = path.join(
      dir,
      "packages/producer/src/new-untracked-file.ts",
    );
    fs.writeFileSync(untrackedFile, "export const untracked = true;\n", "utf8");

    const report = analyzeImpact(dir, "HEAD");

    assert.equal(report.git.hasLocalChanges, true);
    assert.ok(
      report.directImpacts.some(
        (i) =>
          i.id === "producer-feat" &&
          i.changedFiles.includes(
            "packages/producer/src/new-untracked-file.ts",
          ),
      ),
      "Expected untracked file to be captured and mapped to producer-feat",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("synthetic fixture: filenames containing whitespace are safely handled without splitting errors", () => {
  const { dir, runGit } = createGitFixture();
  try {
    const spacedRelPath =
      "packages/producer/src/spaced filename with many parts.ts";
    const fullPath = path.join(dir, spacedRelPath);
    fs.writeFileSync(fullPath, "export const spaced = 123;\n", "utf8");
    runGit(["add", spacedRelPath]);

    const report = analyzeImpact(dir, "HEAD");

    assert.equal(report.git.hasLocalChanges, true);
    const producerImpact = report.directImpacts.find(
      (i) => i.id === "producer-feat",
    );
    assert.ok(producerImpact, "Expected producer-feat to be impacted");
    assert.ok(
      producerImpact.changedFiles.includes(spacedRelPath),
      `Expected full spaced filename '${spacedRelPath}' in changedFiles, got: ${JSON.stringify(
        producerImpact.changedFiles,
      )}`,
    );

    // Verify none of the split substrings appear in changedFiles or unmappedFiles
    assert.ok(
      !producerImpact.changedFiles.includes("packages/producer/src/spaced"),
      "Filename was incorrectly tokenized by spaces",
    );
    assert.ok(
      !report.unmappedFiles.includes("parts.ts"),
      "Filename split residue leaked into unmappedFiles",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("synthetic fixture: forward semantic affects edges propagate downstream", () => {
  const { dir, runGit } = createGitFixture();
  try {
    const producerIndex = path.join(dir, "packages/producer/src/index.ts");
    fs.appendFileSync(
      producerIndex,
      "\n// trigger downstream affect\n",
      "utf8",
    );

    const report = analyzeImpact(dir, "HEAD");

    // producer-feat has affects -> downstream-feat
    const downstreamImpact = report.propagatedImpacts.find(
      (i) => i.id === "downstream-feat",
    );
    assert.ok(
      downstreamImpact,
      "Expected downstream-feat in propagatedImpacts across affects relation",
    );
    assert.equal(downstreamImpact.signal, "semantic-affects");
    assert.ok(
      report.suggestedCommands.includes("pnpm test:downstream"),
      "Expected downstream verification command to be collected",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("synthetic fixture: circular relationship cycles (A affects B, B affects A) terminate cleanly without infinite loop", () => {
  const { dir } = createGitFixture();
  try {
    // Touch cycle-a.ts which affects cycle-b, while cycle-b affects cycle-a
    const cycleAFile = path.join(dir, "packages/producer/src/cycle-a.ts");
    fs.appendFileSync(cycleAFile, "\nexport const modified = true;\n", "utf8");

    // Must terminate cleanly without exceeding call stack or hanging
    const report = analyzeImpact(dir, "HEAD");

    assert.ok(report);
    assert.ok(
      report.directImpacts.some((i) => i.id === "cycle-a"),
      "Expected cycle-a to be directly impacted",
    );
    assert.ok(
      report.propagatedImpacts.some(
        (i) => i.id === "cycle-b" && i.signal === "semantic-affects",
      ),
      "Expected cycle-b to be reached via semantic-affects",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
