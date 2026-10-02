import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createTaskPacket,
  renderFeaturePacket,
  renderTaskPacket,
} from "../packet.mjs";
import { validateNewSourceCoverage } from "../check.mjs";
import { loadFeatureMap, getFeaturesForPath } from "../feature-map.mjs";
import { checkReviewState } from "../context.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mizyun-packet-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(
      path.join(root, file),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  };
  const git = (args) =>
    execFileSync(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  git(["init"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@example.com"]);
  const feature = {
    id: "session",
    title: "Session navigation",
    summary: "Session controls",
    aliases: [],
    entryPoints: ["scripts/session/authority.ts"],
    ownedPaths: ["scripts/session"],
    docs: ["docs/session.md#consent"],
    migrationPaths: ["supabase/migrations/session.sql"],
    requirements: ["SESSION-001"],
    openAcceptance: ["Real consent acceptance remains open"],
    limitations: "External provider calls remain gated.",
    verificationCommands: ["pnpm test:session"],
    tests: ["scripts/session/authority.test.ts"],
    relations: [],
    lastReviewedSha: "0".repeat(40),
    lastReviewedDate: "2026-10-02",
  };
  write(".gitignore", ".cache/\n");
  write("package.json", { name: "packet-fixture", private: true });
  write("docs/feature-map.json", { schemaVersion: 1, features: [feature] });
  write("docs/session.md", "# Session\n\n## Consent\n");
  write(
    "supabase/migrations/session.sql",
    "create table fixture (id integer);\n",
  );
  write(
    "scripts/session/authority.ts",
    "export function saveConsent() { return true; }\n",
  );
  write(
    "scripts/session/authority.test.ts",
    'import { saveConsent } from "./authority";\nexport const consentTest = saveConsent();\n',
  );
  write("scripts/legacy.ts", "export const existingGap = true;\n");
  git(["add", "."]);
  git(["commit", "-m", "Fixture baseline"]);
  feature.lastReviewedSha = git(["rev-parse", "HEAD"]).trim();
  write("docs/feature-map.json", { schemaVersion: 1, features: [feature] });
  return { root, write, git, feature };
}

test("task packets find symbols and consumer tests, preserve intent and expose local review drift", (t) => {
  const { root, write } = fixture(t);
  write(
    "scripts/session/authority.ts",
    "export function saveConsent() { return false; }\n",
  );
  const packet = createTaskPacket(root, { symbol: "saveConsent" });
  assert.equal(packet.files[0].path, "scripts/session/authority.ts");
  assert.ok(
    packet.files.some(
      (file) =>
        file.path.endsWith("authority.test.ts") &&
        file.reason === "direct-consumer",
    ),
  );
  assert.deepEqual(packet.features[0].requirements, ["SESSION-001"]);
  assert.ok(checkReviewState(packet.features[0], root).local);
  assert.ok(!JSON.stringify(packet).includes("return false"));
  assert.match(
    renderTaskPacket(packet),
    /Real consent acceptance remains open/,
  );
  assert.match(
    renderTaskPacket(packet),
    /External provider calls remain gated/,
  );
});

test("query discovery refreshes after untracked additions and uses documentation headings", (t) => {
  const { root, write } = fixture(t);
  const first = createTaskPacket(root, { query: "save consent" });
  write("scripts/session/fresh.ts", "export function saveConsentFresh() {}\n");
  const second = createTaskPacket(root, { query: "save consent" });
  assert.notEqual(first.snapshot.id, second.snapshot.id);
  assert.ok(second.files.some((file) => file.path.endsWith("fresh.ts")));
  assert.ok(second.files.some((file) => file.path === "docs/session.md"));
  assert.equal(second.features.length, 1);
});

test("packet budget protects gates and early checks when one component line is enormous", () => {
  const feature = {
    id: "fixture",
    title: "Fixture",
    summary: "Bounded",
    lastReviewedDate: "2026-10-02",
    lastReviewedSha: "0".repeat(40),
    requirements: ["REQ-001"],
    openAcceptance: ["Device approval pending"],
    verificationCommands: ["pnpm test:fixture"],
    tests: ["fixture.test.ts"],
    contracts: ["long/" + "x".repeat(20000)],
    ui: Array.from({ length: 1000 }, (_, i) => `apps/mobile/${i}.tsx`),
  };
  const output = renderFeaturePacket(feature, { budgetBytes: 2048 });
  assert.ok(Buffer.byteLength(output) <= 2048);
  assert.ok(output.split("\n").length <= 120);
  assert.match(output, /REQ-001/);
  assert.match(output, /Device approval pending/);
  assert.match(output, /pnpm test:fixture/);
  assert.match(output, /fixture.test.ts/);
  assert.match(output, /Truncated/);
});

test("mandatory acceptance is never silently dropped to satisfy a budget", () => {
  assert.throws(
    () =>
      renderFeaturePacket({
        title: "Huge",
        id: "huge",
        openAcceptance: ["x".repeat(9000)],
      }),
    /none were silently dropped/,
  );
});

test("feature CLI rejects a replaced intent map instead of rendering gates from an older map", (t) => {
  const { root, write, feature } = fixture(t);
  write(
    "intent-race.cjs",
    `
const fs = require('node:fs');
const path = require('node:path');
const {syncBuiltinESMExports} = require('node:module');
const original = fs.readFileSync;
const target = path.join(process.cwd(), 'docs/feature-map.json');
let count = 0;
fs.readFileSync = function(file, ...args) {
  if (file === target && ++count === 2) {
    const map = JSON.parse(original(target, 'utf8'));
    map.features[0].openAcceptance = ['New gate that must not disappear'];
    fs.writeFileSync(target, JSON.stringify(map));
  }
  return original.call(this, file, ...args);
};
syncBuiltinESMExports();
`,
  );
  const cli = fileURLToPath(new URL("../context.mjs", import.meta.url));
  for (const extra of [[], ["--json"], ["--all"]]) {
    write("docs/feature-map.json", { schemaVersion: 1, features: [feature] });
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        path.join(root, "intent-race.cjs"),
        cli,
        "session",
        "--no-cache",
        ...extra,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Feature intent changed/);
    assert.equal(result.stdout, "");
  }
});

test("unsafe and missing path selections and unknown symbols fail explicitly", (t) => {
  const { root, write } = fixture(t);
  write(".env", "SECRET=private-value");
  for (const file of ["../outside.ts", ".env", "scripts/missing.ts"])
    assert.throws(
      () => createTaskPacket(root, { path: file }),
      /inside the repository|absent, excluded, or unsafe/,
    );
  assert.throws(
    () => createTaskPacket(root, { symbol: "inventedSymbol" }),
    /No indexed locations/,
  );
});

test("CI ownership gates new and renamed sources while retaining visible legacy gaps", (t) => {
  const { root, write, git } = fixture(t);
  write("scripts/session/new.ts", "export {};\n");
  write("scripts/new-unmapped.ts", "export {};\n");
  write("scripts/legacy.ts", "export const existingGap = false;\n");
  let result = validateNewSourceCoverage(root, "HEAD");
  assert.deepEqual(result.addedPaths, [
    "scripts/new-unmapped.ts",
    "scripts/session/new.ts",
  ]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /new-unmapped/);
  fs.rmSync(path.join(root, "scripts/new-unmapped.ts"));
  git(["mv", "scripts/session/authority.ts", "scripts/renamed-unmapped.ts"]);
  result = validateNewSourceCoverage(root, "HEAD");
  assert.match(result.errors.join("\n"), /renamed-unmapped/);
  assert.match(
    validateNewSourceCoverage(root, "missing-reference").errors[0],
    /unavailable/,
  );
});

test("curated documentation and migration references preserve feature intent association", (t) => {
  const { root } = fixture(t);
  const map = loadFeatureMap(root);
  assert.equal(getFeaturesForPath(map, "docs/session.md")[0].id, "session");
  assert.equal(
    getFeaturesForPath(map, "supabase/migrations/session.sql")[0].id,
    "session",
  );
});

test("new workspace roots inherit the CI ownership gate as repository topology grows", (t) => {
  const { root, write, feature } = fixture(t);
  write("pnpm-workspace.yaml", "packages:\n  - modules/*\n");
  write("modules/new/package.json", { name: "@fixture/new" });
  write("modules/new/src/value.ts", "export const value = 1;\n");
  assert.match(
    validateNewSourceCoverage(root, "HEAD").errors.join("\n"),
    /modules\/new\/src\/value.ts/,
  );
  feature.ownedPaths.push("modules/new");
  write("docs/feature-map.json", { schemaVersion: 1, features: [feature] });
  assert.equal(validateNewSourceCoverage(root, "HEAD").errors.length, 0);
});
