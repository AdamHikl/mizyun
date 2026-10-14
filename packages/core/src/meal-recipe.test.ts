import { describe, expect, it } from "vitest";
import {
  buildMealRecipeMacroContext,
  rankMealRecipeCandidates,
  type MealRecipeCandidate,
  type MealRecipeContextInput,
} from "./meal-recipe";

const now = new Date("2026-10-12T12:00:00Z");
type TestContextInput = {
  -readonly [K in keyof MealRecipeContextInput]: MealRecipeContextInput[K];
};
const input = (): TestContextInput => ({
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
  coverage: "logged_so_far",
  intakeReadComplete: true,
  now,
});
const meal = (
  overrides: Partial<MealRecipeCandidate> = {},
): MealRecipeCandidate => ({
  recipeId: "rice-chicken",
  name: "Rice with lean chicken",
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
  ...overrides,
});
const rank = (candidates: MealRecipeCandidate[], source = input()) => {
  const context = buildMealRecipeMacroContext(source);
  return rankMealRecipeCandidates(context, candidates, {
    now: source.now,
    current: source.snapshot,
  });
};

describe("recipe macro-balance-v1", () => {
  it.each([
    {
      gaps: { proteinG: 80, carbohydrateG: 20, fatG: 5 },
      preferred: { proteinG: 40, carbohydrateG: 10, fatG: 2.5 },
      other: { proteinG: 10, carbohydrateG: 40, fatG: 2.5 },
    },
    {
      gaps: { proteinG: 10, carbohydrateG: 20, fatG: 40 },
      preferred: { proteinG: 5, carbohydrateG: 10, fatG: 20 },
      other: { proteinG: 25, carbohydrateG: 25, fatG: 3.33 },
    },
    {
      gaps: { proteinG: 60, carbohydrateG: 60, fatG: 20 },
      preferred: { proteinG: 30, carbohydrateG: 30, fatG: 10 },
      other: { proteinG: 5, carbohydrateG: 55, fatG: 10 },
    },
  ])(
    "ranks feasible options for differing remaining balances $gaps",
    ({ gaps, preferred, other }) => {
      const source = input();
      source.summary = {
        ...source.summary!,
        proteinG: source.energy.targetProteinG! - gaps.proteinG,
        carbohydrateG: source.energy.targetCarbohydrateG! - gaps.carbohydrateG,
        fatG: source.energy.targetFatG! - gaps.fatG,
      };
      expect(
        rank(
          [
            meal({ recipeId: "other", nutrition: other }),
            meal({ recipeId: "preferred", nutrition: preferred }),
          ],
          source,
        ).ranked[0]!.recipeId,
      ).toBe("preferred");
    },
  );
  it("favors carbs with lean protein without filling all remaining macros", () => {
    const result = rank([
      meal({
        recipeId: "creamy-rice",
        nutrition: { proteinG: 22.5, carbohydrateG: 40, fatG: 16.7 },
      }),
      meal(),
    ]);
    expect(result.context.remaining).toEqual({
      proteinG: 50,
      carbohydrateG: 150,
      fatG: 10,
    });
    expect(result.context.focus).toEqual(["carbohydrate", "protein"]);
    expect(result.ranked.map((x) => x.recipeId)).toEqual([
      "rice-chicken",
      "creamy-rice",
    ]);
    const desired = result.ranked[0]!.desiredMacros;
    expect(desired.proteinG).toBeCloseTo(22.48, 1);
    expect(desired.carbohydrateG).toBeCloseTo(67.45, 1);
    expect(desired.fatG).toBeCloseTo(4.5, 1);
    expect(desired.proteinG).toBeLessThan(50);
  });

  it.each([
    ["protein", { proteinG: 100, carbohydrateG: 280, fatG: 58 }],
    ["fat", { proteinG: 145, carbohydrateG: 290, fatG: 20 }],
  ] as const)(
    "focuses a %s-heavy gap using all three targets",
    (focus, summary) => {
      const source = input();
      source.summary = { ...source.summary!, ...summary };
      expect(buildMealRecipeMacroContext(source).focus[0]).toBe(focus);
    },
  );

  it("does not compare raw grams alone when fat is the larger energy gap", () => {
    const source = input();
    source.summary = {
      ...source.summary!,
      proteinG: 149,
      carbohydrateG: 260,
      fatG: 30,
    };
    expect(buildMealRecipeMacroContext(source).focus).toEqual([
      "fat",
      "carbohydrate",
    ]);
  });

  it("keeps signed overshoot and provides food despite being over target", () => {
    const source = input();
    source.summary = { ...source.summary!, fatG: 80 };
    const result = rank([meal()], source);
    expect(result.context.remaining.fatG).toBe(-20);
    expect(result.context.positiveGaps.fatG).toBe(0);
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0]!.fitLoss).toBeGreaterThan(0);
  });

  it("uses ordinary discovery when all gaps are exhausted", () => {
    const source = input();
    source.summary = {
      ...source.summary!,
      proteinG: 160,
      carbohydrateG: 310,
      fatG: 70,
    };
    const result = rank([meal()], source);
    expect(result.context.state).toBe("no_remaining_gaps");
    expect(result.context.focus).toEqual([]);
    expect(result.ranked[0]!.fitLoss).toBeNull();
    expect(result.ranked[0]!.desiredMacros.proteinG).toBeNull();
  });

  it("keeps an unknown intake macro unknown, with no numeric best-fit claim", () => {
    const source = input();
    source.summary = { ...source.summary!, fatG: null };
    const result = rank([meal()], source);
    expect(result.context.remaining.fatG).toBeNull();
    expect(result.context.reason).toBe("intake_unknown");
    expect(result.context.focus).toEqual([]);
    expect(result.ranked[0]!.fitLoss).toBeNull();
  });

  it("does not fabricate zero from an absent summary or unfinished read", () => {
    const source = input();
    source.summary = null;
    expect(buildMealRecipeMacroContext(source).consumed.proteinG).toBeNull();
    source.summary = input().summary;
    source.intakeReadComplete = false;
    expect(rank([meal()], source).context.reason).toBe("source_incomplete");
    expect(rank([meal()], source).ranked[0]!.fitLoss).toBeNull();
  });

  it("accepts an explicitly known empty day but labels it logged-so-far", () => {
    const source = input();
    source.summary = {
      ...source.summary!,
      entryCount: 0,
      proteinG: 0,
      carbohydrateG: 0,
      fatG: 0,
    };
    expect(buildMealRecipeMacroContext(source).state).toBe("ready");
    expect(buildMealRecipeMacroContext(source).reason).toBe("logged_so_far");
  });

  it.each([null, NaN, Infinity, -1, 10001])(
    "fails safely on target %s",
    (target) => {
      const source = input();
      source.energy = { ...source.energy, targetProteinG: target };
      expect(rank([meal()], source).context.reason).toBe("targets_unavailable");
      expect(rank([meal()], source).ranked[0]!.fitLoss).toBeNull();
    },
  );

  it("does not turn a missing profile/safety-floor target into a suggestion", () => {
    const source = input();
    source.energy = { ...source.energy, complete: false };
    expect(rank([meal()], source).context.state).toBe("unknown");
  });

  it("supports zero targets and fractional small gaps without NaN", () => {
    const source = input();
    source.energy = { ...source.energy, targetFatG: 0 };
    source.summary = {
      ...source.summary!,
      proteinG: 149.99,
      carbohydrateG: 299.99,
      fatG: 0,
    };
    expect(Number.isFinite(rank([meal()], source).ranked[0]!.fitLoss)).toBe(
      true,
    );
  });

  it.each([
    "goalRevision",
    "intakeRevision",
    "constraintsRevision",
    "profileRevision",
    "energyFormulaVersion",
    "timeZone",
    "localDate",
  ] as const)("retires the numeric claim after %s changes", (field) => {
    const source = input();
    const context = buildMealRecipeMacroContext(source);
    const result = rankMealRecipeCandidates(context, [meal()], {
      now,
      current: { ...source.snapshot, [field]: "changed" },
    });
    expect(result.context.state).toBe("stale");
    expect(result.ranked[0]!.fitLoss).toBeNull();
  });

  it("expires at the boundary and at local midnight, including DST", () => {
    const source = input();
    expect(
      rankMealRecipeCandidates(buildMealRecipeMacroContext(source), [meal()], {
        now: new Date(source.snapshot.expiresAt),
        current: source.snapshot,
      }).context.state,
    ).toBe("stale");
    source.snapshot = {
      ...source.snapshot,
      localDate: "2026-10-25",
      generatedAt: "2026-10-25T21:50:00Z",
      expiresAt: "2026-10-26T00:00:00Z",
    };
    source.summary = { ...source.summary!, date: "2026-10-25" };
    source.now = new Date("2026-10-25T23:00:00Z");
    expect(buildMealRecipeMacroContext(source).state).toBe("stale");
  });

  it.each([
    { timeZone: "invalid" },
    { generatedAt: "garbage" },
    { generatedAt: "2026-10-12T12:01:00Z" },
    { expiresAt: "2026-10-12T11:00:00Z" },
    { localDate: "2026-02-30" },
  ])("fails safely on malformed/future freshness metadata %j", (patch) => {
    const source = input();
    source.snapshot = { ...source.snapshot, ...patch };
    expect(rank([meal()], source).context.state).toBe("stale");
  });

  it("does not mix a different day's summary into today's remaining grams", () => {
    const source = input();
    source.summary = { ...source.summary!, date: "2026-10-11" };
    expect(buildMealRecipeMacroContext(source).state).toBe("stale");
  });

  it.each([
    ["excluded", { excluded: true }],
    ["missing_ingredients", { availability: "missing" }],
    ["preparation_mismatch", { nutritionPreparationState: "raw" }],
    ["portion_out_of_bounds", { portionGrams: 15 }],
    ["portion_out_of_bounds", { portionGrams: 3000 }],
    ["portion_out_of_bounds", { portionGrams: 199 }],
    [
      "invalid_candidate",
      { nutrition: { proteinG: NaN, carbohydrateG: 50, fatG: 3 } },
    ],
  ] as const)("rejects %s before scoring", (reason, patch) => {
    const result = rank([meal(patch)]);
    expect(result.ranked).toEqual([]);
    expect(result.rejected[0]!.reason).toBe(reason);
  });

  it("retains an unknown nutrition candidate without numeric ranking", () => {
    const result = rank([
      meal({
        recipeId: "unknown",
        nutrition: { proteinG: null, carbohydrateG: 50, fatG: 3 },
      }),
      meal(),
    ]);
    expect(result.ranked[0]!.recipeId).toBe("rice-chicken");
    expect(result.ranked[1]!.fitLoss).toBeNull();
  });

  it("rescores a sensible adjusted portion and never mutates its input", () => {
    const candidate = meal();
    const before = structuredClone(candidate);
    const large = meal({
      recipeId: "larger",
      portionGrams: 700,
      nutrition: { proteinG: 45, carbohydrateG: 134.8, fatG: 9 },
    });
    const result = rank([candidate, large]);
    expect(result.ranked).toHaveLength(2);
    expect(candidate).toEqual(before);
    expect(
      result.ranked.find((x) => x.recipeId === "larger")!.desiredMacros
        .proteinG,
    ).toBeGreaterThan(40);
  });

  it("deduplicates recipe variants and uses deterministic practicality ties", () => {
    const candidates = [
      meal({ recipeId: "b", availability: "check_quantity" }),
      meal({ recipeId: "a", prepMinutes: 30 }),
      meal({ recipeId: "a", prepMinutes: 10 }),
      meal({ recipeId: "c", prepMinutes: 10 }),
    ];
    const result = rank(candidates);
    expect(result.ranked.map((x) => x.recipeId)).toEqual(["a", "c", "b"]);
    expect(rank([...candidates].reverse()).ranked).toEqual(result.ranked);
  });

  it("rejects impossible macro mass and malformed identity without echoing it", () => {
    expect(
      rank([
        meal({ nutrition: { proteinG: 300, carbohydrateG: 300, fatG: 100 } }),
      ]).rejected[0]!.reason,
    ).toBe("invalid_candidate");
    expect(rank([meal({ recipeId: "<untrusted>" })]).rejected).toEqual([
      { recipeId: null, reason: "invalid_candidate" },
    ]);
  });

  it("bounds candidate work and returns at most twenty distinct options", () => {
    const candidates = Array.from({ length: 100 }, (_, index) =>
      meal({ recipeId: `recipe-${index}` }),
    );
    expect(rank(candidates).ranked).toHaveLength(20);
    expect(() => rank([...candidates, meal()])).toThrow(RangeError);
  });
});
