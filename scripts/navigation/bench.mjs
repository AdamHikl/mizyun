import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { getRepoRoot } from "./feature-map.mjs";
import { getRepositoryIndex } from "./repository-index.mjs";

export function median(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value)))
    throw new Error("Median needs finite samples.");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function parseBenchArgs(args) {
  const options = { samples: 5, json: false };
  const seen = new Set();
  for (let n = 0; n < args.length; n++) {
    const flag = args[n];
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (flag === "--json") options.json = true;
    else if (flag === "--samples") {
      const value = args[++n];
      if (!/^\d+$/.test(value || "") || Number(value) < 1 || Number(value) > 10)
        throw new Error("--samples requires an integer from 1 to 10.");
      options.samples = Number(value);
    } else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

// Tool-output size is a proxy, not model tokens or accepted-task performance.
export function benchmarkNavigation(root, { samples = 5 } = {}) {
  if (!Number.isInteger(samples) || samples < 1 || samples > 10)
    throw new Error("Samples must be an integer from 1 to 10.");
  const snapshots = new Set();
  const measureIndex = (cache) => {
    const start = performance.now();
    const index = getRepositoryIndex(root, { cache });
    snapshots.add(index.snapshot.id);
    return {
      milliseconds: +(performance.now() - start).toFixed(2),
      ...index.stats,
      edges: index.edges.length,
    };
  };
  const cold = Array.from({ length: samples }, () => measureIndex(false));
  const prime = measureIndex(true);
  const warm = Array.from({ length: samples }, () => measureIndex(true));
  const run = (script, args) => {
    const start = performance.now();
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/navigation", script), ...args],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        `Benchmark ${script} failed: ${result.error?.message || result.stderr.trim()}`,
      );
    return {
      milliseconds: +(performance.now() - start).toFixed(2),
      bytes: Buffer.byteLength(result.stdout),
      lines: result.stdout.trimEnd().split("\n").length,
    };
  };
  const selectedPath = "apps/mobile/src/features/community/state/read-cache.ts";
  const context = run("context.mjs", [
    "community",
    "--query",
    "feed loading empty state",
  ]);
  const impact = run("impact.mjs", ["--path", selectedPath]);
  const excerpt = run("read.mjs", [selectedPath, "--lines", "1:30"]);
  const wholeFile = fs.readFileSync(path.join(root, selectedPath));
  const final = getRepositoryIndex(root);
  snapshots.add(final.snapshot.id);
  if (snapshots.size !== 1)
    throw new Error(
      "Repository changed during benchmark; retry after writes settle.",
    );
  return {
    date: new Date().toISOString(),
    node: process.version,
    root: final.snapshot.root,
    headSha: final.snapshot.headSha,
    snapshot: final.snapshot.id,
    samples,
    units:
      "Index timing: synchronous in-process milliseconds, with full content validation. CLI timing includes a fresh Node process. Sizes: rendered UTF-8 bytes/lines, not model tokens, cost or accepted-task latency.",
    index: {
      coldMedianMs: median(cold.map((item) => item.milliseconds)),
      warmMedianMs: median(warm.map((item) => item.milliseconds)),
      cold,
      prime,
      warm,
    },
    output: {
      context,
      impact: { ...impact, scope: "selected-path", path: selectedPath },
      excerpt: {
        ...excerpt,
        path: selectedPath,
        selection: "lines 1:30",
        wholeFileBytes: wholeFile.length,
      },
    },
  };
}

function main() {
  const options = parseBenchArgs(process.argv.slice(2));
  const report = benchmarkNavigation(getRepoRoot(), options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `Navigation measurement: HEAD ${report.headSha}; snapshot ${report.snapshot}`,
    );
    console.log(
      `Index ${report.samples} samples: no-cache median ${report.index.coldMedianMs.toFixed(1)}ms; warm median ${report.index.warmMedianMs.toFixed(1)}ms.`,
    );
    console.log(
      `Warm graph cache: ${report.index.warm.map((item) => item.graphCache || "unavailable").join(", ")}; actual resolutions: ${report.index.warm.map((item) => item.graphResolved ?? "unavailable").join(", ")}.`,
    );
    for (const [kind, item] of Object.entries(report.output))
      console.log(
        `${kind}: ${item.bytes} bytes / ${item.lines} lines; CLI ${item.milliseconds.toFixed(1)}ms${item.wholeFileBytes ? `; whole file ${item.wholeFileBytes} bytes` : ""}.`,
      );
    console.log(report.units);
    console.log(
      "Use --json for complete samples. No timing threshold or client acceptance is inferred.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
