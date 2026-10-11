import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { FoodEntry } from "@mizyun/contracts";
import type { Result } from "@mizyun/core";

import {
  clusterDayEntries,
  copyFoodEntryWith,
  deleteFoodEntryWith,
  fetchFoodDayWith,
  fetchFoodEntryWith,
  fetchFoodHistoryWith,
  fetchFoodDateHistoryWith,
  groupFoodEntriesByDay,
  groupFoodEntriesWith,
  mergeFoodEntries,
  renameFoodGroupWith,
  ungroupFoodEntryWith,
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

  it("sends and preserves AI calculationText and aiDraft in details", async () => {
    const requests: RequestOptions[] = [];
    const calculation = "Bread 80g: 210 kcal. Butter 10g: 72 kcal.";
    const result = await updateFoodEntryWith(
      queuedClient(
        [
          {
            ok: true,
            value: {
              foodEntry: {
                ...ENTRY,
                details: {
                  calculationText: calculation,
                  aiDraft: {
                    name: "Toast with butter",
                    caloriesKcal: 282,
                    proteinG: 7,
                    carbohydrateG: 38,
                    fatG: 11,
                    confidence: 0.9,
                    warnings: [],
                    assumptions: [],
                    calculation,
                    userConfirmed: true,
                    provenance: {
                      inputKind: "text",
                      provider: "logged-meal",
                      model: "logged-refine",
                      promptVersion: "refine-logged-v1",
                    },
                  },
                },
              },
            },
          },
        ],
        requests,
      ),
      ENTRY.id,
      {
        name: "Toast with butter",
        consumedAt: ENTRY.consumedAt,
        caloriesKcal: 282,
        proteinG: 7,
        carbohydrateG: 38,
        fatG: 11,
        details: {
          calculationText: calculation,
          aiDraft: {
            name: "Toast with butter",
            caloriesKcal: 282,
            proteinG: 7,
            carbohydrateG: 38,
            fatG: 11,
            confidence: 0.9,
            warnings: [],
            assumptions: [],
            calculation,
            userConfirmed: true,
            provenance: {
              inputKind: "text",
              provider: "logged-meal",
              model: "logged-refine",
              promptVersion: "refine-logged-v1",
            },
          },
        },
      },
    );
    expect(result).toEqual({ ok: true, id: ENTRY.id });
    expect(requests[0]?.body).toMatchObject({
      details: {
        calculationText: calculation,
        aiDraft: {
          calculation,
        },
      },
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

  it("replays a retained copy payload without changing its operation or consumed instant", async () => {
    const requests: RequestOptions[] = [];
    const payload = {
      clientOperationId: "00000000-0000-4000-8000-000000000123",
      name: "Original breakfast",
      consumedAt: "2026-07-19T08:00:00.000Z",
      caloriesKcal: 200,
      details: { note: "original" },
    };
    await copyFoodEntryWith(
      queuedClient([{ ok: true, value: { foodEntry: ENTRY } }], requests),
      { ...ENTRY, name: "Edited breakfast" },
      () => new Date("2026-07-20T12:00:00.000Z"),
      false,
      { payload, expectedUserId: "synthetic-copy-owner" },
    );
    expect(requests[0]?.body).toEqual(payload);
    expect(requests[0]?.expectedUserId).toBe("synthetic-copy-owner");
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
  it("preserves original offline read time for display-only reminder decisions", async () => {
    const time = new Date("2026-10-09T12:00:00Z").getTime();
    const client: ApiClient = {
      status: () => ({ configured: false, reason: "synthetic" }),
      request: async <T>() => ({
        ok: true as const,
        value: { foodEntries: [] } as T,
        savedAt: time,
      }),
    };
    expect((await fetchFoodHistoryWith(client)).savedAt).toBe(time);
  });
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

    expect(requests[0]?.path).toBe(
      "/v1/food-entries?limit=200&utcOffsetMinutes=120",
    );
    expect(result.message).toBeNull();
    expect(result.entries).toHaveLength(2);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.date).toBe("2026-07-19");
    expect(result.groups[1]?.date).toBe("2026-07-18");
  });

  it("passes cursor and search in query string and flags cutoffDateIsPartial", async () => {
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
                  id: "entry-1",
                  name: "Lentil soup",
                  consumedAt: "2026-07-15T12:00:00.000Z",
                },
              ],
              nextCursor: "next-cursor-token",
              cutoffDateIsPartial: true,
            },
          },
        ],
        requests,
      ),
      60,
      new Date("2026-07-19T14:00:00.000Z"),
      {
        cursor: "cursor-123",
        search: "lentil",
        limit: 50,
      },
    );

    expect(requests[0]?.path).toBe(
      "/v1/food-entries?limit=50&utcOffsetMinutes=60&cursor=cursor-123&search=lentil",
    );
    expect(result.nextCursor).toBe("next-cursor-token");
    expect(result.cutoffDateIsPartial).toBe(true);
    expect(result.groups[0]?.isPartial).toBe(true);
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

