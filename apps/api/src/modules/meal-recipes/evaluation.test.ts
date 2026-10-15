import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import type { FastifyInstance } from "fastify";
import {
  FakeIngredientRecognitionProvider,
  FakeRecipeGenerationProvider,
} from "@mizyun/agent-runtime";
import {
  CURRENT_AI_CONSENT_VERSION,
  ingredientRecognitionResponseSchema,
  mealRecipeSuggestionResponseSchema,
  type MealRecipeDraft,
  type MealRecipeSuggestionRequest,
} from "@mizyun/contracts";
import {
  DEFAULT_COACHING_PREFERENCES,
  type StoredFoodEntry,
  type StoredProfile,
  type UserId,
} from "@mizyun/core";
import { buildApp } from "../../app.js";
import { InMemoryAiConsentRepository } from "../../ai-consent-repository.js";
import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { getRecipeCatalogIngredient } from "./catalog.js";
import { InMemoryRecipeRequestLedger } from "./in-memory-request-ledger.js";

// Frozen REC-06 safety samples: synthetic identities, food and pixels only.
// These exercise composition/service boundaries, not Supabase RLS or live AI.
const owner = "81000000-0000-4000-8000-000000000001" as UserId;
const other = "81000000-0000-4000-8000-000000000002" as UserId;
const requestId = "82000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-13T12:00:00Z");
const apps: FastifyInstance[] = [];
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(
      new Error("REC-06 offline evaluation forbids network requests"),
    );
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

const input = (): MealRecipeSuggestionRequest => ({
  requestId,
  servings: 1,
  input: {
    version: "meal-recipe-v1",
    ingredients: [
      "rice-white-cooked",
      "chicken-breast-cooked",
      "lentils-cooked",
      "tofu-firm",
      "chickpeas-cooked",
      "cucumber-raw",
      "tomato-raw",
      "tomato-puree",
      "olive-oil",
    ].map((ingredientId) => ({
      ingredientId,
      name: "Synthetic confirmed ingredient",
      preparationState:
        getRecipeCatalogIngredient(ingredientId)!.preparationState,
      confirmed: true,
      quantity: 1000,
      quantityUnit: "g",
      availability: "confirmed",
    })),
    exclusions: { ingredientIds: [], allergens: [], dietaryRestrictions: [] },
    preferences: { maximumPrepMinutes: null, mealSize: "normal", cuisines: [] },
  },
});

const foodEntry = (userId: UserId, proteinG: number): StoredFoodEntry => ({
  id:
    userId === owner
      ? "83000000-0000-4000-8000-000000000001"
      : "83000000-0000-4000-8000-000000000002",
  userId,
  name: userId === owner ? "Synthetic owner meal" : "Synthetic other meal",
  consumedAt: now,
  caloriesKcal: 250,
  proteinG,
  carbohydrateG: 30,
  fatG: 5,
  details: {},
  source: "manual",
  confidence: null,
  confirmedByUser: true,
  createdAt: now,
  updatedAt: now,
});

