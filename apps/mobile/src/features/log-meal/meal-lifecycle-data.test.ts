import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { FoodEntry } from "@mizyun/contracts";
import type { Result } from "@mizyun/core";

import {
  copyFoodEntryWith,
  deleteFoodEntryWith,
  fetchFoodDayWith,
  fetchFoodEntryWith,
  fetchFoodHistoryWith,
  groupFoodEntriesByDay,
  updateFoodEntryWith,
} from "./meal-lifecycle-data";

const NOW = new Date("2026-07-19T10:15:00.000Z");
const ENTRY: FoodEntry = {
  id: "00000000-0000-4000-8000-000000000001",
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
};

const queuedClient = (
  results: Array<Result<unknown, ApiError>>,
  requests: RequestOptions[] = [],
): ApiClient => ({
  request: <T>(options: RequestOptions): Promise<Result<T, ApiError>> => {
    requests.push(options);
    const result = results.shift();
    if (result === undefined) throw new Error("missing queued response");
    return Promise.resolve(result as Result<T, ApiError>);
  },
  status: () => ({
    configured: true,
    baseUrl: "https://example.test",
    provider: "supabase",
  }),
});

describe("fetchFoodDayWith", () => {
  it("loads the daily list and authoritative totals together", async () => {
    const requests: RequestOptions[] = [];
    const result = await fetchFoodDayWith(
      queuedClient(
        [
          { ok: true, value: { foodEntries: [ENTRY] } },
          {
            ok: true,
            value: {
              summary: {
                date: "2026-07-19",
                entryCount: 1,
                caloriesKcal: 200,
                proteinG: 5,
                carbohydrateG: 30,
                fatG: 4,
              },
            },
          },
        ],
        requests,
      ),
      "2026-07-19",
      120,
    );
    expect(result.entries).toEqual([ENTRY]);
    expect(result.summary?.caloriesKcal).toBe(200);
    expect(result.message).toBeNull();
    expect(requests.map((request) => request.path)).toEqual([
      "/v1/food-entries?from=2026-07-19&to=2026-07-19&utcOffsetMinutes=120&limit=200",
      "/v1/food-entries/summary?date=2026-07-19&utcOffsetMinutes=120",
    ]);
  });

  it("returns a retryable message when either request fails", async () => {
    const result = await fetchFoodDayWith(
      queuedClient([
        {
          ok: false,
          error: { kind: "network_error", cause: new Error("offline") },
        },
        { ok: true, value: { summary: null } },
      ]),
      "2026-07-19",
    );
    expect(result.entries).toEqual([]);
    expect(result.message).toMatch(/Network unavailable/);
  });
});

describe("food entry lifecycle mutations", () => {
  it("fetches one entry through the response contract", async () => {
    const result = await fetchFoodEntryWith(
      queuedClient([{ ok: true, value: { foodEntry: ENTRY } }]),
      ENTRY.id,
    );
    expect(result).toEqual({ ok: true, entry: ENTRY });
  });

  it("updates nullable nutrition fields and trims the name", async () => {
    const requests: RequestOptions[] = [];
    const result = await updateFoodEntryWith(
      queuedClient(
        [{ ok: true, value: { foodEntry: { ...ENTRY, name: "Toast 2" } } }],
        requests,
      ),
      ENTRY.id,
      {
        name: " Toast 2 ",
        consumedAt: ENTRY.consumedAt,
        caloriesKcal: null,
        proteinG: 6,
        carbohydrateG: 30,
        fatG: 4,
      },
    );
    expect(result).toEqual({ ok: true, id: ENTRY.id });
    expect(requests[0]).toMatchObject({
      method: "PUT",
      path: `/v1/food-entries/${ENTRY.id}`,
      body: { name: "Toast 2", caloriesKcal: null, proteinG: 6 },
    });
  });

  it("deletes through the empty 204 success path", async () => {
    const requests: RequestOptions[] = [];
    const result = await deleteFoodEntryWith(
      queuedClient([{ ok: true, value: undefined }], requests),
      ENTRY.id,
    );
    expect(result).toEqual({ ok: true });
    expect(requests[0]).toMatchObject({
      method: "DELETE",
      path: `/v1/food-entries/${ENTRY.id}`,
    });
  });

  it("copies the snapshot with a new consumed-at instant", async () => {
    const requests: RequestOptions[] = [];
    const result = await copyFoodEntryWith(
      queuedClient([{ ok: true, value: { foodEntry: ENTRY } }], requests),
      ENTRY,
      () => new Date("2026-07-19T12:00:00.000Z"),
    );
    expect(result).toEqual({ ok: true });
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/food-entries",
      body: {
        name: "Toast",
        consumedAt: "2026-07-19T12:00:00.000Z",
        caloriesKcal: 200,
      },
    });
  });
});

