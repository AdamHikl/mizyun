import { describe, expect, it, vi } from "vitest";
import { API_COMPAT_HEADER, API_COMPAT_VERSION } from "@mizyun/contracts";
import type { AuthClient, AuthSession } from "@mizyun/identity";
import { createMealRecipeSessionApi } from "./meal-recipe-session-api";
import { HttpApiClient } from "./http-api-client";
import { DisabledApiClient } from "./disabled-api-client";

const compat = { [API_COMPAT_HEADER]: API_COMPAT_VERSION };
const options = { expectedUserId: "owner", isCurrent: () => true };
const input = {
  version: "meal-recipe-v1" as const,
  catalogRevision: "current-v1",
  servings: 1,
  recipeIds: ["fixed"],
  input: {
    version: "meal-recipe-v1" as const,
    ingredients: [
      {
        ingredientId: "rice",
        name: "Rice",
        preparationState: "cooked" as const,
        confirmed: true,
        quantity: 200,
        quantityUnit: "g" as const,
        availability: "confirmed" as const,
      },
    ],
    exclusions: { ingredientIds: [], allergens: [], dietaryRestrictions: [] },
    preferences: {
      maximumPrepMinutes: null,
      mealSize: "normal" as const,
      cuisines: [],
    },
  },
};
const context = {
  version: "meal-recipe-v1",
  rankingVersion: "macro-balance-v1",
  targets: { proteinG: null, carbohydrateG: null, fatG: null },
  consumed: { proteinG: null, carbohydrateG: null, fatG: null },
  remaining: { proteinG: null, carbohydrateG: null, fatG: null },
  positiveGaps: { proteinG: null, carbohydrateG: null, fatG: null },
  snapshot: {
    localDate: "2026-10-13",
    timeZone: "UTC",
    generatedAt: "2026-10-13T00:00:00Z",
    expiresAt: "2026-10-14T00:00:00Z",
    energyFormulaVersion: "v1",
    goalRevision: "g",
    intakeRevision: "i",
    constraintsRevision: "c",
    profileRevision: "p",
  },
  coverage: "unknown",
  state: "unknown",
  reason: "targets_unavailable",
  focus: [],
};
const payload = {
  version: "meal-recipe-v1",
  catalogRevision: "current-v1",
  catalog: [
    {
      id: "rice",
      name: "Rice",
      familyId: "rice",
      preparationState: "cooked",
      per100g: { caloriesKcal: 130, proteinG: 2, carbohydrateG: 28, fatG: 0 },
      allergens: [],
      vegan: true,
      vegetarian: true,
    },
  ],
  context,
};
const validated = {
  version: "meal-recipe-v1",
  catalogRevision: "current-v1",
  recipes: [
    {
      version: "meal-recipe-v1",
      recipeId: "fixed",
      name: "Rice bowl",
      servings: 1,
      ingredients: [
        { ingredientId: "rice", weightGrams: 200, preparationState: "cooked" },
      ],
      steps: ["Reheat to 74°C throughout."],
      prepMinutes: 5,
      caloriesKcal: 260,
      calorieRangeKcal: null,
      assumptions: [],
      warnings: [],
      nutritionPerServing: { proteinG: 4, carbohydrateG: 56, fatG: 0 },
      rangesPerServing: { proteinG: null, carbohydrateG: null, fatG: null },
      provenance: {
        source: "reference",
        catalogRevision: "current-v1",
        calculationVersion: "v1",
        generatedAt: "2026-10-13T00:00:00Z",
      },
    },
  ],
  candidates: [
    {
      recipeId: "fixed",
      name: "Rice bowl",
      nutrition: { proteinG: 4, carbohydrateG: 56, fatG: 0 },
      portionGrams: 200,
      minimumPortionGrams: 50,
      maximumPortionGrams: 2000,
      preparationState: "cooked",
      nutritionPreparationState: "cooked",
      availability: "confirmed",
      prepMinutes: 5,
      estimateQuality: "reference",
      excluded: false,
    },
  ],
  ranking: {
    context,
    ranked: [
      {
        recipeId: "fixed",
        name: "Rice bowl",
        fitLoss: null,
        desiredMacros: { proteinG: null, carbohydrateG: null, fatG: null },
        reason: "targets_unavailable",
      },
    ],
    rejected: [],
  },
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const make = () => {
  let session: AuthSession | null = {
    user: { id: "owner" as never, email: "synthetic@example.test" },
    accessToken: "token",
  };
  const signOut = vi.fn().mockResolvedValue(undefined);
  const auth = {
    getSession: vi.fn(async () => session),
    signOut,
  } as unknown as AuthClient;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(payload));
  const api = createMealRecipeSessionApi(
    new HttpApiClient({
      baseUrl: "https://api.example/",
      authClient: auth,
      fetch: fetcher,
    }),
  );
  return {
    api,
    fetcher,
    signOut,
    auth,
    setSession: (value: AuthSession | null) => {
      session = value;
    },
  };
};
describe("provider-free recipe session transport", () => {
  it("accepts current revalidation and rejects another request's IDs, catalog or servings", async () => {
    const f = make();
    f.fetcher.mockImplementation(async () => response(validated));
    expect(await f.api.revalidate(input, options)).toEqual({
      ok: true,
      value: validated,
    });
    for (const changed of [
      { ...input, recipeIds: ["other"] },
      { ...input, catalogRevision: "different" },
      { ...input, servings: 2 },
    ])
      expect(await f.api.revalidate(changed, options)).toMatchObject({
        ok: false,
        error: { kind: "validation_error" },
      });
    expect(f.fetcher).toHaveBeenCalledTimes(4);
  });
  it("makes one authenticated context request with strict complete metadata", async () => {
    const f = make();
    expect(await f.api.context(options)).toEqual({ ok: true, value: payload });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher).toHaveBeenCalledWith(
      "https://api.example/v1/meal-recipes/session-context",
      { method: "GET", headers: { authorization: "Bearer token", ...compat } },
    );
  });
  it("makes one explicit JSON revalidation request and never retries a failure", async () => {
    const f = make();
    f.fetcher.mockResolvedValue(
      response(
        {
          error: {
            code: "RECIPE_CONTEXT_CHANGED",
            message: "Review current context.",
          },
        },
        409,
      ),
    );
    expect(await f.api.revalidate(input, options)).toMatchObject({
      ok: false,
      error: {
        kind: "http_error",
        status: 409,
        code: "RECIPE_CONTEXT_CHANGED",
      },
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher).toHaveBeenCalledWith(
      "https://api.example/v1/meal-recipes/revalidate",
      {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          ...compat,
        },
        body: expect.any(String),
      },
    );
    expect(JSON.parse(f.fetcher.mock.calls[0]![1]!.body as string)).toEqual(
      input,
    );
  });
  it("rejects missing session, wrong owner and stale caller without dispatch", async () => {
    const missing = make();
    missing.setSession(null);
    expect(await missing.api.context(options)).toMatchObject({
      ok: false,
      error: { kind: "no_session" },
    });
    expect(missing.fetcher).not.toHaveBeenCalled();
    const wrong = make();
    expect(
      await wrong.api.context({ ...options, expectedUserId: "other" }),
    ).toMatchObject({ ok: false, error: { kind: "context_changed" } });
    expect(wrong.fetcher).not.toHaveBeenCalled();
    const stale = make();
    expect(
      await stale.api.revalidate(input, { ...options, isCurrent: () => false }),
    ).toMatchObject({ ok: false, error: { kind: "context_changed" } });
    expect(stale.fetcher).not.toHaveBeenCalled();
  });
  it.each(["owner", "token", "generation"])(
    "discards response after %s changes",
    async (change) => {
      const f = make();
      let current = true;
      f.fetcher.mockImplementation(async () => {
        if (change === "generation") current = false;
        else
          f.setSession({
            user: {
              id: (change === "owner" ? "other" : "owner") as never,
              email: "synthetic@example.test",
            },
            accessToken: change === "token" ? "new-token" : "token",
          });
        return response(payload);
      });
      expect(
        await f.api.context({ ...options, isCurrent: () => current }),
      ).toMatchObject({ ok: false, error: { kind: "context_changed" } });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("fences identity again after JSON parsing and does not sign out a replacement session", async () => {
    const f = make();
    f.fetcher.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        f.setSession(null);
        return payload;
      },
    } as Response);
    expect(await f.api.context(options)).toMatchObject({
      ok: false,
      error: { kind: "context_changed" },
    });
    const replaced = make();
    replaced.fetcher.mockImplementation(async () => {
      replaced.setSession(null);
      return response({}, 401);
    });
    expect(await replaced.api.context(options)).toMatchObject({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect(replaced.signOut).not.toHaveBeenCalled();
  });
  it("normalizes current-session 401 and rejects malformed or injected envelopes", async () => {
    const f = make();
    f.fetcher.mockResolvedValue(response({}, 401));
    expect(await f.api.context(options)).toMatchObject({
      ok: false,
      error: { kind: "session_expired" },
    });
    expect(f.signOut).toHaveBeenCalledTimes(1);
    const bad = make();
    bad.fetcher.mockResolvedValue(response({ ...payload, userId: "other" }));
    expect(await bad.api.context(options)).toMatchObject({
      ok: false,
      error: { kind: "validation_error" },
    });
    const malformed = make();
    malformed.fetcher.mockResolvedValue(response({}, 503));
    expect(await malformed.api.context(options)).toMatchObject({
      ok: false,
      error: { kind: "parse_error" },
    });
  });
  it("rejects invalid/duplicate/bounded IDs and injected owner before fetch", async () => {
    const f = make();
    for (const bad of [
      { ...input, recipeIds: ["fixed", "fixed"] },
      { ...input, servings: 13 },
      { ...input, userId: "other" },
      { ...input, catalogRevision: "" },
    ])
      expect(
        await f.api.revalidate(bad as typeof input, options),
      ).toMatchObject({ ok: false, error: { kind: "validation_error" } });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("aborts before dispatch or before publishing a late response", async () => {
    const before = make(),
      controller = new AbortController();
    controller.abort();
    expect(
      await before.api.context({ ...options, signal: controller.signal }),
    ).toMatchObject({ ok: false, error: { kind: "network_error" } });
    expect(before.fetcher).not.toHaveBeenCalled();
    const after = make(),
      late = new AbortController();
    after.fetcher.mockImplementation(async () => {
      late.abort();
      return response(payload);
    });
    expect(
      await after.api.context({ ...options, signal: late.signal }),
    ).toMatchObject({ ok: false, error: { kind: "network_error" } });
  });
  it("disabled and legacy transports stay unavailable", async () => {
    const api = createMealRecipeSessionApi(new DisabledApiClient());
    expect(await api.context(options)).toMatchObject({
      ok: false,
      error: { kind: "not_configured" },
    });
    expect(await api.revalidate(input, options)).toMatchObject({
      ok: false,
      error: { kind: "not_configured" },
    });
    const legacy = new DisabledApiClient();
    Object.defineProperty(legacy, "getMealRecipeSessionContext", {
      value: undefined,
    });
    expect(
      await createMealRecipeSessionApi(legacy).context(options),
    ).toMatchObject({ ok: false, error: { kind: "not_configured" } });
  });
});
