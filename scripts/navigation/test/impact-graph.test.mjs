import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  analyzeImpact,
  parseImpactArgs,
  renderImpactReport,
} from "../impact.mjs";

function fixture(extraFiles = {}) {
  const root = fs.mkdtempSync("/tmp/mizyun-impact-graph-");
  const write = (file, value) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, value);
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  git("init");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");
  const files = {
    ".gitignore": ".cache/\n",
    "pnpm-workspace.yaml": "packages:\n  - 'modules/*'\n",
    "package.json": JSON.stringify({ private: true }),
    "modules/logic/package.json": JSON.stringify({
      name: "@graph/logic",
      exports: "./src/barrel.ts",
    }),
    "modules/ui/package.json": JSON.stringify({
      name: "@graph/ui",
      dependencies: { "@graph/logic": "workspace:*" },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@logic/*": ["modules/logic/src/*"] },
      },
    }),
    "modules/logic/src/value.ts":
      "export const value = 1;\nexport type Value = number;\n",
    "modules/logic/src/barrel.ts": "export { value } from './value.js';\n",
    "modules/logic/src/helper.ts":
      "import { value } from './barrel.js';\nexport const helper = value;\n",
    "modules/ui/src/screen.ts":
      "import { helper } from '../../logic/src/helper.js';\nexport const screen = helper;\n",
    "modules/ui/src/workspace.ts":
      "import { value } from '@graph/logic';\nexport const workspace = value;\n",
    "modules/ui/src/alias.ts":
      "import type { Value } from '@logic/value';\nexport type Alias = Value;\n",
    "modules/ui/src/screen.test.ts":
      "import { screen } from './screen.js';\nvoid screen;\n",
    "modules/logic/src/types.ts":
      "import type { Value } from './value.js';\nexport type Copy = Value;\n",
    "modules/ui/src/unrelated.ts": "export const unrelated = true;\n",
    "docs/feature-map.json": JSON.stringify({
      schemaVersion: 1,
      features: [
        {
          id: "value",
          title: "Value",
          ownedPaths: ["modules/logic/src/value.ts"],
          relations: [],
        },
        {
          id: "screen",
          title: "Screen",
          ownedPaths: ["modules/ui/src/screen.ts"],
          relations: [],
        },
        {
          id: "unrelated",
          title: "Unrelated",
          ownedPaths: ["modules/ui/src/unrelated.ts"],
          relations: [],
        },
      ],
    }),
    ...extraFiles,
  };
  for (const [file, text] of Object.entries(files)) write(file, text);
  git("add", ".");
  git("commit", "-m", "Fixture baseline");
  return {
    root,
    git,
    write,
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("real source graph reaches same-package reexports, multiple hops and unlisted tests", () => {
  const f = fixture();
  try {
    f.write(
      "modules/logic/src/value.ts",
      "export const value = 2;\nexport type Value = number;\n",
    );
    const report = analyzeImpact(f.root);
    const screen = report.sourceImpacts.find(
      (impact) => impact.path === "modules/ui/src/screen.ts",
    );
    assert.equal(
      screen.reasons[0].reasonChain,
      "modules/logic/src/value.ts -> modules/logic/src/barrel.ts -> modules/logic/src/helper.ts -> modules/ui/src/screen.ts",
    );
    assert.equal(screen.reasons[0].edges.length, 3);
    assert.ok(screen.reasons[0].edges.every((edge) => edge.line > 0));
    assert.ok(
      report.sourceImpacts.some(
        (impact) => impact.path === "modules/logic/src/helper.ts",
      ),
    );
    assert.ok(
      report.sourceImpacts.some(
        (impact) => impact.path === "modules/ui/src/workspace.ts",
      ),
    );
    assert.ok(report.suggestedTests.includes("modules/ui/src/screen.test.ts"));
    assert.ok(
      report.coverage.unmappedImpactedFiles.includes(
        "modules/ui/src/screen.test.ts",
      ),
    );
    assert.equal(
      report.propagatedImpacts.find((impact) => impact.id === "screen").signal,
      "source-reverse-dep",
    );
    const coarse = report.propagatedImpacts.find(
      (impact) => impact.id === "unrelated",
    );
    assert.equal(coarse.signal, "package-reverse-dep");
    assert.equal(coarse.coarse, true);
    assert.ok(
      !report.sourceImpacts.some(
        (impact) => impact.path === "modules/ui/src/unrelated.ts",
      ),
    );
  } finally {
    f.close();
  }
});

test("type alias imports stay distinguishable from runtime consumers", () => {
  const f = fixture();
  try {
    const report = analyzeImpact(f.root, "HEAD", {
      path: "modules/logic/src/value.ts",
    });
    assert.equal(report.git.hasLocalChanges, false);
    assert.deepEqual(
      report.sourceImpacts.find(
        (impact) => impact.path === "modules/ui/src/alias.ts",
      ).signals,
      ["type-import"],
    );
    assert.deepEqual(
      report.sourceImpacts.find(
        (impact) => impact.path === "modules/ui/src/screen.ts",
      ).signals,
      ["runtime-import"],
    );
    assert.equal(report.coverage.traversal.truncated, false);
  } finally {
    f.close();
  }
});

test("source cycles terminate and bounds report truncation explicitly", () => {
  const files = {
    "modules/logic/src/value.ts":
      "import './cycle.js';\nexport const value = 1;\n",
    "modules/logic/src/cycle.ts": "export { value } from './value.js';\n",
  };
  for (let i = 0; i < 70; i++) {
    files[`modules/logic/src/hop-${i}.ts`] =
      `import './${i ? `hop-${i - 1}` : "value"}.js';\n`;
  }
  const f = fixture(files);
  try {
    const report = analyzeImpact(f.root, "HEAD", {
      path: "modules/logic/src/value.ts",
    });
    assert.equal(
      report.sourceImpacts.filter(
        (impact) => impact.path === "modules/logic/src/cycle.ts",
      ).length,
      1,
    );
    assert.equal(report.coverage.traversal.truncated, true);
    assert.ok(
      report.sourceImpacts.some(
        (impact) => impact.path === "modules/logic/src/hop-63.ts",
      ),
    );
    assert.ok(
      !report.sourceImpacts.some(
        (impact) => impact.path === "modules/logic/src/hop-64.ts",
      ),
    );
    assert.ok(
      report.coverage.warnings.some((warning) => /bound/.test(warning)),
    );
  } finally {
    f.close();
  }
});

test("cold deleted relative target surfaces conservative importers and multi-hop tests", () => {
  const f = fixture();
  try {
    fs.unlinkSync(path.join(f.root, "modules/logic/src/value.ts"));
    const report = analyzeImpact(f.root);
    const barrel = report.sourceImpacts.find(
      (impact) => impact.path === "modules/logic/src/barrel.ts",
    );
    assert.ok(barrel.signals.includes("unresolved-import"));
    assert.equal(barrel.reasons[0].conservative, true);
    const types = report.sourceImpacts.find(
      (impact) => impact.path === "modules/logic/src/types.ts",
    );
    assert.ok(types.signals.includes("type-import"));
    assert.ok(types.signals.includes("unresolved-import"));
    assert.equal(types.reasons[0].signal, "type-only");
    assert.ok(
      report.sourceImpacts.find(
        (impact) => impact.path === "modules/ui/src/screen.ts",
      ).reasons[0].conservative,
    );
    assert.ok(report.suggestedTests.includes("modules/ui/src/screen.test.ts"));
    assert.ok(
      report.coverage.unresolvedImports.some(
        (entry) => entry.specifier === "./value.js",
      ),
    );
  } finally {
    f.close();
  }
});

test("staged move preserves old target consumers without cached historical edges", () => {
  const f = fixture();
  try {
    f.git("mv", "modules/logic/src/value.ts", "modules/logic/src/moved.ts");
    const report = analyzeImpact(f.root);
    assert.ok(report.analyzedFiles.includes("modules/logic/src/value.ts"));
    assert.ok(report.analyzedFiles.includes("modules/logic/src/moved.ts"));
    assert.ok(
      report.sourceImpacts
        .find((impact) => impact.path === "modules/logic/src/barrel.ts")
        .signals.includes("unresolved-import"),
    );
  } finally {
    f.close();
  }
});

test("root configuration change reports coarse scope and test coverage", () => {
  const f = fixture();
  try {
    f.write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    const report = analyzeImpact(f.root);
    const config = report.configurationImpacts.find(
      (impact) => impact.path === "tsconfig.json",
    );
    assert.equal(config.scope, ".");
    assert.equal(config.coarse, true);
    assert.equal(
      report.propagatedImpacts.find((impact) => impact.id === "screen").signal,
      "configuration-scope",
    );
    assert.ok(report.suggestedTests.includes("modules/ui/src/screen.test.ts"));
    assert.ok(
      report.coverage.unresolvedImports.some(
        (entry) => entry.specifier === "@logic/value",
      ),
    );
  } finally {
    f.close();
  }
});

test("successive analyses refresh edited, added and removed source edges", () => {
  const f = fixture();
  try {
    const first = analyzeImpact(f.root, "HEAD", {
      path: "modules/logic/src/value.ts",
    });
    assert.ok(
      first.sourceImpacts.some(
        (impact) => impact.path === "modules/ui/src/screen.ts",
      ),
    );
    f.write("modules/ui/src/screen.ts", "export const screen = 0;\n");
    f.write(
      "modules/ui/src/new.ts",
      "import { value } from '../../logic/src/value.js';\nvoid value;\n",
    );
    f.git("add", ".");
    f.git("commit", "-m", "Update source edges");
    const next = analyzeImpact(f.root, "HEAD", {
      path: "modules/logic/src/value.ts",
    });
    assert.notEqual(next.coverage.snapshot.id, first.coverage.snapshot.id);
    assert.ok(
      !next.sourceImpacts.some(
        (impact) => impact.path === "modules/ui/src/screen.ts",
      ),
    );
    assert.ok(
      next.sourceImpacts.some(
        (impact) => impact.path === "modules/ui/src/new.ts",
      ),
    );
    fs.unlinkSync(path.join(f.root, "modules/ui/src/new.ts"));
    const last = analyzeImpact(f.root, "HEAD", {
      path: "modules/logic/src/value.ts",
    });
    assert.ok(
      !last.sourceImpacts.some(
        (impact) => impact.path === "modules/ui/src/new.ts",
      ),
    );
    assert.throws(
      () => analyzeImpact(f.root, "HEAD", { path: "../outside.ts" }),
      /inside the repository/,
    );
  } finally {
    f.close();
  }
});

test("a concrete changed dependency does not hide a deleted dependency's conservative reason", () => {
  const f = fixture({
    "modules/logic/src/also.ts": "export const also = 1;\n",
    "modules/logic/src/barrel.ts":
      "export { also } from './also.js';\nexport { value } from './value.js';\n",
  });
  try {
    f.write("modules/logic/src/also.ts", "export const also = 2;\n");
    fs.unlinkSync(path.join(f.root, "modules/logic/src/value.ts"));
    const report = analyzeImpact(f.root);
    const screen = report.sourceImpacts.find(
      (impact) => impact.path === "modules/ui/src/screen.ts",
    );
    assert.ok(
      screen.reasons.some(
        (reason) =>
          reason.origin === "modules/logic/src/also.ts" && !reason.conservative,
      ),
    );
    assert.ok(
      screen.reasons.some(
        (reason) =>
          reason.origin === "modules/logic/src/value.ts" && reason.conservative,
      ),
    );
    assert.ok(screen.signals.includes("unresolved-import"));
  } finally {
    f.close();
  }
});

test("deleted alias target reaches its consumers and tests on a cold snapshot", () => {
  const f = fixture({
    "modules/ui/src/alias.test.ts":
      "import type { Alias } from './alias.js';\nexport type Check = Alias;\n",
  });
  try {
    fs.unlinkSync(path.join(f.root, "modules/logic/src/value.ts"));
    const report = analyzeImpact(f.root);
    const alias = report.sourceImpacts.find(
      (impact) => impact.path === "modules/ui/src/alias.ts",
    );
    assert.ok(alias.signals.includes("unresolved-import"));
    assert.equal(alias.reasons[0].conservative, true);
    assert.ok(report.suggestedTests.includes("modules/ui/src/alias.test.ts"));
  } finally {
    f.close();
  }
});

test("deleted relative target preserves consumers when directory index fallback resolves", () => {
  const f = fixture({
    "modules/logic/src/value/index.ts": "export const value = 3;\n",
    "modules/logic/src/barrel.ts": "export { value } from './value';\n",
  });
  try {
    fs.unlinkSync(path.join(f.root, "modules/logic/src/value.ts"));
    const report = analyzeImpact(f.root);
    const barrel = report.sourceImpacts.find(
      (impact) => impact.path === "modules/logic/src/barrel.ts",
    );
    assert.ok(barrel.signals.includes("unresolved-import"));
    assert.equal(barrel.reasons[0].origin, "modules/logic/src/value.ts");
    assert.ok(report.suggestedTests.includes("modules/ui/src/screen.test.ts"));
    assert.ok(
      !report.coverage.unresolvedImports.some(
        (entry) => entry.file === "modules/logic/src/barrel.ts",
      ),
    );
  } finally {
    f.close();
  }
});

test("deleted workspace export target retains package consumers and discovered tests", () => {
  const f = fixture({
    "modules/logic/package.json": JSON.stringify({
      name: "@graph/logic",
      exports: "./src/value.ts",
    }),
    "modules/ui/src/workspace.test.ts":
      "import { workspace } from './workspace.js';\nvoid workspace;\n",
  });
  try {
    fs.unlinkSync(path.join(f.root, "modules/logic/src/value.ts"));
    const report = analyzeImpact(f.root);
    const workspace = report.sourceImpacts.find(
      (impact) => impact.path === "modules/ui/src/workspace.ts",
    );
    assert.ok(workspace.signals.includes("unresolved-import"));
    assert.equal(workspace.reasons[0].origin, "modules/logic/src/value.ts");
    assert.ok(
      report.suggestedTests.includes("modules/ui/src/workspace.test.ts"),
    );
  } finally {
    f.close();
  }
});

test("impact rejects a feature map changed between reading routing and capturing source", () => {
  const f = fixture();
  const read = fs.readFileSync;
  let mapReads = 0;
  try {
    const target = path.join(f.root, "docs/feature-map.json");
    fs.readFileSync = function (file, ...args) {
      const content = read.call(this, file, ...args);
      if (file === target && ++mapReads === 2)
        f.write(
          "docs/feature-map.json",
          JSON.stringify({ schemaVersion: 1, features: [] }),
        );
      return content;
    };
    assert.throws(
      () => analyzeImpact(f.root),
      /Repository changed during impact capture/,
    );
  } finally {
    fs.readFileSync = read;
    f.close();
  }
});

test("impact rejects changed file inventory introduced during source capture", () => {
  const f = fixture();
  const read = fs.readFileSync;
  let introduced = false;
  try {
    fs.readFileSync = function (file, ...args) {
      const content = read.call(this, file, ...args);
      // The index reads safe opened file descriptors. This simulates a write
      // after the initial Git inventory without relying on timing races.
      if (typeof file === "number" && !introduced) {
        introduced = true;
        f.write("docs/concurrent.md", "# Concurrent addition\n");
      }
      return content;
    };
    assert.throws(
      () => analyzeImpact(f.root),
      /Repository changed during impact capture/,
    );
    assert.equal(introduced, true);
  } finally {
    fs.readFileSync = read;
    f.close();
  }
});

test("selected paths exclude unrelated staged, unstaged and untracked seeds", () => {
  const f = fixture();
  try {
    f.write("modules/ui/src/unrelated.ts", "export const unrelated = false;\n");
    f.git("add", "modules/ui/src/unrelated.ts");
    f.write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    f.write("docs/unrelated.md", "# Unrelated note\n");
    const report = analyzeImpact(f.root, "HEAD", {
      paths: ["modules/logic/src/value.ts", "modules/logic/src/./value.ts"],
    });
    assert.deepEqual(report.analyzedFiles, ["modules/logic/src/value.ts"]);
    assert.equal(report.configurationImpacts.length, 0);
    assert.ok(
      !report.directImpacts.some((impact) => impact.id === "unrelated"),
    );
    assert.equal(report.scope.mode, "selected-paths");
    assert.equal(report.scope.excludedChangeCount, 3);
    assert.equal(report.scope.includeWorkingTree, false);
    assert.equal(report.git.hasLocalChanges, true);
  } finally {
    f.close();
  }
});

test("working tree inclusion is explicit and no-path since keeps legacy change scope", () => {
  const f = fixture();
  try {
    const base = f.git("rev-parse", "HEAD");
    f.write("modules/ui/src/unrelated.ts", "export const unrelated = false;\n");
    f.git("add", ".");
    f.git("commit", "-m", "Unrelated committed change");
    f.write("docs/untracked.md", "# Untracked\n");
    const selected = analyzeImpact(f.root, base, {
      path: "modules/logic/src/value.ts",
    });
    assert.deepEqual(selected.analyzedFiles, ["modules/logic/src/value.ts"]);
    const combined = analyzeImpact(f.root, base, {
      path: "modules/logic/src/value.ts",
      includeWorkingTree: true,
    });
    assert.deepEqual(combined.analyzedFiles, [
      "docs/untracked.md",
      "modules/logic/src/value.ts",
      "modules/ui/src/unrelated.ts",
    ]);
    assert.equal(combined.scope.mode, "combined");
    const legacy = analyzeImpact(f.root, base);
    assert.deepEqual(legacy.analyzedFiles, [
      "docs/untracked.md",
      "modules/ui/src/unrelated.ts",
    ]);
    assert.equal(legacy.scope.mode, "changes");
    assert.equal(legacy.git.baseSha, base);
  } finally {
    f.close();
  }
});

test("selected deletion and configuration retain their own advisory boundary", () => {
  const f = fixture();
  try {
    fs.unlinkSync(path.join(f.root, "modules/logic/src/value.ts"));
    f.write("docs/noise.md", "# Noise\n");
    const deletion = analyzeImpact(f.root, "HEAD", {
      path: "modules/logic/src/value.ts",
    });
    assert.ok(
      deletion.sourceImpacts.some(
        (impact) =>
          impact.path === "modules/ui/src/alias.ts" &&
          impact.signals.includes("type-import"),
      ),
    );
    assert.ok(
      deletion.suggestedTests.includes("modules/ui/src/screen.test.ts"),
    );
    const config = analyzeImpact(f.root, "HEAD", { path: "tsconfig.json" });
    assert.deepEqual(config.analyzedFiles, ["tsconfig.json"]);
    assert.equal(config.configurationImpacts[0].coarse, true);
    assert.ok(config.suggestedTests.includes("modules/ui/src/screen.test.ts"));
    assert.equal(config.scope.excludedLocalChangeCount, 2);
  } finally {
    f.close();
  }
});

test("impact argument parser accepts deliberate scopes and rejects unknown, duplicate or conflicting flags", () => {
  const valid = parseImpactArgs([
    "--path",
    "a.ts",
    "--path",
    "a.ts",
    "--since",
    "main",
    "--include-working-tree",
    "--budget-bytes",
    "4096",
  ]);
  assert.deepEqual(valid.paths, ["a.ts", "a.ts"]);
  assert.equal(valid.sinceRef, "main");
  assert.equal(valid.includeWorkingTree, true);
  assert.equal(valid.budgetBytes, 4096);
  for (const args of [
    ["--unknown"],
    ["bare-path.ts"],
    ["--path"],
    ["--path", "--json"],
    ["--since"],
    ["--since", "HEAD", "--since", "main"],
    ["--json", "--json"],
    ["--include-working-tree"],
    ["--json", "--all"],
    ["--all", "--budget-bytes", "2048"],
    ["--json", "--budget-bytes", "2048"],
    ["--budget-bytes", "2e3"],
    ["--budget-bytes", "2047"],
    ["--budget-bytes", "1048577"],
    ["--budget-bytes", "4096", "--budget-bytes", "8192"],
  ])
    assert.throws(() => parseImpactArgs(args), Error, JSON.stringify(args));
  assert.equal(parseImpactArgs(["--all"]).all, true);
  assert.equal(parseImpactArgs(["-h"]).help, true);
});

test("human impact output respects UTF-8 bytes and lines with exact omissions and early tests", () => {
  const f = fixture();
  try {
    const report = analyzeImpact(f.root, "HEAD", {
      path: "modules/logic/src/value.ts",
    });
    report.suggestedTests = Array.from(
      { length: 160 },
      (_, i) => `tests/例-${i}.test.ts`,
    );
    report.suggestedCommands = ["pnpm check"];
    report.propagatedImpacts.push({
      id: "long",
      title: "界".repeat(10000),
      signal: "coarse",
      reasonChain: "界".repeat(10000),
    });
    const rendered = renderImpactReport(report, { budgetBytes: 2048 });
    assert.ok(rendered.bytes <= 2048);
    assert.ok(rendered.lines <= 120);
    assert.equal(rendered.bytes, Buffer.byteLength(rendered.text + "\n"));
    const shownTests = rendered.text
      .split("\n")
      .filter((line) => line.startsWith("Test: ")).length;
    assert.ok(shownTests > 0);
    assert.equal(rendered.omissions.tests, 160 - shownTests);
    assert.match(rendered.text, new RegExp(`tests=${160 - shownTests}`));
    assert.match(rendered.text, /do NOT waive pnpm check or release gates/);
    assert.match(rendered.text, /may miss runtime behavior/);
    assert.match(rendered.text, /use --json or --all/);
    const defaultOutput = renderImpactReport(report);
    assert.ok(defaultOutput.bytes <= 8192);
    assert.ok(defaultOutput.lines <= 120);
    assert.match(
      defaultOutput.text,
      /Selected: modules\/logic\/src\/value\.ts/,
    );
    assert.match(defaultOutput.text, /Check \(advisory\): pnpm check/);
    assert.match(defaultOutput.text, /Source: modules\/logic\/src\/barrel\.ts/);
    assert.match(
      defaultOutput.text,
      /Reason: modules\/logic\/src\/value\.ts -> modules\/logic\/src\/barrel\.ts/,
    );
    assert.match(defaultOutput.text, /Warning:/);
    const complete = renderImpactReport(report, { all: true });
    assert.ok(complete.bytes > 8192);
    assert.ok(Object.values(complete.omissions).every((value) => value === 0));
    assert.equal(complete.text.match(/^Test: /gm).length, 160);
    const lineLimited = renderImpactReport(report, { maxLines: 8 });
    assert.equal(lineLimited.lines, 8);
    assert.equal(lineLimited.omissions.seeds, 0);
    assert.equal(lineLimited.omissions.tests, 160);
  } finally {
    f.close();
  }
});

test("CLI exposes selected scope as JSON and rejects flags before repository work", () => {
  const f = fixture();
  const cli = new URL("../impact.mjs", import.meta.url);
  try {
    f.write("docs/dirty.md", "# Dirty\n");
    const raw = execFileSync(
      process.execPath,
      [cli.pathname, "--path", "modules/logic/src/value.ts", "--json"],
      { cwd: f.root, encoding: "utf8" },
    );
    const report = JSON.parse(raw);
    assert.equal(report.scope.mode, "selected-paths");
    assert.deepEqual(report.analyzedFiles, ["modules/logic/src/value.ts"]);
    assert.equal(report.scope.excludedLocalChangeCount, 1);
    assert.throws(
      () =>
        execFileSync(process.execPath, [cli.pathname, "--typo"], {
          cwd: "/tmp",
          stdio: "pipe",
        }),
      (error) =>
        error.status === 1 && /Unknown option/.test(error.stderr.toString()),
    );
    const human = execFileSync(
      process.execPath,
      [
        cli.pathname,
        "--path",
        "modules/logic/src/value.ts",
        "--budget-bytes",
        "2048",
      ],
      { cwd: f.root, encoding: "utf8" },
    );
    assert.ok(Buffer.byteLength(human) <= 2048);
    assert.ok(human.trimEnd().split("\n").length <= 120);
  } finally {
    f.close();
  }
});
