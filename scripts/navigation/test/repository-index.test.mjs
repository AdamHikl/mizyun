import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getRepositoryIndex, isIndexablePath } from "../repository-index.mjs";

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "mizyun-index-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, content) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(
      path.join(root, relative),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  };
  const git = (args, cwd = root) =>
    execFileSync(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  git(["init"]);
  git(["config", "user.email", "fixture@example.com"]);
  git(["config", "user.name", "Fixture"]);
  write(".gitignore", ".cache/\nnode_modules/\nignored.ts\n");
  write(
    "pnpm-workspace.yaml",
    "packages:\n  - modules/*\n  - '!modules/excluded'\n",
  );
  write("tsconfig.base.json", {
    compilerOptions: {
      moduleResolution: "Bundler",
      module: "ESNext",
      baseUrl: ".",
      paths: { "@local/*": ["modules/consumer/src/*"] },
    },
  });
  write("tsconfig.json", { extends: "./tsconfig.base.json" });
  write("modules/producer/package.json", {
    name: "@fixture/producer",
    exports: {
      ".": { types: "./src/index.ts", default: "./dist/index.js" },
      "./types": "./src/types.ts",
      "./*": "./src/*.ts",
    },
  });
  write(
    "modules/producer/src/index.ts",
    'export { value } from "./value.js";\nexport type { Shape } from "./types.js";\n',
  );
  write("modules/producer/src/value.ts", "export const value = 1;\n");
  write(
    "modules/producer/src/types.ts",
    "export interface Shape { value: number }\n",
  );
  write("modules/consumer/package.json", {
    name: "@fixture/consumer",
    dependencies: { "@fixture/producer": "workspace:*" },
  });
  write("modules/consumer/src/local.ts", "export function local() {}\n");
  write(
    "modules/consumer/src/index.ts",
    'import { value } from "@fixture/producer";\nimport type { Shape } from "@fixture/producer/types";\nexport * from "@local/local";\nconst lazy = import("./later");\nconst cjs = require("../src/local.js");\nconst runtime = import(getPath());\nconst uncertain = require(name);\nexport type Remote = import("@fixture/producer/types").Shape;\n',
  );
  write(
    "README.md",
    "# Index fixture\n\n~~~js\n# Not a heading\n~~~\n\nReal heading\n============\n",
  );
  git(["add", "."]);
  git(["commit", "-m", "Fixture baseline"]);
  return { root, write, git };
}
const file = (index, relative) =>
  index.files.find((item) => item.path === relative);
const consumer = "modules/consumer/src/index.ts";

test("source index resolves workspace exports, aliases, barrels, literal calls and types", (t) => {
  const { root } = fixture(t);
  const index = getRepositoryIndex(root, { cache: false });
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.snapshot.headSha.length, 40);
  assert.equal(index.packages.length, 2);
  assert.deepEqual(
    index.packages.find((pkg) => pkg.name === "@fixture/consumer").dependencies,
    ["@fixture/producer"],
  );
  assert.ok(
    index.edges.some(
      (edge) =>
        edge.from === consumer && edge.to === "modules/producer/src/index.ts",
    ),
  );
  assert.ok(
    index.edges.some(
      (edge) =>
        edge.from === consumer &&
        edge.to.endsWith("/local.ts") &&
        edge.specifier === "@local/local",
    ),
  );
  assert.ok(
    index.edges.some(
      (edge) =>
        edge.from.endsWith("producer/src/index.ts") &&
        edge.to.endsWith("/value.ts"),
    ),
  );
  assert.equal(
    file(index, consumer).imports.filter((item) => item.typeOnly).length,
    2,
  );
  assert.equal(
    index.unresolved.filter((item) => item.kind === "nonliteral").length,
    2,
  );
  assert.ok(
    index.unresolved.some(
      (item) => item.specifier === "./later" && item.kind === "missing",
    ),
  );
  assert.deepEqual(file(index, "modules/producer/src/types.ts").symbols, [
    { name: "Shape", kind: "interface", line: 1 },
  ]);
  assert.deepEqual(file(index, "README.md").headings, [
    { title: "Index fixture", line: 1 },
    { title: "Real heading", line: 7 },
  ]);
  const fallback = index.edges.find(
    (edge) => edge.from === consumer && edge.specifier === "@fixture/producer",
  );
  assert.equal(fallback.typeOnly, true);
  assert.equal(fallback.uncertain, true);
  assert.equal(fs.existsSync(path.join(root, ".cache")), false);
});

