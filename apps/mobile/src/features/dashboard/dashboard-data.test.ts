import { describe, expect, it } from "vitest";

import type {
  BoulderSessionListResponse,
  BoulderSessionRecord,
  DailyFoodSummary,
  DailyFoodSummaryListResponse,
  DailyFoodSummaryResponse,
  BodyMeasurementListResponse,
  EnergySummaryResponse,
  FoodEntry,
  WorkoutListResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";

import {
  combineNutritionReview,
  computeDailyNutritionDisplay,
  fetchDailySummary,
  fetchEnergySummary,
  fetchLatestWeight,
  fetchNutritionReview,
  fetchNutritionReviewSummaries,
  fetchWorkoutCountForPeriod,
  fetchBoulderSessionCountForPeriod,
  combineTrainingCounts,
  readDashboardSnapshot,
  extractFirstEligibleMeal,
  summariseNutritionReview,
  type LocalDayQuery,
  type NutritionReviewRangeQuery,
} from "./dashboard-data";

const fakePrincipal = {
  userId: "00000000-0000-4000-8000-000000000001",
  accessToken: "test-token",
};

const fakePrincipalNull = null;

/**
 * Build a `vi.fn()`-free client whose `request` always returns the
 * given `Result`. The signature mirrors `ApiClient.request` so the
 * reducers treat the fake exactly like the real client.
 */
const fakeClient = (result: Result<unknown, ApiError>): ApiClient => ({
  request: <T>(_options: RequestOptions): Promise<Result<T, ApiError>> =>
    Promise.resolve(result as Result<T, ApiError>),
  status: () => ({
    configured: true,
    baseUrl: "https://example.test",
    provider: "supabase",
  }),
});

const fakeClientSequence = (
  results: ReadonlyArray<Result<unknown, ApiError>>,
): ApiClient => {
  let index = 0;
  return {
    request: <T>(_options: RequestOptions): Promise<Result<T, ApiError>> => {
      const result = results[index++];
      if (result === undefined) throw new Error("unexpected request");
      return Promise.resolve(result as Result<T, ApiError>);
    },
    status: () => ({
      configured: true,
      baseUrl: "https://example.test",
      provider: "supabase",
    }),
  };
};

describe("fetchDailySummary", () => {
  it("returns the parsed summary on success", async () => {
    const summary: DailyFoodSummaryResponse = {
      summary: {
        date: "2026-07-18",
        entryCount: 3,
        caloriesKcal: 800,
        proteinG: 30,
        carbohydrateG: 100,
        fatG: 25,
      },
    };
    const client = fakeClient({ ok: true, value: summary });
    const result = await fetchDailySummary(client, fakePrincipal, {
      date: "2026-07-18",
      utcOffsetMinutes: 120,
    });
    expect(result.value?.caloriesKcal).toBe(800);
    expect(result.error).toBeNull();
  });

  it("returns the no-session error when the principal is null", async () => {
    const client = fakeClient({ ok: true, value: {} });
    const result = await fetchDailySummary(client, fakePrincipalNull, {
      date: "2026-07-18",
    });
    expect(result.value).toBeNull();
    expect(result.error?.kind).toBe("no_session");
  });

  it("returns the underlying error when the request fails", async () => {
    const client = fakeClient({
      ok: false,
      error: {
        kind: "http_error",
        status: 500,
        code: "INTERNAL_ERROR",
        message: "boom",
      },
    });
    const result = await fetchDailySummary(client, fakePrincipal, {
      date: "2026-07-18",
    });
    expect(result.value).toBeNull();
    expect(result.error?.kind).toBe("http_error");
  });
});

describe("fetchLatestWeight", () => {
  it("returns the first measurement when the list is non-empty", async () => {
    const list: BodyMeasurementListResponse = {
      bodyMeasurements: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          userId: fakePrincipal.userId,
          measuredAt: "2026-07-15T08:00:00.000Z",
          weightKg: 72.5,
          measurements: {},
          source: "manual",
          createdAt: "2026-07-15T08:00:00.000Z",
        },
      ],
    };
    const client = fakeClient({ ok: true, value: list });
    const result = await fetchLatestWeight(client, fakePrincipal);
    expect(result.value?.weightKg).toBe(72.5);
  });

  it("returns null when the list is empty", async () => {
    const list: BodyMeasurementListResponse = { bodyMeasurements: [] };
    const client = fakeClient({ ok: true, value: list });
    const result = await fetchLatestWeight(client, fakePrincipal);
    expect(result.value).toBeNull();
    expect(result.error).toBeNull();
  });

  it("returns the no-session error when the principal is null", async () => {
    const client = fakeClient({ ok: true, value: { bodyMeasurements: [] } });
    const result = await fetchLatestWeight(client, fakePrincipalNull);
    expect(result.value).toBeNull();
    expect(result.error?.kind).toBe("no_session");
  });
});

describe("fetchEnergySummary", () => {
  it("returns the inspectable energy breakdown", async () => {
    const response: EnergySummaryResponse = {
      summary: {
        formulaVersion: "mizyun-energy-v1",
        userId: fakePrincipal.userId,
        computedAt: "2026-07-19T12:00:00.000Z",
        complete: true,
        incompleteReason: null,
        ageYears: 36,
        bmrKcal: 1600,
        activityMultiplier: 1.5,
        tdeeKcal: 2400,
        exerciseKcal: 120,
        goalAdjustmentKcal: -500,
        dailyTargetKcal: 1900,
        targetProteinG: 140,
        targetCarbohydrateG: 212,
        targetFatG: 53,
        balanceKcal: -300,
        balanceUncertaintyKcal: 50,
        inputs: {
          weightKg: 70,
          heightCm: 175,
          birthYear: 1990,
          sexAtBirth: "male",
          activityLevel: "lightly_active",
          goalKind: "cut",
          goalPace: "steady",
        },
      },
    };
    const result = await fetchEnergySummary(
      fakeClient({ ok: true, value: response }),
      fakePrincipal,
      120,
    );
    expect(result.value?.dailyTargetKcal).toBe(1900);
    expect(result.value?.formulaVersion).toBe("mizyun-energy-v1");
  });
});

