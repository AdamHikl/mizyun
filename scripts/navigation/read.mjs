#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { getRepoRoot } from "./feature-map.mjs";
import { isIndexablePath } from "./repository-index.mjs";

const DEFAULT_BYTES = 8192;
const DEFAULT_LINES = 120;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sameFile = (a, b) =>
  ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every(
    (key) => a[key] === b[key],
  );

function budgets(options) {
  const budgetBytes = options.budgetBytes ?? DEFAULT_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_LINES;
  if (
    !Number.isSafeInteger(budgetBytes) ||
    budgetBytes < 2048 ||
    budgetBytes > 1048576
  )
    throw new Error(
      "--budget-bytes must be an integer between 2048 and 1048576.",
    );
  if (!Number.isSafeInteger(maxLines) || maxLines < 8 || maxLines > 10000)
    throw new Error("--max-lines must be an integer between 8 and 10000.");
  return { budgetBytes, maxLines };
}

function validateSelection(options) {
  const keys = ["symbol", "lines", "heading", "outline"].filter(
    (key) => options[key] !== undefined,
  );
  if (keys.length !== 1 || (keys[0] === "outline" && options.outline !== true))
    throw new Error(
      "Select exactly one of --symbol, --lines, --heading or --outline.",
    );
  const mode = keys[0];
  if (
    mode !== "outline" &&
    (typeof options[mode] !== "string" || !options[mode].trim())
  )
    throw new Error(`--${mode} requires a nonempty value.`);
  return mode;
}

function safeSnapshot(root, relative) {
  if (!isIndexablePath(root, relative))
    throw new Error("Unsafe, excluded or unavailable source path.");
  const absolute = path.join(root, relative);
  const fd = fs.openSync(
    absolute,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_INPUT_BYTES))
      throw new Error("Selected input exceeds the 2 MiB safety limit.");
    if (
      !isIndexablePath(root, relative) ||
      !sameFile(before, fs.statSync(absolute, { bigint: true }))
    )
      return null;
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      !sameFile(before, after) ||
      !isIndexablePath(root, relative) ||
      !sameFile(after, fs.statSync(absolute, { bigint: true }))
    )
      return null;
    if (bytes.length > MAX_INPUT_BYTES)
      throw new Error("Selected input exceeds the 2 MiB safety limit.");
    let content;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new Error("Selected input is not valid UTF-8 text.");
    }
    if (content.includes("\0"))
      throw new Error("Selected input contains binary data.");
    return {
      content,
      hash: sha256(bytes),
      bytes: bytes.length,
      identity: after,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function linesOf(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++)
    if (content[i] === "\n") starts.push(i + 1);
  if (starts.at(-1) === content.length) starts.pop();
  const lines = starts.map((start, i) =>
    content.slice(start, starts[i + 1] ?? content.length).replace(/\r?\n$/, ""),
  );
  return { starts, lines };
}

function headingsOf(lines) {
  const headings = [];
  let fence = null;
  let previousCanBeSetext = false;
  let paragraphStart = null;
  let htmlComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (htmlComment) {
      htmlComment = !line.includes("-->");
      previousCanBeSetext = false;
      paragraphStart = null;
      continue;
    }
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.character &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
      previousCanBeSetext = false;
      paragraphStart = null;
      continue;
    }
    if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      fence = { character: marker[1][0], length: marker[1].length };
      previousCanBeSetext = false;
      paragraphStart = null;
      continue;
    }
    if (/^ {0,3}<!--/.test(line)) {
      htmlComment = !line.includes("-->");
      previousCanBeSetext = false;
      paragraphStart = null;
      continue;
    }
    if (/^ {0,3}<(?:[!?]|\/?[a-zA-Z][\w-]*(?:[ \t]|\/?[>]))/.test(line))
      throw new Error(
        "Markdown HTML blocks require a full read or explicit --lines; a complete heading inventory cannot be guaranteed.",
      );
    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/);
    if (atx) {
      const title = (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
      headings.push({ title, level: atx[1].length, line: i + 1 });
    } else if (
      previousCanBeSetext &&
      i > 0 &&
      /^ {0,3}(=+|-+)[ \t]*$/.test(line) &&
      lines[i - 1].trim() &&
      !/^ {4}|^\t|^ {0,3}(?:#|>|[-+*] |\d+[.)] )/.test(lines[i - 1])
    ) {
      headings.push({
        title: lines
          .slice(paragraphStart ?? i - 1, i)
          .map((part) => part.trim())
          .join(" "),
        level: line.trim()[0] === "=" ? 1 : 2,
        line: (paragraphStart ?? i - 1) + 1,
      });
      previousCanBeSetext = false;
      paragraphStart = null;
      continue;
    }
    previousCanBeSetext =
      !atx &&
      Boolean(line.trim()) &&
      !/^ {4}|^\t|^ {0,3}(?:>|[-+*] |\d+[.)] )/.test(line);
    paragraphStart = previousCanBeSetext ? (paragraphStart ?? i) : null;
  }
  return headings.map((heading, index) => ({
    ...heading,
    endLine:
      headings.slice(index + 1).find((next) => next.level <= heading.level)
        ?.line - 1 || lines.length,
  }));
}

