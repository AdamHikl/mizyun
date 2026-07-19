import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { FoodSource, StoredFoodEntry, UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";

const userA: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userB: UserId = "00000000-0000-4000-8000-000000000002" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (
  principal: { readonly userId: UserId } | null,
): AccessTokenVerifier => ({
  verify: async (token) =>
    token === "valid"
      ? {
          userId: principal!.userId,
          role: "authenticated",
          accessToken: "test-token",
        }
      : null,
});

const build = (verifier: AccessTokenVerifier) => {
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    foodEntryRepository,
  });
  apps.push(app);
  return { app, foodEntryRepository };
};

const seedEntry = (
  repo: InMemoryFoodEntryRepository,
  overrides: Partial<StoredFoodEntry> = {},
): StoredFoodEntry => {
  const entry: StoredFoodEntry = {
    id: "00000000-0000-4000-8000-00000000a001",
    userId: userA,
    source: "manual" as FoodSource,
    confidence: null,
    confirmedByUser: true,
    name: "Toast",
    consumedAt: new Date("2026-07-10T08:00:00Z"),
    caloriesKcal: 200,
    proteinG: 5,
    carbohydrateG: 30,
    fatG: 4,
    details: {},
    createdAt: new Date("2026-07-10T08:00:00Z"),
    updatedAt: new Date("2026-07-10T08:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(entry);
  return entry;
};

describe("GET /v1/food-entries", () => {
  it("returns an empty list for a fresh user", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ foodEntries: [] });
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it("returns 401 when the bearer token is invalid", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries",
      headers: { authorization: "Bearer wrong" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ACCESS_TOKEN" },
    });
  });

  it("returns the verified user's entries newest-first", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      name: "Older",
      consumedAt: new Date("2026-07-10T08:00:00Z"),
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      name: "Newer",
      consumedAt: new Date("2026-07-12T08:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.foodEntries.map((e: { name: string }) => e.name)).toEqual([
      "Newer",
      "Older",
    ]);
  });

  it("never returns another user's entries", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    // Seed user A; user B sees their own (empty) list.
    seedEntry(foodEntryRepository);
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/food-entries",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ foodEntries: [] });
  });

  it("filters by `from` and `to` inclusive", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      consumedAt: new Date("2026-07-09T08:00:00Z"),
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      consumedAt: new Date("2026-07-11T12:00:00Z"),
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a003",
      consumedAt: new Date("2026-07-13T08:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries?from=2026-07-11&to=2026-07-13",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const ids = response.json().foodEntries.map((e: { id: string }) => e.id);
    // inclusive on both ends: 11 Jul (kept) and 13 Jul (kept)
    expect(ids).toContain("00000000-0000-4000-8000-00000000a002");
    expect(ids).toContain("00000000-0000-4000-8000-00000000a003");
    expect(ids).not.toContain("00000000-0000-4000-8000-00000000a001");
  });

  it("applies the caller's UTC offset to local-day list boundaries", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      consumedAt: new Date("2026-07-09T22:30:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries?from=2026-07-10&to=2026-07-10&utcOffsetMinutes=120",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().foodEntries).toHaveLength(1);
  });

  it("rejects `from > to` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries?from=2026-07-15&to=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("caps the limit at the maximum page size", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      consumedAt: new Date("2026-07-10T08:00:00Z"),
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      consumedAt: new Date("2026-07-11T08:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries?limit=1",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().foodEntries).toHaveLength(1);
  });

  it("rejects an out-of-range `limit` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries?limit=999",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});

