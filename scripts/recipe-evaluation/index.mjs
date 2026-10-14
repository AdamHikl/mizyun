import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMealRecipeMacroContext,
  rankMealRecipeCandidates,
} from "../../packages/core/src/index.js";
import {
  mealRecipeDraftSchema,
  mealRecipeRankResultSchema,
} from "../../packages/contracts/src/index.js";
import {
  buildFeasibleRecipeTemplates,
  getRecipeCatalogIngredient,
  RECIPE_CATALOG_REVISION,
} from "../../apps/api/src/modules/meal-recipes/index.js";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const corpusPrefix = "scripts/recipe-evaluation/";
const fixedFiles = [
  `${corpusPrefix}thresholds.json`,
  `${corpusPrefix}recipe-contexts.json`,
  `${corpusPrefix}photo-scenarios.json`,
  "apps/api/src/modules/meal-recipes/catalog-data.ts",
  "apps/api/src/modules/meal-recipes/catalog-source.json",
];
const now = new Date("2026-10-13T12:00:00Z");
const macroKeys = ["proteinG", "carbohydrateG", "fatG"];
const nutritionalKeys = ["caloriesKcal", ...macroKeys];
const equal = (actual, expected, message) =>
  assert.deepEqual(actual, expected, message);
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const keys = (object, allowed) => {
  assert(object && typeof object === "object" && !Array.isArray(object));
  equal(
    Object.keys(object).sort(),
    [...allowed].sort(),
    "Unexpected fixture fields",
  );
};
function read(root, path) {
  assert(
    fixedFiles.includes(path) ||
      /^scripts\/recipe-evaluation\/scenes\/[a-z0-9-]+\.svg$/.test(path),
    "Unexpected corpus path",
  );
  const base = realpathSync(root);
  const full = realpathSync(resolve(base, path));
  assert(full.startsWith(base + sep), "Corpus symlink escapes repository");
  assert(statSync(full).size <= 1_048_576, "Corpus member exceeds 1 MiB");
  return readFileSync(full);
}
const json = (root, path) => JSON.parse(read(root, path).toString("utf8"));
export function collectCorpusFiles(root = repositoryRoot) {
  const photos = json(root, `${corpusPrefix}photo-scenarios.json`);
  assert(Array.isArray(photos.scenarios) && photos.scenarios.length <= 100);
  const scenes = photos.scenarios.flatMap((s) => {
    assert(
      Array.isArray(s.sceneFiles) &&
        s.sceneFiles.length >= 1 &&
        s.sceneFiles.length <= 2,
    );
    return s.sceneFiles;
  });
  return [...new Set([...fixedFiles, ...scenes])].sort();
}
export function createCorpusManifest(root = repositoryRoot) {
  return {
    version: "recipe-evaluation-freeze-v1",
    frozenOn: "2026-10-13",
    liveProviderObservationsAtFreeze: 0,
    purpose:
      "Immutable offline references and release thresholds; explicit versioned edits require a new reviewed freeze.",
    entries: collectCorpusFiles(root).map((path) => ({
      path,
      sha256: hash(read(root, path)),
    })),
  };
}
export function verifyCorpusManifest(root = repositoryRoot) {
  const path = resolve(root, `${corpusPrefix}manifest.json`);
  assert(statSync(path).size <= 65536);
  const actual = JSON.parse(readFileSync(path, "utf8"));
  equal(
    actual,
    createCorpusManifest(root),
    "Frozen corpus changed; do not silently regenerate expectations after observing results",
  );
  return hash(readFileSync(path));
}