describe("summariseNutritionReview", () => {
  it("aggregates positive entries and calories across summaries", () => {
    const summaries: DailyFoodSummary[] = [
      {
        date: "2026-07-01",
        entryCount: 2,
        caloriesKcal: 500,
        proteinG: 30,
        carbohydrateG: 60,
        fatG: 15,
      },
      {
        date: "2026-07-02",
        entryCount: 3,
        caloriesKcal: 750,
        proteinG: 45,
        carbohydrateG: 85,
        fatG: 25,
      },
    ];
    const review = summariseNutritionReview(summaries);
    expect(review).toEqual({
      loggedDays: 2,
      entryCount: 5,
      caloriesKcal: 1250,
      incompleteDays: 0,
    });
  });

  it("withholds calories when any summary has caloriesKcal null", () => {
    const summaries: DailyFoodSummary[] = [
      {
        date: "2026-07-01",
        entryCount: 2,
        caloriesKcal: 500,
        proteinG: 30,
        carbohydrateG: 60,
        fatG: 15,
      },
      {
        date: "2026-07-02",
        entryCount: 1,
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
      },
    ];
    const review = summariseNutritionReview(summaries);
    expect(review).toEqual({
      loggedDays: 2,
      entryCount: 3,
      caloriesKcal: null,
      incompleteDays: 1,
    });
  });

  it("returns zeroes when given an empty list", () => {
    const review = summariseNutritionReview([]);
    expect(review).toEqual({
      loggedDays: 0,
      entryCount: 0,
      caloriesKcal: 0,
      incompleteDays: 0,
    });
  });
});

describe("combineNutritionReview", () => {
  it("combines historical summaries with today's summary, deduplicating today if present", () => {
    const historical: DailyFoodSummary[] = [
      {
        date: "2026-07-10",
        entryCount: 2,
        caloriesKcal: 500,
        proteinG: 30,
        carbohydrateG: 60,
        fatG: 15,
      },
      {
        date: "2026-07-11",
        entryCount: 1,
        caloriesKcal: 300,
        proteinG: 20,
        carbohydrateG: 35,
        fatG: 10,
      },
      // Stale copy of today in historical data
      {
        date: "2026-07-12",
        entryCount: 1,
        caloriesKcal: 200,
        proteinG: 10,
        carbohydrateG: 25,
        fatG: 5,
      },
    ];

    const today: DailyFoodSummary = {
      date: "2026-07-12",
      entryCount: 3,
      caloriesKcal: 800,
      proteinG: 50,
      carbohydrateG: 90,
      fatG: 25,
    };

    const review = combineNutritionReview(historical, today);

    // Deduplicated 2026-07-12 uses today's data: 500 + 300 + 800 = 1600 kcal
    // entries: 2 + 1 + 3 = 6 entries, 3 logged days
    expect(review).toEqual({
      loggedDays: 3,
      entryCount: 6,
      caloriesKcal: 1600,
      incompleteDays: 0,
    });
  });

  it("withholds calories if today has incomplete nutrition", () => {
    const historical: DailyFoodSummary[] = [
      {
        date: "2026-07-10",
        entryCount: 2,
        caloriesKcal: 500,
        proteinG: 30,
        carbohydrateG: 60,
        fatG: 15,
      },
    ];

    const today: DailyFoodSummary = {
      date: "2026-07-11",
      entryCount: 1,
      caloriesKcal: null,
      proteinG: null,
      carbohydrateG: 30,
      fatG: null,
    };

    const review = combineNutritionReview(historical, today);
    expect(review.loggedDays).toBe(2);
    expect(review.entryCount).toBe(3);
    expect(review.caloriesKcal).toBeNull();
    expect(review.incompleteDays).toBe(1);
  });

  it("withholds calories if any historical day has incomplete nutrition", () => {
    const historical: DailyFoodSummary[] = [
      {
        date: "2026-07-10",
        entryCount: 2,
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
      },
      {
        date: "2026-07-11",
        entryCount: 1,
        caloriesKcal: 400,
        proteinG: 25,
        carbohydrateG: 45,
        fatG: 12,
      },
    ];

    const today: DailyFoodSummary = {
      date: "2026-07-12",
      entryCount: 2,
      caloriesKcal: 600,
      proteinG: 40,
      carbohydrateG: 70,
      fatG: 20,
    };

    const review = combineNutritionReview(historical, today);
    expect(review.loggedDays).toBe(3);
    expect(review.entryCount).toBe(5);
    expect(review.caloriesKcal).toBeNull();
    expect(review.incompleteDays).toBe(1);
  });

  it("removes today from logged days if today's entryCount is 0", () => {
    const historical: DailyFoodSummary[] = [
      {
        date: "2026-07-10",
        entryCount: 2,
        caloriesKcal: 500,
        proteinG: 30,
        carbohydrateG: 60,
        fatG: 15,
      },
      {
        date: "2026-07-11",
        entryCount: 1,
        caloriesKcal: 300,
        proteinG: 20,
        carbohydrateG: 35,
        fatG: 10,
      },
    ];

    const today: DailyFoodSummary = {
      date: "2026-07-11",
      entryCount: 0,
      caloriesKcal: null,
      proteinG: null,
      carbohydrateG: null,
      fatG: null,
    };

    const review = combineNutritionReview(historical, today);
    expect(review.loggedDays).toBe(1);
    expect(review.entryCount).toBe(2);
    expect(review.caloriesKcal).toBe(500);
    expect(review.incompleteDays).toBe(0);
  });

  it("works when todaySummary is null", () => {
    const historical: DailyFoodSummary[] = [
      {
        date: "2026-07-10",
        entryCount: 2,
        caloriesKcal: 500,
        proteinG: 30,
        carbohydrateG: 60,
        fatG: 15,
      },
    ];

    const review = combineNutritionReview(historical, null);
    expect(review).toEqual({
      loggedDays: 1,
      entryCount: 2,
      caloriesKcal: 500,
      incompleteDays: 0,
    });
  });

  it("filters out historical summaries with entryCount <= 0", () => {
    const historical: DailyFoodSummary[] = [
      {
        date: "2026-07-10",
        entryCount: 0,
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
      },
      {
        date: "2026-07-11",
        entryCount: 2,
        caloriesKcal: 700,
        proteinG: 50,
        carbohydrateG: 80,
        fatG: 20,
      },
    ];

    const review = combineNutritionReview(historical, null);
    expect(review).toEqual({
      loggedDays: 1,
      entryCount: 2,
      caloriesKcal: 700,
      incompleteDays: 0,
    });
  });
});

