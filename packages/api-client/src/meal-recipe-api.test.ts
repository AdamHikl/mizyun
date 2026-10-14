import { describe, expect, it, vi } from "vitest";
import type { AuthClient, AuthSession } from "@mizyun/identity";
import { createMealRecipeApi } from "./meal-recipe-api";
import { HttpApiClient } from "./http-api-client";
import { DisabledApiClient } from "./disabled-api-client";

const requestId = "00000000-0000-4000-8000-000000000001";
const options = { expectedUserId: "owner", isCurrent: () => true };
const capabilities = {
  version: "meal-recipe-v1",
  suggest: true,
  recognizeIngredients: true,
  reason: "ready",
  maximumImages: 3,
  maximumTotalImageBytes: 4_194_304,
  maximumImageDimension: 4096,
  requiresIngredientConfirmation: true,
  requestIdRequired: true,
};
const recognition = {
  version: "meal-recipe-v1",
  requestId,
  ingredients: [],
  warnings: [],
};
const input = {
  requestId,
  servings: 1,
  input: {
    version: "meal-recipe-v1" as const,
    ingredients: [
      {
        ingredientId: "rice",
        name: "Rice",
        confirmed: true,
        preparationState: "raw" as const,
        quantity: 100,
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
const suggestion = {
  version: "meal-recipe-v1",
  requestId,
  recipes: [],
  ranking: {
    context: {
      version: "meal-recipe-v1",
      rankingVersion: "macro-balance-v1",
      targets: { proteinG: null, carbohydrateG: null, fatG: null },
      consumed: { proteinG: null, carbohydrateG: null, fatG: null },
      remaining: { proteinG: null, carbohydrateG: null, fatG: null },
      positiveGaps: { proteinG: null, carbohydrateG: null, fatG: null },
      snapshot: {
        localDate: "2026-10-13",
        timeZone: "Europe/Bratislava",
        generatedAt: "2026-10-13T00:00:00Z",
        expiresAt: "2026-10-14T00:00:00Z",
        energyFormulaVersion: "v1",
        goalRevision: "g1",
        intakeRevision: "i1",
        constraintsRevision: "c1",
        profileRevision: "p1",
      },
      coverage: "unknown",
      state: "unknown",
      reason: "targets_unavailable",
      focus: [],
    },
    ranked: [],
    rejected: [],
  },
};
const image = (type = "image/jpeg", size = 1) => ({
  photo: new Blob([new Uint8Array(size)], { type }),
  mimeType: type as "image/jpeg",
});
const response = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status });
const make = (payload: unknown = capabilities) => {
  let session: AuthSession | null = {
    user: { id: "owner" as never, email: "test@example.com" },
    accessToken: "token",
  };
  const signOut = vi.fn().mockResolvedValue(undefined);
  const auth = {
    getSession: vi.fn(async () => session),
    signOut,
  } as unknown as AuthClient;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(payload));
  const api = createMealRecipeApi(
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

describe("recipe API boundary", () => {
  it("uses the exact capability route and authenticated owner", async () => {
    const { api, fetcher } = make();
    expect(await api.capabilities(options)).toEqual({
      ok: true,
      value: capabilities,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example/v1/meal-recipes/capabilities",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
  });
  it("posts only the strict suggestion input and stable persisted UUID", async () => {
    const { api, fetcher } = make(suggestion);
    expect((await api.suggest(input, options)).ok).toBe(true);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.example/v1/meal-recipes/suggest",
    );
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual(
      input,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    const injected = { ...input, ownerId: "other", targets: { proteinG: 500 } };
    expect((await api.suggest(injected, options)).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("posts requestId plus repeated images without a manual multipart content type", async () => {
    const { api, fetcher } = make(recognition);
    const controller = new AbortController();
    expect(
      (
        await api.recognizeIngredients(
          {
            requestId,
            images: [image(), image("image/png"), image("image/webp")],
          },
          { ...options, signal: controller.signal },
        )
      ).ok,
    ).toBe(true);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      "https://api.example/v1/meal-recipes/recognize-ingredients",
    );
    expect(init?.signal).toBe(controller.signal);
    expect(init?.headers).toEqual({ authorization: "Bearer token" });
    const form = init?.body as FormData;
    expect([...form.keys()]).toEqual([
      "requestId",
      "images",
      "images",
      "images",
    ]);
    expect(form.get("requestId")).toBe(requestId);
    expect(form.getAll("images").map((item) => (item as Blob).type)).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
  it.each([
    { images: [] },
    { images: [image(), image(), image(), image()] },
    { images: [image("image/gif")] },
    { images: [image("image/png", 4_194_305)] },
    { images: [image("image/jpeg", 0)] },
  ])("rejects invalid image bounds before dispatch", async ({ images }) => {
    const { api, fetcher } = make();
    expect(
      (await api.recognizeIngredients({ requestId, images }, options)).ok,
    ).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects absent UUID and aggregate bytes before dispatch", async () => {
    const { api, fetcher } = make();
    await api.recognizeIngredients(
      { requestId: "new-id", images: [image()] },
      options,
    );
    await api.recognizeIngredients(
      {
        requestId,
        images: [
          image("image/jpeg", 2_097_153),
          image("image/jpeg", 2_097_152),
        ],
      },
      options,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never retries an ambiguous lost response", async () => {
    const { api, fetcher } = make();
    fetcher.mockRejectedValue(new Error("lost response"));
    expect((await api.suggest(input, options)).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string).requestId,
    ).toBe(requestId);
  });
  it("fences retired and wrong owners before fetch", async () => {
    const { api, fetcher } = make();
    await api.capabilities({ ...options, expectedUserId: "other" });
    await api.suggest(input, { ...options, isCurrent: () => false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fences account switches and stale 401 without signing out the next account", async () => {
    const { api, fetcher, setSession, signOut } = make();
    fetcher.mockImplementation(async () => {
      setSession({
        user: { id: "other" as never, email: "other@example.com" },
        accessToken: "new",
      });
      return response({}, 401);
    });
    expect(await api.capabilities(options)).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect(signOut).not.toHaveBeenCalled();
  });
  it("fences same-owner token replacement and controller retirement after fetch", async () => {
    const { api, fetcher, setSession } = make();
    fetcher.mockImplementation(async () => {
      setSession({
        user: { id: "owner" as never, email: "test@example.com" },
        accessToken: "new",
      });
      return response(capabilities);
    });
    expect(await api.capabilities(options)).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    let active = true;
    fetcher.mockImplementation(async () => {
      active = false;
      return response(capabilities);
    });
    expect(
      await api.capabilities({ ...options, isCurrent: () => active }),
    ).toEqual({ ok: false, error: { kind: "context_changed" } });
  });
  it("fences owner changes while parsing the response", async () => {
    const { api, fetcher, setSession } = make();
    fetcher.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        setSession(null);
        return capabilities;
      },
    } as Response);
    expect(await api.capabilities(options)).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
  });
  it("rejects pre-abort and post-response abort even when fetch ignores cancellation", async () => {
    const { api, fetcher } = make();
    const controller = new AbortController();
    controller.abort();
    await api.capabilities({ ...options, signal: controller.signal });
    expect(fetcher).not.toHaveBeenCalled();
    const next = new AbortController();
    fetcher.mockImplementation(async () => {
      next.abort();
      return response(capabilities);
    });
    expect(
      await api.capabilities({ ...options, signal: next.signal }),
    ).toMatchObject({
      ok: false,
      error: { kind: "network_error", cause: { name: "AbortError" } },
    });
  });
  it("rejects strict response extras and mismatched operation identities without sensitive issue contents", async () => {
    const { api, fetcher } = make({
      ...capabilities,
      privateHealthData: "secret-health",
    });
    const invalid = await api.capabilities(options);
    expect(invalid).toMatchObject({
      ok: false,
      error: { kind: "validation_error" },
    });
    expect(JSON.stringify(invalid)).not.toContain("secret");
    expect(JSON.stringify(invalid)).not.toContain("privateHealthData");
    fetcher.mockResolvedValue(
      response({
        ...recognition,
        requestId: "00000000-0000-4000-8000-000000000002",
      }),
    );
    expect(
      (
        await api.recognizeIngredients(
          { requestId, images: [image()] },
          options,
        )
      ).ok,
    ).toBe(false);
    fetcher.mockResolvedValue(
      response({ ...suggestion, recipes: [{ unsafe: "secret" }] }),
    );
    expect((await api.suggest(input, options)).ok).toBe(false);
  });
  it("sanitizes malformed error bodies and normalizes valid errors", async () => {
    const { api, fetcher } = make();
    fetcher.mockResolvedValue(response({ privateHealth: "secret" }, 500));
    expect(await api.capabilities(options)).toEqual({
      ok: false,
      error: { kind: "parse_error", cause: "Invalid recipe response." },
    });
    fetcher.mockResolvedValue(
      response(
        { error: { code: "RECIPES_DISABLED", message: "Recipes unavailable" } },
        503,
      ),
    );
    expect(await api.capabilities(options)).toMatchObject({
      ok: false,
      error: { kind: "http_error", code: "RECIPES_DISABLED", status: 503 },
    });
  });
  it("signs out only the captured current session on a current 401", async () => {
    const { api, fetcher, signOut } = make();
    fetcher.mockResolvedValue(response({}, 401));
    expect(await api.capabilities(options)).toEqual({
      ok: false,
      error: { kind: "session_expired" },
    });
    expect(signOut).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "token" }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("disabled clients provide every named recipe method", async () => {
    const api = createMealRecipeApi(new DisabledApiClient());
    for (const result of [
      await api.capabilities(options),
      await api.suggest(input, options),
      await api.recognizeIngredients({ requestId, images: [image()] }, options),
    ])
      expect(result).toMatchObject({
        ok: false,
        error: { kind: "not_configured" },
      });
  });
});
