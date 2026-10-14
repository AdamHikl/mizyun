import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  FakeRecipeGenerationProvider,
  FakeIngredientRecognitionProvider,
} from "@mizyun/agent-runtime";
import {
  mealRecipeRevalidationResponseSchema,
  mealRecipeSessionContextSchema,
  type MealRecipeRevalidationRequest,
} from "@mizyun/contracts";
import type { UserId, AccountRepository } from "@mizyun/core";
import { authenticationPlugin } from "../../plugins/authentication.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryAiConsentRepository } from "../../ai-consent-repository.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";
import { mealRecipeRoutes } from "./routes.js";
import { MealRecipeSessionService } from "./session-service.js";
import {
  RECIPE_CATALOG_DATA,
  RECIPE_CATALOG_REVISION,
} from "./catalog-data.js";
const user = "71000000-0000-4000-8000-000000000001" as UserId;
const other = "71000000-0000-4000-8000-000000000002" as UserId;
const now = new Date("2026-10-13T12:00:00Z");
const request = (): MealRecipeRevalidationRequest => ({
  version: "meal-recipe-v1",
  catalogRevision: RECIPE_CATALOG_REVISION,
  servings: 1,
  recipeIds: ["chicken-rice-tomato", "lentil-rice-tomato"],
  input: {
    version: "meal-recipe-v1",
    ingredients: [
      "rice-white-cooked",
      "chicken-breast-cooked",
      "lentils-cooked",
      "tomato-puree",
      "olive-oil",
    ].map((ingredientId) => ({
      ingredientId,
      name: "Synthetic ingredient",
      preparationState: RECIPE_CATALOG_DATA.find(
        (item) => item.id === ingredientId,
      )!.preparationState,
      confirmed: true,
      quantity: 1000,
      quantityUnit: "g",
      availability: "confirmed",
    })),
    exclusions: { ingredientIds: [], allergens: [], dietaryRestrictions: [] },
    preferences: { maximumPrepMinutes: null, mealSize: "normal", cuisines: [] },
  },
});
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture() {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
  });
  const profile = await profileRepository.getOrCreate(user, {
    now,
    accessToken: "valid",
  });
  const food = new InMemoryFoodEntryRepository();
  const repositories = {
    profileRepository,
    foodEntryRepository: food,
    goalRepository: new InMemoryGoalRepository(),
    bodyMeasurementRepository: new InMemoryBodyMeasurementRepository(),
    workoutRepository: new InMemoryWorkoutRepository(),
    workoutSetRepository: new InMemoryWorkoutSetRepository(),
  };
  let enabled = true,
    deleting = false;
  const account = {
    getDeletionJob: vi.fn(async () =>
      deleting ? { status: "in_progress" } : null,
    ),
  } as unknown as AccountRepository;
  const consent = new InMemoryAiConsentRepository({ defaultGranted: false });
  const generation = new FakeRecipeGenerationProvider(),
    recognition = new FakeIngredientRecognitionProvider();
  const generationSpy = vi.spyOn(generation, "generate"),
    recognitionSpy = vi.spyOn(recognition, "recognize");
  const consentSpy = vi.spyOn(consent, "getConsent"),
    statusSpy = vi.spyOn(generation, "status");
  const options = {
    repositories,
    accountRepository: account,
    consentRepository: consent,
    ledger: null,
    generationProvider: generation,
    recognitionProvider: recognition,
    enabled: () => enabled,
    now: () => now,
  };
  const service = new MealRecipeSessionService(options);
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(authenticationPlugin, {
    tokenVerifier: {
      verify: async (token) =>
        token === "valid" || token === "other"
          ? {
              userId: token === "valid" ? user : other,
              role: "authenticated",
              accessToken: token,
            }
          : null,
    },
  });
  await app.register(mealRecipeRoutes, {
    ...options,
    prefix: "/v1/meal-recipes",
  });
  await app.ready();
  return {
    app,
    service,
    profile,
    profileRepository,
    repositories,
    food,
    account,
    consentSpy,
    generationSpy,
    recognitionSpy,
    statusSpy,
    disable: () => {
      enabled = false;
    },
    delete: () => {
      deleting = true;
    },
  };
}
const get = (app: FastifyInstance, token = "valid") =>
  app.inject({
    method: "GET",
    url: "/v1/meal-recipes/session-context",
    headers: { authorization: `Bearer ${token}` },
  });
const post = (app: FastifyInstance, payload: unknown = request()) =>
  app.inject({
    method: "POST",
    url: "/v1/meal-recipes/revalidate",
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/json",
    },
    payload: JSON.stringify(payload),
  });