describe("fetchNutritionReviewSummaries", () => {
  it("fetches range summaries with correct query params", async () => {
    const requestedPaths: string[] = [];
    const client: ApiClient = {
      request: <T>(options: RequestOptions): Promise<Result<T, ApiError>> => {
        requestedPaths.push(options.path);
        const response: DailyFoodSummaryListResponse = {
          summaries: [
            {
              date: "2026-07-01",
              entryCount: 1,
              caloriesKcal: 350,
              proteinG: 20,
              carbohydrateG: 40,
              fatG: 10,
            },
          ],
        };
        return Promise.resolve({
          ok: true,
          value: response as unknown as T,
        });
      },
      status: () => ({
        configured: true,
        baseUrl: "https://example.test",
        provider: "supabase",
      }),
    };

    const result = await fetchNutritionReviewSummaries(client, fakePrincipal, {
      fromIsoDate: "2026-07-01",
      toIsoDate: "2026-07-07",
      utcOffsetMinutes: 120,
    });

    expect(requestedPaths).toEqual([
      "/v1/food-entries/summary?from=2026-07-01&to=2026-07-07&utcOffsetMinutes=120",
    ]);
    expect(result.value?.length).toBe(1);
    expect(result.value?.[0]?.caloriesKcal).toBe(350);
    expect(result.error).toBeNull();
  });

  it("returns no_session when principal is null", async () => {
    const client = fakeClient({ ok: true, value: { summaries: [] } });
    const result = await fetchNutritionReviewSummaries(
      client,
      fakePrincipalNull,
      {
        fromIsoDate: "2026-07-01",
        toIsoDate: "2026-07-07",
      },
    );
    expect(result.value).toBeNull();
    expect(result.error?.kind).toBe("no_session");
  });

  it("returns error when request fails", async () => {
    const client = fakeClient({
      ok: false,
      error: {
        kind: "http_error",
        status: 500,
        code: "INTERNAL_ERROR",
        message: "boom",
      },
    });
    const result = await fetchNutritionReviewSummaries(client, fakePrincipal, {
      fromIsoDate: "2026-07-01",
      toIsoDate: "2026-07-07",
    });
    expect(result.value).toBeNull();
    expect(result.error?.kind).toBe("http_error");
  });
});