test("warm cache reuses parses while dirty and untracked edits retain current provenance", (t) => {
  const { root, write } = fixture(t);
  const initial = getRepositoryIndex(root);
  const warm = getRepositoryIndex(root);
  assert.equal(warm.stats.parsed, 0);
  assert.equal(warm.stats.reused, warm.files.length);
  assert.equal(initial.snapshot.id, warm.snapshot.id);
  write("modules/producer/src/value.ts", "export const changed = 2;\n");
  write(
    "modules/consumer/src/untracked.ts",
    "export const untracked = true;\n",
  );
  write("ignored.ts", "export const ignored = true;\n");
  const changed = getRepositoryIndex(root);
  assert.notEqual(changed.snapshot.id, warm.snapshot.id);
  assert.equal(changed.snapshot.headSha, warm.snapshot.headSha);
  assert.equal(changed.stats.parsed, 2);
  assert.equal(
    file(changed, "modules/producer/src/value.ts").symbols[0].name,
    "changed",
  );
  assert.ok(file(changed, "modules/consumer/src/untracked.ts"));
  assert.equal(file(changed, "ignored.ts"), undefined);
});

test("deleted and renamed files disappear and formerly missing directory indexes resolve", (t) => {
  const { root, write, git } = fixture(t);
  getRepositoryIndex(root);
  fs.unlinkSync(path.join(root, "modules/producer/src/value.ts"));
  git([
    "mv",
    "modules/consumer/src/local.ts",
    "modules/consumer/src/renamed.ts",
  ]);
  write("modules/consumer/src/later/index.ts", "export const later = true;\n");
  const changed = getRepositoryIndex(root);
  assert.equal(file(changed, "modules/producer/src/value.ts"), undefined);
  assert.equal(file(changed, "modules/consumer/src/local.ts"), undefined);
  assert.ok(file(changed, "modules/consumer/src/renamed.ts"));
  assert.ok(
    changed.edges.some(
      (edge) =>
        edge.specifier === "./later" && edge.to.endsWith("/later/index.ts"),
    ),
  );
  assert.ok(changed.unresolved.some((item) => item.specifier === "./value.js"));
  assert.ok(!changed.edges.some((edge) => edge.to.endsWith("/value.ts")));
});

test("inherited path and package export edits refresh resolution without reparsing unchanged source", (t) => {
  const { root, write } = fixture(t);
  const initial = getRepositoryIndex(root);
  write("tsconfig.base.json", {
    compilerOptions: {
      moduleResolution: "Bundler",
      module: "ESNext",
      baseUrl: ".",
      paths: { "@local/*": ["modules/producer/src/*"] },
    },
  });
  write("modules/producer/src/local.ts", "export const otherLocal = true;\n");
  write("modules/producer/package.json", {
    name: "@fixture/producer",
    exports: { ".": "./src/value.ts", "./types": "./src/types.ts" },
  });
  const changed = getRepositoryIndex(root);
  assert.notEqual(changed.snapshot.id, initial.snapshot.id);
  assert.ok(
    changed.edges.some(
      (edge) =>
        edge.from === consumer &&
        edge.specifier === "@fixture/producer" &&
        edge.to.endsWith("/value.ts"),
    ),
  );
  assert.ok(
    changed.edges.some(
      (edge) =>
        edge.specifier === "@local/local" &&
        edge.to === "modules/producer/src/local.ts",
    ),
  );
  assert.ok(changed.stats.reused >= initial.files.length - 2);
});

