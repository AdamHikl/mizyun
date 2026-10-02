import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { getRepositoryIndex } from "./repository-index.mjs";
import {
  loadFeatureMap,
  findFeature,
  getFeaturesForPath,
} from "./feature-map.mjs";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "with",
  "how",
  "change",
  "fix",
  "add",
  "implement",
  "this",
  "that",
]);
function words(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !STOP_WORDS.has(word));
}
function lexicalScore(value, terms) {
  const text = String(value || "").toLowerCase();
  const tokens = new Set(words(value));
  return terms.reduce(
    (score, term) =>
      score + (tokens.has(term) ? 3 : text.includes(term) ? 1 : 0),
    0,
  );
}
function featureSummary(feature) {
  return Object.fromEntries(
    [
      "id",
      "title",
      "summary",
      "requirements",
      "openAcceptance",
      "docs",
      "verificationCommands",
      "relations",
      "limitations",
      "ownedPaths",
      "lastReviewedSha",
      "lastReviewedDate",
    ]
      .filter((key) => feature[key] !== undefined)
      .map((key) => [key, feature[key]]),
  );
}
function normalizeSelection(root, value) {
  const absolute = path.resolve(root, value);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative))
    throw new Error(
      "--path must identify an indexed file inside the repository.",
    );
  return relative;
}