describe("fetchNutritionReview", () => {
  it("aggregates complete local-day summaries", async () => {
    const result = await fetchNutritionReview(
      fakeClient({
        ok: true,
        value: {
          summaries: [
            {
              date: "2026-07-14",
              entryCount: 2,
              caloriesKcal: 900,
              proteinG: 50,
              carbohydrateG: 100,
              fatG: 30,
            },
          ],
        },
      }),
      fakePrincipal,
      [
        { date: "2026-07-14", utcOffsetMinutes: 120 },
        { date: "2026-07-15", utcOffsetMinutes: 120 },
      ],
    );
    expect(result.value).toEqual({
      loggedDays: 1,
      entryCount: 2,
      caloriesKcal: 900,
      incompleteDays: 0,
    });
  });

  it("withholds the weekly calorie total when a logged day is incomplete", async () => {
    const result = await fetchNutritionReview(
      fakeClient({
        ok: true,
        value: {
          summaries: [
            {
              date: "2026-07-14",
              entryCount: 1,
              caloriesKcal: null,
              proteinG: null,
              carbohydrateG: null,
              fatG: null,
            },
          ],
        },
      }),
      fakePrincipal,
      [{ date: "2026-07-14", utcOffsetMinutes: 120 }],
    );
    expect(result.value?.caloriesKcal).toBeNull();
    expect(result.value?.incompleteDays).toBe(1);
  });

  it("makes exactly 1 request to /v1/food-entries/summary?from=...&to=... and correctly aggregates", async () => {
    const requestedPaths: string[] = [];
    const client: ApiClient = {
      request: <T>(options: RequestOptions): Promise<Result<T, ApiError>> => {
        requestedPaths.push(options.path);
        const response: DailyFoodSummaryListResponse = {
          summaries: [
            {
              date: "2026-07-01",
              entryCount: 2,
              caloriesKcal: 600,
              proteinG: 40,
              carbohydrateG: 70,
              fatG: 20,
            },
            {
              date: "2026-07-03",
              entryCount: 3,
              caloriesKcal: 900,
              proteinG: 60,
              carbohydrateG: 100,
              fatG: 30,
            },
          ],
        };
        return Promise.resolve({
          ok: true,
          value: response as unknown as T,
        });
      },
      status: () => ({
        configured: true,
        baseUrl: "https://example.test",
        provider: "supabase",
      }),
    };

    const result = await fetchNutritionReview(client, fakePrincipal, {
      fromIsoDate: "2026-07-01",
      toIsoDate: "2026-07-07",
      utcOffsetMinutes: 120,
    });

    expect(requestedPaths).toEqual([
      "/v1/food-entries/summary?from=2026-07-01&to=2026-07-07&utcOffsetMinutes=120",
    ]);
    expect(result.value).toEqual({
      loggedDays: 2,
      entryCount: 5,
      caloriesKcal: 1500,
      incompleteDays: 0,
    });
    expect(result.error).toBeNull();
  });

  it("asserts exactly 1 request is made for a 31-day month range query, not 31 requests", async () => {
    let requestCount = 0;
    const client: ApiClient = {
      request: <T>(_options: RequestOptions): Promise<Result<T, ApiError>> => {
        requestCount++;
        const summaries: DailyFoodSummary[] = Array.from(
          { length: 31 },
          (_, i) => ({
            date: `2026-07-${String(i + 1).padStart(2, "0")}`,
            entryCount: 2,
            caloriesKcal: 2000,
            proteinG: 150,
            carbohydrateG: 200,
            fatG: 60,
          }),
        );
        return Promise.resolve({
          ok: true,
          value: { summaries } as unknown as T,
        });
      },
      status: () => ({
        configured: true,
        baseUrl: "https://example.test",
        provider: "supabase",
      }),
    };

    const query: NutritionReviewRangeQuery = {
      fromIsoDate: "2026-07-01",
      toIsoDate: "2026-07-31",
      utcOffsetMinutes: 60,
    };
    const result = await fetchNutritionReview(client, fakePrincipal, query);

    expect(requestCount).toBe(1);
    expect(result.value?.loggedDays).toBe(31);
    expect(result.value?.entryCount).toBe(62);
    expect(result.value?.caloriesKcal).toBe(62000);
  });

  it("asserts exactly 1 request is made for a 31-day LocalDayQuery array when range query succeeds", async () => {
    let requestCount = 0;
    const client: ApiClient = {
      request: <T>(_options: RequestOptions): Promise<Result<T, ApiError>> => {
        requestCount++;
        const summaries: DailyFoodSummary[] = Array.from(
          { length: 31 },
          (_, i) => ({
            date: `2026-07-${String(i + 1).padStart(2, "0")}`,
            entryCount: 1,
            caloriesKcal: 1000,
            proteinG: 80,
            carbohydrateG: 100,
            fatG: 30,
          }),
        );
        return Promise.resolve({
          ok: true,
          value: { summaries } as unknown as T,
        });
      },
      status: () => ({
        configured: true,
        baseUrl: "https://example.test",
        provider: "supabase",
      }),
    };

    const days: LocalDayQuery[] = Array.from({ length: 31 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      utcOffsetMinutes: 0,
    }));
    const result = await fetchNutritionReview(client, fakePrincipal, days);

    expect(requestCount).toBe(1);
    expect(result.value?.loggedDays).toBe(31);
  });

  it("falls back to batched execution with bounded concurrency of at most 4 when range query fails", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const requestedPaths: string[] = [];

    const client: ApiClient = {
      request: async <T>(
        options: RequestOptions,
      ): Promise<Result<T, ApiError>> => {
        requestedPaths.push(options.path);
        activeRequests++;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

        // If range query, return 404 to trigger fallback
        if (options.path.includes("from=")) {
          activeRequests--;
          return {
            ok: false,
            error: {
              kind: "http_error",
              status: 404,
              code: "NOT_FOUND",
              message: "Range query not found",
            },
          };
        }

        // Delay slightly to test concurrency
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeRequests--;

        return {
          ok: true,
          value: {
            summary: {
              date: "2026-07-01",
              entryCount: 1,
              caloriesKcal: 200,
              proteinG: 15,
              carbohydrateG: 20,
              fatG: 5,
            },
          } as unknown as T,
        };
      },
      status: () => ({
        configured: true,
        baseUrl: "https://example.test",
        provider: "supabase",
      }),
    };

    const days: LocalDayQuery[] = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      utcOffsetMinutes: 0,
    }));

    const result = await fetchNutritionReview(client, fakePrincipal, days);

    expect(maxActiveRequests).toBeLessThanOrEqual(4);
    expect(maxActiveRequests).toBeGreaterThanOrEqual(1);
    // 1 range query + 10 single-day queries = 11 total requests
    expect(requestedPaths.length).toBe(11);
    expect(requestedPaths[0]).toContain("from=2026-07-01&to=2026-07-10");
    expect(result.value).toEqual({
      loggedDays: 10,
      entryCount: 10,
      caloriesKcal: 2000,
      incompleteDays: 0,
    });
  });

  it("returns error when a batch fails during fallback", async () => {
    let count = 0;
    const client: ApiClient = {
      request: async <T>(
        options: RequestOptions,
      ): Promise<Result<T, ApiError>> => {
        if (options.path.includes("from=")) {
          return {
            ok: false,
            error: {
              kind: "http_error",
              status: 404,
              code: "NOT_FOUND",
              message: "Range query not found",
            },
          };
        }
        count++;
        if (count === 2) {
          return {
            ok: false,
            error: {
              kind: "http_error",
              status: 500,
              code: "SERVER_ERROR",
              message: "boom",
            },
          };
        }
        return {
          ok: true,
          value: {
            summary: {
              date: "2026-07-01",
              entryCount: 1,
              caloriesKcal: 100,
              proteinG: 10,
              carbohydrateG: 10,
              fatG: 2,
            },
          } as unknown as T,
        };
      },
      status: () => ({
        configured: true,
        baseUrl: "https://example.test",
        provider: "supabase",
      }),
    };

    const days: LocalDayQuery[] = [
      { date: "2026-07-01", utcOffsetMinutes: 0 },
      { date: "2026-07-02", utcOffsetMinutes: 0 },
    ];
    const result = await fetchNutritionReview(client, fakePrincipal, days);
    expect(result.value).toBeNull();
    expect(result.error?.kind).toBe("http_error");
  });

  it("returns empty review when given an empty day array without making requests", async () => {
    let called = false;
    const client: ApiClient = {
      request: <T>(_options: RequestOptions): Promise<Result<T, ApiError>> => {
        called = true;
        return Promise.resolve({
          ok: true,
          value: {} as unknown as T,
        });
      },
      status: () => ({
        configured: true,
        baseUrl: "https://example.test",
        provider: "supabase",
      }),
    };

    const result = await fetchNutritionReview(client, fakePrincipal, []);
    expect(called).toBe(false);
    expect(result.value).toEqual({
      loggedDays: 0,
      entryCount: 0,
      caloriesKcal: 0,
      incompleteDays: 0,
    });
    expect(result.error).toBeNull();
  });

  it("returns no_session error when principal is null", async () => {
    const client = fakeClient({ ok: true, value: {} });
    const result = await fetchNutritionReview(client, fakePrincipalNull, [
      { date: "2026-07-14", utcOffsetMinutes: 120 },
    ]);
    expect(result.value).toBeNull();
    expect(result.error?.kind).toBe("no_session");
  });
});

