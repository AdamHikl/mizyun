import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";

import { refineMealDraftWith, submitLogMealWith } from "./log-meal-data";

const NOW = new Date("2026-07-19T10:15:00.000Z");

const fakeClient = (
  result: Result<unknown, ApiError>,
  requests: RequestOptions[] = [],
): ApiClient => ({
  request: <T>(options: RequestOptions): Promise<Result<T, ApiError>> => {
    requests.push(options);
    return Promise.resolve(result as Result<T, ApiError>);
  },
  status: () => ({
    configured: true,
    baseUrl: "https://example.test",
    provider: "supabase",
  }),
  draftFoodEntry: async () => ({
    ok: true as const,
    value: {
      draft: {
        name: "Stub meal",
        caloriesKcal: 0,
        proteinG: 0,
        carbohydrateG: 0,
        fatG: 0,
        calorieRangeKcal: null,
        proteinRangeG: null,
        carbohydrateRangeG: null,
        fatRangeG: null,
        confidence: 0,
        warnings: [],
        assumptions: [],
        provenance: {
          inputKind: "photo" as const,
          provider: "stub",
          model: "stub",
          promptVersion: "nutrition-draft-v2",
        },
      },
      requestId: "stub",
    },
  }),
});

describe("submitLogMealWith", () => {
  it("rejects an empty name without calling the API", async () => {
    const requests: RequestOptions[] = [];
    const result = await submitLogMealWith(
      {
        name: "   ",
        caloriesKcal: 200,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
        consumedAt: null,
      },
      fakeClient({ ok: true, value: {} }, requests),
    );
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("posts a confirmed manual entry and returns its id", async () => {
    const requests: RequestOptions[] = [];
    const id = "00000000-0000-4000-8000-000000000001";
    const result = await submitLogMealWith(
      {
        name: " Toast ",
        caloriesKcal: 200,
        proteinG: 5,
        carbohydrateG: 30,
        fatG: 4,
        consumedAt: null,
        details: {
          aiDraft: {
            provenance: { inputKind: "text" },
            userConfirmed: true,
          },
        },
      },
      fakeClient(
        {
          ok: true,
          value: {
            foodEntry: {
              id,
              userId: "00000000-0000-4000-8000-000000000002",
              name: "Toast",
              consumedAt: NOW.toISOString(),
              caloriesKcal: 200,
              proteinG: 5,
              carbohydrateG: 30,
              fatG: 4,
              source: "manual",
              confidence: null,
              confirmedByUser: true,
              details: {},
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString(),
            },
          },
        },
        requests,
      ),
      () => NOW,
    );
    expect(result).toEqual({ ok: true, id });
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/food-entries",
      body: { name: "Toast", caloriesKcal: 200, consumedAt: NOW.toISOString() },
    });
    expect(requests[0]?.body).toMatchObject({
      details: {
        aiDraft: {
          provenance: { inputKind: "text" },
          userConfirmed: true,
        },
      },
    });
  });

  it("keeps the form recoverable on a network error", async () => {
    const result = await submitLogMealWith(
      {
        name: "Toast",
        caloriesKcal: 200,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
        consumedAt: NOW.toISOString(),
      },
      fakeClient({
        ok: false,
        error: { kind: "network_error", cause: new Error("offline") },
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: "Network unavailable. Try again when you're online.",
    });
  });

  it("attaches clientOperationId and Idempotency-Key header for retry deduplication (REL-AUD-007)", async () => {
    const requests: RequestOptions[] = [];
    const clientOpId = "00000000-0000-4000-8000-000000000099";
    const result = await submitLogMealWith(
      {
        name: "Eggs and coffee",
        caloriesKcal: 250,
        proteinG: 14,
        carbohydrateG: 2,
        fatG: 18,
        consumedAt: NOW.toISOString(),
        clientOperationId: clientOpId,
      },
      fakeClient(
        {
          ok: true,
          value: {
            foodEntry: {
              id: "meal-123",
              userId: "00000000-0000-4000-8000-000000000002",
              name: "Eggs and coffee",
              consumedAt: NOW.toISOString(),
              caloriesKcal: 250,
              proteinG: 14,
              carbohydrateG: 2,
              fatG: 18,
              source: "manual",
              confidence: null,
              confirmedByUser: true,
              clientOperationId: clientOpId,
              details: {},
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString(),
            },
          },
        },
        requests,
      ),
      () => NOW,
    );

    expect(result).toEqual({ ok: true, id: "meal-123" });
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/food-entries",
      headers: {
        "Idempotency-Key": clientOpId,
      },
    });
    expect(
      (requests[0]?.body as { clientOperationId?: string }).clientOperationId,
    ).toBe(clientOpId);
  });
});

// =========================================================================
// VISION-001 — snapMealPhotoWith (multipart photo → photo-draft)
// =========================================================================

import { snapMealPhotoWith } from "./log-meal-data";

