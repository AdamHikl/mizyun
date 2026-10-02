import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  readExcerpt,
  renderReadExcerpt,
  parseReadArguments,
} from "../read.mjs";

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "mizyun-read-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, content) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  };
  return { root, write };
}
const excerpt = (root, options) =>
  renderReadExcerpt(readExcerpt(root, options));

test("exact AST boundary preserves full function and JSDoc but excludes same-line siblings", (t) => {
  const { root, write } = fixture(t);
  const source =
    '/** Required rule. */\nexport async function exact() {\n  const nested = () => ({ brace: "}" });\n  return nested();\n} export const sibling = 2;\n';
  write("src/main.ts", source);
  const packet = readExcerpt(root, { path: "src/main.ts", symbol: "exact" });
  assert.equal(
    packet.content,
    source.slice(0, source.indexOf(" export const")),
  );
  assert.deepEqual(packet.range, {
    startLine: 1,
    startColumn: 1,
    endLine: 5,
    endExclusiveLine: 5,
    endColumnExclusive: 2,
  });
  assert.equal(packet.hash, createHash("sha256").update(source).digest("hex"));
  assert.ok(packet.omittedBytes.after > 0);
  assert.doesNotMatch(renderReadExcerpt(packet), /sibling =/);
  assert.throws(
    () => readExcerpt(root, { path: "src/main.ts", symbol: "nested" }),
    /top-level symbol not found/,
  );
  assert.throws(
    () => readExcerpt(root, { path: "src/main.ts", symbol: "exa" }),
    /top-level symbol not found/,
  );
});

