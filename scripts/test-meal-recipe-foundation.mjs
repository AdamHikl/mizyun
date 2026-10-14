import assert from "node:assert/strict";
import test from "node:test";
import {
  COACH_APP_CAPABILITIES,
  COACH_INTERNAL_FEATURES,
} from "../packages/agent-runtime/src/index.ts";
import {
  buildMealRecipeMacroContext,
  rankMealRecipeCandidates,
  MEAL_RECIPE_MAX_RANK_RESULT_BYTES,
} from "../packages/core/src/index.ts";
import {
  mealRecipeMacroContextSchema,
  mealRecipeRankResultSchema,
  mealRecipeCandidateSchema,
  MEAL_RECIPE_MAX_RESPONSE_BYTES,
} from "../packages/contracts/src/index.ts";

const now = new Date("2026-10-12T12:00:00Z");
const source = () => ({
  energy: {
    complete: true,
    formulaVersion: "v1-mifflin-st-jeor-2026-07",
    targetProteinG: 150,
    targetCarbohydrateG: 300,
    targetFatG: 60,
  },
  summary: {
    date: "2026-10-12",
    entryCount: 2,
    proteinG: 100,
    carbohydrateG: 150,
    fatG: 50,
  },
  coverage: "logged_so_far",
  intakeReadComplete: true,
  now,
  snapshot: {
    localDate: "2026-10-12",
    timeZone: "Europe/Bratislava",
    generatedAt: "2026-10-12T11:59:00Z",
    expiresAt: "2026-10-12T13:00:00Z",
    energyFormulaVersion: "v1-mifflin-st-jeor-2026-07",
    goalRevision: "goal-1",
    intakeRevision: "intake-2",
    constraintsRevision: "constraints-1",
    profileRevision: "profile-1",
  },
});
const candidate = (patch = {}) => ({
  recipeId: "rice:chicken.v1",
  name: "Rice and lean chicken",
  nutrition: { proteinG: 22.5, carbohydrateG: 67.4, fatG: 4.5 },
  portionGrams: 350,
  minimumPortionGrams: 200,
  maximumPortionGrams: 700,
  preparationState: "cooked",
  nutritionPreparationState: "cooked",
  availability: "confirmed",
  prepMinutes: 20,
  estimateQuality: "reference",
  excluded: false,
  ...patch,
});

test("actual public core outputs cross the recipe wire boundary", () => {
  for (const scenario of ["ready", "unknown", "exhausted", "stale"]) {
    const input = source();
    if (scenario === "unknown") input.summary.fatG = null;
    if (scenario === "exhausted") {
      input.summary.proteinG = 150;
      input.summary.carbohydrateG = 300;
      input.summary.fatG = 60;
    }
    const context = buildMealRecipeMacroContext(input);
    mealRecipeMacroContextSchema.parse(JSON.parse(JSON.stringify(context)));
    const result = rankMealRecipeCandidates(context, [candidate()], {
      now,
      current:
        scenario === "stale"
          ? { ...input.snapshot, intakeRevision: "edited" }
          : input.snapshot,
    });
    const parsed = mealRecipeRankResultSchema.parse(
      JSON.parse(JSON.stringify(result)),
    );
    if (scenario === "ready") {
      assert.deepEqual(parsed.context.focus, ["carbohydrate", "protein"]);
      assert.ok(parsed.ranked[0].desiredMacros.proteinG < 50);
    } else assert.equal(parsed.ranked[0].fitLoss, null);
  }
});

test("invalid variants and invalid IDs remain representable as rejections", () => {
  const input = source();
  const result = rankMealRecipeCandidates(
    buildMealRecipeMacroContext(input),
    [
      candidate(),
      candidate({ excluded: true }),
      candidate({ recipeId: "<bad>" }),
    ],
    { now, current: input.snapshot },
  );
  const parsed = mealRecipeRankResultSchema.parse(result);
  assert.equal(parsed.ranked.length, 1);
  assert.equal(parsed.rejected.length, 2);
  assert.equal(parsed.rejected[1].recipeId, null);
});

test("maximum-length Unicode results fail explicitly at the shared byte boundary", () => {
  assert.equal(
    MEAL_RECIPE_MAX_RANK_RESULT_BYTES,
    MEAL_RECIPE_MAX_RESPONSE_BYTES,
  );
  const input = source();
  const candidates = Array.from({ length: 100 }, (_, index) =>
    candidate({
      recipeId: `recipe-${index}`.padEnd(128, "x"),
      name: "飯".repeat(160),
      excluded: index >= 20,
    }),
  );
  candidates.forEach((item) => mealRecipeCandidateSchema.parse(item));
  const context = buildMealRecipeMacroContext(input);
  assert.throws(
    () =>
      rankMealRecipeCandidates(context, candidates, {
        now,
        current: input.snapshot,
      }),
    { name: "RangeError", message: /16 KiB response limit/ },
  );
  // A representable subset still returns a valid result, preserving UTF-8 text.
  const result = rankMealRecipeCandidates(context, candidates.slice(0, 10), {
    now,
    current: input.snapshot,
  });
  assert.equal(mealRecipeRankResultSchema.parse(result).ranked.length, 10);
});

test("Coach directs to the shared recipe route with qualified availability and explicit Save", () => {
  assert.ok(
    !COACH_INTERNAL_FEATURES.some((feature) => feature.id === "meal-recipes"),
  );
  const capability = COACH_APP_CAPABILITIES.find((capability) =>
    capability.featureIds.includes("meal-recipes"),
  );
  assert.deepEqual(capability.routes, ["meal-recipes.tsx"]);
  assert.match(capability.guidance, /only Save records intake/);
  assert.match(capability.guidance, /environment switch/);
  assert.match(capability.guidance, /unknown context/);
});