async function fixture(options: { missingConsent?: boolean } = {}) {
  const profiles = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
  });
  const profile: StoredProfile = {
    userId: owner,
    displayName: "Synthetic evaluation adult",
    unitSystem: "metric",
    timezone: "UTC",
    birthYear: 1990,
    heightCm: 175,
    activityLevel: "moderately_active",
    sexAtBirth: "male",
    coachingPreferences: DEFAULT_COACHING_PREFERENCES,
    planTier: "paid",
    aiProvider: "gemini",
    createdAt: now,
    updatedAt: now,
  };
  profiles.__seedForTest(profile);
  profiles.__seedForTest({ ...profile, userId: other });
  const consent = new InMemoryAiConsentRepository({
    clock: { now: () => now },
  });
  for (const userId of [owner, other]) {
    if (options.missingConsent && userId === owner) continue;
    await consent.saveConsent(userId, {
      granted: true,
      confirmedAdult: true,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
    });
  }
  const food = new InMemoryFoodEntryRepository();
  food.__seedForTest(foodEntry(owner, 10));
  food.__seedForTest(foodEntry(other, 80));
  const goals = new InMemoryGoalRepository();
  const body = new InMemoryBodyMeasurementRepository();
  for (const [index, userId] of [owner, other].entries()) {
    goals.__seedForTest({
      id: `84000000-0000-4000-8000-00000000000${index + 1}`,
      userId,
      kind: "cut",
      pace: "steady",
      target: { weightKg: 68 },
      startsOn: "2026-01-01",
      targetDate: "2026-12-31",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    body.__seedForTest({
      id: `85000000-0000-4000-8000-00000000000${index + 1}`,
      userId,
      weightKg: 70,
      measurements: {},
      source: "manual",
      measuredAt: now,
      createdAt: now,
    });
  }
  const generation = new FakeRecipeGenerationProvider();
  const recognition = new FakeIngredientRecognitionProvider({
    ingredients: [
      {
        ingredientId: "tofu-firm",
        name: "Synthetic tofu",
        preparationState: "raw",
      },
    ],
    tokensUsed: 1,
  });
  const generationSpy = vi.spyOn(generation, "generate");
  const recognitionSpy = vi.spyOn(recognition, "recognize");
  let enabled = true;
  let budgetAvailable = true;
  let budgetDenied = false;
  const reserve = vi.fn(async () =>
    budgetDenied
      ? ({ allowed: false, reason: "tokens", retryAfter: 1 } as const)
      : ({ allowed: true } as const),
  );
  const ledger = new InMemoryRecipeRequestLedger({
    clock: () => now,
    authorize: async (userId, consentVersion) => {
      const current = await consent.getConsent(userId);
      return current?.granted &&
        current.revokedAt === null &&
        current.consentVersion === consentVersion
        ? "allowed"
        : "consent";
    },
    budgetGate: {
      isAvailable: async () => budgetAvailable,
      reserve,
      settle: async () => undefined,
    },
  });
  const app = buildApp({
    tokenVerifier: {
      verify: async (token) =>
        token === "owner" || token === "other"
          ? {
              userId: token === "owner" ? owner : other,
              role: "authenticated",
              accessToken: token,
            }
          : null,
    },
    profileRepository: profiles,
    aiConsentRepository: consent,
    foodEntryRepository: food,
    goalRepository: goals,
    bodyMeasurementRepository: body,
    mealRecipeControls: {
      enabled: () => enabled,
      ledger,
      generationProvider: generation,
      recognitionProvider: recognition,
      now: () => now,
    },
  });
  apps.push(app);
  await app.ready();
  return {
    app,
    profiles,
    profile,
    consent,
    food,
    generationSpy,
    recognitionSpy,
    reserve,
    ledger,
    disable: () => {
      enabled = false;
    },
    denyBudget: () => {
      budgetDenied = true;
    },
    unavailableBudget: () => {
      budgetAvailable = false;
    },
  };
}

const suggest = (
  app: FastifyInstance,
  payload: unknown = input(),
  token: string | null = "owner",
) =>
  app.inject({
    method: "POST",
    url: "/v1/meal-recipes/suggest",
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      "content-type": "application/json",
    },
    payload: JSON.stringify(payload),
  });