describe("fetchWorkoutCountForPeriod", () => {
  it("returns the count from the list", async () => {
    const list: WorkoutListResponse = {
      workouts: [
        {
          id: "00000000-0000-4000-8000-00000000b001",
          userId: fakePrincipal.userId,
          name: "Leg day",
          startedAt: "2026-07-15T08:00:00.000Z",
          completedAt: "2026-07-15T09:00:00.000Z",
          notes: null,
          source: "manual",
          details: {},
          createdAt: "2026-07-15T08:00:00.000Z",
          updatedAt: "2026-07-15T09:00:00.000Z",
        },
        {
          id: "00000000-4000-4000-8000-00000000b002",
          userId: fakePrincipal.userId,
          name: "Pull day",
          startedAt: "2026-07-13T08:00:00.000Z",
          completedAt: null,
          notes: null,
          source: "manual",
          details: {},
          createdAt: "2026-07-13T08:00:00.000Z",
          updatedAt: "2026-07-13T09:00:00.000Z",
        },
      ],
    };
    const client = fakeClient({ ok: true, value: list });
    const result = await fetchWorkoutCountForPeriod(client, fakePrincipal, {
      fromIsoDate: "2026-07-12",
      toIsoDate: "2026-07-18",
    });
    expect(result.value).toBe(1);
  });

  it("returns zero when the list is empty", async () => {
    const list: WorkoutListResponse = { workouts: [] };
    const client = fakeClient({ ok: true, value: list });
    const result = await fetchWorkoutCountForPeriod(client, fakePrincipal, {
      fromIsoDate: "2026-07-12",
      toIsoDate: "2026-07-18",
    });
    expect(result.value).toBe(0);
  });
});

describe("computeDailyNutritionDisplay (#112)", () => {
  const energy = {
    dailyTargetKcal: 2000,
    targetProteinG: 150,
    targetCarbohydrateG: 200,
    targetFatG: 60,
  } as const;

  it("returns loading state with neutral badge and withheld remaining allowance", () => {
    const result = computeDailyNutritionDisplay({
      summary: null,
      energy: energy as any,
      caloriesToday: null,
      loading: true,
      hasError: false,
    });
    expect(result.status).toBe("loading");
    expect(result.consumedKcal).toBeNull();
    expect(result.targetKcal).toBe(2000);
    expect(result.remainingKcal).toBeNull();
    expect(result.proteinG).toBeNull();
    expect(result.badgeText).toBe("2000 kcal target");
    expect(result.badgeType).toBe("neutral");
    expect(result.hasIncompleteMeals).toBe(false);
  });

  it("returns error state with Unavailable badge", () => {
    const result = computeDailyNutritionDisplay({
      summary: null,
      energy: energy as any,
      caloriesToday: null,
      loading: false,
      hasError: true,
    });
    expect(result.status).toBe("error");
    expect(result.consumedKcal).toBeNull();
    expect(result.badgeText).toBe("Unavailable");
    expect(result.badgeType).toBe("neutral");
  });

  it("returns no_entries state when entryCount is 0, showing 0 consumed and full target allowance", () => {
    const result = computeDailyNutritionDisplay({
      summary: {
        date: "2026-09-21",
        entryCount: 0,
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
      },
      energy: energy as any,
      caloriesToday: null,
      loading: false,
      hasError: false,
    });
    expect(result.status).toBe("no_entries");
    expect(result.consumedKcal).toBe(0);
    expect(result.targetKcal).toBe(2000);
    expect(result.remainingKcal).toBe(2000);
    expect(result.proteinG).toBe(0);
    expect(result.carbohydrateG).toBe(0);
    expect(result.fatG).toBe(0);
    expect(result.badgeText).toBe("2000 kcal left");
    expect(result.badgeType).toBe("normal");
    expect(result.hasIncompleteMeals).toBe(false);
  });

  it("withholds remaining allowance and returns alert badge when calories are unknown", () => {
    const result = computeDailyNutritionDisplay({
      summary: {
        date: "2026-09-21",
        entryCount: 2,
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: 40,
        fatG: null,
      },
      energy: energy as any,
      caloriesToday: null,
      loading: false,
      hasError: false,
    });
    expect(result.status).toBe("incomplete");
    expect(result.consumedKcal).toBeNull();
    expect(result.targetKcal).toBe(2000);
    // Crucial: remainingKcal must be null, never targetKcal - 0!
    expect(result.remainingKcal).toBeNull();
    expect(result.proteinG).toBeNull();
    expect(result.carbohydrateG).toBe(40);
    expect(result.carbohydratePercent).toBe(20);
    expect(result.fatG).toBeNull();
    expect(result.badgeText).toBe("Needs nutrition");
    expect(result.badgeType).toBe("alert");
    expect(result.hasIncompleteMeals).toBe(true);
  });

  it("withholds remaining allowance and returns alert badge when a macro is incomplete even if calories are known", () => {
    const result = computeDailyNutritionDisplay({
      summary: {
        date: "2026-09-21",
        entryCount: 1,
        caloriesKcal: 500,
        proteinG: null, // unknown protein
        carbohydrateG: 60,
        fatG: 15,
      },
      energy: energy as any,
      caloriesToday: 500,
      loading: false,
      hasError: false,
    });
    expect(result.status).toBe("incomplete");
    expect(result.consumedKcal).toBe(500);
    expect(result.remainingKcal).toBeNull();
    expect(result.proteinG).toBeNull();
    expect(result.badgeText).toBe("Needs nutrition");
    expect(result.badgeType).toBe("alert");
    expect(result.hasIncompleteMeals).toBe(true);
  });

  it("accurately computes remaining allowance and macros for confirmed zero intake", () => {
    const result = computeDailyNutritionDisplay({
      summary: {
        date: "2026-09-21",
        entryCount: 1,
        caloriesKcal: 0,
        proteinG: 0,
        carbohydrateG: 0,
        fatG: 0,
      },
      energy: energy as any,
      caloriesToday: 0,
      loading: false,
      hasError: false,
    });
    expect(result.status).toBe("complete");
    expect(result.consumedKcal).toBe(0);
    expect(result.remainingKcal).toBe(2000);
    expect(result.proteinG).toBe(0);
    expect(result.carbohydrateG).toBe(0);
    expect(result.fatG).toBe(0);
    expect(result.badgeText).toBe("2000 kcal left");
    expect(result.badgeType).toBe("normal");
    expect(result.hasIncompleteMeals).toBe(false);
  });

  it("accurately computes remaining allowance and percentages for normal complete intake", () => {
    const result = computeDailyNutritionDisplay({
      summary: {
        date: "2026-09-21",
        entryCount: 3,
        caloriesKcal: 1500,
        proteinG: 120,
        carbohydrateG: 150,
        fatG: 45,
      },
      energy: energy as any,
      caloriesToday: 1500,
      loading: false,
      hasError: false,
    });
    expect(result.status).toBe("complete");
    expect(result.consumedKcal).toBe(1500);
    expect(result.remainingKcal).toBe(500);
    expect(result.kcalPercent).toBe(75);
    expect(result.proteinG).toBe(120);
    expect(result.proteinPercent).toBe(80);
    expect(result.badgeText).toBe("500 kcal left");
    expect(result.badgeType).toBe("normal");
    expect(result.hasIncompleteMeals).toBe(false);
  });

  it("marks over-allowance badge when consumed exceeds target", () => {
    const result = computeDailyNutritionDisplay({
      summary: {
        date: "2026-09-21",
        entryCount: 4,
        caloriesKcal: 2300,
        proteinG: 170,
        carbohydrateG: 220,
        fatG: 70,
      },
      energy: energy as any,
      caloriesToday: 2300,
      loading: false,
      hasError: false,
    });
    expect(result.status).toBe("complete");
    expect(result.consumedKcal).toBe(2300);
    expect(result.remainingKcal).toBe(-300);
    expect(result.kcalPercent).toBe(100);
    expect(result.badgeText).toBe("300 kcal over");
    expect(result.badgeType).toBe("over");
    expect(result.hasIncompleteMeals).toBe(false);
  });
});