test("variable and destructured names select the full containing declaration statement", (t) => {
  const { root, write } = fixture(t);
  write(
    "src/main.ts",
    "export const alpha = 1, beta = () => { return alpha; };\nconst { value: renamed, nested: { child } } = input;\n",
  );
  assert.equal(
    readExcerpt(root, { path: "src/main.ts", symbol: "beta" }).content,
    "export const alpha = 1, beta = () => { return alpha; };",
  );
  assert.match(
    readExcerpt(root, { path: "src/main.ts", symbol: "child" }).content,
    /^const \{ value: renamed/,
  );
  assert.match(
    readExcerpt(root, { path: "src/main.ts", symbol: "renamed" }).note,
    /all bindings/,
  );
});

test("ambiguous overloads and malformed source fail without guessing boundaries", (t) => {
  const { root, write } = fixture(t);
  write(
    "main.ts",
    "function task(a: number): number;\nfunction task(a: number) { return a; }\n",
  );
  assert.throws(
    () => readExcerpt(root, { path: "main.ts", symbol: "task" }),
    /Ambiguous.*1, 2/,
  );
  write("main.ts", "export function task( {\n");
  assert.throws(
    () => readExcerpt(root, { path: "main.ts", symbol: "task" }),
    /syntax errors/,
  );
});

test("TSX and JS config parsing stays inert and does not read or execute config", (t) => {
  const { root, write } = fixture(t);
  write("view.tsx", "export const View = () => <div>{'}'}</div>;\n");
  write(
    "vite.config.mjs",
    "export function build() { throw Error('must never execute'); }\n",
  );
  write("tsconfig.json", "not valid JSON");
  assert.match(excerpt(root, { path: "view.tsx", symbol: "View" }), /<div>/);
  assert.match(
    excerpt(root, { path: "vite.config.mjs", symbol: "build" }),
    /must never execute/,
  );
  assert.equal(fs.existsSync(path.join(root, ".cache")), false);
});

test("complete heading section includes nested acceptance gates and excludes next peer", (t) => {
  const { root, write } = fixture(t);
  const source =
    "# Plan\nIntro\n## Work\nDo work.\n### Release gate\nNever release without approval.\n#### Nested gate\nFull device checks.\n## Later\nUnrelated.\n";
  write("docs/plan.md", source);
  const packet = readExcerpt(root, { path: "docs/plan.md", heading: "Work" });
  assert.equal(
    packet.content,
    "## Work\nDo work.\n### Release gate\nNever release without approval.\n#### Nested gate\nFull device checks.\n",
  );
  assert.equal(packet.range.startLine, 3);
  assert.equal(packet.range.endLine, 8);
  assert.match(
    excerpt(root, { path: "docs/plan.md", heading: "Work" }),
    /Full device checks/,
  );
  assert.doesNotMatch(
    excerpt(root, { path: "docs/plan.md", heading: "Work" }),
    /Unrelated/,
  );
});

test("outline inventories ATX and setext headings but skips fenced fake headings", (t) => {
  const { root, write } = fixture(t);
  write(
    "doc.md",
    "Title\n=====\n\n## Real ##\n```md\n# Fake\n```\n~~~\nOther fake\n----------\n~~~\n\nChild\n-----\nText.\n# End\n",
  );
  const packet = readExcerpt(root, { path: "doc.md", outline: true });
  assert.deepEqual(
    packet.sections.map((section) => [
      section.title,
      section.level,
      section.line,
    ]),
    [
      ["Title", 1, 1],
      ["Real", 2, 4],
      ["Child", 2, 13],
      ["End", 1, 16],
    ],
  );
  assert.match(
    renderReadExcerpt(packet),
    /section contents\/gates remain unread/,
  );
  assert.doesNotMatch(renderReadExcerpt(packet), /Other fake/);
  assert.match(
    readExcerpt(root, { path: "doc.md", heading: "Child" }).content,
    /^Child\n-----\nText/,
  );
});

test("missing and duplicate headings fail with explicit choices", (t) => {
  const { root, write } = fixture(t);
  write("doc.md", "# Repeat\nfirst\n# Repeat\nsecond\n");
  assert.throws(
    () => readExcerpt(root, { path: "doc.md", heading: "repeat" }),
    /not found/,
  );
  assert.throws(
    () => readExcerpt(root, { path: "doc.md", heading: "Repeat" }),
    /Ambiguous.*1, 3/,
  );
});

test("line intervals are inclusive, current, and never silently clamped", (t) => {
  const { root, write } = fixture(t);
  write("main.sql", "first\r\nsecond\r\nthird\r\n");
  const packet = readExcerpt(root, { path: "main.sql", lines: "2:3" });
  assert.equal(packet.content, "second\r\nthird\r\n");
  assert.equal(packet.sourceLines, 3);
  assert.equal(packet.omittedLines.before, 1);
  assert.equal(packet.range.endExclusiveLine, 4);
  assert.equal(packet.range.endColumnExclusive, 1);
  assert.match(renderReadExcerpt(packet), /2 \| second\n    3 \| third/);
  for (const lines of [
    "0:2",
    "2:1",
    "1:4",
    "1",
    "1:2junk",
    "1:9007199254740993",
  ])
    assert.throws(
      () => readExcerpt(root, { path: "main.sql", lines }),
      /range|requires/,
    );
});

test("selectors enforce supported document/source formats", (t) => {
  const { root, write } = fixture(t);
  write("main.sql", "select 1;\n");
  write("doc.md", "# Heading\n");
  assert.throws(
    () => readExcerpt(root, { path: "main.sql", heading: "Heading" }),
    /Markdown/,
  );
  assert.throws(
    () => readExcerpt(root, { path: "main.sql", outline: true }),
    /Markdown/,
  );
  assert.throws(
    () => readExcerpt(root, { path: "doc.md", symbol: "Heading" }),
    /TypeScript or JavaScript/,
  );
});

test("byte cap includes Unicode source and all metadata; larger explicit budget succeeds", (t) => {
  const { root, write } = fixture(t);
  write("doc.md", "# Work\n" + "🧭".repeat(2100) + "\n## Gate\nMust verify.\n");
  assert.throws(
    () => readExcerpt(root, { path: "doc.md", heading: "Work" }),
    /exceeds 8192-byte\/120-line.*No partial/,
  );
  const packet = readExcerpt(root, {
    path: "doc.md",
    heading: "Work",
    budgetBytes: 16384,
  });
  const text = renderReadExcerpt(packet);
  assert.match(text, /Must verify/);
  assert.ok(Buffer.byteLength(text) <= 16384);
});

test("line cap includes wrapper and refuses partial declaration, section, interval or outline", (t) => {
  const { root, write } = fixture(t);
  write(
    "main.ts",
    "export function large() {\n" + "  doWork();\n".repeat(120) + "}\n",
  );
  write("doc.md", "# Work\n" + "text\n".repeat(120) + "## Gate\nNever skip.\n");
  write(
    "outline.md",
    Array.from({ length: 120 }, (_, i) => `# Section${i}\ntext\n`).join(""),
  );
  for (const options of [
    { path: "main.ts", symbol: "large" },
    { path: "main.ts", lines: "1:122" },
    { path: "doc.md", heading: "Work" },
    { path: "outline.md", outline: true },
  ])
    assert.throws(
      () => readExcerpt(root, options),
      /120-line budget.*No partial/,
    );
  const text = excerpt(root, {
    path: "doc.md",
    heading: "Work",
    maxLines: 150,
  });
  assert.match(text, /Never skip/);
  assert.ok(text.trimEnd().split("\n").length <= 150);
});

test("secrets, archives, traversal, outside files and unsupported formats are rejected", (t) => {
  const { root, write } = fixture(t);
  const blocked = [
    ".env",
    ".env.production",
    "credentials.json",
    "secrets.ts",
    "tokens.md",
    "private_key.ts",
    "docs/archive/old.md",
    "private/main.ts",
    "logs/main.ts",
    "node_modules/main.ts",
    "photo.png",
    "backup.zip",
  ];
  for (const file of blocked) write(file, "sensitive fixture only\n");
  for (const file of [
    ...blocked,
    "../outside.ts",
    "/tmp/outside.ts",
    "docs/../main.ts",
    "docs\\main.ts",
    "./main.ts",
  ])
    assert.throws(
      () => readExcerpt(root, { path: file, lines: "1:1" }),
      /Unsafe|excluded/,
    );
});

test("internal, external and directory symlinks never expose target content", (t) => {
  const { root, write } = fixture(t);
  write("real/main.ts", "secret fixture marker\n");
  fs.symlinkSync(
    path.join(root, "real/main.ts"),
    path.join(root, "internal.ts"),
  );
  fs.symlinkSync("/etc/passwd", path.join(root, "outside.ts"));
  fs.symlinkSync(path.join(root, "real"), path.join(root, "linked"));
  for (const file of ["internal.ts", "outside.ts", "linked/main.ts"])
    assert.throws(
      () => readExcerpt(root, { path: file, lines: "1:1" }),
      /Unsafe/,
    );
});

test("AGENTS and SKILL instruction files always require full reads including outlines", (t) => {
  const { root, write } = fixture(t);
  for (const file of [
    "AGENTS.md",
    "docs/SKILL.md",
    "docs/agents.md",
    ".agents/skills/example/SKILL.md",
  ]) {
    write(file, "# Gates\nDo not hide rules.\n");
    for (const selection of [
      { lines: "1:1" },
      { heading: "Gates" },
      { outline: true },
      { symbol: "Gate" },
    ])
      assert.throws(
        () => readExcerpt(root, { path: file, ...selection }),
        /require a full read/,
      );
  }
});

test("current hash and boundaries reflect edits without index or cache", (t) => {
  const { root, write } = fixture(t);
  write("main.ts", "export const value = 1;\n");
  const first = readExcerpt(root, { path: "main.ts", symbol: "value" });
  write("main.ts", "// added\nexport const value = 2;\n");
  const second = readExcerpt(root, { path: "main.ts", symbol: "value" });
  assert.notEqual(first.hash, second.hash);
  assert.equal(second.range.startLine, 2);
  assert.match(second.content, /value = 2/);
  assert.equal(fs.existsSync(path.join(root, ".cache")), false);
});

test("concurrent in-place write retries and returns only a stable fresh snapshot", (t) => {
  const { root, write } = fixture(t);
  write("main.ts", "export const value = 1;\n");
  const original = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", function (file, ...args) {
    const content = original.call(this, file, ...args);
    if (typeof file === "number" && ++reads === 1)
      write("main.ts", "export const value = 2;\n");
    return content;
  });
  const packet = readExcerpt(root, { path: "main.ts", symbol: "value" });
  assert.match(packet.content, /value = 2/);
  assert.ok(reads >= 3);
});