describe("mergeFoodEntries", () => {
  it("merges existing and incoming entries without duplicates and preserves descending order", () => {
    const existing = [
      {
        ...ENTRY,
        id: "entry-1",
        consumedAt: "2026-07-19T18:00:00.000Z",
      },
      {
        ...ENTRY,
        id: "entry-2",
        consumedAt: "2026-07-19T12:00:00.000Z",
      },
    ];
    const incoming = [
      {
        ...ENTRY,
        id: "entry-2",
        name: "Updated Entry 2",
        consumedAt: "2026-07-19T12:00:00.000Z",
      },
      {
        ...ENTRY,
        id: "entry-3",
        consumedAt: "2026-07-18T08:00:00.000Z",
      },
    ];

    const merged = mergeFoodEntries(existing, incoming);
    expect(merged).toHaveLength(3);
    expect(merged[0]?.id).toBe("entry-1");
    expect(merged[1]?.id).toBe("entry-2");
    expect(merged[1]?.name).toBe("Updated Entry 2");
    expect(merged[2]?.id).toBe("entry-3");
  });
});

describe("clusterDayEntries", () => {
  const item1: FoodEntry = {
    ...ENTRY,
    id: "entry-1",
    name: "Eggs",
    caloriesKcal: 150,
    proteinG: 12,
    carbohydrateG: 1,
    fatG: 10,
    details: {
      mealGroup: { id: "group-breakfast", name: "Breakfast" },
    },
  };

  const item2: FoodEntry = {
    ...ENTRY,
    id: "entry-2",
    name: "Toast",
    caloriesKcal: 120,
    proteinG: 4,
    carbohydrateG: 22,
    fatG: 1.5,
    details: {
      mealGroup: { id: "group-breakfast", name: "Breakfast" },
    },
  };

  const item3: FoodEntry = {
    ...ENTRY,
    id: "entry-3",
    name: "Apple",
    caloriesKcal: 80,
    proteinG: 0.5,
    carbohydrateG: 20,
    fatG: 0.2,
    details: {},
  };

  it("clusters grouped meals and preserves standalone meals", () => {
    const items = [item1, item2, item3];
    const clusters = clusterDayEntries(items);

    expect(clusters).toHaveLength(2);

    // First item is the Breakfast cluster
    const cluster = clusters[0];
    expect(cluster?.kind).toBe("group");
    if (cluster?.kind === "group") {
      expect(cluster.id).toBe("group-breakfast");
      expect(cluster.name).toBe("Breakfast");
      expect(cluster.entries).toHaveLength(2);
      expect(cluster.summary.entryCount).toBe(2);
      expect(cluster.summary.caloriesKcal).toBe(270);
      expect(cluster.summary.proteinG).toBe(16);
      expect(cluster.summary.carbohydrateG).toBe(23);
      expect(cluster.summary.fatG).toBe(11.5);
    }

    // Second item is standalone Apple
    const standalone = clusters[1];
    expect(standalone?.kind).toBe("standalone");
    if (standalone?.kind === "standalone") {
      expect(standalone.entry.id).toBe("entry-3");
      expect(standalone.entry.name).toBe("Apple");
    }
  });
});

describe("groupFoodEntriesWith", () => {
  it("groups selected meals into a new meal group", async () => {
    const requests: RequestOptions[] = [];
    const client = queuedClient(
      [
        { ok: true, value: { foodEntry: { ...ENTRY, id: "entry-1" } } },
        { ok: true, value: { foodEntry: { ...ENTRY, id: "entry-2" } } },
      ],
      requests,
    );

    const entry1: FoodEntry = { ...ENTRY, id: "entry-1", name: "Eggs" };
    const entry2: FoodEntry = { ...ENTRY, id: "entry-2", name: "Toast" };

    const result = await groupFoodEntriesWith(
      client,
      ["entry-1", "entry-2"],
      "Power Breakfast",
      [entry1, entry2],
      "fixed-group-id",
    );

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.path).toBe("/v1/food-entries/entry-1");
    expect(requests[1]?.path).toBe("/v1/food-entries/entry-2");
    expect(
      (requests[0]?.body as { details?: Record<string, unknown> }).details,
    ).toMatchObject({
      mealGroupId: "fixed-group-id",
      mealGroupName: "Power Breakfast",
    });
  });

  it("fails if meal group name is empty", async () => {
    const client = queuedClient([]);
    const result = await groupFoodEntriesWith(client, ["e1"], "   ", [ENTRY]);
    expect(result).toEqual({
      ok: false,
      message: "Please enter a meal name.",
    });
  });
});