describe("DASH-LOAD-001: Historical failure and delay regressions", () => {
  it("preserves fresh today's values and does not let a historical review failure corrupt or revert them", async () => {
    // Simulate: fresh today's meal was logged (850 kcal), but historical range query fails (e.g. 500 server error)
    const todaySummary: DailyFoodSummary = {
      date: "2026-07-15",
      entryCount: 2,
      caloriesKcal: 850,
      proteinG: 65,
      carbohydrateG: 90,
      fatG: 25,
    };

    const failingClient: ApiClient = {
      request: <T>(_options: RequestOptions): Promise<Result<T, ApiError>> => {
        return Promise.resolve({
          ok: false,
          error: {
            kind: "http_error",
            status: 500,
            code: "INTERNAL_ERROR",
            message: "Historical review timeout",
          },
        });
      },
      status: () => ({
        configured: true,
        baseUrl: "https://example.test",
        provider: "supabase",
      }),
    };

    // Historical review fails
    const historicalResult = await fetchNutritionReviewSummaries(
      failingClient,
      fakePrincipal,
      {
        fromIsoDate: "2026-07-01",
        toIsoDate: "2026-07-14",
      },
    );

    expect(historicalResult.error).not.toBeNull();
    expect(historicalResult.value).toBeNull();

    // Verify today's fresh summary is independent and renders complete state
    const todayDisplay = computeDailyNutritionDisplay({
      summary: todaySummary,
      energy: {
        dailyTargetKcal: 2000,
        bmrKcal: 1600,
        tdeeKcal: 2200,
        complete: true,
      } as any,
      caloriesToday: 850,
      loading: false,
      hasError: false, // Today's fetch succeeded independently
    });

    expect(todayDisplay.status).toBe("complete");
    expect(todayDisplay.consumedKcal).toBe(850);
    expect(todayDisplay.remainingKcal).toBe(1150);
    expect(todayDisplay.badgeText).toBe("1150 kcal left");
  });

  it("resolves today's summary immediately without waiting for a delayed historical review", async () => {
    let historicalResolved = false;

    // Simulate fast today summary (instant) and slow historical review (delayed promise)
    const todayPromise = Promise.resolve<DailyFoodSummary>({
      date: "2026-07-15",
      entryCount: 1,
      caloriesKcal: 500,
      proteinG: 40,
      carbohydrateG: 50,
      fatG: 15,
    });

    let resolveHistorical!: (
      val: Result<DailyFoodSummaryListResponse, ApiError>,
    ) => void;
    const delayedHistoricalPromise = new Promise<
      Result<DailyFoodSummaryListResponse, ApiError>
    >((resolve) => {
      resolveHistorical = (val) => {
        historicalResolved = true;
        resolve(val);
      };
    });

    const delayedClient: ApiClient = {
      request: <T>(_options: RequestOptions): Promise<Result<T, ApiError>> => {
        return delayedHistoricalPromise as Promise<Result<T, ApiError>>;
      },
      status: () => ({
        configured: true,
        baseUrl: "https://example.test",
        provider: "supabase",
      }),
    };

    // Trigger historical fetch
    const historicalFetchPromise = fetchNutritionReviewSummaries(
      delayedClient,
      fakePrincipal,
      {
        fromIsoDate: "2026-07-01",
        toIsoDate: "2026-07-14",
      },
    );

    // Today's summary resolves immediately
    const todayVal = await todayPromise;
    expect(todayVal.caloriesKcal).toBe(500);
    // Historical review is still in-flight
    expect(historicalResolved).toBe(false);

    // Now resolve the delayed historical review
    resolveHistorical({
      ok: true,
      value: {
        summaries: [
          {
            date: "2026-07-02",
            entryCount: 1,
            caloriesKcal: 600,
            proteinG: 30,
            carbohydrateG: 70,
            fatG: 20,
          },
        ],
      },
    });

    const historicalVal = await historicalFetchPromise;
    expect(historicalResolved).toBe(true);
    expect(historicalVal.value?.length).toBe(1);

    // Combine them
    const combined = combineNutritionReview(historicalVal.value!, todayVal);
    expect(combined.loggedDays).toBe(2);
    expect(combined.entryCount).toBe(2);
    expect(combined.caloriesKcal).toBe(1100);
  });

  describe("extractFirstEligibleMeal", () => {
    const meal = (
      id: string,
      consumedAt: string,
      overrides: Partial<FoodEntry> = {},
    ): FoodEntry => ({
      id,
      userId: "synthetic-owner",
      name: `Synthetic ${id}`,
      consumedAt,
      caloriesKcal: 200,
      proteinG: 10,
      carbohydrateG: 20,
      fatG: 5,
      details: {},
      source: "manual",
      confidence: null,
      confirmedByUser: true,
      createdAt: consumedAt,
      updatedAt: consumedAt,
      ...overrides,
    });

    it("selects breakfast rather than the evening meal from descending or shuffled history", () => {
      const breakfast = meal("breakfast", "2026-10-06T06:30:00Z");
      const lunch = meal("lunch", "2026-10-06T11:00:00Z");
      const evening = meal("evening", "2026-10-06T18:01:00Z");

      expect(extractFirstEligibleMeal([evening, lunch, breakfast])).toBe(
        breakfast,
      );
      expect(extractFirstEligibleMeal([lunch, breakfast, evening])).toBe(
        breakfast,
      );
    });

    it("uses consumption time when an earlier meal was logged later", () => {
      const breakfast = meal("breakfast", "2026-10-06T06:30:00Z", {
        createdAt: "2026-10-06T20:00:00Z",
      });
      const lunch = meal("lunch", "2026-10-06T11:00:00Z", {
        createdAt: "2026-10-06T11:05:00Z",
      });

      expect(extractFirstEligibleMeal([lunch, breakfast])).toBe(breakfast);
    });

    it("skips blank names and invalid consumption times before selecting the earliest eligible meal", () => {
      const breakfast = meal("breakfast", "2026-10-06T06:30:00Z");
      const entries = [
        meal("invalid-time", "not-a-date"),
        meal("blank-name", "2026-10-06T05:00:00Z", { name: "   " }),
        meal("evening", "2026-10-06T18:01:00Z"),
        breakfast,
      ];

      expect(extractFirstEligibleMeal(entries)).toBe(breakfast);
      expect(extractFirstEligibleMeal(entries.slice(0, 2))).toBeNull();
    });

    it("returns null when entries array is empty", () => {
      expect(extractFirstEligibleMeal([])).toBeNull();
    });

    it("returns null when all entries have empty names", () => {
      expect(
        extractFirstEligibleMeal([
          {
            id: "1",
            userId: "u1",
            name: "   ",
            consumedAt: "2026-09-23T08:00:00Z",
            caloriesKcal: 200,
            proteinG: 10,
            carbohydrateG: 20,
            fatG: 5,
            details: {},
            source: "manual",
            confidence: null,
            confirmedByUser: true,
            createdAt: "2026-09-23T08:00:00Z",
            updatedAt: "2026-09-23T08:00:00Z",
          },
        ]),
      ).toBeNull();
    });

    it("returns first meal with valid name", () => {
      const meal: FoodEntry = {
        id: "2",
        userId: "u1",
        name: "Oatmeal",
        consumedAt: "2026-09-23T08:00:00Z",
        caloriesKcal: 350,
        proteinG: 15,
        carbohydrateG: 50,
        fatG: 6,
        details: {},
        source: "manual",
        confidence: null,
        confirmedByUser: true,
        createdAt: "2026-09-23T08:00:00Z",
        updatedAt: "2026-09-23T08:00:00Z",
      };
      expect(extractFirstEligibleMeal([meal])).toBe(meal);
    });
  });
});