const stubFoodDraft = (
  overrides: Partial<{
    name: string | null;
    caloriesKcal: number | null;
    proteinG: number | null;
    carbohydrateG: number | null;
    fatG: number | null;
    confidence: number;
    warnings: string[];
  }> = {},
) => ({
  draft: {
    name: overrides.name ?? null,
    caloriesKcal: overrides.caloriesKcal ?? null,
    proteinG: overrides.proteinG ?? null,
    carbohydrateG: overrides.carbohydrateG ?? null,
    fatG: overrides.fatG ?? null,
    confidence: overrides.confidence ?? 0.5,
    warnings: overrides.warnings ?? [],
    calorieRangeKcal: null,
    proteinRangeG: null,
    carbohydrateRangeG: null,
    fatRangeG: null,
    assumptions: [],
    provenance: {
      inputKind: "photo" as const,
      provider: "stub",
      model: "stub",
      promptVersion: "nutrition-draft-v2",
    },
  },
  requestId: "req-stub",
});

const photoBlob = new Blob(
  [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer as ArrayBuffer],
  { type: "image/jpeg" },
);

describe("snapMealPhotoWith", () => {
  it("returns the parsed candidate on a 2xx response", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      draftFoodEntry: async () => ({
        ok: true as const,
        value: stubFoodDraft({
          name: "Grilled chicken",
          caloriesKcal: 420,
          proteinG: 38,
          carbohydrateG: 12,
          fatG: 18,
          confidence: 0.82,
        }),
      }),
    };
    const result = await snapMealPhotoWith(
      client,
      photoBlob,
      "image/jpeg",
      "lunch",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.draft.name).toBe("Grilled chicken");
    expect(result.draft.caloriesKcal).toBe(420);
    expect(result.draft.confidence).toBe(0.82);
  });

  it("omits textHint when not provided (sends an empty multipart body)", async () => {
    let captured:
      | {
          readonly photo: Blob;
          readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
          readonly textHint?: string;
        }
      | undefined;
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      draftFoodEntry: async (input) => {
        captured = input;
        return { ok: true as const, value: stubFoodDraft() };
      },
    };
    const result = await snapMealPhotoWith(client, photoBlob, "image/jpeg");
    expect(result.ok).toBe(true);
    expect(captured).toEqual({
      photo: photoBlob,
      mimeType: "image/jpeg",
    });
  });

  it("forwards the user's description as a textHint alongside the photo", async () => {
    let captured:
      | {
          readonly photo: Blob;
          readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
          readonly textHint?: string;
        }
      | undefined;
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      draftFoodEntry: async (input) => {
        captured = input;
        return {
          ok: true as const,
          value: stubFoodDraft({ name: "Toast and butter" }),
        };
      },
    };
    const description = "two slices of toast with a teaspoon of butter";
    const result = await snapMealPhotoWith(
      client,
      photoBlob,
      "image/jpeg",
      description,
    );
    expect(result.ok).toBe(true);
    expect(captured).toEqual({
      photo: photoBlob,
      mimeType: "image/jpeg",
      textHint: description,
    });
  });

  it("translates a network error to a recoverable human message", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      draftFoodEntry: async () => ({
        ok: false as const,
        error: { kind: "network_error", cause: new Error("offline") },
      }),
    };
    const result = await snapMealPhotoWith(
      client,
      photoBlob,
      "image/jpeg",
      "lunch",
    );
    expect(result).toEqual({
      ok: false,
      message: "Can't reach the server — type the meal by hand.",
    });
  });

  it("translates a 503 AI_CONFIGURATION_ERROR", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      draftFoodEntry: async () => ({
        ok: false as const,
        error: {
          kind: "http_error",
          status: 503,
          code: "AI_CONFIGURATION_ERROR",
          message: "Photo drafts are not configured on this server.",
        },
      }),
    };
    const result = await snapMealPhotoWith(client, photoBlob, "image/jpeg");
    expect(result).toEqual({
      ok: false,
      message: "Photo drafts are not configured on this server.",
    });
  });

  it("translates a 429 RATE_LIMITED with a retry hint", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      draftFoodEntry: async () => ({
        ok: false as const,
        error: {
          kind: "http_error",
          status: 429,
          code: "RATE_LIMITED",
          message: "Slow down.",
        },
      }),
    };
    const result = await snapMealPhotoWith(client, photoBlob, "image/jpeg");
    expect(result).toEqual({
      ok: false,
      message: "Photo drafts are limited — try again in a minute.",
    });
  });

  it("falls back to a generic error message on unknown failure shapes", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      draftFoodEntry: async () => ({
        ok: false as const,
        error: { kind: "parse_error", cause: new Error("weird") },
      }),
    };
    const result = await snapMealPhotoWith(client, photoBlob, "image/jpeg");
    expect(result).toEqual({
      ok: false,
      message: "Couldn't read the photo — type the meal by hand.",
    });
  });
});

// =========================================================================
// AI-ACT-007 — refineMealDraftWith (JSON → refined draft)
// =========================================================================

