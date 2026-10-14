#!/usr/bin/env node
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
// Never instantiate a live provider. Fail if any dependency attempts fetch.
globalThis.fetch = () => {
  throw new Error("Network is forbidden in offline recipe evaluation");
};
const { runRecipeEvaluation } = await import("./recipe-evaluation/index.mjs");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output"))
  throw new Error(
    "Usage: node --import tsx scripts/run-meal-recipe-evaluation.mjs [--output report.json]",
  );
const report = runRecipeEvaluation();
if (args.length)
  writeFileSync(resolve(args[1]), JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
console.log(
  `Recipe evaluation ${report.mode}: ${report.referenceChecks.passed} reference checks PASS; corpus ${report.corpusFingerprint}`,
);
console.log(
  `${report.recipeContext.successfulTemplateCases} successful template cases; ${report.recipeContext.blockedOrClarificationCases} blocked/clarification cases (not successful generation).`,
);
console.log(
  `${report.photoScoring.cases.length} synthetic photo scenarios; ${report.photoScoring.abstentions} scripted abstentions. Scripted metrics are not provider accuracy.`,
);
console.log(
  "Live feasibility, recognition, latency/cost, qualified review, Dev/native and pilot: NOT EVALUATED.",
);