describe("computeDailyNutritionDisplay protein range (#293)", () => {
  const energy = {
    dailyTargetKcal: 2000,
    targetProteinG: 140,
    targetCarbohydrateG: 200,
    targetFatG: 60,
    inputs: { weightKg: 70, goalKind: "cut" },
  };
  const summary = (proteinG: number | null) => ({
    date: "2026-10-17",
    entryCount: 2,
    caloriesKcal: 900,
    proteinG,
    carbohydrateG: 100,
    fatG: 30,
  });

  it("is building below the lower end of the range", () => {
    const result = computeDailyNutritionDisplay({
      summary: summary(60),
      energy: energy as any,
      caloriesToday: 900,
      loading: false,
      hasError: false,
    });
    expect(result.proteinStatus).toBe("building");
    expect(result).not.toHaveProperty("proteinRangeLowG");
  });

  it("is in range from the lower end, before the full target", () => {
    const result = computeDailyNutritionDisplay({
      summary: summary(115),
      energy: energy as any,
      caloriesToday: 900,
      loading: false,
      hasError: false,
    });
    expect(result.proteinStatus).toBe("in_range");
  });

  it("keeps unknown protein unknown instead of a deficit", () => {
    const result = computeDailyNutritionDisplay({
      summary: summary(null),
      energy: energy as any,
      caloriesToday: 900,
      loading: false,
      hasError: false,
    });
    expect(result.proteinG).toBeNull();
    expect(result.proteinStatus).toBe("unknown");
  });

  it("treats protein below target as building without a confirmed weight", () => {
    const result = computeDailyNutritionDisplay({
      summary: summary(60),
      energy: { ...energy, inputs: { weightKg: null, goalKind: "cut" } } as any,
      caloriesToday: 900,
      loading: false,
      hasError: false,
    });
    expect(result.proteinStatus).toBe("building");
  });

  it("is unknown while loading or after a failed read", () => {
    for (const state of [
      { loading: true, hasError: false },
      { loading: false, hasError: true },
    ]) {
      const result = computeDailyNutritionDisplay({
        summary: null,
        energy: energy as any,
        caloriesToday: null,
        ...state,
      });
      expect(result.proteinStatus).toBe("unknown");
    }
  });
});

const boulderSession = (
  activityDate: string,
  completedAt: string | null = `${activityDate}T10:00:00.000Z`,
): BoulderSessionRecord => ({
  id: "33333333-3333-4333-8333-333333333333",
  clientOperationId: "11111111-1111-4111-8111-111111111111",
  name: "Bouldering",
  notes: null,
  startedAt: `${activityDate}T08:00:00.000Z`,
  completedAt,
  session: {
    version: 1,
    gradeScale: "font",
    recordingTimezone: "Europe/Bratislava",
    activityDate,
    gymName: null,
  },
  summary: {
    boulders: 4,
    sends: 3,
    flashes: 1,
    attempts: 7,
    attemptsComplete: true,
    topGrade: "6C",
  },
});
const boulderList = (
  ...sessions: BoulderSessionRecord[]
): BoulderSessionListResponse => ({ sessions, nextCursor: null });

