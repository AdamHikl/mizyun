import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { StoredFoodEntry, UserId } from "@mizyun/core";
import { InMemoryMemoryStore } from "@mizyun/memory";
import { buildApp } from "../../app.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryRecurringMealRepository } from "../../recurring-meal-repository.js";
import { API_COMPAT_HEADER, API_COMPAT_VERSION } from "@mizyun/contracts";

const userA = "00000000-0000-4000-8000-000000000001" as UserId;
const userB = "00000000-0000-4000-8000-000000000002" as UserId;
const id = "00000000-0000-4000-8000-000000000011";
const sourceEntryId = "00000000-0000-4000-8000-000000000021";
const create = {
  id,
  sourceEntryId,
  localTime: "10:00",
  timeZone: "Europe/Bratislava",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
};
const apps: ReturnType<typeof buildApp>[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T08:00:00Z"));
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.useRealTimers();
});
const build = (persistentUnavailable = false, injectRepository = true) => {
  const food = new InMemoryFoodEntryRepository();
  const source: StoredFoodEntry = {
    id: sourceEntryId,
    userId: userA,
    name: "Breakfast",
    consumedAt: new Date(),
    caloriesKcal: 200,
    proteinG: null,
    carbohydrateG: null,
    fatG: null,
    source: "manual",
    confidence: null,
    confirmedByUser: true,
    details: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  food.__seedForTest(source);
  const repo = new InMemoryRecurringMealRepository(food);
  const app = buildApp({
    tokenVerifier: {
      verify: async (token) =>
        token === "a" || token === "b"
          ? {
              userId: token === "a" ? userA : userB,
              role: "authenticated",
              accessToken: token,
            }
          : null,
    },
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    foodEntryRepository: food,
    ...(injectRepository ? { recurringMealRepository: repo } : {}),
    ...(persistentUnavailable
      ? {
          supabasePersistence: {
            clientFor: () => {
              throw new Error("unexpected database access");
            },
            storageClientFor: () => {
              throw new Error("unexpected storage access");
            },
          },
        }
      : {}),
  });
  apps.push(app);
  const request = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path = "",
    payload?: unknown,
    token = "a",
  ) =>
    app.inject({
      method,
      url: `/v1/recurring-meals${path}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined
        ? {}
        : { payload: payload as Record<string, unknown> }),
    });
  return { app, food, source, repo, request };
};

describe("recurring meal routes", () => {
  it("fails automatic logging closed when the default app has neither durable persistence nor an explicitly injected repository", async () => {
    const { request } = build(false, false);
    const response = await request("POST", "", create);
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect((await request("GET")).json()).toEqual({ recurringMeals: [] });
  });
  it("clears recurring schedules and skipped occurrences through confirmed account deletion", async () => {
    const { app, request, repo, food, source } = build();
    await request("POST", "", create);
    await request("POST", `/${id}/skip`, { localDate: "2026-10-03" });
    await request("DELETE", `/${id}`);
    food.__seedForTest({ ...source, id: userB, userId: userB });
    expect(
      (
        await request(
          "POST",
          "",
          { ...create, id: userB, sourceEntryId: userB },
          "b",
        )
      ).statusCode,
    ).toBe(200);
    const challenge = await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
      headers: { authorization: "Bearer a" },
    });
    expect(challenge.statusCode).toBe(200);
    const deletion = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { authorization: "Bearer a" },
      payload: { confirmationToken: challenge.json().confirmationToken },
    });
    expect(deletion.statusCode).toBe(200);
    expect(deletion.json()).toEqual({ deleted: true });
    expect(await repo.exportForUser(userA, { accessToken: "a" })).toEqual({
      schedules: [],
      occurrences: [],
    });
    expect(await repo.list(userB, { accessToken: "b" })).toHaveLength(1);
    expect(await food.getById(sourceEntryId, { accessToken: "a" })).toBeNull();
    expect(await food.getById(userB, { accessToken: "b" })).not.toBeNull();
  });
  it("exports stopped schedules and skipped occurrences through account export without cross-account disclosure", async () => {
    const { app, request } = build();
    expect((await request("POST", "", create)).statusCode).toBe(200);
    expect(
      (await request("POST", `/${id}/skip`, { localDate: "2026-10-03" }))
        .statusCode,
    ).toBe(204);
    expect((await request("DELETE", `/${id}`)).statusCode).toBe(204);
    const owned = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: { authorization: "Bearer a" },
    });
    expect(owned.statusCode).toBe(200);
    expect(owned.json().export.recurringMeals).toMatchObject({
      schedules: [
        { id, userId: userA, name: "Breakfast", stopped: true, enabled: false },
      ],
      occurrences: [
        { recurringMealId: id, localDate: "2026-10-03", status: "skipped" },
      ],
    });
    const other = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: {
        authorization: "Bearer b",
        [API_COMPAT_HEADER]: API_COMPAT_VERSION,
      },
    });
    expect(other.statusCode).toBe(200);
    expect(other.json().export.userId).toBe(userB);
    // Suggestion data has its own section: installed build 9 parses
    // `recurringMeals` strictly with only schedules and occurrences.
    expect(other.json().export.recurringMeals).toEqual({
      schedules: [],
      occurrences: [],
    });
    expect(other.json().export.recurringMealSuggestions).toEqual({
      states: [],
      preferences: [],
      receipts: [],
    });
    expect(other.body).not.toContain(id);
    expect(other.body).not.toContain("Breakfast");
    const legacy = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: { authorization: "Bearer b" },
    });
    expect(legacy.statusCode).toBe(200);
    expect(Object.keys(legacy.json().export.recurringMeals).sort()).toEqual([
      "occurrences",
      "schedules",
    ]);
  });
  it("fails writes closed when durable automatic logging is unavailable", async () => {
    const { request, repo } = build(true);
    const spy = vi.spyOn(repo, "create");
    for (const [method, path, payload] of [
      ["POST", "", create],
      ["PATCH", `/${id}`, { enabled: true }],
      ["DELETE", `/${id}`, undefined],
      ["POST", `/${id}/skip`, { localDate: "2026-10-03" }],
    ] as const) {
      const response = await request(method, path, payload);
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
    }
    expect(spy).not.toHaveBeenCalled();
    expect((await request("GET")).json()).toEqual({ recurringMeals: [] });
  });
  it("requires a verified principal for every operation", async () => {
    const { request } = build();
    for (const [method, path, payload] of [
      ["GET", "", undefined],
      ["POST", "", create],
      ["PATCH", `/${id}`, { enabled: false }],
      ["DELETE", `/${id}`, undefined],
      ["POST", `/${id}/skip`, { localDate: "2026-10-03" }],
    ] as const) {
      expect((await request(method, path, payload, "invalid")).statusCode).toBe(
        401,
      );
    }
  });
  it("creates from a confirmed owned source and retries without duplicates", async () => {
    const { request } = build();
    const first = await request("POST", "", create);
    expect(first.statusCode).toBe(200);
    expect(first.json().recurringMeal).toMatchObject({
      id,
      userId: userA,
      name: "Breakfast",
      enabled: true,
    });
    const repeated = await request("POST", "", create);
    expect(repeated.json()).toEqual(first.json());
    expect((await request("GET")).json().recurringMeals).toHaveLength(1);
    const conflict = await request("POST", "", {
      ...create,
      localTime: "11:00",
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toMatchObject({
      code: "CONFLICT",
      requestId: expect.any(String),
    });
  });
  it("does not expose or mutate another user's schedules or sources", async () => {
    const { request } = build();
    await request("POST", "", create);
    expect((await request("GET", "", undefined, "b")).json()).toEqual({
      recurringMeals: [],
    });
    expect(
      (await request("POST", "", { ...create, id: userB }, "b")).statusCode,
    ).toBe(404);
    expect((await request("POST", "", create, "b")).statusCode).toBe(404);
    expect(
      (await request("PATCH", `/${id}`, { enabled: false }, "b")).statusCode,
    ).toBe(404);
    expect((await request("DELETE", `/${id}`, undefined, "b")).statusCode).toBe(
      404,
    );
    expect(
      (await request("POST", `/${id}/skip`, { localDate: "2026-10-03" }, "b"))
        .statusCode,
    ).toBe(404);
    expect((await request("GET")).json().recurringMeals[0].enabled).toBe(true);
  });
  it("supports pause, schedule edits, idempotent skip, resume and final stop", async () => {
    const { request } = build();
    await request("POST", "", create);
    expect(
      (
        await request("PATCH", `/${id}`, {
          enabled: false,
          localTime: "08:30",
          weekdays: [1, 3],
        })
      ).json().recurringMeal,
    ).toMatchObject({ enabled: false, localTime: "08:30", weekdays: [1, 3] });
    expect(
      (await request("POST", "", create)).json().recurringMeal.enabled,
    ).toBe(false);
    for (let repeat = 0; repeat < 2; repeat++)
      expect(
        (await request("POST", `/${id}/skip`, { localDate: "2026-10-03" }))
          .statusCode,
      ).toBe(204);
    expect(
      (await request("PATCH", `/${id}`, { enabled: true })).json().recurringMeal
        .enabled,
    ).toBe(true);
    expect((await request("DELETE", `/${id}`)).statusCode).toBe(204);
    expect((await request("DELETE", `/${id}`)).statusCode).toBe(204);
    expect((await request("GET")).json()).toEqual({ recurringMeals: [] });
    expect((await request("POST", "", create)).statusCode).toBe(409);
    expect(
      (await request("PATCH", `/${id}`, { enabled: true })).statusCode,
    ).toBe(404);
    expect(
      (await request("POST", `/${id}/skip`, { localDate: "2026-10-03" }))
        .statusCode,
    ).toBe(404);
  });
  it("replaces the snapshot only from a confirmed owned source", async () => {
    const { request, food, source } = build();
    await request("POST", "", create);
    const replacement = { ...source, id: userB, name: "Evening meal" };
    food.__seedForTest(replacement);
    expect(
      (await request("PATCH", `/${id}`, { sourceEntryId: userB })).json()
        .recurringMeal.name,
    ).toBe("Evening meal");
    food.__seedForTest({ ...replacement, id: id, confirmedByUser: false });
    expect(
      (await request("PATCH", `/${id}`, { sourceEntryId: id })).statusCode,
    ).toBe(422);
    expect((await request("GET")).json().recurringMeals[0].name).toBe(
      "Evening meal",
    );
  });
  it("rejects unconfirmed sources and source deletion does not break successful retries", async () => {
    const { request, food, source } = build();
    food.__seedForTest({ ...source, confirmedByUser: false });
    expect((await request("POST", "", create)).statusCode).toBe(422);
    food.__seedForTest(source);
    await request("POST", "", create);
    await food.delete(sourceEntryId, { accessToken: "a" });
    expect((await request("POST", "", create)).statusCode).toBe(200);
  });
  it.each([
    { localTime: "24:00" },
    { timeZone: "bad/timezone" },
    { weekdays: [] },
    { weekdays: [1, 1] },
    { userId: userB },
    { caloriesKcal: 10 },
  ])("rejects invalid and server-owned create fields %j", async (patch) => {
    const { request } = build();
    expect(
      (await request("POST", "", { ...create, ...patch })).statusCode,
    ).toBe(422);
  });
  it("rejects empty patches, malformed ids, nonexistent dates and unknown skip fields", async () => {
    const { request } = build();
    await request("POST", "", create);
    expect((await request("PATCH", `/${id}`, {})).statusCode).toBe(422);
    expect(
      (await request("PATCH", "/broken", { enabled: false })).statusCode,
    ).toBe(404);
    expect(
      (await request("POST", `/${id}/skip`, { localDate: "2026-02-29" }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await request("POST", `/${id}/skip`, {
          localDate: "2026-10-03",
          userId: userB,
        })
      ).statusCode,
    ).toBe(422);
  });
  it("normalizes repository failures without leaking error detail", async () => {
    const { request, repo } = build();
    vi.spyOn(repo, "list").mockRejectedValue(
      new Error("private database detail"),
    );
    const response = await request("GET");
    expect(response.statusCode).toBe(500);
    expect(response.json().error).toMatchObject({
      code: "INTERNAL_ERROR",
      requestId: expect.any(String),
    });
    expect(response.body).not.toContain("private database detail");
  });
});