test("unsafe files and escaping source/config symlinks are never read or cached", (t) => {
  const { root, write } = fixture(t);
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "mizyun-index-private-"),
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(outside, "sensitive.ts"),
    "export const NEVER_READ_SECRET = true;",
  );
  fs.writeFileSync(
    path.join(outside, "tsconfig.json"),
    '{"compilerOptions":{"baseUrl":"NEVER_READ_SECRET"}}',
  );
  fs.symlinkSync(
    path.join(outside, "sensitive.ts"),
    path.join(root, "escape.ts"),
  );
  fs.symlinkSync(outside, path.join(root, "outside-directory"));
  fs.symlinkSync(
    path.join(outside, "tsconfig.json"),
    path.join(root, "external-tsconfig.json"),
  );
  write("tsconfig.json", { extends: "./external-tsconfig.json" });
  for (const relative of [
    ".env.ts",
    ".env.production",
    "private/export.ts",
    "docs/archive/old.md",
    "photos/test.ts",
    "logs/log.ts",
    "generated/out.ts",
  ])
    write(relative, "NEVER_READ_SECRET");
  write(
    "modules/consumer/src/session-token.ts",
    "export const safeDomainToken = true;",
  );
  const index = getRepositoryIndex(root);
  assert.equal(isIndexablePath(root, "escape.ts"), false);
  assert.equal(isIndexablePath(root, "../outside.ts"), false);
  assert.ok(
    !index.files.some(
      (item) =>
        item.path.includes("escape") ||
        item.path.startsWith("private/") ||
        item.path.startsWith("docs/archive/"),
    ),
  );
  assert.ok(file(index, "modules/consumer/src/session-token.ts"));
  assert.ok(
    index.warnings.some((warning) =>
      warning.includes("external-tsconfig.json"),
    ),
  );
  assert.ok(!JSON.stringify(index).includes("NEVER_READ_SECRET"));
  assert.ok(
    !fs
      .readFileSync(
        path.join(root, ".cache/mizyun-navigation/parse-cache.json"),
        "utf8",
      )
      .includes("NEVER_READ_SECRET"),
  );
});