describe("fetchBoulderSessionCountForPeriod", () => {
  const range = { fromIsoDate: "2026-10-26", toIsoDate: "2026-10-30" };

  it("counts finished sessions whose activity date is in the period", async () => {
    const client = fakeClient({
      ok: true,
      value: boulderList(
        boulderSession("2026-10-30"),
        boulderSession("2026-10-27"),
        boulderSession("2026-10-29", null),
        boulderSession("2026-10-20"),
      ),
    });
    const result = await fetchBoulderSessionCountForPeriod(
      client,
      fakePrincipal,
      range,
    );
    expect(result).toEqual({ value: 2, error: null });
  });

  it("reads the existing session history route", async () => {
    const paths: string[] = [];
    const client: ApiClient = {
      ...fakeClient({ ok: true, value: boulderList() }),
      request: <T>(options: RequestOptions) => {
        paths.push(options.path);
        return Promise.resolve({
          ok: true,
          value: boulderList(),
        } as Result<T, ApiError>);
      },
    };
    await fetchBoulderSessionCountForPeriod(client, fakePrincipal, range);
    expect(paths).toEqual(["/v1/bouldering/sessions?limit=50"]);
  });

  it("reports a failed read instead of a zero", async () => {
    const error: ApiError = { kind: "network_error", cause: "offline" };
    const result = await fetchBoulderSessionCountForPeriod(
      fakeClient({ ok: false, error }),
      fakePrincipal,
      range,
    );
    expect(result).toEqual({ value: null, error });
  });

  it("counts zero where the server has bouldering switched off", async () => {
    const result = await fetchBoulderSessionCountForPeriod(
      fakeClient({
        ok: false,
        error: {
          kind: "http_error",
          status: 404,
          code: "FEATURE_DISABLED",
          message: "off",
        },
      }),
      fakePrincipal,
      range,
    );
    expect(result).toEqual({ value: 0, error: null });
  });

  it("reports an unreadable list as a failed read, not an empty count", async () => {
    const result = await fetchBoulderSessionCountForPeriod(
      fakeClient({ ok: true, value: { sessions: "nope" } }),
      fakePrincipal,
      range,
    );
    expect(result.value).toBeNull();
    expect(result.error?.kind).toBe("parse_error");
  });

  it("returns the no-session error without a principal", async () => {
    const result = await fetchBoulderSessionCountForPeriod(
      fakeClient({ ok: true, value: boulderList() }),
      null,
      range,
    );
    expect(result.error?.kind).toBe("no_session");
  });
});

describe("combineTrainingCounts", () => {
  const ok = (value: number) => ({ value, error: null });
  const failure = {
    value: null,
    error: { kind: "network_error", cause: "offline" } as ApiError,
  };

  it("adds climbing sessions to workouts", () => {
    expect(combineTrainingCounts(ok(2), ok(3))).toEqual(ok(5));
  });

  it("keeps the workout count where bouldering is off", () => {
    expect(combineTrainingCounts(ok(2), null)).toEqual(ok(2));
  });

  it("withholds the total when the climbing read fails", () => {
    expect(combineTrainingCounts(ok(2), failure)).toEqual(failure);
  });

  it("withholds the total when the workout read fails", () => {
    expect(combineTrainingCounts(failure, ok(3))).toEqual(failure);
  });
});

describe("readDashboardSnapshot training count", () => {
  const query = {
    date: "2026-10-30",
    fromIsoDate: "2026-10-26",
    toIsoDate: "2026-10-29",
    utcOffsetMinutes: 0,
  };
  const workoutList: WorkoutListResponse = { workouts: [] };
  const peekWith =
    (reads: Record<string, unknown>) =>
    <T>(options: RequestOptions): Result<T, ApiError> | null => {
      const key = Object.keys(reads).find((path) =>
        options.path.startsWith(path),
      );
      return key === undefined
        ? null
        : ({ ok: true, value: reads[key] } as Result<T, ApiError>);
    };

  it("adds saved climbing sessions when bouldering is on", () => {
    const snapshot = readDashboardSnapshot(
      peekWith({
        "/v1/workouts": workoutList,
        "/v1/bouldering/sessions": boulderList(boulderSession("2026-10-28")),
      }),
      { ...query, boulderingEnabled: true },
    );
    expect(snapshot.workouts?.value).toBe(1);
  });

  it("keeps the older save time and never invents one", () => {
    const saved = (value: unknown, savedAt?: number) => ({
      ok: true as const,
      value,
      ...(savedAt === undefined ? {} : { savedAt }),
    });
    const reads = (workoutAt?: number, boulderAt?: number) =>
      readDashboardSnapshot(
        <T>(options: RequestOptions) =>
          (options.path.startsWith("/v1/workouts")
            ? saved(workoutList, workoutAt)
            : options.path.startsWith("/v1/bouldering/sessions")
              ? saved(boulderList(), boulderAt)
              : null) as Result<T, ApiError> | null,
        { ...query, boulderingEnabled: true },
      ).workouts;
    expect(reads(undefined, undefined)?.savedAt).toBeUndefined();
    expect(reads(500, 300)?.savedAt).toBe(300);
    expect(reads(500, undefined)?.savedAt).toBe(500);
  });

  it("waits for the saved climbing read instead of showing a partial count", () => {
    const snapshot = readDashboardSnapshot(
      peekWith({ "/v1/workouts": workoutList }),
      { ...query, boulderingEnabled: true },
    );
    expect(snapshot.workouts).toBeNull();
  });

  it("ignores climbing sessions where bouldering is off", () => {
    const snapshot = readDashboardSnapshot(
      peekWith({
        "/v1/workouts": workoutList,
        "/v1/bouldering/sessions": boulderList(boulderSession("2026-10-28")),
      }),
      query,
    );
    expect(snapshot.workouts?.value).toBe(0);
  });
});