test("atomic replacement after selection is detected even for same bytes", (t) => {
  const { root, write } = fixture(t);
  const source = "export const value = 1;\n";
  write("main.ts", source);
  const original = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", function (file, ...args) {
    const content = original.call(this, file, ...args);
    if (typeof file === "number" && ++reads === 2) {
      write("replacement.ts", source);
      fs.renameSync(
        path.join(root, "replacement.ts"),
        path.join(root, "main.ts"),
      );
    }
    return content;
  });
  assert.equal(
    readExcerpt(root, { path: "main.ts", symbol: "value" }).content,
    source.trimEnd(),
  );
  assert.ok(reads >= 4);
});

test("repeated concurrent writes fail closed after three attempts", (t) => {
  const { root, write } = fixture(t);
  write("main.ts", "export const value = 1;\n");
  const original = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", function (file, ...args) {
    const content = original.call(this, file, ...args);
    if (typeof file === "number")
      write("main.ts", `export const value = ${++reads + 1};\n`);
    return content;
  });
  assert.throws(
    () => readExcerpt(root, { path: "main.ts", symbol: "value" }),
    /three read attempts.*No excerpt/,
  );
  assert.equal(reads, 3);
});

test("selection errors are retried when source concurrently changes to a valid selection", (t) => {
  const { root, write } = fixture(t);
  write("main.ts", "export const absent = 1;\n");
  const original = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", function (file, ...args) {
    const content = original.call(this, file, ...args);
    if (typeof file === "number" && ++reads === 2)
      write("main.ts", "export const value = 2;\n");
    return content;
  });
  assert.match(
    readExcerpt(root, { path: "main.ts", symbol: "value" }).content,
    /value = 2/,
  );
});