test("corrupt cache and unsafe cache directory gracefully fall back to current parsing", (t) => {
  const { root } = fixture(t);
  getRepositoryIndex(root);
  fs.writeFileSync(
    path.join(root, ".cache/mizyun-navigation/parse-cache.json"),
    "{broken",
  );
  const repaired = getRepositoryIndex(root);
  assert.equal(repaired.stats.parsed, repaired.files.length);
  assert.ok(repaired.warnings.some((warning) => warning.includes("corrupt")));
  fs.rmSync(path.join(root, ".cache"), { recursive: true });
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "mizyun-cache-outside-"),
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(root, ".cache"));
  const fallback = getRepositoryIndex(root);
  assert.ok(
    fallback.warnings.some((warning) => warning.includes("could not be saved")),
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("branches and Git worktrees keep SHA, content and cache roots isolated", (t) => {
  const { root, write, git } = fixture(t);
  const initial = getRepositoryIndex(root);
  const worktree = path.join(root, "second-worktree");
  git(["worktree", "add", "-b", "fixture-other", worktree]);
  t.after(() => {
    try {
      git(["worktree", "remove", "--force", worktree]);
    } catch {
      /* fixture cleanup handles remainder */
    }
  });
  fs.writeFileSync(
    path.join(worktree, "modules/producer/src/value.ts"),
    "export const otherBranch = 3;\n",
  );
  git(["add", "modules/producer/src/value.ts"], worktree);
  git(["commit", "-m", "Other worktree commit"], worktree);
  const other = getRepositoryIndex(worktree);
  assert.notEqual(other.snapshot.root, initial.snapshot.root);
  assert.notEqual(other.snapshot.id, initial.snapshot.id);
  assert.notEqual(other.snapshot.headSha, initial.snapshot.headSha);
  assert.equal(other.stats.reused, 0);
  assert.equal(
    file(other, "modules/producer/src/value.ts").symbols[0].name,
    "otherBranch",
  );
  write("modules/producer/src/value.ts", "export const mainDirty = 4;\n");
  assert.equal(
    file(getRepositoryIndex(root), "modules/producer/src/value.ts").symbols[0]
      .name,
    "mainDirty",
  );
});

test("workspace exclusions and unsupported workspace syntax are explicit", (t) => {
  const { root, write } = fixture(t);
  write("modules/excluded/package.json", { name: "@fixture/excluded" });
  assert.ok(
    !getRepositoryIndex(root, { cache: false }).packages.some(
      (pkg) => pkg.name === "@fixture/excluded",
    ),
  );
  write("pnpm-workspace.yaml", 'packages: ["modules/*"]\n');
  assert.throws(
    () => getRepositoryIndex(root, { cache: false }),
    /Unsupported pnpm workspace/,
  );
});

test("safe installed config inheritance and lockfile changes contribute current provenance", (t) => {
  const { root, write } = fixture(t);
  write("node_modules/shared-config/tsconfig.base.json", {
    compilerOptions: {
      moduleResolution: "Bundler",
      module: "ESNext",
      baseUrl: root,
      paths: { "@local/*": ["modules/consumer/src/*"] },
    },
  });
  write("tsconfig.json", {
    extends: "./node_modules/shared-config/tsconfig.base.json",
  });
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write(
    "metro.config.mjs",
    'import { local } from "./modules/consumer/src/local.js";\nthrow new Error("CONFIG_MUST_NEVER_EXECUTE");\n',
  );
  const first = getRepositoryIndex(root);
  assert.ok(
    first.edges.some(
      (edge) =>
        edge.from === "metro.config.mjs" && edge.to.endsWith("/local.ts"),
    ),
  );
  assert.ok(first.edges.some((edge) => edge.specifier === "@local/local"));
  assert.ok(
    first.warnings.every((warning) => warning.includes("type-only fallback")),
  );
  assert.ok(!first.files.some((item) => item.path.startsWith("node_modules/")));
  write("node_modules/shared-config/tsconfig.base.json", {
    compilerOptions: {
      moduleResolution: "Bundler",
      module: "ESNext",
      baseUrl: root,
      paths: { "@local/*": ["modules/producer/src/*"] },
    },
  });
  const second = getRepositoryIndex(root);
  assert.notEqual(second.snapshot.id, first.snapshot.id);
  assert.ok(!second.edges.some((edge) => edge.specifier === "@local/local"));
  write(
    "pnpm-lock.yaml",
    "lockfileVersion: '9.0'\n# changed dependency resolution\n",
  );
  assert.notEqual(getRepositoryIndex(root).snapshot.id, second.snapshot.id);
});

test("snapshot revalidation retries a concurrent edit and fails after persistent edits", (t) => {
  const { root, write } = fixture(t);
  const originalRead = fs.readFileSync;
  let edits = 0;
  try {
    fs.readFileSync = function (...args) {
      const result = originalRead.apply(this, args);
      if (
        typeof result === "string" &&
        result === "export const value = 1;\n" &&
        edits++ === 0
      )
        write(
          "modules/producer/src/value.ts",
          "export const concurrent = true;\n",
        );
      return result;
    };
    const settled = getRepositoryIndex(root, { cache: false });
    assert.equal(
      file(settled, "modules/producer/src/value.ts").symbols[0].name,
      "concurrent",
    );
    write("modules/producer/src/value.ts", "export const moving = 0;\n");
    fs.readFileSync = function (...args) {
      const result = originalRead.apply(this, args);
      if (
        typeof result === "string" &&
        /^export const moving = \d+;\n$/.test(result)
      )
        write(
          "modules/producer/src/value.ts",
          `export const moving = ${++edits};\n`,
        );
      return result;
    };
    assert.throws(
      () => getRepositoryIndex(root, { cache: false }),
      /changed during indexing after three attempts/,
    );
  } finally {
    fs.readFileSync = originalRead;
  }
});

test("conditional exports route import, require and type dependencies to their actual source targets", (t) => {
  const { root, write } = fixture(t);
  write("modules/producer/package.json", {
    name: "@fixture/producer",
    exports: {
      ".": {
        types: "./src/types.ts",
        import: "./src/runtime.ts",
        require: "./src/cjs.ts",
      },
    },
  });
  write("modules/producer/src/runtime.ts", "export const runtime = true;\n");
  write("modules/producer/src/cjs.ts", "export const cjs = true;\n");
  write(
    consumer,
    'import { runtime } from "@fixture/producer";\nconst cjs = require("@fixture/producer");\nimport type { Shape } from "@fixture/producer";\nconst lazy = import("@fixture/producer");\nimport classic = require("@fixture/producer");\n',
  );
  const cold = getRepositoryIndex(root);
  const dependencies = cold.edges.filter((edge) => edge.from === consumer);
  assert.deepEqual(
    dependencies.map((edge) => [edge.line, edge.to, edge.typeOnly]),
    [
      [1, "modules/producer/src/runtime.ts", false],
      [2, "modules/producer/src/cjs.ts", false],
      [3, "modules/producer/src/types.ts", true],
      [4, "modules/producer/src/runtime.ts", false],
      [5, "modules/producer/src/cjs.ts", false],
    ],
  );
  assert.deepEqual(
    file(cold, consumer).imports.map((entry) => entry.mode),
    ["import", "require", "type", "import", "require"],
  );
  assert.equal(cold.warnings.length, 0);
  assert.deepEqual(
    getRepositoryIndex(root).edges,
    cold.edges,
    "warm cached parse preserves import modes",
  );
  write(
    "modules/producer/src/runtime.ts",
    "export const runtimeChanged = true;\n",
  );
  const changed = getRepositoryIndex(root);
  assert.notEqual(changed.snapshot.id, cold.snapshot.id);
  assert.ok(
    changed.edges.some(
      (edge) =>
        edge.from === consumer &&
        edge.to === "modules/producer/src/runtime.ts" &&
        !edge.typeOnly,
    ),
  );
});

test("deleted relative, alias and workspace candidates remain visible when an alternate index resolves", (t) => {
  const { root, write } = fixture(t);
  write("modules/producer/package.json", {
    name: "@fixture/producer",
    exports: { ".": "./src/value" },
  });
  write("tsconfig.base.json", {
    compilerOptions: {
      moduleResolution: "Bundler",
      module: "ESNext",
      baseUrl: ".",
      paths: { "@value": ["modules/producer/src/value"] },
    },
  });
  write(
    consumer,
    'import { value as direct } from "../../producer/src/value";\nimport { value as alias } from "@value";\nimport { value as workspace } from "@fixture/producer";\n',
  );
  getRepositoryIndex(root);
  fs.unlinkSync(path.join(root, "modules/producer/src/value.ts"));
  write("modules/producer/src/value/index.ts", "export const value = 2;\n");
  const changed = getRepositoryIndex(root);
  for (const dependency of file(changed, consumer).imports) {
    assert.equal(dependency.target, "modules/producer/src/value/index.ts");
    assert.ok(
      dependency.candidates.includes("modules/producer/src/value.ts"),
      dependency.specifier,
    );
    assert.ok(
      dependency.candidates.includes("modules/producer/src/value/index.ts"),
      dependency.specifier,
    );
    assert.ok(
      dependency.candidates.every(
        (relative) => !relative.startsWith("../") && !path.isAbsolute(relative),
      ),
    );
  }
});

const graphCacheFile = (root) =>
  path.join(root, ".cache/mizyun-navigation/graph-cache.json");
const inheritedOptions = (root, owner = "consumer") => ({
  compilerOptions: {
    moduleResolution: "Bundler",
    module: "ESNext",
    baseUrl: root,
    paths: { "@local/*": [`modules/${owner}/src/*`] },
  },
});

test("warm graph cache performs zero resolutions and cache:false neither reads nor writes caches", (t) => {
  const { root } = fixture(t);
  const cold = getRepositoryIndex(root);
  assert.equal(cold.stats.graphCache, "miss");
  assert.ok(cold.stats.graphResolved > 0);
  const graphBefore = fs.readFileSync(graphCacheFile(root), "utf8");
  const parseBefore = fs.readFileSync(
    path.join(root, ".cache/mizyun-navigation/parse-cache.json"),
    "utf8",
  );
  const warm = getRepositoryIndex(root);
  assert.equal(warm.stats.graphCache, "hit");
  assert.equal(warm.stats.graphResolved, 0);
  assert.deepEqual(warm.edges, cold.edges);
  assert.deepEqual(warm.files, cold.files);
  assert.deepEqual(warm.warnings, cold.warnings);
  const cacheReads = [];
  const originalOpen = fs.openSync;
  const originalWrite = fs.writeFileSync;
  try {
    fs.openSync = function (filename, ...rest) {
      if (
        typeof filename === "string" &&
        filename.startsWith(path.join(root, ".cache"))
      )
        cacheReads.push(filename);
      return originalOpen.call(this, filename, ...rest);
    };
    fs.writeFileSync = function (filename, ...rest) {
      if (
        typeof filename === "string" &&
        filename.startsWith(path.join(root, ".cache"))
      )
        throw new Error("Disabled caches must not write");
      return originalWrite.call(this, filename, ...rest);
    };
    const uncached = getRepositoryIndex(root, { cache: false });
    assert.equal(uncached.stats.graphCache, "disabled");
    assert.equal(uncached.stats.reused, 0);
    assert.ok(uncached.stats.graphResolved > 0);
    assert.deepEqual(uncached.edges, cold.edges);
    assert.equal(uncached.snapshot.id, cold.snapshot.id);
    assert.deepEqual(cacheReads, []);
  } finally {
    fs.openSync = originalOpen;
    fs.writeFileSync = originalWrite;
  }
  assert.equal(fs.readFileSync(graphCacheFile(root), "utf8"), graphBefore);
  assert.equal(
    fs.readFileSync(
      path.join(root, ".cache/mizyun-navigation/parse-cache.json"),
      "utf8",
    ),
    parseBefore,
  );
  assert.ok(!graphBefore.includes("export const value = 1"));
  assert.ok(!graphBefore.includes('"symbols"'));
  assert.ok(!graphBefore.includes('"headings"'));
});

test("same-size same-time installed inherited config edits invalidate the warm graph", (t) => {
  const { root, write } = fixture(t);
  write("modules/producer/src/local.ts", "export const local = true;\n");
  write(
    "node_modules/shared-config/tsconfig.base.json",
    inheritedOptions(root),
  );
  write("tsconfig.json", {
    extends: "./node_modules/shared-config/tsconfig.base.json",
  });
  const first = getRepositoryIndex(root);
  assert.equal(getRepositoryIndex(root).stats.graphCache, "hit");
  const config = path.join(
    root,
    "node_modules/shared-config/tsconfig.base.json",
  );
  const before = fs.statSync(config);
  write(
    "node_modules/shared-config/tsconfig.base.json",
    inheritedOptions(root, "producer"),
  );
  fs.utimesSync(config, before.atime, before.mtime);
  assert.equal(fs.statSync(config).size, before.size);
  const changed = getRepositoryIndex(root);
  assert.equal(changed.stats.graphCache, "miss");
  assert.equal(changed.stats.parsed, 0);
  assert.notEqual(changed.snapshot.id, first.snapshot.id);
  assert.ok(
    changed.edges.some(
      (edge) =>
        edge.specifier === "@local/local" &&
        edge.to === "modules/producer/src/local.ts",
    ),
  );
  assert.equal(getRepositoryIndex(root).stats.graphCache, "hit");
  fs.unlinkSync(config);
  const removed = getRepositoryIndex(root);
  assert.equal(removed.stats.graphCache, "miss");
  assert.ok(!removed.edges.some((edge) => edge.specifier === "@local/local"));
});

test("negative installed configuration lookups invalidate when a missing config appears", (t) => {
  const { root, write } = fixture(t);
  write("tsconfig.json", {
    extends: "./node_modules/missing-config/tsconfig.base.json",
  });
  const missing = getRepositoryIndex(root);
  assert.equal(getRepositoryIndex(root).stats.graphCache, "hit");
  assert.ok(!missing.edges.some((edge) => edge.specifier === "@local/local"));
  const cache = JSON.parse(fs.readFileSync(graphCacheFile(root), "utf8"));
  assert.ok(
    cache.lookups.some(
      (lookup) =>
        lookup.path === "node_modules/missing-config/tsconfig.base.json" &&
        lookup.state === "missing",
    ),
  );
  write(
    "node_modules/missing-config/tsconfig.base.json",
    inheritedOptions(root),
  );
  const found = getRepositoryIndex(root);
  assert.equal(found.stats.graphCache, "miss");
  assert.equal(found.stats.parsed, 0);
  assert.notEqual(found.snapshot.id, missing.snapshot.id);
  assert.ok(found.edges.some((edge) => edge.specifier === "@local/local"));
});

test("higher-priority installed config directory appearance invalidates an ancestor fallback", (t) => {
  const { root, write } = fixture(t);
  write("modules/producer/src/local.ts", "export const local = true;\n");
  write(
    "node_modules/shared-config/tsconfig.base.json",
    inheritedOptions(root),
  );
  write("modules/consumer/tsconfig.json", {
    extends: "shared-config/tsconfig.base",
  });
  const ancestor = getRepositoryIndex(root);
  assert.equal(getRepositoryIndex(root).stats.graphCache, "hit");
  assert.ok(
    ancestor.edges.some(
      (edge) =>
        edge.specifier === "@local/local" &&
        edge.to === "modules/consumer/src/local.ts",
    ),
  );
  write(
    "modules/consumer/node_modules/shared-config/tsconfig.base.json",
    inheritedOptions(root, "producer"),
  );
  const nearer = getRepositoryIndex(root);
  assert.equal(nearer.stats.graphCache, "miss");
  assert.equal(nearer.stats.parsed, 0);
  assert.ok(
    nearer.edges.some(
      (edge) =>
        edge.specifier === "@local/local" &&
        edge.to === "modules/producer/src/local.ts",
    ),
  );
});

test("installed config symlink retargets invalidate and external config contents remain unread", (t) => {
  const { root, write } = fixture(t);
  write("modules/producer/src/local.ts", "export const local = true;\n");
  write("node_modules/config-one/tsconfig.base.json", inheritedOptions(root));
  write(
    "node_modules/config-two/tsconfig.base.json",
    inheritedOptions(root, "producer"),
  );
  fs.symlinkSync("config-one", path.join(root, "node_modules/current-config"));
  write("tsconfig.json", {
    extends: "./node_modules/current-config/tsconfig.base.json",
  });
  const first = getRepositoryIndex(root);
  assert.equal(getRepositoryIndex(root).stats.graphCache, "hit");
  fs.unlinkSync(path.join(root, "node_modules/current-config"));
  fs.symlinkSync("config-two", path.join(root, "node_modules/current-config"));
  const retargeted = getRepositoryIndex(root);
  assert.equal(retargeted.stats.graphCache, "miss");
  assert.notEqual(retargeted.snapshot.id, first.snapshot.id);
  assert.ok(
    retargeted.edges.some(
      (edge) =>
        edge.specifier === "@local/local" &&
        edge.to === "modules/producer/src/local.ts",
    ),
  );
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "mizyun-index-outside-config-"),
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(outside, "tsconfig.base.json"),
    '{"compilerOptions":{"baseUrl":"NEVER_READ_GRAPH_CONFIG"}}',
  );
  fs.unlinkSync(path.join(root, "node_modules/current-config"));
  fs.symlinkSync(outside, path.join(root, "node_modules/current-config"));
  const rejected = getRepositoryIndex(root);
  assert.equal(rejected.stats.graphCache, "miss");
  assert.ok(!JSON.stringify(rejected).includes("NEVER_READ_GRAPH_CONFIG"));
  assert.ok(
    !fs
      .readFileSync(graphCacheFile(root), "utf8")
      .includes("NEVER_READ_GRAPH_CONFIG"),
  );
  assert.ok(!rejected.edges.some((edge) => edge.specifier === "@local/local"));
  fs.unlinkSync(path.join(root, "node_modules/current-config"));
  fs.symlinkSync("config-one", path.join(root, "node_modules/current-config"));
  const returned = getRepositoryIndex(root);
  assert.equal(returned.stats.graphCache, "miss");
  assert.ok(returned.edges.some((edge) => edge.specifier === "@local/local"));
});