/** Returns locations and explicit intent, never source bodies or execution results. */
export function createTaskPacket(root, options = {}) {
  const mapPath = path.join(root, "docs/feature-map.json");
  const mapHash = createHash("sha256")
    .update(fs.readFileSync(mapPath))
    .digest("hex");
  const map = loadFeatureMap(root);
  const index = getRepositoryIndex(root, { cache: options.cache !== false });
  if (
    index.files.find((file) => file.path === "docs/feature-map.json")?.hash !==
      mapHash ||
    createHash("sha256").update(fs.readFileSync(mapPath)).digest("hex") !==
      mapHash
  )
    throw new Error(
      "Feature intent changed during discovery. Retry the context request after writes settle.",
    );
  let requestedFeature;
  if (options.feature) {
    const lookup = findFeature(map, options.feature);
    if (!lookup.found)
      throw new Error(
        `Unknown or ambiguous feature '${options.feature}'. Suggestions: ${lookup.suggestions.join(", ") || "pnpm context --list"}`,
      );
    requestedFeature = lookup.feature;
  }
  const selectedPath = options.path && normalizeSelection(root, options.path);
  if (selectedPath && !index.files.some((file) => file.path === selectedPath))
    throw new Error(
      `File '${selectedPath}' is absent, excluded, or unsafe for indexing.`,
    );
  const terms = [...new Set(words(options.query))];
  if (options.query && terms.length === 0)
    throw new Error("--query needs at least one searchable word.");
  const selectable = index.files.filter((file) =>
    ["source", "doc", "sql"].includes(file.kind),
  );
  const ranked = [];
  for (const file of selectable) {
    const matches = getFeaturesForPath(map, file.path);
    if (
      requestedFeature &&
      !matches.some((feature) => feature.id === requestedFeature.id)
    )
      continue;
    const symbols = file.symbols || [];
    const headings = file.headings || [];
    const symbolMatch =
      options.symbol &&
      symbols.find((symbol) => symbol.name === options.symbol);
    if (options.symbol && !symbolMatch) continue;
    if (selectedPath && file.path !== selectedPath) continue;
    let score = lexicalScore(file.path, terms) * 2;
    let line = symbolMatch?.line || 1;
    let best = 0;
    for (const item of [...symbols, ...headings]) {
      const value = lexicalScore(item.name || item.title, terms);
      score += value;
      if (value > best) {
        best = value;
        line = item.line;
      }
    }
    if (terms.length && score === 0) continue;
    if (!terms.length)
      score = requestedFeature?.entryPoints?.includes(file.path)
        ? 30
        : /\.(test|spec)\./.test(file.path)
          ? 5
          : 10;
    ranked.push({
      ...file,
      line,
      score,
      reason: selectedPath
        ? "selected-path"
        : symbolMatch
          ? "symbol-declaration"
          : terms.length
            ? "lexical-match"
            : "feature-discovery",
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  if (!ranked.length)
    throw new Error(
      "No indexed locations match this selection. Try fewer query words, a file path, or an exact declared symbol.",
    );
  const seeds = ranked.slice(0, 16);
  const selected = new Map(seeds.map((file) => [file.path, file]));
  const relevantEdges = [];
  const seedsSet = new Set(seeds.map((file) => file.path));
  const byPath = new Map(index.files.map((file) => [file.path, file]));
  for (const edge of index.edges) {
    if (!seedsSet.has(edge.from) && !seedsSet.has(edge.to)) continue;
    relevantEdges.push(edge);
    for (const relative of [edge.from, edge.to]) {
      if (selected.has(relative) || selected.size >= 32) continue;
      const file = byPath.get(relative);
      if (file && ["source", "doc", "sql"].includes(file.kind))
        selected.set(relative, {
          ...file,
          line: relative === edge.from ? edge.line : 1,
          score: 0,
          reason: seedsSet.has(edge.to)
            ? "direct-consumer"
            : "direct-dependency",
        });
    }
  }
  const features = new Map(
    requestedFeature ? [[requestedFeature.id, requestedFeature]] : [],
  );
  for (const file of selected.values())
    for (const feature of getFeaturesForPath(map, file.path))
      features.set(feature.id, feature);
  // Shared contracts may belong to many features; retain all intent pointers instead of guessing ownership.
  const files = [...selected.values()].map((file) => ({
    path: file.path,
    hash: file.hash,
    kind: file.kind,
    line: file.line,
    reason: file.reason,
    symbols: (file.symbols || []).slice(0, 8),
    headings: (file.headings || []).slice(0, 4),
  }));
  const docs = [...features.values()].flatMap((feature) => feature.docs || []);
  const relatedDocs = index.files.filter(
    (file) =>
      file.kind === "doc" &&
      docs.some((doc) => doc.split("#")[0] === file.path),
  );
  const currentPaths = new Set(files.map((file) => file.path));
  return {
    intentHash: createHash("sha256")
      .update(JSON.stringify(map.raw))
      .digest("hex"),
    selection: {
      feature: requestedFeature?.id || null,
      query: options.query || null,
      path: selectedPath || null,
      symbol: options.symbol || null,
    },
    snapshot: index.snapshot,
    stats: index.stats,
    features: [...features.values()].map(featureSummary),
    files,
    relatedDocs: relatedDocs.map((file) => ({
      path: file.path,
      headings: file.headings || [],
    })),
    relationships: relevantEdges.slice(0, 40),
    coverage: {
      matchedFiles: ranked.length,
      omittedMatches: Math.max(0, ranked.length - seeds.length),
      relationships: relevantEdges.length,
      omittedRelationships: Math.max(0, relevantEdges.length - 40),
      unmappedFiles: files
        .filter((file) => getFeaturesForPath(map, file.path).length === 0)
        .map((file) => file.path),
    },
    unresolved: index.unresolved.filter((item) => currentPaths.has(item.file)),
    warnings: index.warnings,
    limitations:
      "Static file relationships and likely test locations are advisory. Dynamic registration, SQL/RLS behavior and actual test coverage require inspection. Index freshness is not reviewed acceptance. No commands are executed.",
  };
}

function fitPacket(
  required,
  optional,
  { budgetBytes = 8192, all = false } = {},
) {
  if (all) return [...required, ...optional].join("\n");
  const footerReserve = 180;
  const lineCount = (lines) => lines.join("\n").split("\n").length;
  if (
    Buffer.byteLength(required.join("\n")) + footerReserve > budgetBytes ||
    lineCount(required) > 112
  ) {
    throw new Error(
      "Required instructions, warnings or acceptance pointers exceed this packet budget. Narrow the selection, raise --budget-bytes, or use --json/--all; none were silently dropped.",
    );
  }
  const selected = [...required];
  let omitted = 0;
  for (const line of optional) {
    if (
      lineCount([...selected, line]) > 112 ||
      Buffer.byteLength([...selected, line].join("\n")) + footerReserve >
        budgetBytes
    )
      omitted++;
    else selected.push(line);
  }
  if (omitted)
    selected.push(
      `... [Truncated ${omitted} optional lines. Use --json or --all for complete results, or narrow with --query/--path/--symbol.]`,
    );
  return selected.join("\n");
}

function featureIntentLines(feature) {
  return [
    ...(feature.requirements?.length
      ? [
          "--- Requirements & Work Items ---",
          ...feature.requirements.map((item) => `  • ${item}`),
        ]
      : []),
    ...(feature.openAcceptance?.length
      ? [
          "--- Open Acceptance Gates & Findings ---",
          ...feature.openAcceptance.map((item) => `  • ${item}`),
        ]
      : []),
  ];
}

export function renderFeaturePacket(feature, options = {}) {
  const state = options.reviewState || {};
  const required = [
    `FEATURE: ${feature.title} [${feature.id}]`,
    `Summary: ${feature.summary}`,
    `Reviewed: ${feature.lastReviewedDate} (SHA: ${feature.lastReviewedSha?.slice(0, 8) || "none"}); this is separate from index freshness.`,
    ...(state.committed
      ? [
          `WARNING: Stale committed review: ${state.committed.changedPaths.length} owned paths changed.`,
        ]
      : []),
    ...(state.committedUnavailable
      ? ["WARNING: Committed review unavailable in this checkout."]
      : []),
    ...(state.local
      ? [
          `WARNING: Local review drift: ${state.local.changedPaths.length} owned paths changed.`,
        ]
      : []),
    ...(feature.limitations ? [`Limitations: ${feature.limitations}`] : []),
    "--- Applicable Nested Instructions ---",
    ...(options.instructions || []).map(
      (item) => `  • ${item.path}: ${item.reason}`,
    ),
    ...featureIntentLines(feature),
    "Advisory only. Full pnpm check and release gates remain required; suggested commands are inert.",
  ];
  const discovery = options.discovery;
  if (discovery)
    required.push(
      `Index: ${discovery.snapshot.id} at ${discovery.snapshot.headSha || "unborn HEAD"}; ${discovery.stats.files} files; ${discovery.stats.parsed} parsed / ${discovery.stats.reused} reused.`,
      `Coverage: ${discovery.coverage.omittedMatches} additional matching files; ${discovery.unresolved.length} selected unresolved imports.`,
      ...discovery.warnings.map((warning) => `WARNING: ${warning}`),
    );
  const optional = [
    "--- Relevant Tests & Advisory Checks ---",
    ...(feature.verificationCommands || [])
      .slice(0, 4)
      .map((item) => `  Command: ${item}`),
    ...(discovery?.files || [])
      .filter((file) => /\.(test|spec)\./.test(file.path))
      .slice(0, 4)
      .map((file) => `  Discovered test candidate: ${file.path}:${file.line}`),
    ...(feature.tests || []).slice(0, 4).map((item) => `  Test: ${item}`),
    "--- Primary Entry Points ---",
    ...(feature.entryPoints || []).map((item) => `  • ${item}`),
    "--- Automatically Discovered Locations ---",
    ...(discovery?.files || []).map(
      (file) => `  ${file.path}:${file.line} [${file.reason}]`,
    ),
    "--- Documentation, Decisions & Patterns ---",
    ...(feature.docs || []).map((item) => `  • ${item}`),
    "--- Direct Relationships ---",
    ...(feature.relations || []).map(
      (item) => `  • [${item.type}] -> ${item.target}: ${item.reason}`,
    ),
    "--- Implementation Components ---",
    ...[
      "contracts",
      "domainPort",
      "api",
      "ui",
      "adapters",
      "dataTables",
      "migrationPaths",
    ].flatMap((key) => (feature[key] || []).map((item) => `  ${key}: ${item}`)),
    ...(feature.verificationCommands || [])
      .slice(4)
      .map((item) => `  Command: ${item}`),
    ...(feature.tests || []).slice(4).map((item) => `  Test: ${item}`),
  ];
  return fitPacket(required, optional, options);
}

export function renderTaskPacket(packet, options = {}) {
  const required = [
    `TASK CONTEXT: ${JSON.stringify(packet.selection)}`,
    `Snapshot: ${packet.snapshot.id}; HEAD ${packet.snapshot.headSha || "unborn"}.`,
    `Index: ${packet.stats.files} files; ${packet.stats.parsed} parsed / ${packet.stats.reused} reused.`,
    "--- Applicable Nested Instructions ---",
    ...(packet.instructions || []).map(
      (item) => `  • ${item.path}: ${item.reason}`,
    ),
    ...packet.features.flatMap((feature) => [
      `Feature: ${feature.title} [${feature.id}]`,
      ...(feature.limitations ? [`Limitations: ${feature.limitations}`] : []),
      ...featureIntentLines(feature),
    ]),
    ...(packet.reviewStates || [])
      .filter(
        (state) => state.committed || state.local || state.committedUnavailable,
      )
      .map(
        (state) =>
          `WARNING: ${state.id} has ${state.committed ? "committed " : ""}${state.local ? "local " : ""}${state.committedUnavailable ? "unavailable " : ""}review drift; index refresh does not accept changes.`,
      ),
    `Coverage: ${packet.coverage.omittedMatches} additional matches / ${packet.coverage.omittedRelationships} additional relationships; ${packet.coverage.unmappedFiles.length} selected unmapped files; ${packet.unresolved.length} selected unresolved imports.`,
    ...packet.warnings.map((warning) => `WARNING: ${warning}`),
    packet.limitations,
    "Full pnpm check and release gates remain required. Use the current source at each location before editing.",
  ];
  const optional = [
    "--- Relevant Tests & Inert Advisory Checks ---",
    ...packet.files
      .filter((file) => /\.(test|spec)\./.test(file.path))
      .slice(0, 4)
      .map((file) => `  Test candidate: ${file.path}:${file.line}`),
    ...packet.features.flatMap((feature) =>
      (feature.verificationCommands || [])
        .slice(0, 2)
        .map((command) => `  Command: ${command}`),
    ),
    "--- Selected Locations ---",
    ...packet.files.map(
      (file) =>
        `  ${file.path}:${file.line} [${file.reason}]${file.symbols.length ? ` — ${file.symbols.map((item) => item.name).join(", ")}` : ""}`,
    ),
    "--- Direct Source Relationships ---",
    ...packet.relationships.map(
      (edge) =>
        `  ${edge.from}:${edge.line} -> ${edge.to} [${edge.typeOnly ? "type" : "runtime"}]`,
    ),
    "--- Documentation & Inert Advisory Checks ---",
    ...packet.relatedDocs.map(
      (doc) =>
        `  ${doc.path}${
          doc.headings.length
            ? ` — ${doc.headings
                .slice(0, 3)
                .map((item) => item.title)
                .join("; ")}`
            : ""
        }`,
    ),
    ...packet.features.flatMap((feature) =>
      (feature.verificationCommands || []).map(
        (command) => `  Command: ${command}`,
      ),
    ),
    ...packet.unresolved.map(
      (item) =>
        `  Unresolved: ${item.file}:${item.line} ${item.specifier || item.kind}`,
    ),
  ];
  return fitPacket(required, optional, options);
}