test("input cap, invalid UTF8 and binary text fail before selection", (t) => {
  const { root, write } = fixture(t);
  write("large.md", Buffer.alloc(2 * 1024 * 1024 + 1, "x"));
  write("binary.md", Buffer.from([0, 1, 2]));
  write("invalid.md", Buffer.from([0xff, 0xfe]));
  assert.throws(
    () => readExcerpt(root, { path: "large.md", lines: "1:1" }),
    /2 MiB/,
  );
  assert.throws(
    () => readExcerpt(root, { path: "binary.md", lines: "1:1" }),
    /binary/,
  );
  assert.throws(
    () => readExcerpt(root, { path: "invalid.md", lines: "1:1" }),
    /UTF-8/,
  );
});

test("strict arguments reject conflicts, duplicates, malformed budgets and unknown flags", () => {
  assert.deepEqual(parseReadArguments(["doc.md", "--outline"]), {
    path: "doc.md",
    outline: true,
  });
  assert.deepEqual(
    parseReadArguments([
      "main.ts",
      "--symbol",
      "exact",
      "--budget-bytes",
      "2048",
      "--max-lines",
      "150",
    ]),
    { path: "main.ts", symbol: "exact", budgetBytes: 2048, maxLines: 150 },
  );
  for (const args of [
    [],
    ["main.ts"],
    ["a.ts", "b.ts", "--lines", "1:1"],
    ["a.ts", "--lines", "1:1", "--symbol", "a"],
    ["doc.md", "--outline", "--outline"],
    ["a.ts", "--lines", "1:1", "--lines", "1:2"],
    ["a.ts", "--symbol"],
    ["a.ts", "--lines", "1:1", "--json"],
    ["doc.md", "--outline", "--budget-bytes", "2047"],
    ["doc.md", "--outline", "--budget-bytes", "2048.0"],
    ["doc.md", "--outline", "--max-lines", "10001"],
  ])
    assert.throws(() => parseReadArguments(args));
});