test("corrupt/version/root graph cache entries rebuild and warm reuse never overwrites them", (t) => {
  const { root } = fixture(t);
  const initial = getRepositoryIndex(root);
  fs.writeFileSync(graphCacheFile(root), "{corrupt");
  const repaired = getRepositoryIndex(root);
  assert.equal(repaired.stats.graphCache, "miss");
  assert.equal(repaired.stats.parsed, 0);
  assert.ok(
    repaired.warnings.some((warning) =>
      warning.includes("graph cache unavailable or corrupt"),
    ),
  );
  assert.deepEqual(repaired.edges, initial.edges);
  assert.equal(getRepositoryIndex(root).stats.graphCache, "hit");
  for (const [key, value] of [
    ["resolver", "old-resolver"],
    ["root", path.dirname(root)],
    ["schemaVersion", -1],
  ]) {
    const cache = JSON.parse(fs.readFileSync(graphCacheFile(root), "utf8"));
    cache[key] = value;
    fs.writeFileSync(graphCacheFile(root), JSON.stringify(cache));
    assert.equal(getRepositoryIndex(root).stats.graphCache, "miss", key);
    assert.equal(getRepositoryIndex(root).stats.graphCache, "hit", key);
  }
  const originalRename = fs.renameSync;
  let writes = 0;
  try {
    fs.renameSync = function (...args) {
      writes++;
      return originalRename.apply(this, args);
    };
    const warm = getRepositoryIndex(root);
    assert.equal(warm.stats.graphCache, "hit");
    assert.equal(warm.stats.graphResolved, 0);
    assert.equal(writes, 0);
  } finally {
    fs.renameSync = originalRename;
  }
});