describe("provider-free recipe session boundary", () => {
  it("fails closed when the account deletion guard is unavailable", async () => {
    const f = await fixture();
    delete f.account.getDeletionJob;
    expect((await get(f.app)).statusCode).toBe(503);
  });
  it("authenticates both routes and rejects owner/context injection", async () => {
    const f = await fixture();
    expect((await get(f.app, "invalid")).statusCode).toBe(401);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/meal-recipes/revalidate",
          payload: request(),
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await post(f.app, { ...request(), userId: other })).statusCode,
    ).toBe(400);
    expect((await post(f.app, { ...request(), context: {} })).statusCode).toBe(
      400,
    );
  });
  it("returns complete bounded catalog metadata with honest unknown context and no consent/provider/budget calls", async () => {
    const f = await fixture();
    const result = await get(f.app);
    expect(result.statusCode).toBe(200);
    const value = mealRecipeSessionContextSchema.parse(result.json());
    expect(value.context.state).toBe("unknown");
    expect(value.context.reason).toBe("targets_unavailable");
    expect(value.context.consumed.proteinG).toBeNull();
    expect(value.catalog.length).toBe(RECIPE_CATALOG_DATA.length);
    expect(Buffer.byteLength(result.body)).toBeLessThanOrEqual(16_384);
    expect(value.catalog[0]).not.toHaveProperty("fdcId");
    expect(f.consentSpy).not.toHaveBeenCalled();
    expect(f.generationSpy).not.toHaveBeenCalled();
    expect(f.recognitionSpy).not.toHaveBeenCalled();
    expect(f.statusSpy).not.toHaveBeenCalled();
  });
  it("rebuilds requested templates and portions deterministically after AI revocation without intake writes", async () => {
    const f = await fixture();
    const create = vi.spyOn(f.food, "create");
    const first = await post(f.app);
    expect(first.statusCode).toBe(200);
    const a = mealRecipeRevalidationResponseSchema.parse(first.json());
    expect(a.recipes.map((item) => item.recipeId)).toEqual(
      expect.arrayContaining(request().recipeIds),
    );
    expect(a.ranking.ranked.every((item) => item.fitLoss === null)).toBe(true);
    const second = await post(f.app, { ...request(), servings: 2 });
    expect(second.statusCode).toBe(200);
    const b = mealRecipeRevalidationResponseSchema.parse(second.json());
    expect(b.recipes[0]!.ingredients[0]!.weightGrams).toBe(
      2 * a.recipes[0]!.ingredients[0]!.weightGrams,
    );
    expect(b.candidates[0]!.nutrition).toEqual(a.candidates[0]!.nutrition);
    expect(create).not.toHaveBeenCalled();
    expect(f.consentSpy).not.toHaveBeenCalled();
    expect(f.generationSpy).not.toHaveBeenCalled();
  });
  it("fails closed on outdated catalog, unsupported IDs and currently infeasible or mismatched ingredients", async () => {
    const f = await fixture();
    expect(
      (await post(f.app, { ...request(), catalogRevision: "old" })).statusCode,
    ).toBe(409);
    expect(
      (
        await post(f.app, {
          ...request(),
          recipeIds: ["unreviewed-model-recipe"],
        })
      ).statusCode,
    ).toBe(422);
    const bad = request();
    bad.input.ingredients[0]!.preparationState = "raw";
    expect((await post(f.app, bad)).statusCode).toBe(422);
    const missing = request();
    missing.input.ingredients[0]!.availability = "missing";
    expect((await post(f.app, missing)).statusCode).toBe(422);
    const excluded = request();
    excluded.input.exclusions.ingredientIds = ["chicken-breast"];
    expect((await post(f.app, excluded)).statusCode).toBe(422);
  });
  it("applies current server profile diet constraints and fails the whole selected set safely", async () => {
    const f = await fixture();
    f.profileRepository.__seedForTest({
      ...f.profile,
      coachingPreferences: {
        ...f.profile.coachingPreferences,
        dietaryPreferences: ["vegetarian"],
      },
    });
    expect((await post(f.app)).statusCode).toBe(422);
    expect(
      (await post(f.app, { ...request(), recipeIds: ["lentil-rice-tomato"] }))
        .statusCode,
    ).toBe(200);
  });
  it("forwards the authenticated owner and token to repository reads", async () => {
    const f = await fixture();
    const list = vi.spyOn(f.food, "list");
    expect((await get(f.app, "other")).statusCode).toBe(200);
    expect(
      list.mock.calls.every(
        ([id, options]) => id === other && options.accessToken === "other",
      ),
    ).toBe(true);
  });
  it("disabling dispatches no repository or provider work", async () => {
    const f = await fixture();
    f.disable();
    const profile = vi.spyOn(f.profileRepository, "getOrCreate");
    expect((await get(f.app)).statusCode).toBe(503);
    expect((await post(f.app)).statusCode).toBe(503);
    expect(profile).not.toHaveBeenCalled();
    expect(f.account.getDeletionJob).not.toHaveBeenCalled();
    expect(f.statusSpy).not.toHaveBeenCalled();
  });
  it.each(["context", "revalidate"] as const)(
    "rejects deletion before %s and when it begins during reads",
    async (method) => {
      const f = await fixture();
      f.delete();
      expect(
        method === "context"
          ? (await get(f.app)).statusCode
          : (await post(f.app)).statusCode,
      ).toBe(403);
      const race = await fixture();
      const list = race.food.list.bind(race.food);
      vi.spyOn(race.food, "list").mockImplementation(async (...args) => {
        race.delete();
        return list(...args);
      });
      expect(
        method === "context"
          ? (await get(race.app)).statusCode
          : (await post(race.app)).statusCode,
      ).toBe(403);
    },
  );
  it("rejects profile/timezone changes and feature disable while owner context loads", async () => {
    const f = await fixture();
    const list = f.food.list.bind(f.food);
    vi.spyOn(f.food, "list").mockImplementationOnce(async (...args) => {
      f.profileRepository.__seedForTest({
        ...f.profile,
        timezone: "Europe/Bratislava",
        updatedAt: new Date(now.getTime() + 1),
      });
      return list(...args);
    });
    expect((await post(f.app)).statusCode).toBe(409);
    const disabled = await fixture();
    const read = disabled.food.list.bind(disabled.food);
    vi.spyOn(disabled.food, "list").mockImplementationOnce(async (...args) => {
      disabled.disable();
      return read(...args);
    });
    expect((await get(disabled.app)).statusCode).toBe(503);
  });
  it("rejects a cross-owner profile returned by a faulty repository", async () => {
    const f = await fixture();
    vi.spyOn(f.profileRepository, "getOrCreate").mockResolvedValue({
      ...f.profile,
      userId: other,
    });
    expect((await get(f.app)).statusCode).toBe(503);
  });
});