/** Exact canonical visible labels; duplicates and hidden/ambiguous guesses are false positives. */
export function scoreRecognition(visibleLabels, observation) {
  assert(Array.isArray(visibleLabels) && visibleLabels.length <= 50);
  assert(Array.isArray(observation.labels) && observation.labels.length <= 100);
  assert(typeof observation.abstained === "boolean");
  // Abstention may be partial: visible items can be returned while uncertain items are withheld.
  const validLabel = (label) =>
    typeof label === "string" &&
    label.length > 0 &&
    label.length <= 160 &&
    label === label.trim().toLowerCase();
  assert([...visibleLabels, ...observation.labels].every(validLabel));
  equal(new Set(visibleLabels).size, visibleLabels.length);
  const visible = new Set(visibleLabels),
    found = new Set();
  let truePositives = 0,
    falsePositives = 0;
  for (const label of observation.labels) {
    if (visible.has(label) && !found.has(label)) {
      found.add(label);
      truePositives++;
    } else falsePositives++;
  }
  const falseNegatives = visible.size - found.size;
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision: observation.labels.length
      ? truePositives / observation.labels.length
      : null,
    recall: visible.size ? truePositives / visible.size : null,
  };
}
function contextFor(tc) {
  const patch = tc.sourcePatch;
  const allowed = [
    "unknownFat",
    "noSummary",
    "intakeReadComplete",
    "coverage",
    "energyComplete",
    "expired",
    "previousLocalDay",
    "currentRevision",
    "allExhausted",
  ];
  assert(Object.keys(patch).every((k) => allowed.includes(k)));
  const snapshot = {
    localDate: patch.previousLocalDay ? "2026-10-12" : "2026-10-13",
    timeZone: "UTC",
    generatedAt: "2026-10-13T11:59:00Z",
    expiresAt: patch.expired ? "2026-10-13T11:59:59Z" : "2026-10-13T12:05:00Z",
    energyFormulaVersion: "v1-mifflin-st-jeor-2026-07",
    goalRevision: "goal-1",
    intakeRevision: "intake-1",
    constraintsRevision: "constraints-1",
    profileRevision: "profile-1",
  };
  const targets = { proteinG: 150, carbohydrateG: 300, fatG: 60 };
  const remaining = patch.allExhausted
    ? { proteinG: -10, carbohydrateG: -10, fatG: -10 }
    : tc.remaining;
  const summary = {
    date: snapshot.localDate,
    entryCount: 2,
    ...Object.fromEntries(macroKeys.map((k) => [k, targets[k] - remaining[k]])),
  };
  if (patch.unknownFat) summary.fatG = null;
  const source = {
    energy: {
      complete: patch.energyComplete !== false,
      formulaVersion: snapshot.energyFormulaVersion,
      targetProteinG: targets.proteinG,
      targetCarbohydrateG: targets.carbohydrateG,
      targetFatG: targets.fatG,
    },
    summary: patch.noSummary ? null : summary,
    snapshot,
    coverage: patch.coverage ?? "logged_so_far",
    intakeReadComplete: patch.intakeReadComplete !== false,
    now,
  };
  const current = { ...snapshot };
  if (patch.currentRevision) {
    assert(
      [
        "goalRevision",
        "intakeRevision",
        "constraintsRevision",
        "profileRevision",
      ].includes(patch.currentRevision),
    );
    current[patch.currentRevision] += "-changed";
  }
  return { source, current };
}
function templateInput(corpus, tc) {
  const patch = tc.patch;
  const allowed = [
    "allergens",
    "dietaryRestrictions",
    "ingredientIds",
    "omit",
    "add",
    "ingredientPatches",
    "expectedCheckQuantity",
    "maximumPrepMinutes",
    "mealSize",
    "cuisines",
    "duplicateFirst",
  ];
  assert(Object.keys(patch).every((k) => allowed.includes(k)));
  assert(Object.hasOwn(corpus.groups, tc.group));
  const ids = [
    ...corpus.groups[tc.group].filter((id) => !(patch.omit ?? []).includes(id)),
    ...(patch.add ?? []),
  ];
  const ingredients = ids.map((id) => ({
    ingredientId: id,
    name: "Synthetic confirmed ingredient",
    confirmed: true,
    preparationState:
      getRecipeCatalogIngredient(id)?.preparationState ?? "as_sold",
    quantity: 5000,
    quantityUnit: "g",
    availability: "confirmed",
    ...(patch.ingredientPatches?.[id] ?? {}),
  }));
  if (patch.duplicateFirst) ingredients.push({ ...ingredients[0] });
  return {
    version: "meal-recipe-v1",
    ingredients,
    exclusions: {
      ingredientIds: patch.ingredientIds ?? [],
      allergens: patch.allergens ?? [],
      dietaryRestrictions: patch.dietaryRestrictions ?? [],
    },
    preferences: {
      maximumPrepMinutes: patch.maximumPrepMinutes ?? null,
      mealSize: patch.mealSize ?? "normal",
      cuisines: patch.cuisines ?? [],
    },
  };
}
function validateNutrition(draft, reference, scale, tolerance) {
  assert(reference, "Missing independently frozen recipe reference");
  equal(draft.provenance.catalogRevision, RECIPE_CATALOG_REVISION);
  equal(draft.provenance.calculationVersion, "ingredient-weight-v1");
  equal(draft.provenance.source, "reference");
  equal(
    draft.ingredients.map((r) => r.ingredientId),
    reference.ingredients.map((r) => r.ingredientId),
  );
  for (let i = 0; i < draft.ingredients.length; i++) {
    const line = draft.ingredients[i],
      frozen = reference.ingredients[i];
    const catalog = getRecipeCatalogIngredient(line.ingredientId);
    equal(catalog.fdcId, frozen.fdcId);
    equal(catalog.per100g, frozen.per100g);
    equal(line.preparationState, frozen.preparationState);
    equal(line.weightGrams, frozen.grams * scale * draft.servings);
  }
  // Sum fixed source rows independently; do not call the production nutrition calculator as its own oracle.
  for (const field of nutritionalKeys) {
    const independent = round(
      reference.ingredients.reduce(
        (sum, r) => sum + (r.per100g[field] * r.grams * scale) / 100,
        0,
      ),
    );
    const actual =
      field === "caloriesKcal"
        ? draft.caloriesKcal
        : draft.nutritionPerServing[field];
    assert(
      Math.abs(actual - independent) <= tolerance,
      `Nutrition mismatch ${field}`,
    );
    if (scale === 1) equal(actual, reference.expectedPerServing[field]);
  }
  equal(draft.calorieRangeKcal, null);
  equal(draft.rangesPerServing, {
    proteinG: null,
    carbohydrateG: null,
    fatG: null,
  });
}
export function runRecipeEvaluation(root = repositoryRoot) {
  const fingerprint = verifyCorpusManifest(root);
  const thresholds = json(root, `${corpusPrefix}thresholds.json`);
  const corpus = json(root, `${corpusPrefix}recipe-contexts.json`);
  const photos = json(root, `${corpusPrefix}photo-scenarios.json`);
  equal(thresholds.version, "recipe-evaluation-v1");
  equal(thresholds.offline, {
    minimumRecipeContextFixtures: 40,
    minimumPhotoScenarios: 20,
    referencePassRate: 1,
    maximumForbiddenIngredientSuccesses: 0,
    maximumCrossOwnerSuccesses: 0,
    maximumUnauthorizedProviderCalls: 0,
    nutritionAbsoluteTolerance: 0.005,
  });
  equal(thresholds.release.eligibleIndependentlyFeasibleRecipeRate, 0.9);
  equal(thresholds.release.visibleIngredientPrecision, 0.9);
  equal(thresholds.release.providerOperationP95Milliseconds, 15000);
  equal(corpus.version, "recipe-context-corpus-v1");
  equal(corpus.synthetic, true);
  equal(corpus.catalogRevision, RECIPE_CATALOG_REVISION);
  equal(photos.version, "recipe-photo-corpus-v1");
  equal(photos.synthetic, true);
  assert(corpus.cases.length >= 40 && corpus.cases.length <= 200);
  assert(photos.scenarios.length >= 20 && photos.scenarios.length <= 100);
  equal(
    new Set([...corpus.cases, ...photos.scenarios].map((x) => x.id)).size,
    corpus.cases.length + photos.scenarios.length,
  );
  const refs = new Map(corpus.referenceRecipes.map((r) => [r.recipeId, r]));
  const base = buildFeasibleRecipeTemplates(
    templateInput(corpus, { group: "rice", patch: {} }),
    { now, servings: 1 },
  );
  const recipes = [],
    photoMetrics = [];
  for (const tc of corpus.cases) {
    assert(/^[a-z0-9-]{1,100}$/.test(tc.id));
    assert(Array.isArray(tc.tags) && tc.tags.length > 0);
    if (tc.kind === "context") {
      keys(tc, ["id", "kind", "tags", "remaining", "sourcePatch", "expected"]);
      const { source, current } = contextFor(tc);
      const result = rankMealRecipeCandidates(
        buildMealRecipeMacroContext(source),
        base.recipes.map((r) => r.candidate),
        { now, current },
      );
      mealRecipeRankResultSchema.parse(result);
      equal(
        {
          state: result.context.state,
          reason: result.context.reason,
          focus: result.context.focus,
          rankedRecipeIds: result.ranked.map((r) => r.recipeId),
          scored: result.ranked.every((r) => r.fitLoss !== null),
        },
        tc.expected,
        tc.id,
      );
      if (!tc.expected.scored)
        assert(
          result.ranked.every(
            (r) =>
              r.fitLoss === null &&
              macroKeys.every((k) => r.desiredMacros[k] === null),
          ),
        );
      recipes.push({
        id: tc.id,
        kind: tc.kind,
        outcome: "reference_pass",
        recommendationState: result.context.state,
      });
    } else {
      equal(tc.kind, "template");
      keys(tc, [
        "id",
        "kind",
        "tags",
        "group",
        "servings",
        "patch",
        "expected",
      ]);
      const input = templateInput(corpus, tc);
      const result = buildFeasibleRecipeTemplates(input, {
        now,
        servings: tc.servings,
      });
      equal(
        {
          state: result.state,
          recipeIds: result.recipes.map((r) => r.draft.recipeId),
          clarificationReasons: result.clarificationReasons,
        },
        tc.expected,
        tc.id,
      );
      const scale = { small: 0.75, normal: 1, large: 1.25 }[
        input.preferences.mealSize
      ];
      for (const item of result.recipes) {
        mealRecipeDraftSchema.parse(item.draft);
        validateNutrition(
          item.draft,
          refs.get(item.draft.recipeId),
          scale,
          thresholds.offline.nutritionAbsoluteTolerance,
        );
        assert(
          item.draft.ingredients.every((line) =>
            input.ingredients.some(
              (row) =>
                row.ingredientId === line.ingredientId &&
                row.confirmed &&
                row.availability !== "missing",
            ),
          ),
        );
        if (tc.patch.expectedCheckQuantity) {
          equal(item.candidate.availability, "check_quantity");
          assert(
            item.draft.warnings.some((text) =>
              text.startsWith("Check you have enough"),
            ),
          );
        }
      }
      recipes.push({
        id: tc.id,
        kind: tc.kind,
        outcome: "reference_pass",
        disposition: result.state,
        successfulSuggestion: result.state === "ready",
        recipeCount: result.recipes.length,
      });
    }
  }
  for (const scenario of photos.scenarios) {
    keys(scenario, [
      "id",
      "tags",
      "sceneFiles",
      "description",
      "visibleLabels",
      "ambiguousLabels",
      "hiddenLabels",
      "exclusions",
      "preparationStates",
      "quantityNotes",
      "expectedDisposition",
      "scriptedObservation",
      "expectedMetrics",
    ]);
    assert(
      [
        "review_required",
        "clarification_required",
        "insufficient_ingredients",
      ].includes(scenario.expectedDisposition),
    );
    assert(
      scenario.visibleLabels.every(
        (label) =>
          !scenario.ambiguousLabels.includes(label) &&
          !scenario.hiddenLabels.includes(label),
      ),
    );
    for (const path of scenario.sceneFiles) {
      const svg = read(root, path).toString("utf8");
      assert(
        svg.includes("<svg") &&
          !/<script|<foreignObject|\b(?:href|src)\s*=|\bon[a-z]+\s*=/i.test(
            svg,
          ),
        "Unsafe SVG fixture",
      );
    }
    const metrics = scoreRecognition(
      scenario.visibleLabels,
      scenario.scriptedObservation,
    );
    equal(metrics, scenario.expectedMetrics, scenario.id);
    photoMetrics.push({
      id: scenario.id,
      ...metrics,
      abstained: scenario.scriptedObservation.abstained,
      abstentionState: !scenario.scriptedObservation.abstained
        ? "none"
        : scenario.scriptedObservation.labels.length
          ? "partial"
          : "full",
      disposition: scenario.expectedDisposition,
      source: "scripted_fixture_only",
    });
  }
  const totals = photoMetrics.reduce(
    (a, m) => ({
      truePositives: a.truePositives + m.truePositives,
      falsePositives: a.falsePositives + m.falsePositives,
      falseNegatives: a.falseNegatives + m.falseNegatives,
    }),
    { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
  );
  return {
    version: "recipe-evaluation-report-v1",
    mode: "offline",
    corpusFingerprint: fingerprint,
    referenceChecks: {
      passed: recipes.length + photoMetrics.length,
      failed: 0,
      passRate: 1,
    },
    recipeContext: {
      cases: recipes,
      successfulTemplateCases: recipes.filter(
        (r) => r.successfulSuggestion === true,
      ).length,
      blockedOrClarificationCases: recipes.filter(
        (r) => r.kind === "template" && !r.successfulSuggestion,
      ).length,
    },
    photoScoring: {
      source: "scripted_fixture_only_not_model_accuracy",
      cases: photoMetrics,
      micro: {
        ...totals,
        precision:
          totals.truePositives + totals.falsePositives
            ? totals.truePositives /
              (totals.truePositives + totals.falsePositives)
            : null,
        recall:
          totals.truePositives + totals.falseNegatives
            ? totals.truePositives /
              (totals.truePositives + totals.falseNegatives)
            : null,
      },
      abstentions: photoMetrics.filter((m) => m.abstained).length,
      fullAbstentions: photoMetrics.filter((m) => m.abstentionState === "full")
        .length,
      partialAbstentions: photoMetrics.filter(
        (m) => m.abstentionState === "partial",
      ).length,
    },
    liveAcceptance: {
      status: "not_evaluated",
      feasibleRecipeRate: null,
      visibleIngredientPrecision: null,
      visibleIngredientRecall: null,
      providerOperationP95Milliseconds: null,
      twoPhotoAndGenerationCost: null,
      retryCost: null,
      aggregateSpendLimit: null,
      qualifiedReview: "open",
      nativeDevAcceptance: "open",
      pilot: "not_run",
      thresholds: thresholds.release,
    },
    limits: [
      "No provider calls or real image recognition",
      "Scripted scoring is evaluator verification, not provider precision/recall",
      "Blocked cases are not successful generation",
      "Offline templates and synthetic route tests do not accept real Auth/DB/native behavior",
      "No food-safety, allergy guarantee, clinical or intake-completeness claim",
    ],
  };
}