test("warm graph revalidates concurrent source and inherited config edits before returning", (t) => {
  const { root, write } = fixture(t);
  write("modules/producer/src/local.ts", "export const local = true;\n");
  write(
    "node_modules/shared-config/tsconfig.base.json",
    inheritedOptions(root),
  );
  write("tsconfig.json", {
    extends: "./node_modules/shared-config/tsconfig.base.json",
  });
  getRepositoryIndex(root);
  const originalRead = fs.readFileSync;
  let edited = false;
  try {
    fs.readFileSync = function (...args) {
      const result = originalRead.apply(this, args);
      if (
        !edited &&
        typeof result === "string" &&
        result === "export const value = 1;\n"
      ) {
        edited = true;
        write(
          "modules/producer/src/value.ts",
          "export const sourceChangedDuringHit = true;\n",
        );
      }
      return result;
    };
    const currentSource = getRepositoryIndex(root);
    assert.equal(
      file(currentSource, "modules/producer/src/value.ts").symbols[0].name,
      "sourceChangedDuringHit",
    );
    fs.readFileSync = originalRead;
    getRepositoryIndex(root);
    edited = false;
    fs.readFileSync = function (...args) {
      const result = originalRead.apply(this, args);
      if (
        !edited &&
        typeof result === "string" &&
        result === JSON.stringify(inheritedOptions(root))
      ) {
        edited = true;
        write(
          "node_modules/shared-config/tsconfig.base.json",
          inheritedOptions(root, "producer"),
        );
      }
      return result;
    };
    const currentConfig = getRepositoryIndex(root);
    assert.equal(currentConfig.stats.graphCache, "miss");
    assert.ok(
      currentConfig.edges.some(
        (edge) =>
          edge.specifier === "@local/local" &&
          edge.to === "modules/producer/src/local.ts",
      ),
    );
  } finally {
    fs.readFileSync = originalRead;
  }
});