test("CLI emits no partial gate on budget failure and successful output fits actual caps", (t) => {
  const { root, write } = fixture(t);
  write(
    "doc.md",
    "# Work\n" + "x".repeat(9000) + "\n## Gate\nSECRET_GATE_FIXTURE\n",
  );
  const cli = path.resolve(import.meta.dirname, "../read.mjs");
  const failed = spawnSync(
    process.execPath,
    [cli, "doc.md", "--heading", "Work"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /No partial excerpt/);
  assert.doesNotMatch(failed.stderr, /SECRET_GATE_FIXTURE/);
  write("doc.md", "# Work\nVerify.\n");
  const success = execFileSync(
    process.execPath,
    [cli, "doc.md", "--heading", "Work"],
    { cwd: root, encoding: "utf8" },
  );
  assert.match(success, /Verify/);
  assert.ok(Buffer.byteLength(success) <= 8192);
  assert.ok(success.trimEnd().split("\n").length <= 120);
});

test("fence closing markers and existing ATX headings cannot become setext titles", (t) => {
  const { root, write } = fixture(t);
  write(
    "doc.md",
    "# Parent\n```md\n# Fake\n```\n---\n# Gate\n---\nMust retain gate.\n",
  );
  const packet = readExcerpt(root, { path: "doc.md", outline: true });
  assert.deepEqual(
    packet.sections.map((section) => section.title),
    ["Parent", "Gate"],
  );
  assert.match(
    readExcerpt(root, { path: "doc.md", heading: "Parent" }).content,
    /# Fake/,
  );
});

test("render escapes terminal controls while provenance still hashes the original bytes", (t) => {
  const { root, write } = fixture(t);
  const source = "# Data\n\u001b[31minert\n";
  write("doc.md", source);
  const packet = readExcerpt(root, { path: "doc.md", heading: "Data" });
  const text = renderReadExcerpt(packet);
  assert.equal(packet.hash, createHash("sha256").update(source).digest("hex"));
  assert.equal(text.includes("\u001b"), false);
  assert.ok(text.includes("\\u001b[31minert"));
});

test("HTML comments cannot introduce fake section boundaries; other HTML blocks fail visibly", (t) => {
  const { root, write } = fixture(t);
  write("doc.md", "# Work\n<!--\n# Fake\n-->\n## Gate\nMust retain.\n# Next\n");
  assert.match(
    readExcerpt(root, { path: "doc.md", heading: "Work" }).content,
    /Must retain/,
  );
  assert.deepEqual(
    readExcerpt(root, { path: "doc.md", outline: true }).sections.map(
      (s) => s.title,
    ),
    ["Work", "Gate", "Next"],
  );
  write("doc.md", "# Work\n<div>\n# Fake\n</div>\n## Gate\nMust retain.\n");
  assert.throws(
    () => readExcerpt(root, { path: "doc.md", heading: "Work" }),
    /HTML blocks.*full read/,
  );
  assert.throws(
    () => readExcerpt(root, { path: "doc.md", outline: true }),
    /HTML blocks/,
  );
  assert.match(
    readExcerpt(root, { path: "doc.md", lines: "1:6" }).content,
    /Must retain/,
  );
});

test("multiline setext title includes every original title line", (t) => {
  const { root, write } = fixture(t);
  write("doc.md", "Multi line\ntitle\n==========\nGate body.\n\n# Next\n");
  const packet = readExcerpt(root, {
    path: "doc.md",
    heading: "Multi line title",
  });
  assert.equal(packet.range.startLine, 1);
  assert.match(packet.content, /^Multi line\ntitle\n==========\nGate body/);
  assert.equal(
    readExcerpt(root, { path: "doc.md", outline: true }).sections[0].title,
    "Multi line title",
  );
});

test("fence markers inside HTML comments do not hide later real headings", (t) => {
  const { root, write } = fixture(t);
  write(
    "doc.md",
    "# Work\n<!--\n```\n# Fake\n-->\n## Gate\nRequired.\n# Next\n",
  );
  assert.deepEqual(
    readExcerpt(root, { path: "doc.md", outline: true }).sections.map(
      (s) => s.title,
    ),
    ["Work", "Gate", "Next"],
  );
  assert.match(
    readExcerpt(root, { path: "doc.md", heading: "Work" }).content,
    /Required/,
  );
});