describe("ungroupFoodEntryWith & renameFoodGroupWith", () => {
  it("ungroups a meal by clearing its mealGroup details", async () => {
    const requests: RequestOptions[] = [];
    const client = queuedClient(
      [{ ok: true, value: { foodEntry: ENTRY } }],
      requests,
    );

    const groupedEntry: FoodEntry = {
      ...ENTRY,
      details: {
        mealGroup: { id: "g1", name: "Breakfast" },
      },
    };

    const result = await ungroupFoodEntryWith(client, groupedEntry);
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    const body = requests[0]?.body as { details?: Record<string, unknown> };
    expect(body.details?.mealGroup).toBeUndefined();
    expect(body.details?.mealGroupId).toBeUndefined();
  });

  it("renames a meal group across all entries", async () => {
    const requests: RequestOptions[] = [];
    const client = queuedClient(
      [
        { ok: true, value: { foodEntry: ENTRY } },
        { ok: true, value: { foodEntry: ENTRY } },
      ],
      requests,
    );

    const grouped1: FoodEntry = {
      ...ENTRY,
      id: "e1",
      details: { mealGroup: { id: "g1", name: "Old Breakfast" } },
    };
    const grouped2: FoodEntry = {
      ...ENTRY,
      id: "e2",
      details: { mealGroup: { id: "g1", name: "Old Breakfast" } },
    };

    const result = await renameFoodGroupWith(
      client,
      [grouped1, grouped2],
      "New Brunch",
    );
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    const body1 = requests[0]?.body as { details?: Record<string, unknown> };
    expect(body1.details?.mealGroupName).toBe("New Brunch");
  });
});

it("manual copies do not inherit the automatic occurrence marker", async () => {
  const requests: RequestOptions[] = [];
  await copyFoodEntryWith(
    queuedClient([{ ok: true, value: { foodEntry: ENTRY } }], requests),
    {
      ...ENTRY,
      details: {
        recurringMeal: {
          scheduleId: "schedule",
          localDate: "2026-10-03",
          timeZone: "UTC",
        },
        calculationText: "Saved calculation",
      },
    },
  );
  expect(
    (requests[0]?.body as { details: Record<string, unknown> }).details,
  ).toEqual({ calculationText: "Saved calculation" });
});

describe("refreshing a selected historical day", () => {
  it("uses exact local day bounds and follows pagination", async () => {
    const requests: RequestOptions[] = [];
    const date = "2026-03-29";
    const past = {
      ...ENTRY,
      consumedAt: new Date(2026, 2, 29, 12).toISOString(),
    };
    const result = await fetchFoodDateHistoryWith(
      queuedClient(
        [
          {
            ok: true,
            value: {
              foodEntries: [
                past,
                {
                  ...past,
                  id: "before",
                  consumedAt: new Date(
                    new Date(2026, 2, 29).getTime() - 1,
                  ).toISOString(),
                },
                {
                  ...past,
                  id: "after",
                  consumedAt: new Date(2026, 2, 30).toISOString(),
                },
              ],
              nextCursor: "second",
            },
          },
          {
            ok: true,
            value: {
              foodEntries: [{ ...past, id: "added" }],
              nextCursor: null,
            },
          },
        ],
        requests,
      ),
      date,
      new Date(2026, 9, 4),
    );
    expect(result.entries).toHaveLength(2);
    const query = new URL(requests[0].path, "https://example.test")
      .searchParams;
    expect(query.get("from")).toBe(
      new Date(2026, 2, 29).toISOString().slice(0, 10),
    );
    expect(query.get("to")).toBe(
      new Date(new Date(2026, 2, 30).getTime() - 1).toISOString().slice(0, 10),
    );
    expect(Number(query.get("utcOffsetMinutes") ?? 0)).toBe(0);
    expect(requests[1].path).toContain("cursor=second");
  });
  it("surfaces a later page failure rather than replacing history with partial results", async () => {
    const result = await fetchFoodDateHistoryWith(
      queuedClient([
        { ok: true, value: { foodEntries: [ENTRY], nextCursor: "second" } },
        {
          ok: false,
          error: { kind: "network_error", cause: new Error("offline") },
        },
      ]),
      "2026-07-19",
    );
    expect(result.message).toBeTruthy();
    expect(result.entries).toEqual([]);
  });
  it("stops repeated cursors", async () => {
    const result = await fetchFoodDateHistoryWith(
      queuedClient([
        { ok: true, value: { foodEntries: [ENTRY], nextCursor: "same" } },
        { ok: true, value: { foodEntries: [ENTRY], nextCursor: "same" } },
      ]),
      "2026-07-19",
    );
    expect(result.message).toBeTruthy();
  });
});