describe("POST /v1/food-entries", () => {
  it("creates a manual entry with macros", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Apple",
        consumedAt: "2026-07-10T08:00:00Z",
        caloriesKcal: 95,
        proteinG: 0.5,
        carbohydrateG: 25,
        fatG: 0.3,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.foodEntry.name).toBe("Apple");
    expect(body.foodEntry.source).toBe("manual");
    expect(body.foodEntry.confirmedByUser).toBe(true);
    expect(body.foodEntry.confidence).toBeNull();
    expect(body.foodEntry.userId).toBe(userA);
    expect(typeof body.foodEntry.id).toBe("string");
  });

  it("creates a minimal entry when only `name` is provided", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Quick bite" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.foodEntry.name).toBe("Quick bite");
    expect(body.foodEntry.caloriesKcal).toBeNull();
    expect(body.foodEntry.consumedAt).toBeTruthy();
    // consumedAt defaults to "now" — parse the ISO and assert it's recent.
    const ms = Date.parse(body.foodEntry.consumedAt);
    expect(Math.abs(Date.now() - ms)).toBeLessThan(10_000);
  });

  it("rejects a blank name with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "   " },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects a negative macro with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Apple",
        proteinG: -1,
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects an unknown field with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Apple", mystery: "x" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects 401 when the bearer token is missing", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: { "content-type": "application/json" },
      payload: { name: "Apple" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /v1/food-entries/:id", () => {
  it("returns the entry by id for the verified user", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().foodEntry.name).toBe("Toast");
  });

  it("returns 404 when another user's id is requested", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    // Switch to userB:
    apps.forEach((a) => a.close());
    apps.length = 0;
    const second = build(tokenVerifierFor({ userId: userB }));
    const asB = await second.app.inject({
      method: "GET",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(asB.statusCode).toBe(404);
    expect(asB.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    // Sanity: first response was 200.
    expect(response.statusCode).toBe(200);
  });

  it("returns 404 for a non-UUID id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/not-a-uuid",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for an unknown UUID", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/00000000-0000-4000-8000-000000000099",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("PUT /v1/food-entries/:id", () => {
  it("applies a single-field patch and persists it", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository);
    const patch = await app.inject({
      method: "PUT",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { caloriesKcal: 250 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().foodEntry.caloriesKcal).toBe(250);

    const read = await app.inject({
      method: "GET",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(read.json().foodEntry.caloriesKcal).toBe(250);
  });

  it("rejects an empty patch with a 422 VALIDATION_ERROR", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository);
    const response = await app.inject({
      method: "PUT",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("clears a nullable field when the patch sets it to null", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository);
    const cleared = await app.inject({
      method: "PUT",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { proteinG: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().foodEntry.proteinG).toBeNull();
  });

  it("returns 404 when another user tries to patch", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository);
    const close: Promise<void>[] = apps.map((a) => a.close());
    await Promise.all(close);
    apps.length = 0;
    const second = build(tokenVerifierFor({ userId: userB }));
    const response = await second.app.inject({
      method: "PUT",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { caloriesKcal: 1 },
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects an unknown field with a 422", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository);
    const response = await app.inject({
      method: "PUT",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { caloriesKcal: 100, mystery: "x" },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("DELETE /v1/food-entries/:id", () => {
  it("removes the entry and a follow-up GET returns 404", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository);
    const del = await app.inject({
      method: "DELETE",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(del.statusCode).toBe(204);
    const read = await app.inject({
      method: "GET",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(read.statusCode).toBe(404);
  });

  it("returns 404 when another user tries to delete", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository);
    const close: Promise<void>[] = apps.map((a) => a.close());
    await Promise.all(close);
    apps.length = 0;
    const second = build(tokenVerifierFor({ userId: userB }));
    const response = await second.app.inject({
      method: "DELETE",
      url: "/v1/food-entries/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for a non-UUID id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/food-entries/not-a-uuid",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/food-entries/summary", () => {
  it("returns an empty zero-entry summary when the user has no entries on the date", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      summary: {
        date: "2026-07-10",
        entryCount: 0,
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
      },
    });
  });

  it("aggregates a day's entries into a single summary", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      name: "Toast",
      consumedAt: new Date("2026-07-10T08:00:00Z"),
      caloriesKcal: 200,
      proteinG: 5,
      carbohydrateG: 30,
      fatG: 4,
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      name: "Salad",
      consumedAt: new Date("2026-07-10T18:00:00Z"),
      caloriesKcal: 100,
      proteinG: 3,
      carbohydrateG: 10,
      fatG: 5,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary).toEqual({
      date: "2026-07-10",
      entryCount: 2,
      caloriesKcal: 300,
      proteinG: 8,
      carbohydrateG: 40,
      fatG: 9,
    });
  });

  it("aggregates the caller's local day around the UTC boundary", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      consumedAt: new Date("2026-07-09T22:30:00Z"),
      caloriesKcal: 250,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-07-10&utcOffsetMinutes=120",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary).toMatchObject({
      date: "2026-07-10",
      entryCount: 1,
      caloriesKcal: 250,
    });
  });

  it("returns null for any field with at least one null entry on the day", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      consumedAt: new Date("2026-07-10T08:00:00Z"),
      caloriesKcal: 200,
      proteinG: 5,
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      consumedAt: new Date("2026-07-10T18:00:00Z"),
      caloriesKcal: 100,
      proteinG: null,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary.proteinG).toBeNull();
    expect(response.json().summary.caloriesKcal).toBe(300);
  });

  it("returns an array of per-day summaries for a range query, oldest-first", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a003",
      consumedAt: new Date("2026-07-12T08:00:00Z"),
      caloriesKcal: 100,
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      consumedAt: new Date("2026-07-10T08:00:00Z"),
      caloriesKcal: 200,
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      consumedAt: new Date("2026-07-11T08:00:00Z"),
      caloriesKcal: 300,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?from=2026-07-10&to=2026-07-12",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summaries.map((s: { date: string }) => s.date)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
    expect(
      body.summaries.map((s: { caloriesKcal: number }) => s.caloriesKcal),
    ).toEqual([200, 300, 100]);
  });

  it("omits days with zero entries from the range query response", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      consumedAt: new Date("2026-07-10T08:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?from=2026-07-09&to=2026-07-12",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summaries).toHaveLength(1);
  });

  it("rejects a missing query entirely with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects a query with both `date` and `from/to` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-07-10&from=2026-07-09&to=2026-07-12",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects `from > to` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?from=2026-07-15&to=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("caps the range query at `limit` days", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    for (let i = 1; i <= 5; i += 1) {
      seedEntry(foodEntryRepository, {
        id: `00000000-0000-4000-8000-00000000a00${i}`,
        consumedAt: new Date(`2026-07-1${i}T08:00:00Z`),
        caloriesKcal: 100,
      });
    }
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?from=2026-07-11&to=2026-07-15&limit=2",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summaries).toHaveLength(2);
  });

  it("never returns another user's entries", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedEntry(foodEntryRepository, {
      consumedAt: new Date("2026-07-10T08:00:00Z"),
      caloriesKcal: 999,
    });
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary.entryCount).toBe(0);
    expect(response.json().summary.caloriesKcal).toBeNull();
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-07-10",
    });
    expect(response.statusCode).toBe(401);
  });
});
