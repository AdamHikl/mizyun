import { readFile } from "node:fs/promises";

import {
  isAnalyticsExport,
  summarizeAlphaAnalytics,
  type AnalyticsExport,
} from "../packages/observability/src/index.ts";

const main = async (): Promise<void> => {
  const paths = process.argv.slice(2).filter((argument) => argument !== "--");
  if (paths.length === 0) {
    process.stderr.write(
      "Usage: pnpm alpha:analyze -- <anonymous-export.json> [...]\n",
    );
    process.exitCode = 1;
    return;
  }

  const exports: AnalyticsExport[] = [];
  for (const [index, path] of paths.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch {
      throw new Error(`Export ${index + 1} is not readable JSON.`);
    }
    if (!isAnalyticsExport(parsed)) {
      throw new Error(`Export ${index + 1} does not match the safe schema.`);
    }
    exports.push(parsed);
  }
  process.stdout.write(
    `${JSON.stringify(summarizeAlphaAnalytics(exports), null, 2)}\n`,
  );
};

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Alpha analysis failed."}\n`,
  );
  process.exitCode = 1;
});
