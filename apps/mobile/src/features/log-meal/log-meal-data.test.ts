import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";

import { submitLogMealWith } from "./log-meal-data";

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
});