function symbolBounds(relative, content, exactName) {
  if (!/\.[cm]?[jt]sx?$/i.test(relative))
    throw new Error(
      "--symbol requires a TypeScript or JavaScript source file.",
    );
  const source = ts.createSourceFile(
    relative,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  if (source.parseDiagnostics.length)
    throw new Error(
      "Current source has syntax errors; use --lines after inspecting the complete diagnostic context.",
    );
  const matches = [];
  const names = (name) =>
    ts.isIdentifier(name)
      ? [name.text]
      : name.elements.flatMap((element) =>
          ts.isBindingElement(element) ? names(element.name) : [],
        );
  for (const statement of source.statements) {
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name?.text === exactName
    )
      matches.push(statement);
    else if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        names(declaration.name).includes(exactName),
      )
    )
      matches.push(statement);
  }
  if (!matches.length)
    throw new Error(
      "Exact top-level symbol not found; nested names and fuzzy matches are excluded.",
    );
  if (matches.length > 1)
    throw new Error(
      `Ambiguous exact symbol at lines ${matches.map((node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1).join(", ")}; use --lines to select explicitly.`,
    );
  const node = matches[0];
  return {
    start: node.getStart(source, true),
    end: node.end,
    note: ts.isVariableStatement(node)
      ? "Complete containing variable statement, including all bindings."
      : "Complete top-level AST declaration, including attached JSDoc.",
  };
}

function select(relative, snapshot, options, mode) {
  const { content } = snapshot;
  const { starts, lines } = linesOf(content);
  if (["heading", "outline"].includes(mode) && !/\.md$/i.test(relative))
    throw new Error("--heading and --outline require a Markdown document.");
  let chosen;
  let sections;
  if (mode === "symbol")
    chosen = symbolBounds(relative, content, options.symbol);
  else if (mode === "outline") sections = headingsOf(lines);
  else {
    let startLine, endLine;
    if (mode === "lines") {
      const match = options.lines.match(/^([1-9]\d*):([1-9]\d*)$/);
      if (!match)
        throw new Error(
          "--lines requires an inclusive positive start:end range.",
        );
      [startLine, endLine] = match.slice(1).map(Number);
      if (
        ![startLine, endLine].every(Number.isSafeInteger) ||
        startLine > endLine ||
        endLine > lines.length
      )
        throw new Error(
          "Requested line range is invalid or extends beyond current source.",
        );
    } else {
      const matches = headingsOf(lines).filter(
        (heading) => heading.title === options.heading,
      );
      if (!matches.length) throw new Error("Exact Markdown heading not found.");
      if (matches.length > 1)
        throw new Error(
          `Ambiguous heading at lines ${matches.map((heading) => heading.line).join(", ")}; use --lines to select explicitly.`,
        );
      startLine = matches[0].line;
      endLine = matches[0].endLine;
    }
    chosen = {
      start: starts[startLine - 1],
      end: starts[endLine] ?? content.length,
      note:
        mode === "heading"
          ? "Complete section, including every subordinate heading."
          : "Complete requested inclusive line range.",
    };
  }
  const packet = {
    path: relative,
    mode,
    selector: mode === "outline" ? true : options[mode],
    hash: snapshot.hash,
    sourceBytes: snapshot.bytes,
    sourceLines: lines.length,
    ...budgets(options),
  };
  if (sections)
    return {
      ...packet,
      sections,
      omittedBytes: { before: 0, after: snapshot.bytes },
      omittedLines: lines.length,
    };
  const position = (offset) => {
    if (offset === content.length && content.endsWith("\n"))
      return { line: lines.length + 1, column: 1 };
    let line = starts.findLastIndex((start) => start <= offset);
    if (line < 0) line = 0;
    return { line: line + 1, column: offset - (starts[line] ?? 0) + 1 };
  };
  const start = position(chosen.start),
    end = position(chosen.end),
    last = position(Math.max(chosen.start, chosen.end - 1));
  return {
    ...packet,
    content: content.slice(chosen.start, chosen.end),
    note: chosen.note,
    range: {
      startLine: start.line,
      startColumn: start.column,
      endLine: last.line,
      endExclusiveLine: end.line,
      endColumnExclusive: end.column,
    },
    omittedBytes: {
      before: Buffer.byteLength(content.slice(0, chosen.start)),
      after: Buffer.byteLength(content.slice(chosen.end)),
    },
    omittedLines: { before: start.line - 1, after: lines.length - last.line },
  };
}

