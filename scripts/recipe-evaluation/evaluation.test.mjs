import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  collectCorpusFiles,
  createCorpusManifest,
  repositoryRoot,
  runRecipeEvaluation,
  scoreRecognition,
  verifyCorpusManifest,
} from "./index.mjs";
const prefix = "scripts/recipe-evaluation/";
function disposable(fn) {
  const root = mkdtempSync(resolve(tmpdir(), "rec06-evaluation-"));
  try {
    for (const path of [...collectCorpusFiles(), `${prefix}manifest.json`]) {
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      cpSync(resolve(repositoryRoot, path), resolve(root, path));
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function amend(root, file, mutate) {
  const path = resolve(root, prefix + file);
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
function refreeze(root) {
  writeFileSync(
    resolve(root, prefix + "manifest.json"),
    JSON.stringify(createCorpusManifest(root), null, 2) + "\n",
  );
}

test("visible ground truth penalizes duplicates, hidden guesses and missed items", () => {
  assert.deepEqual(
    scoreRecognition(["rice", "chicken"], {
      labels: ["rice", "rice", "hidden oil"],
      abstained: false,
    }),
    {
      truePositives: 1,
      falsePositives: 2,
      falseNegatives: 1,
      precision: 1 / 3,
      recall: 0.5,
    },
  );
});
test("full and partial abstention retain missing-label recall instead of invented perfect precision", () => {
  assert.deepEqual(
    scoreRecognition(["rice"], { labels: [], abstained: true }),
    {
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 1,
      precision: null,
      recall: 0,
    },
  );
  assert.deepEqual(
    scoreRecognition(["rice", "carrot"], {
      labels: ["carrot"],
      abstained: true,
    }),
    {
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 1,
      precision: 1,
      recall: 0.5,
    },
  );
  assert.deepEqual(scoreRecognition([], { labels: [], abstained: true }), {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    precision: null,
    recall: null,
  });
});
test("bounded canonical labels reject malformed and oversized observations", () => {
  assert.throws(() =>
    scoreRecognition(["rice", "rice"], { labels: [], abstained: false }),
  );
  assert.throws(() =>
    scoreRecognition(["rice"], { labels: [" RICE "], abstained: false }),
  );
  assert.throws(() =>
    scoreRecognition(["rice"], {
      labels: Array(101).fill("rice"),
      abstained: false,
    }),
  );
});
test("frozen recipe references and photo scoring run with no fetch or real provider", () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("unexpected network");
  };
  try {
    const result = runRecipeEvaluation();
    assert.equal(result.referenceChecks.passed, 81);
    assert.equal(result.recipeContext.successfulTemplateCases, 23);
    assert.equal(result.recipeContext.blockedOrClarificationCases, 11);
    assert.equal(result.photoScoring.cases.length, 23);
    assert.equal(result.photoScoring.fullAbstentions, 2);
    assert.equal(result.photoScoring.partialAbstentions, 2);
    assert(result.photoScoring.micro.falsePositives > 0);
    assert.equal(result.liveAcceptance.status, "not_evaluated");
    for (const field of [
      "feasibleRecipeRate",
      "visibleIngredientPrecision",
      "visibleIngredientRecall",
      "providerOperationP95Milliseconds",
      "twoPhotoAndGenerationCost",
      "retryCost",
      "aggregateSpendLimit",
    ])
      assert.equal(result.liveAcceptance[field], null);
    assert.equal(
      result.photoScoring.source,
      "scripted_fixture_only_not_model_accuracy",
    );
  } finally {
    globalThis.fetch = previous;
  }
});
test("a changed frozen expectation fails before scoring and never rewrites its manifest", () =>
  disposable((root) => {
    const before = readFileSync(resolve(root, prefix + "manifest.json"));
    amend(root, "recipe-contexts.json", (value) => {
      value.cases[0].expected.recipeIds = [];
    });
    assert.throws(() => runRecipeEvaluation(root), /Frozen corpus changed/);
    assert.deepEqual(
      readFileSync(resolve(root, prefix + "manifest.json")),
      before,
    );
  }));
test("missing freeze members cannot silently reduce the corpus", () =>
  disposable((root) => {
    amend(root, "manifest.json", (value) => {
      value.entries.pop();
    });
    assert.throws(() => verifyCorpusManifest(root), /Frozen corpus changed/);
  }));
test("explicit refreeze still cannot weaken the plan's release thresholds", () =>
  disposable((root) => {
    amend(root, "thresholds.json", (value) => {
      value.release.visibleIngredientPrecision = 0.5;
    });
    refreeze(root);
    assert.throws(() => runRecipeEvaluation(root));
  }));
test("even refrozen fixtures must have the required recipe/context count", () =>
  disposable((root) => {
    amend(root, "recipe-contexts.json", (value) => {
      value.cases = value.cases.slice(0, 39);
    });
    refreeze(root);
    assert.throws(() => runRecipeEvaluation(root));
  }));
test("corpus path traversal and escaping symlinks fail before reading their target", () =>
  disposable((root) => {
    amend(root, "photo-scenarios.json", (value) => {
      value.scenarios[0].sceneFiles = ["../../outside.svg"];
    });
    assert.throws(() => createCorpusManifest(root), /Unexpected corpus path/);
    const outsideDir = mkdtempSync(resolve(tmpdir(), "rec06-outside-"));
    const outside = resolve(outsideDir, "outside.svg");
    const path = resolve(root, prefix + "scenes/escape.svg");
    symlinkSync(outside, path);
    // Missing targets fail closed too; existing external targets cannot be accepted.
    writeFileSync(outside, "<svg></svg>");
    try {
      amend(root, "photo-scenarios.json", (value) => {
        value.scenarios[0].sceneFiles = [prefix + "scenes/escape.svg"];
      });
      assert.throws(() => createCorpusManifest(root), /escapes repository/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  }));
test("refrozen active SVG content cannot enter offline image fixtures", () =>
  disposable((root) => {
    const photos = JSON.parse(
      readFileSync(resolve(root, prefix + "photo-scenarios.json"), "utf8"),
    );
    writeFileSync(
      resolve(root, photos.scenarios[0].sceneFiles[0]),
      '<svg><script>alert("bad")</script></svg>',
    );
    refreeze(root);
    assert.throws(() => runRecipeEvaluation(root), /Unsafe SVG/);
  }));
test("CLI emits qualified reports and rejects live/unknown flags", () => {
  const root = mkdtempSync(resolve(tmpdir(), "rec06-cli-"));
  try {
    const output = resolve(root, "report.json");
    const ok = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/run-meal-recipe-evaluation.mjs",
        "--output",
        output,
      ],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(
      JSON.parse(readFileSync(output, "utf8")).liveAcceptance.status,
      "not_evaluated",
    );
    const bad = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/run-meal-recipe-evaluation.mjs", "--live"],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 30000 },
    );
    assert.notEqual(bad.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
