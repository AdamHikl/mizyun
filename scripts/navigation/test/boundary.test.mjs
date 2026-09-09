import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validateFeatureMapStructure,
  validateMarkdownLinks,
  validateImportBoundaries,
} from "../check.mjs";
import { getRepoRoot } from "../feature-map.mjs";

test("validateFeatureMapStructure passes on canonical repository manifest", () => {
  const root = getRepoRoot();
  const result = validateFeatureMapStructure(root);

  assert.equal(
    result.errors.length,
    0,
    `Expected 0 errors, got: ${result.errors.join("; ")}`,
  );
});

test("validateMarkdownLinks passes on canonical active navigation documents", () => {
  const root = getRepoRoot();
  const result = validateMarkdownLinks(root);

  assert.equal(
    result.errors.length,
    0,
    `Expected 0 link errors, got: ${result.errors.join("; ")}`,
  );
});

test("validateImportBoundaries passes on canonical source codebase", () => {
  const root = getRepoRoot();
  const result = validateImportBoundaries(root);

  assert.equal(
    result.errors.length,
    0,
    `Expected 0 boundary errors, got: ${result.errors.join("; ")}`,
  );
});

test("validateFeatureMapStructure catches non-existent paths in synthetic fixtures", () => {
  const tmpDir = path.join("/tmp", `test-boundary-${Date.now()}`);
  try {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });

    const invalidManifest = {
      schemaVersion: 1,
      features: [
        {
          id: "broken-path-feature",
          title: "Broken",
          summary: "Broken path test",
          aliases: [],
          entryPoints: ["nonexistent/entry.ts"],
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

    const result = validateFeatureMapStructure(tmpDir);
    assert.ok(result.errors.length > 0);
    assert.ok(
      result.errors.some((e) =>
        e.includes(
          "references non-existent path in entryPoints: 'nonexistent/entry.ts'",
        ),
      ),
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("validateFeatureMapStructure catches dangling relation targets", () => {
  const tmpDir = path.join("/tmp", `test-dangling-${Date.now()}`);
  try {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });

    const invalidManifest = {
      schemaVersion: 1,
      features: [
        {
          id: "feat-alpha",
          title: "Alpha",
          summary: "Alpha test",
          aliases: [],
          entryPoints: [],
          ownedPaths: [],
          relations: [
            {
              type: "dependsOn",
              target: "ghost-feature",
              reason: "testing dangling target",
            },
          ],
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

    const result = validateFeatureMapStructure(tmpDir);
    assert.ok(result.errors.length > 0);
    assert.ok(
      result.errors.some((e) => e.includes("unknown target 'ghost-feature'")),
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("boundary check catches forbidden import of @mizyun/adapter-supabase-server in apps/mobile", () => {
  const tmpDir = path.join("/tmp", `test-mobile-boundary-${Date.now()}`);
  try {
    const mobileSrc = path.join(tmpDir, "apps/mobile/src/leak");
    fs.mkdirSync(mobileSrc, { recursive: true });
    fs.writeFileSync(
      path.join(mobileSrc, "leak.ts"),
      `import { createClient } from "@mizyun/adapter-supabase-server";\nexport const x = 1;\n`,
      "utf8",
    );

    const result = validateImportBoundaries(tmpDir);
    assert.ok(result.errors.length > 0, "Expected import boundary errors");
    assert.ok(
      result.errors.some(
        (e) =>
          e.includes("apps/mobile server-secret boundary violation") &&
          e.includes("@mizyun/adapter-supabase-server"),
      ),
      `Expected server-secret violation for mobile, got: ${result.errors.join("; ")}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("boundary check catches dynamic import of vendor SDK inside packages/core", () => {
  const tmpDir = path.join("/tmp", `test-core-dynamic-${Date.now()}`);
  try {
    const coreSrc = path.join(tmpDir, "packages/core/src");
    fs.mkdirSync(coreSrc, { recursive: true });
    fs.writeFileSync(
      path.join(coreSrc, "ai-service.ts"),
      `export async function getModel() {\n  const ai = await import("@google/genai");\n  return ai;\n}\n`,
      "utf8",
    );

    const result = validateImportBoundaries(tmpDir);
    assert.ok(result.errors.length > 0, "Expected core boundary errors");
    assert.ok(
      result.errors.some(
        (e) =>
          e.includes("packages/core boundary violation") &&
          e.includes("@google/genai"),
      ),
      `Expected packages/core boundary violation for @google/genai, got: ${result.errors.join("; ")}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("validateFeatureMapStructure catches invalid SHA, invalid relation type, missing migration, and missing doc", () => {
  const tmpDir = path.join("/tmp", `test-manifest-negative-${Date.now()}`);
  try {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });

    const invalidManifest = {
      schemaVersion: 1,
      features: [
        {
          id: "feat-multi-invalid",
          title: "Multi Invalid",
          summary: "Manifest with multiple invalid fields",
          aliases: [],
          entryPoints: [],
          ownedPaths: [],
          relations: [
            {
              type: "invalidType",
              target: "feat-multi-invalid",
              reason: "invalid relation type test",
            },
          ],
          migrationPaths: [
            "supabase/migrations/20990101000000_nonexistent.sql",
          ],
          docs: ["docs/nonexistent-reference.md#heading"],
          verificationCommands: [],
          lastReviewedSha: "not-a-valid-sha",
          lastReviewedDate: "2026-09-09",
        },
      ],
    };

    fs.writeFileSync(
      path.join(tmpDir, "docs/feature-map.json"),
      JSON.stringify(invalidManifest),
      "utf8",
    );

    const result = validateFeatureMapStructure(tmpDir);
    assert.ok(
      result.errors.length >= 4,
      `Expected at least 4 errors, got: ${result.errors.length}`,
    );

    assert.ok(
      result.errors.some((e) =>
        e.includes("invalid lastReviewedSha: 'not-a-valid-sha'"),
      ),
      "Missing invalid lastReviewedSha error",
    );
    assert.ok(
      result.errors.some((e) =>
        e.includes("invalid relation type 'invalidType'"),
      ),
      "Missing invalid relation type error",
    );
    assert.ok(
      result.errors.some((e) =>
        e.includes(
          "references non-existent path in migrationPaths: 'supabase/migrations/20990101000000_nonexistent.sql'",
        ),
      ),
      "Missing non-existent migrationPaths error",
    );
    assert.ok(
      result.errors.some((e) =>
        e.includes(
          "references non-existent doc: 'docs/nonexistent-reference.md'",
        ),
      ),
      "Missing non-existent doc error",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("validateFeatureMapStructure catches symlink escaping the repository root", () => {
  const tmpDir = path.join("/tmp", `test-symlink-root-${Date.now()}`);
  const outsideFile = path.join("/tmp", `test-outside-file-${Date.now()}.txt`);

  try {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "packages/core/src"), { recursive: true });
    fs.writeFileSync(outsideFile, "outside content", "utf8");

    const symlinkPath = path.join(
      tmpDir,
      "packages/core/src/symlink-escape.ts",
    );
    fs.symlinkSync(outsideFile, symlinkPath);

    const manifest = {
      schemaVersion: 1,
      features: [
        {
          id: "symlink-feat",
          title: "Symlink Feature",
          summary: "Symlink escape test",
          aliases: [],
          entryPoints: ["packages/core/src/symlink-escape.ts"],
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
      JSON.stringify(manifest),
      "utf8",
    );

    const result = validateFeatureMapStructure(tmpDir);
    assert.ok(result.errors.length > 0, "Expected errors for symlink escape");
    assert.ok(
      result.errors.some((e) =>
        e.includes("symlink resolves outside repository"),
      ),
      `Expected symlink escape error, got: ${result.errors.join("; ")}`,
    );
  } finally {
    if (fs.existsSync(outsideFile)) fs.unlinkSync(outsideFile);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("validateMarkdownLinks catches broken relative markdown links and missing heading anchors", () => {
  const tmpDir = path.join("/tmp", `test-md-links-${Date.now()}`);
  try {
    const docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });

    // Create required documents so they don't trigger "Document to validate not found"
    const standardDocs = [
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

    for (const doc of standardDocs) {
      const full = path.join(tmpDir, doc);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `# ${path.basename(doc)}\n\nContent\n`, "utf8");
    }

    // In docs/START_HERE.md, introduce:
    // 1. Broken link to non-existent markdown file
    // 2. Broken anchor to existing document
    fs.writeFileSync(
      path.join(tmpDir, "docs/START_HERE.md"),
      `# Start Here\n\nLink to [missing doc](nonexistent-guide.md) and [missing anchor](ARCHITECTURE.md#nonexistent-heading).\n`,
      "utf8",
    );

    const result = validateMarkdownLinks(tmpDir);
    assert.ok(
      result.errors.length >= 2,
      `Expected at least 2 link errors, got: ${result.errors.join("; ")}`,
    );

    assert.ok(
      result.errors.some((e) =>
        e.includes("Link target does not exist: 'nonexistent-guide.md'"),
      ),
      "Missing broken link target error",
    );
    assert.ok(
      result.errors.some((e) =>
        e.includes(
          "Anchor '#nonexistent-heading' not found in target 'docs/ARCHITECTURE.md'",
        ),
      ),
      "Missing broken anchor error",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("validateMarkdownLinks validates canonical pattern source paths in docs/patterns/README.md for disk existence", () => {
  const tmpDir = path.join("/tmp", `test-pattern-source-${Date.now()}`);
  try {
    // Create required standard docs
    const standardDocs = [
      "AGENTS.md",
      "status.md",
      "docs/START_HERE.md",
      "docs/ARCHITECTURE.md",
      "docs/SESSION_GUIDE.md",
      "docs/adr/README.md",
      "docs/tutorials/README.md",
      "docs/AGENT_NAVIGATION_ACCEPTANCE.md",
    ];
    for (const doc of standardDocs) {
      const full = path.join(tmpDir, doc);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `# ${path.basename(doc)}\n`, "utf8");
    }

    // Create docs/patterns/README.md citing a non-existent source file
    const patternsPath = path.join(tmpDir, "docs/patterns/README.md");
    fs.mkdirSync(path.dirname(patternsPath), { recursive: true });
    fs.writeFileSync(
      patternsPath,
      `# Patterns\n\n### PAT-999: Test Pattern\n- **Canonical Sources**:\n  - \`packages/core/src/ghost-pattern.ts\`\n`,
      "utf8",
    );

    const result = validateMarkdownLinks(tmpDir);
    assert.ok(
      result.errors.length > 0,
      "Expected error for non-existent canonical pattern source",
    );
    assert.ok(
      result.errors.some((e) =>
        e.includes(
          "Canonical pattern path does not exist: 'packages/core/src/ghost-pattern.ts'",
        ),
      ),
      `Expected canonical pattern error, got: ${result.errors.join("; ")}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