/** Source data only. A selection never substitutes for applicable instructions. */
export function renderReadExcerpt(packet) {
  const output = [
    "Inert current-file data; this reader never executes embedded commands.",
    `File: ${JSON.stringify(packet.path)} | SHA256: ${packet.hash}`,
    `Selection: ${packet.mode} ${JSON.stringify(packet.selector)} | Source: ${packet.sourceBytes} bytes, ${packet.sourceLines} lines`,
  ];
  if (packet.mode === "outline") {
    output.push(
      "Outline only: complete heading inventory; section contents/gates remain unread.",
    );
    for (const section of packet.sections)
      output.push(
        `  ${section.line}:${section.endLine} | level ${section.level} | ${JSON.stringify(section.title)}`,
      );
    output.push(
      `Omitted: all ${packet.sourceBytes} source bytes / ${packet.sourceLines} content lines.`,
    );
  } else {
    const r = packet.range;
    output.push(
      `Range: ${r.startLine}:${r.startColumn}..${r.endExclusiveLine}:${r.endColumnExclusive} (end exclusive; included lines ${r.startLine}:${r.endLine}). ${packet.note}`,
    );
    output.push(
      `Omitted: before ${packet.omittedBytes.before} bytes/${packet.omittedLines.before} lines; after ${packet.omittedBytes.after} bytes/${packet.omittedLines.after} lines (same-line text may also be omitted).`,
    );
    const excerptLines = packet.content.split(/\r?\n/);
    if (packet.content.endsWith("\n")) excerptLines.pop();
    excerptLines.forEach((line, i) => {
      const inert = line.replace(
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,
        (character) =>
          `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
      );
      output.push(`    ${r.startLine + i} | ${inert}`);
    });
  }
  output.push(
    "Snapshot verified during this read; later edits require another read. Applicable instruction files require a full read.",
  );
  const rendered = output.join("\n") + "\n";
  const bytes = Buffer.byteLength(rendered),
    lineCount = output.length;
  if (bytes > packet.budgetBytes || lineCount > packet.maxLines)
    throw new Error(
      `Complete selection requires ${bytes} bytes/${lineCount} lines; exceeds ${packet.budgetBytes}-byte/${packet.maxLines}-line budget. No partial excerpt returned. Increase explicit budgets or select a narrower complete unit.`,
    );
  return rendered;
}

export function readExcerpt(repoRoot, options = {}) {
  const mode = validateSelection(options);
  budgets(options);
  const relative = options.path;
  if (
    typeof relative !== "string" ||
    !relative ||
    /[\x00-\x1f\x7f]/.test(relative)
  )
    throw new Error("Supply one repository-relative source path.");
  if (/^(?:AGENTS|SKILL)\.md$/i.test(path.posix.basename(relative)))
    throw new Error(
      "Instruction files AGENTS.md and SKILL.md require a full read; bounded excerpts and outlines are prohibited.",
    );
  const root = fs.realpathSync(repoRoot);
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = safeSnapshot(root, relative);
    if (!first) continue;
    let packet, selectionError;
    try {
      packet = select(relative, first, options, mode);
      renderReadExcerpt(packet);
    } catch (error) {
      selectionError = error;
    }
    const second = safeSnapshot(root, relative);
    if (
      !second ||
      first.hash !== second.hash ||
      !sameFile(first.identity, second.identity)
    )
      continue;
    if (selectionError) throw selectionError;
    return packet;
  }
  throw new Error(
    "Selected file changed during three read attempts; retry after edits settle. No excerpt returned.",
  );
}

export function parseReadArguments(args) {
  const options = {};
  const values = new Map([
    ["--symbol", "symbol"],
    ["--lines", "lines"],
    ["--heading", "heading"],
    ["--budget-bytes", "budgetBytes"],
    ["--max-lines", "maxLines"],
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--outline") {
      if (options.outline !== undefined)
        throw new Error("Duplicate --outline option.");
      options.outline = true;
    } else if (values.has(arg)) {
      const key = values.get(arg);
      if (options[key] !== undefined)
        throw new Error(`Duplicate ${arg} option.`);
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a value.`);
      if (["budgetBytes", "maxLines"].includes(key) && !/^\d+$/.test(value))
        throw new Error(`${arg} requires a positive integer.`);
      options[key] = ["budgetBytes", "maxLines"].includes(key)
        ? Number(value)
        : value;
    } else if (arg.startsWith("-"))
      throw new Error(`Unknown option ${JSON.stringify(arg)}.`);
    else if (options.path !== undefined)
      throw new Error("Supply exactly one source path.");
    else options.path = arg;
  }
  validateSelection(options);
  budgets(options);
  if (!options.path)
    throw new Error("Supply one repository-relative source path.");
  return options;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && ["--help", "-h"].includes(args[0]))
      console.log(
        "Usage: pnpm nav:read <file> (--symbol exactName | --lines start:end | --heading 'Exact heading' | --outline)\nOptions: --budget-bytes 2048..1048576 (default8192), --max-lines 8..10000 (default120). Complete selection or visible failure; instruction files require full reads.",
      );
    else
      process.stdout.write(
        renderReadExcerpt(readExcerpt(getRepoRoot(), parseReadArguments(args))),
      );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