function recognize(app: FastifyInstance, token: string | null = "owner") {
  const boundary = "rec06-synthetic-photo";
  const pixels = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWP4jwMwDC0JALoev0GybL49AAAAAElFTkSuQmCC",
    "base64",
  );
  return app.inject({
    method: "POST",
    url: "/v1/meal-recipes/recognize-ingredients",
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="requestId"\r\n\r\n${requestId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      pixels,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

const denialSamples = [
  {
    name: "absent authentication",
    status: 401,
    code: "AUTHENTICATION_REQUIRED",
  },
  { name: "invalid authentication", status: 401, code: "INVALID_ACCESS_TOKEN" },
  { name: "missing consent", status: 403, code: "AI_CONSENT_REQUIRED" },
  { name: "revoked consent", status: 403, code: "AI_CONSENT_REQUIRED" },
  { name: "outdated consent", status: 403, code: "AI_CONSENT_REQUIRED" },
  { name: "adult not confirmed", status: 403, code: "AI_CONSENT_REQUIRED" },
  { name: "underadult profile", status: 403, code: "AI_AGE_RESTRICTED" },
  { name: "recipe kill switch", status: 503, code: "RECIPES_DISABLED" },
  { name: "budget denial", status: 429, code: "RECIPE_LIMIT_TOKENS" },
  {
    name: "budget unavailable",
    status: 503,
    code: "RECIPE_BUDGET_UNAVAILABLE",
  },
] as const;
const deniedOperations = denialSamples.flatMap((sample) =>
  (["suggest", "recognize"] as const).map((operation) => ({
    ...sample,
    operation,
  })),
);

describe("REC-06 offline safety evaluation through buildApp", () => {
  it.each(deniedOperations)(
    "$name / $operation: blocked, zero provider calls",
    async (sample) => {
      const f = await fixture({
        missingConsent: sample.name === "missing consent",
      });
      let token: string | null = "owner";
      switch (sample.name) {
        case "absent authentication":
          token = null;
          break;
        case "invalid authentication":
          token = "invalid";
          break;
        case "revoked consent":
        case "outdated consent":
        case "adult not confirmed":
          await f.consent.saveConsent(owner, {
            granted: sample.name !== "revoked consent",
            confirmedAdult: sample.name !== "adult not confirmed",
            consentVersion:
              sample.name === "outdated consent"
                ? "obsolete-evaluation-consent"
                : CURRENT_AI_CONSENT_VERSION,
          });
          break;
        case "underadult profile":
          f.profiles.__seedForTest({ ...f.profile, birthYear: 2012 });
          break;
        case "recipe kill switch":
          f.disable();
          break;
        case "budget denial":
          f.denyBudget();
          break;
        case "budget unavailable":
          f.unavailableBudget();
          break;
      }
      const response = await (sample.operation === "suggest"
        ? suggest(f.app, input(), token)
        : recognize(f.app, token));
      expect(response.statusCode).toBe(sample.status);
      expect(response.json().error.code).toBe(sample.code);
      expect(response.json().recipes).toBeUndefined();
      expect(f.generationSpy).toHaveBeenCalledTimes(0);
      expect(f.recognitionSpy).toHaveBeenCalledTimes(0);
      expect(f.reserve).toHaveBeenCalledTimes(
        sample.name === "budget denial" ? 1 : 0,
      );
      expect(await f.ledger.exportUsageForUser(owner)).toEqual([]);
    },
  );

  it.each([{ userId: other }, { targets: { proteinG: 999 } }])(
    "rejects forged owner/target context %j before provider dispatch",
    async (extra) => {
      const f = await fixture();
      const response = await suggest(f.app, { ...input(), ...extra });
      expect(response.statusCode).toBe(400);
      expect(f.generationSpy).toHaveBeenCalledTimes(0);
      expect(f.recognitionSpy).toHaveBeenCalledTimes(0);
      expect(f.reserve).toHaveBeenCalledTimes(0);
    },
  );

  it("same request ID cannot reuse another owner's context or selection", async () => {
    const f = await fixture();
    f.profiles.__seedForTest({
      ...f.profile,
      userId: other,
      coachingPreferences: {
        ...DEFAULT_COACHING_PREFERENCES,
        dietaryPreferences: ["vegan"],
      },
    });
    const first = mealRecipeSuggestionResponseSchema.parse(
      (await suggest(f.app)).json(),
    );
    const secondResponse = await suggest(f.app, input(), "other");
    expect(secondResponse.statusCode).toBe(200);
    const second = mealRecipeSuggestionResponseSchema.parse(
      secondResponse.json(),
    );
    expect(first.ranking.context.consumed.proteinG).toBe(10);
    expect(second.ranking.context.consumed.proteinG).toBe(80);
    expect(
      first.recipes.some(
        (recipe: MealRecipeDraft) => recipe.recipeId === "chicken-rice-tomato",
      ),
    ).toBe(true);
    expect(second.recipes.length).toBeGreaterThan(0);
    expect(
      second.recipes
        .flatMap((recipe: MealRecipeDraft) => recipe.ingredients)
        .some(
          (ingredient: MealRecipeDraft["ingredients"][number]) =>
            ingredient.ingredientId === "chicken-breast-cooked",
        ),
    ).toBe(false);
    expect(f.generationSpy).toHaveBeenCalledTimes(2);
    expect(f.recognitionSpy).toHaveBeenCalledTimes(0);
    expect(f.reserve).toHaveBeenCalledTimes(2);
    for (const userId of [owner, other])
      expect(await f.ledger.exportUsageForUser(userId)).toMatchObject([
        { requestId, status: "succeeded" },
      ]);
    for (const [sent] of f.generationSpy.mock.calls) {
      expect(JSON.stringify(sent)).not.toContain(owner);
      expect(JSON.stringify(sent)).not.toContain(other);
      expect(JSON.stringify(sent)).not.toContain("Synthetic other meal");
    }
  });

  it("rejects a repository returning cross-owner intake before calling provider", async () => {
    const f = await fixture();
    vi.spyOn(f.food, "list").mockResolvedValue([foodEntry(other, 80)]);
    const response = await suggest(f.app);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("RECIPE_REQUEST_UNAVAILABLE");
    expect(response.json().recipes).toBeUndefined();
    expect(f.generationSpy).toHaveBeenCalledTimes(0);
    expect(f.recognitionSpy).toHaveBeenCalledTimes(0);
    expect(f.reserve).toHaveBeenCalledTimes(0);
  });

  it.each([
    {
      name: "ingredient family alias",
      exclusions: {
        ingredientIds: ["chicken-breast"],
        allergens: [],
        dietaryRestrictions: [],
      },
      forbiddenRecipe: "chicken-rice-tomato",
    },
    {
      name: "soy allergen",
      exclusions: {
        ingredientIds: [],
        allergens: ["soy"],
        dietaryRestrictions: [],
      },
      forbiddenRecipe: "tofu-rice-tomato",
    },
    {
      name: "vegan diet",
      exclusions: {
        ingredientIds: [],
        allergens: [],
        dietaryRestrictions: ["vegan"],
      },
      forbiddenRecipe: "chicken-rice-tomato",
    },
  ])(
    "rejects malicious provider selection that bypasses $name",
    async (sample) => {
      const f = await fixture();
      f.generationSpy.mockResolvedValue({
        recipeIds: [sample.forbiddenRecipe],
      });
      const request = input();
      const response = await suggest(f.app, {
        ...request,
        input: { ...request.input, exclusions: sample.exclusions },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe(
        "RECIPE_PROVIDER_MALFORMED_OUTPUT",
      );
      expect(response.json().recipes).toBeUndefined();
      expect(f.generationSpy).toHaveBeenCalledTimes(1);
      expect(
        f.generationSpy.mock.calls[0]![0].eligibleRecipes.length,
      ).toBeGreaterThan(0);
      expect(
        f.generationSpy.mock.calls[0]![0].eligibleRecipes.some(
          (recipe) => recipe.recipeId === sample.forbiddenRecipe,
        ),
      ).toBe(false);
      expect(f.recognitionSpy).toHaveBeenCalledTimes(0);
      expect(f.reserve).toHaveBeenCalledTimes(1);
      expect(await f.ledger.exportUsageForUser(owner)).toMatchObject([
        { status: "failed" },
      ]);
    },
  );

  it.each(["suggest", "recognize"] as const)(
    "accepted %s changes no intake and performs exactly one fake call",
    async (operation) => {
      const f = await fixture();
      const list = (userId: UserId) =>
        f.food.list(userId, {
          from: null,
          to: null,
          limit: 100,
          accessToken: userId === owner ? "owner" : "other",
        });
      const before = await Promise.all([list(owner), list(other)]);
      const create = vi.spyOn(f.food, "create");
      const update = vi.spyOn(f.food, "update");
      const remove = vi.spyOn(f.food, "delete");
      const response = await (operation === "suggest"
        ? suggest(f.app)
        : recognize(f.app));
      expect(response.statusCode).toBe(200);
      if (operation === "suggest")
        expect(
          mealRecipeSuggestionResponseSchema.parse(response.json()).recipes
            .length,
        ).toBeGreaterThan(0);
      else {
        const result = ingredientRecognitionResponseSchema.parse(
          response.json(),
        );
        expect(result.ingredients).toHaveLength(1);
        expect(result.ingredients[0]).toMatchObject({
          confirmed: false,
          quantity: null,
          availability: "check_quantity",
        });
      }
      expect(f.generationSpy).toHaveBeenCalledTimes(
        operation === "suggest" ? 1 : 0,
      );
      expect(f.recognitionSpy).toHaveBeenCalledTimes(
        operation === "recognize" ? 1 : 0,
      );
      expect(f.reserve).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(await Promise.all([list(owner), list(other)])).toEqual(before);
    },
  );
});