import type { FoodDraftCandidate } from "@mizyun/contracts";

const baselineCandidate: FoodDraftCandidate = {
  name: "Grilled chicken",
  caloriesKcal: 300,
  proteinG: 50,
  carbohydrateG: 0,
  fatG: 10,
  calorieRangeKcal: { low: 240, high: 360 },
  proteinRangeG: { low: 40, high: 60 },
  carbohydrateRangeG: { low: 0, high: 5 },
  fatRangeG: { low: 7, high: 14 },
  confidence: 0.7,
  warnings: [],
  assumptions: ["Assumes 100g chicken breast."],
  provenance: {
    inputKind: "text",
    provider: "stub",
    model: "stub",
    promptVersion: "nutrition-draft-v2",
  },
};

describe("refineMealDraftWith", () => {
  it("returns the refined candidate on a 2xx response", async () => {
    let captured:
      | {
          readonly method: string;
          readonly path: string;
          readonly body: unknown;
        }
      | undefined;
    const refined: FoodDraftCandidate = {
      ...baselineCandidate,
      caloriesKcal: 600,
      proteinG: 100,
      fatG: 20,
      calorieRangeKcal: { low: 480, high: 720 },
      proteinRangeG: { low: 80, high: 120 },
      fatRangeG: { low: 14, high: 28 },
      provenance: {
        ...baselineCandidate.provenance,
        promptVersion: "nutrition-draft-refine-v1",
      },
    };
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      request: async <T>(
        options: RequestOptions,
      ): Promise<Result<T, ApiError>> => {
        captured = {
          method: options.method,
          path: options.path,
          body: options.body,
        };
        return Promise.resolve({
          ok: true as const,
          value: { draft: refined, requestId: "req-refine" } as T,
        });
      },
    };
    const result = await refineMealDraftWith(
      client,
      baselineCandidate,
      "double the portion",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.draft.caloriesKcal).toBe(600);
    expect(result.draft.proteinG).toBe(100);
    expect(captured?.method).toBe("POST");
    expect(captured?.path).toBe("/v1/food-entries/draft/refine");
    expect(captured?.body).toMatchObject({
      currentDraft: { name: "Grilled chicken" },
      instruction: "double the portion",
    });
  });

  it("rejects an instruction shorter than 2 characters without calling the API", async () => {
    const requests: RequestOptions[] = [];
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }, requests),
    };
    const result = await refineMealDraftWith(client, baselineCandidate, "x");
    expect(result).toEqual({
      ok: false,
      message: "Type an instruction for the AI.",
    });
    expect(requests).toHaveLength(0);
  });

  it("translates a 422 validation error to a recoverable human message", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      request: async () => ({
        ok: false as const,
        error: {
          kind: "http_error",
          status: 422,
          code: "VALIDATION_ERROR",
          message: "bad",
        },
      }),
    };
    const result = await refineMealDraftWith(
      client,
      baselineCandidate,
      "halve the chicken",
    );
    expect(result).toEqual({
      ok: false,
      message: "Couldn't refine the draft. Edit the values manually.",
    });
  });

  it("translates a 503 AI_CONFIGURATION_ERROR", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      request: async () => ({
        ok: false as const,
        error: {
          kind: "http_error",
          status: 503,
          code: "AI_CONFIGURATION_ERROR",
          message: "Refine is not configured on this server.",
        },
      }),
    };
    const result = await refineMealDraftWith(
      client,
      baselineCandidate,
      "halve the chicken",
    );
    expect(result).toEqual({
      ok: false,
      message: "Refine is not configured on this server.",
    });
  });

  it("translates a 429 RATE_LIMITED", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      request: async () => ({
        ok: false as const,
        error: {
          kind: "http_error",
          status: 429,
          code: "RATE_LIMITED",
          message: "Slow down.",
        },
      }),
    };
    const result = await refineMealDraftWith(
      client,
      baselineCandidate,
      "halve the chicken",
    );
    expect(result).toEqual({
      ok: false,
      message: "Refine is limited — try again in a minute.",
    });
  });

  it("translates a network error", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      request: async () => ({
        ok: false as const,
        error: { kind: "network_error", cause: new Error("offline") },
      }),
    };
    const result = await refineMealDraftWith(
      client,
      baselineCandidate,
      "halve the chicken",
    );
    expect(result).toEqual({
      ok: false,
      message: "Can't reach the server — try again in a moment.",
    });
  });

  it("returns a fallback error message when the response fails contract validation", async () => {
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: {} }),
      request: async () =>
        ({
          ok: true as const,
          // Missing required `draft` shape — Zod will reject.
          value: { notADraft: true } as never,
        }) as never,
    };
    const result = await refineMealDraftWith(
      client,
      baselineCandidate,
      "halve the chicken",
    );
    expect(result).toEqual({
      ok: false,
      message: "Couldn't refine the draft. Edit the values manually.",
    });
  });
});
