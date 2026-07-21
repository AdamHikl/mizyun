import { describe, expect, it } from "vitest";

import type {
  DailyFoodSummaryResponse,
  BodyMeasurementListResponse,
  EnergySummaryResponse,
  WorkoutListResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";

import {
  fetchDailySummary,
  fetchEnergySummary,
  fetchLatestWeight,
  fetchNutritionReview,
  fetchWorkoutCountForPeriod,
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

describe("fetchNutritionReview", () => {
  it("aggregates complete local-day summaries", async () => {
    const result = await fetchNutritionReview(
      fakeClientSequence([
        {
          ok: true,
          value: {
            summary: {
              date: "2026-07-14",
              entryCount: 2,
              caloriesKcal: 900,
              proteinG: 50,
              carbohydrateG: 100,
              fatG: 30,
            },
          },
        },
        {
          ok: true,
          value: {
            summary: {
              date: "2026-07-15",
              entryCount: 0,
              caloriesKcal: 0,
              proteinG: 0,
              carbohydrateG: 0,
              fatG: 0,
            },
          },
        },
      ]),
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
          summary: {
            date: "2026-07-14",
            entryCount: 1,
            caloriesKcal: null,
            proteinG: null,
            carbohydrateG: null,
            fatG: null,
          },
        },
      }),
      fakePrincipal,
      [{ date: "2026-07-14", utcOffsetMinutes: 120 }],
    );
    expect(result.value?.caloriesKcal).toBeNull();
    expect(result.value?.incompleteDays).toBe(1);
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
