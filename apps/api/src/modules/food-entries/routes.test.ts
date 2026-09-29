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
import { InMemoryBetaProRepository } from "../../beta-pro-repository.js";

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

const build = (
  verifier: AccessTokenVerifier,
  betaProRepository = new InMemoryBetaProRepository(),
) => {
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    foodEntryRepository,
    betaProRepository,
  });
  apps.push(app);
  return { app, foodEntryRepository };
};

const approvedBetaPro = (): InMemoryBetaProRepository => {
  const repository = new InMemoryBetaProRepository();
  repository.__seedForTest({
    id: "00000000-0000-4000-8000-00000000b001",
    userId: userA,
    email: "example@example.test",
    pushToken: null,
    status: "approved",
    notes: null,
    createdAt: new Date("2026-09-29T12:00:00Z"),
    reviewedAt: new Date("2026-09-29T12:01:00Z"),
  });
  return repository;
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

  it("handles 200/201-entry boundary across pages using cursor pagination", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const baseDate = new Date("2026-01-01T00:00:00Z").getTime();
    for (let i = 0; i < 201; i++) {
      seedEntry(foodEntryRepository, {
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        name: `Meal ${i}`,
        consumedAt: new Date(baseDate + i * 60_000),
      });
    }

    // Page 1: limit=200
    const page1 = await app.inject({
      method: "GET",
      url: "/v1/food-entries?limit=200",
      headers: { authorization: "Bearer valid" },
    });
    expect(page1.statusCode).toBe(200);
    const p1Body = page1.json();
    expect(p1Body.foodEntries).toHaveLength(200);
    expect(typeof p1Body.nextCursor).toBe("string");

    // Page 2: limit=200 with cursor
    const page2 = await app.inject({
      method: "GET",
      url: `/v1/food-entries?limit=200&cursor=${encodeURIComponent(p1Body.nextCursor)}`,
      headers: { authorization: "Bearer valid" },
    });
    expect(page2.statusCode).toBe(200);
    const p2Body = page2.json();
    expect(p2Body.foodEntries).toHaveLength(1);
    expect(p2Body.foodEntries[0].name).toBe("Meal 0");
    expect(p2Body.nextCursor).toBeUndefined();
  });

  it("breaks ties deterministically on identical timestamps without duplicate or skipped entries", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const sameTime = new Date("2026-07-10T12:00:00Z");
    const id1 = "00000000-0000-4000-8000-000000000001";
    const id2 = "00000000-0000-4000-8000-000000000002";
    const id3 = "00000000-0000-4000-8000-000000000003";

    seedEntry(foodEntryRepository, {
      id: id1,
      name: "Meal 1",
      consumedAt: sameTime,
    });
    seedEntry(foodEntryRepository, {
      id: id2,
      name: "Meal 2",
      consumedAt: sameTime,
    });
    seedEntry(foodEntryRepository, {
      id: id3,
      name: "Meal 3",
      consumedAt: sameTime,
    });

    // Page 1: limit=2
    const res1 = await app.inject({
      method: "GET",
      url: "/v1/food-entries?limit=2",
      headers: { authorization: "Bearer valid" },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.foodEntries).toHaveLength(2);
    expect(typeof body1.nextCursor).toBe("string");

    // Page 2: limit=2 with cursor
    const res2 = await app.inject({
      method: "GET",
      url: `/v1/food-entries?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: { authorization: "Bearer valid" },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.foodEntries).toHaveLength(1);

    const allIds = [
      ...body1.foodEntries.map((e: { id: string }) => e.id),
      ...body2.foodEntries.map((e: { id: string }) => e.id),
    ];
    expect(new Set(allIds).size).toBe(3);
    expect(allIds.sort()).toEqual([id1, id2, id3].sort());
  });

  it("finds an old uniquely named match across all history using search", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const baseDate = new Date("2026-01-01T00:00:00Z").getTime();
    for (let i = 0; i < 205; i++) {
      seedEntry(foodEntryRepository, {
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        name: i === 0 ? "Grandma's secret lentil soup" : `Meal ${i}`,
        consumedAt: new Date(baseDate + i * 60_000),
      });
    }

    const response = await app.inject({
      method: "GET",
      url: `/v1/food-entries?search=${encodeURIComponent("secret lentil")}`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.foodEntries).toHaveLength(1);
    expect(body.foodEntries[0].name).toBe("Grandma's secret lentil soup");
  });

  it("sets cutoffDateIsPartial true when page boundary splits meals of the same day", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    // 3 meals on 2026-07-15
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-000000000001",
      consumedAt: new Date("2026-07-15T18:00:00Z"),
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-000000000002",
      consumedAt: new Date("2026-07-15T12:00:00Z"),
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-000000000003",
      consumedAt: new Date("2026-07-15T08:00:00Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries?limit=2",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.foodEntries).toHaveLength(2);
    expect(body.cutoffDateIsPartial).toBe(true);
  });

  it("leaves cutoffDateIsPartial false when page boundary aligns with date transition", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    // 2 meals on 2026-07-15, 1 meal on 2026-07-14
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-000000000001",
      consumedAt: new Date("2026-07-15T18:00:00Z"),
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-000000000002",
      consumedAt: new Date("2026-07-15T12:00:00Z"),
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-000000000003",
      consumedAt: new Date("2026-07-14T19:00:00Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries?limit=2",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.foodEntries).toHaveLength(2);
    expect(body.cutoffDateIsPartial).toBeUndefined();
  });

  it("rejects a malformed cursor with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/food-entries?cursor=not-a-valid-cursor",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "Invalid cursor format" },
    });
  });
});

describe("advanced nutrition Pro boundary", () => {
  const headers = { authorization: "Bearer valid" };
  const advancedMeal = {
    name: "Oats",
    caloriesKcal: 200,
    carbohydrateG: 30,
    fatG: 4,
    fibreG: 5,
    saturatedFatG: 1,
    totalSugarsG: 2,
    sodiumMg: 12,
    cholesterolMg: 0,
  };

  it("rejects advanced writes for non-Pro while basic meals remain available", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const capability = await app.inject({
      method: "GET",
      url: "/v1/food-entries/capabilities",
      headers,
    });
    expect(capability.json()).toEqual({
      advancedNutrition: false,
      source: "none",
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers,
      payload: advancedMeal,
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe("PREMIUM_REQUIRED");
    const basic = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers,
      payload: { name: "Oats", caloriesKcal: 200 },
    });
    expect(basic.statusCode).toBe(200);
  });

  it("accepts approved Beta Pro and marks incomplete nutrients honestly", async () => {
    const { app } = build(
      tokenVerifierFor({ userId: userA }),
      approvedBetaPro(),
    );
    const capability = await app.inject({
      method: "GET",
      url: "/v1/food-entries/capabilities",
      headers,
    });
    expect(capability.json()).toEqual({
      advancedNutrition: true,
      source: "beta_pro",
    });
    const first = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers,
      payload: { ...advancedMeal, consumedAt: "2026-09-29T10:00:00Z" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().foodEntry.fibreG).toBe(5);
    const second = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers,
      payload: { name: "Unknown fibre", consumedAt: "2026-09-29T11:00:00Z" },
    });
    expect(second.statusCode).toBe(200);
    const summary = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-09-29",
      headers,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().summary.fibreG).toBeNull();
    expect(summary.json().summary.advancedCoverage.fibreG).toBe(1);
  });

  it("paginates every entry before declaring a complete daily total", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
      approvedBetaPro(),
    );
    for (let index = 0; index < 400; index += 1) {
      seedEntry(foodEntryRepository, {
        id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
        consumedAt: new Date(
          `2026-09-29T${String(index % 24).padStart(2, "0")}:00:00Z`,
        ),
        fibreG: 1,
      });
    }
    const summary = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-09-29",
      headers,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().summary.entryCount).toBe(400);
    expect(summary.json().summary.fibreG).toBe(400);
    expect(summary.json().summary.advancedCoverage.fibreG).toBe(400);
  });

  it("accepts aggregate totals above a single meal's bound", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
      approvedBetaPro(),
    );
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a111",
      consumedAt: new Date("2026-09-29T10:00:00Z"),
      fibreG: 9000,
    });
    seedEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000a112",
      consumedAt: new Date("2026-09-29T11:00:00Z"),
      fibreG: 9000,
    });
    const summary = await app.inject({
      method: "GET",
      url: "/v1/food-entries/summary?date=2026-09-29",
      headers,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().summary.fibreG).toBe(18_000);
  });

  it("replays a committed advanced meal after Pro lapses without creating another", async () => {
    const betaProRepository = approvedBetaPro();
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
      betaProRepository,
    );
    const payload = {
      ...advancedMeal,
      clientOperationId: "00000000-0000-4000-8000-00000000a901",
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    betaProRepository.__seedForTest({
      id: "00000000-0000-4000-8000-00000000b001",
      userId: userA,
      email: "example@example.test",
      pushToken: null,
      status: "rejected",
      notes: null,
      createdAt: new Date("2026-09-29T12:00:00Z"),
      reviewedAt: new Date("2026-09-29T12:01:00Z"),
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers,
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().foodEntry.id).toBe(first.json().foodEntry.id);
    const rows = await foodEntryRepository.list(userA, {
      from: null,
      to: null,
      limit: 10,
      accessToken: "test-token",
    });
    expect(rows).toHaveLength(1);
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

  it("deduplicates identical meal submissions with the same clientOperationId on retry (REL-AUD-007)", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const clientOperationId = "11111111-2222-4333-8444-555555555555";
    const payload = {
      name: "Post-workout shake",
      caloriesKcal: 300,
      proteinG: 30,
      clientOperationId,
    };

    // First POST succeeds
    const first = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    const createdId = firstBody.foodEntry.id;
    expect(firstBody.foodEntry.name).toBe("Post-workout shake");
    expect(firstBody.foodEntry.clientOperationId).toBe(clientOperationId);

    // Second POST (lost response retry) returns the same entry without creating a duplicate
    const retry = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload,
    });
    expect(retry.statusCode).toBe(200);
    const retryBody = retry.json();
    expect(retryBody.foodEntry.id).toBe(createdId);

    // Verify only ONE entry exists in the repository
    const list = await foodEntryRepository.list(userA, {
      from: null,
      to: null,
      limit: 10,
      accessToken: "valid",
    });
    expect(list.length).toBe(1);
  });

  it("deduplicates identical meal submissions with Idempotency-Key header on retry (REL-AUD-007)", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const idempotencyKey = "22222222-3333-4444-8555-666666666666";
    const payload = {
      name: "Oatmeal with blueberries",
      caloriesKcal: 350,
      carbohydrateG: 60,
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload,
    });
    expect(first.statusCode).toBe(200);
    const firstId = first.json().foodEntry.id;

    const retry = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().foodEntry.id).toBe(firstId);

    const list = await foodEntryRepository.list(userA, {
      from: null,
      to: null,
      limit: 10,
      accessToken: "valid",
    });
    expect(list.length).toBe(1);
  });

  it("preserves intentionally separate identical meals when operation IDs differ (REL-AUD-007)", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const payload1 = {
      name: "Espresso",
      caloriesKcal: 5,
      clientOperationId: "33333333-4444-4555-8666-777777777777",
    };
    const payload2 = {
      name: "Espresso",
      caloriesKcal: 5,
      clientOperationId: "44444444-5555-4666-8777-888888888888",
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: payload1,
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: payload2,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().foodEntry.id).not.toBe(second.json().foodEntry.id);

    const list = await foodEntryRepository.list(userA, {
      from: null,
      to: null,
      limit: 10,
      accessToken: "valid",
    });
    expect(list.length).toBe(2);
  });

  it("returns 409 CONFLICT when the same clientOperationId is submitted with a different payload (Q2)", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const clientOperationId = "55555555-6666-4777-8888-999999999999";
    const originalPayload = {
      name: "Chicken Salad",
      caloriesKcal: 400,
      proteinG: 35,
      clientOperationId,
    };
    const conflictingPayload = {
      name: "Chicken Salad with Dressing",
      caloriesKcal: 550,
      proteinG: 35,
      clientOperationId,
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: originalPayload,
    });
    expect(first.statusCode).toBe(200);

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: conflictingPayload,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("CONFLICT");
    expect(conflict.json().error.message).toContain("different meal payload");

    // Verify still only ONE entry exists in the repository
    const list = await foodEntryRepository.list(userA, {
      from: null,
      to: null,
      limit: 10,
      accessToken: "valid",
    });
    expect(list.length).toBe(1);
    expect(list[0]?.caloriesKcal).toBe(400);
  });

  it("returns 409 CONFLICT when the same clientOperationId is submitted with a different consumedAt date (Q2)", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const clientOperationId = "55555555-6666-4777-8888-999999999998";
    const originalPayload = {
      name: "Oatmeal",
      caloriesKcal: 250,
      consumedAt: "2026-09-08T08:00:00.000Z",
      clientOperationId,
    };
    const conflictingPayload = {
      name: "Oatmeal",
      caloriesKcal: 250,
      consumedAt: "2026-09-08T09:00:00.000Z",
      clientOperationId,
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: originalPayload,
    });
    expect(first.statusCode).toBe(200);

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: conflictingPayload,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("CONFLICT");
    expect(conflict.json().error.message).toContain("different meal payload");

    // Also verify that identical consumedAt returns 200 with original entry
    const retry = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: originalPayload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().foodEntry.id).toBe(first.json().foodEntry.id);
  });

  it("returns 409 CONFLICT when the same clientOperationId is submitted with different details (Q2)", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const clientOperationId = "55555555-6666-4777-8888-999999999997";
    const originalPayload = {
      name: "Protein Shake",
      caloriesKcal: 150,
      details: { flavor: "vanilla", scoops: 1 },
      clientOperationId,
    };
    const conflictingPayload = {
      name: "Protein Shake",
      caloriesKcal: 150,
      details: { flavor: "chocolate", scoops: 1 },
      clientOperationId,
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: originalPayload,
    });
    expect(first.statusCode).toBe(200);

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: conflictingPayload,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("CONFLICT");
    expect(conflict.json().error.message).toContain("different meal payload");

    // Also verify that same details with rearranged keys matches canonically (200)
    const rearrangedPayload = {
      name: "Protein Shake",
      caloriesKcal: 150,
      details: { scoops: 1, flavor: "vanilla" },
      clientOperationId,
    };
    const retry = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: rearrangedPayload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().foodEntry.id).toBe(first.json().foodEntry.id);
  });

  it("allows different users to use the same clientOperationId without collision (Q2)", async () => {
    const { app, foodEntryRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const clientOperationId = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
    const payload = {
      name: "Oatmeal",
      caloriesKcal: 200,
      clientOperationId,
    };

    // User A posts
    const resA = await app.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload,
    });
    expect(resA.statusCode).toBe(200);

    // User B posts with SAME clientOperationId
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const resB = await appB.inject({
      method: "POST",
      url: "/v1/food-entries",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload,
    });
    expect(resB.statusCode).toBe(200);
    expect(resB.json().foodEntry.id).not.toBe(resA.json().foodEntry.id);
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
