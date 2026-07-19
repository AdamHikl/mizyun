import { describe, expect, it } from "vitest";

import type {
  DailyFoodSummaryResponse,
  BodyMeasurementListResponse,
  WorkoutListResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";

import {
  fetchDailySummary,
  fetchLatestWeight,
  fetchWorkoutCountThisWeek,
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

describe("fetchWorkoutCountThisWeek", () => {
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
          completedAt: "2026-07-13T09:00:00.000Z",
          notes: null,
          source: "manual",
          details: {},
          createdAt: "2026-07-13T08:00:00.000Z",
          updatedAt: "2026-07-13T09:00:00.000Z",
        },
      ],
    };
    const client = fakeClient({ ok: true, value: list });
    const result = await fetchWorkoutCountThisWeek(client, fakePrincipal, {
      fromIsoDate: "2026-07-12",
      toIsoDate: "2026-07-18",
    });
    expect(result.value).toBe(2);
  });

  it("returns zero when the list is empty", async () => {
    const list: WorkoutListResponse = { workouts: [] };
    const client = fakeClient({ ok: true, value: list });
    const result = await fetchWorkoutCountThisWeek(client, fakePrincipal, {
      fromIsoDate: "2026-07-12",
      toIsoDate: "2026-07-18",
    });
    expect(result.value).toBe(0);
  });
});
