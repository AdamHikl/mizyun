#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createCorpusManifest,
  repositoryRoot,
} from "./recipe-evaluation/index.mjs";
if (process.argv.slice(2).join(" ") !== "--confirm-offline-freeze")
  throw new Error(
    "Explicit offline freeze required. Run with --confirm-offline-freeze before live observations; changed references require independent review.",
  );
writeFileSync(
  resolve(repositoryRoot, "scripts/recipe-evaluation/manifest.json"),
  JSON.stringify(createCorpusManifest(), null, 2) + "\n",
);
console.log(
  "Offline corpus/threshold freeze written; never silently update after evaluation results.",
);