describe("groupFoodEntriesByDay", () => {
  const referenceDate = new Date("2026-07-19T14:00:00.000Z");

  it("returns an empty array when no entries are given", () => {
    expect(groupFoodEntriesByDay([], referenceDate)).toEqual([]);
  });

  it("groups entries by day with calculated totals and human-friendly display dates", () => {
    const entryToday1: FoodEntry = {
      ...ENTRY,
      id: "00000000-0000-4000-8000-000000000001",
      name: "Breakfast Eggs",
      consumedAt: "2026-07-19T08:00:00.000Z",
      caloriesKcal: 350,
      proteinG: 25,
      carbohydrateG: 5,
      fatG: 22,
    };
    const entryToday2: FoodEntry = {
      ...ENTRY,
      id: "00000000-0000-4000-8000-000000000002",
      name: "Lunch Bowl",
      consumedAt: "2026-07-19T12:30:00.000Z",
      caloriesKcal: 650,
      proteinG: 45,
      carbohydrateG: 70,
      fatG: 18,
    };
    const entryYesterday: FoodEntry = {
      ...ENTRY,
      id: "00000000-0000-4000-8000-000000000003",
      name: "Dinner Steak",
      consumedAt: "2026-07-18T19:00:00.000Z",
      caloriesKcal: 800,
      proteinG: 60,
      carbohydrateG: 20,
      fatG: 40,
    };
    const entryPast: FoodEntry = {
      ...ENTRY,
      id: "00000000-0000-4000-8000-000000000004",
      name: "Protein Shake",
      consumedAt: "2026-07-15T15:00:00.000Z",
      caloriesKcal: 200,
      proteinG: 30,
      carbohydrateG: 10,
      fatG: 3,
    };

    const groups = groupFoodEntriesByDay(
      [entryToday1, entryYesterday, entryToday2, entryPast],
      referenceDate,
    );

    expect(groups).toHaveLength(3);

    // Group 1: Today (2026-07-19)
    expect(groups[0]?.date).toBe("2026-07-19");
    expect(groups[0]?.displayDate).toMatch(/Today · /);
    expect(groups[0]?.summary).toEqual({
      entryCount: 2,
      caloriesKcal: 1000,
      proteinG: 70,
      carbohydrateG: 75,
      fatG: 40,
    });
    expect(groups[0]?.entries[0]?.id).toBe(entryToday2.id); // Sorted newest first
    expect(groups[0]?.entries[1]?.id).toBe(entryToday1.id);

    // Group 2: Yesterday (2026-07-18)
    expect(groups[1]?.date).toBe("2026-07-18");
    expect(groups[1]?.displayDate).toMatch(/Yesterday · /);
    expect(groups[1]?.summary).toEqual({
      entryCount: 1,
      caloriesKcal: 800,
      proteinG: 60,
      carbohydrateG: 20,
      fatG: 40,
    });

    // Group 3: Past day (2026-07-15)
    expect(groups[2]?.date).toBe("2026-07-15");
    expect(groups[2]?.displayDate).toMatch(/Jul 15/);
    expect(groups[2]?.summary).toEqual({
      entryCount: 1,
      caloriesKcal: 200,
      proteinG: 30,
      carbohydrateG: 10,
      fatG: 3,
    });
  });

  it("handles entries with null calories and macros gracefully", () => {
    const entryWithoutMacros: FoodEntry = {
      ...ENTRY,
      id: "00000000-0000-4000-8000-000000000005",
      name: "Apple",
      consumedAt: "2026-07-19T10:00:00.000Z",
      caloriesKcal: null,
      proteinG: null,
      carbohydrateG: null,
      fatG: null,
    };

    const groups = groupFoodEntriesByDay([entryWithoutMacros], referenceDate);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.summary).toEqual({
      entryCount: 1,
      caloriesKcal: null,
      proteinG: null,
      carbohydrateG: null,
      fatG: null,
    });
  });
});

describe("fetchFoodHistoryWith", () => {
  it("fetches all entries and groups them by day", async () => {
    const requests: RequestOptions[] = [];
    const result = await fetchFoodHistoryWith(
      queuedClient(
        [
          {
            ok: true,
            value: {
              foodEntries: [
                {
                  ...ENTRY,
                  id: "00000000-0000-4000-8000-000000000001",
                  consumedAt: "2026-07-19T12:00:00.000Z",
                },
                {
                  ...ENTRY,
                  id: "00000000-0000-4000-8000-000000000002",
                  consumedAt: "2026-07-18T12:00:00.000Z",
                },
              ],
            },
          },
        ],
        requests,
      ),
      120,
      new Date("2026-07-19T14:00:00.000Z"),
    );

    expect(requests[0]?.path).toBe("/v1/food-entries?limit=200");
    expect(result.message).toBeNull();
    expect(result.entries).toHaveLength(2);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.date).toBe("2026-07-19");
    expect(result.groups[1]?.date).toBe("2026-07-18");
  });

  it("returns error message when network request fails", async () => {
    const result = await fetchFoodHistoryWith(
      queuedClient([
        {
          ok: false,
          error: { kind: "network_error", cause: new Error("offline") },
        },
      ]),
    );

    expect(result.groups).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.message).toMatch(/Network unavailable/);
  });
});