test("unavailable configuration dependencies bypass graph persistence and recover safely", (t) => {
  const { root, write } = fixture(t);
  write(
    "node_modules/shared-config/tsconfig.base.json",
    inheritedOptions(root),
  );
  write("tsconfig.json", {
    extends: "./node_modules/shared-config/tsconfig.base.json",
  });
  getRepositoryIndex(root);
  const previous = fs.readFileSync(graphCacheFile(root), "utf8");
  const config = path.join(
    root,
    "node_modules/shared-config/tsconfig.base.json",
  );
  const originalOpen = fs.openSync;
  try {
    fs.openSync = function (filename, ...args) {
      if (filename === config) {
        const error = new Error("Synthetic config access denial");
        error.code = "EACCES";
        throw error;
      }
      return originalOpen.call(this, filename, ...args);
    };
    const unavailable = getRepositoryIndex(root);
    assert.equal(unavailable.stats.graphCache, "miss");
    assert.ok(
      unavailable.warnings.some((warning) =>
        warning.includes("graph cache bypassed"),
      ),
    );
    assert.ok(
      !unavailable.edges.some((edge) => edge.specifier === "@local/local"),
    );
    assert.equal(fs.readFileSync(graphCacheFile(root), "utf8"), previous);
  } finally {
    fs.openSync = originalOpen;
  }
  const recovered = getRepositoryIndex(root);
  assert.equal(recovered.stats.graphCache, "hit");
  assert.ok(recovered.edges.some((edge) => edge.specifier === "@local/local"));
});

test("persistently changing inherited configuration fails after bounded warm retries", (t) => {
  const { root, write } = fixture(t);
  write(
    "node_modules/shared-config/tsconfig.base.json",
    inheritedOptions(root),
  );
  write("tsconfig.json", {
    extends: "./node_modules/shared-config/tsconfig.base.json",
  });
  getRepositoryIndex(root);
  const originalRead = fs.readFileSync;
  const first = JSON.stringify(inheritedOptions(root));
  const second = JSON.stringify(inheritedOptions(root, "producer"));
  try {
    fs.readFileSync = function (...args) {
      const result = originalRead.apply(this, args);
      if (result === first || result === second)
        write(
          "node_modules/shared-config/tsconfig.base.json",
          result === first ? second : first,
        );
      return result;
    };
    assert.throws(
      () => getRepositoryIndex(root),
      /changed during indexing after three attempts/,
    );
  } finally {
    fs.readFileSync = originalRead;
  }
});
