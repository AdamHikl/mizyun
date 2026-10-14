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
import { InMemoryRecurringMealSuggestionRepository } from "../../recurring-meal-suggestion-repository.js";
const user = "10000000-0000-4000-8000-000000000001" as UserId;
const apps: ReturnType<typeof buildApp>[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  vi.useRealTimers();
});
function setup() {
  const food = new InMemoryFoodEntryRepository();
  for (const day of [11, 12, 13]) {
    const entry: StoredFoodEntry = {
      id: `20000000-0000-4000-8000-0000000000${day}`,
      userId: user,
      name: "Oats with banana",
      consumedAt: new Date(`2026-10-${day}T08:00:00Z`),
      createdAt: new Date(`2026-10-${day}T08:00:00Z`),
      updatedAt: new Date(`2026-10-${day}T08:00:00Z`),
      caloriesKcal: 300,
      proteinG: 10,
      carbohydrateG: 40,
      fatG: 10,
      confirmedByUser: true,
      source: "manual",
      confidence: null,
      details: { grams: 100 },
    };
    food.__seedForTest(entry);
  }
  const recurring = new InMemoryRecurringMealRepository(food);
  const repo = new InMemoryRecurringMealSuggestionRepository(food, recurring);
  const app = buildApp({
    tokenVerifier: {
      verify: async (token) =>
        token === "a"
          ? { userId: user, role: "authenticated", accessToken: token }
          : null,
    },
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    foodEntryRepository: food,
    recurringMealRepository: recurring,
    recurringMealSuggestionRepository: repo,
  });
  apps.push(app);
  const request = (
    method: "GET" | "POST" | "PATCH",
    path: string,
    payload?: unknown,
    token = "a",
  ) =>
    app.inject({
      method,
      url: `/v1/recurring-meal-suggestions${path}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined
        ? {}
        : { payload: payload as Record<string, unknown> }),
    });
  return { app, repo, recurring, request };
}
describe("meal suggestion authenticated routes", () => {
  it("requires authentication and named-zone query; rejects unknown fields", async () => {
    const { request } = setup();
    expect(
      (await request("GET", "?timeZone=UTC", undefined, "bad")).statusCode,
    ).toBe(401);
    expect((await request("GET", "")).statusCode).toBe(422);
    expect((await request("GET", "?timeZone=Wrong/Zone")).statusCode).toBe(422);
    expect(
      (await request("PATCH", "/preferences", { enabled: false, userId: user }))
        .statusCode,
    ).toBe(422);
  });
  it("reads, records impression and accepts a real schedule with tomorrow start", async () => {
    const { request, recurring } = setup();
    const got = await request("GET", "?timeZone=UTC");
    expect(got.statusCode).toBe(200);
    const proposal = got.json().suggestion;
    expect(
      (
        await request("POST", `/${proposal.candidateId}/decision`, {
          proposal,
          decision: "shown",
        })
      ).json(),
    ).toEqual({ ok: true });
    const accepted = await request("POST", `/${proposal.candidateId}/accept`, {
      operationId: "30000000-0000-4000-8000-000000000001",
      proposal,
      localTime: "09:15",
      timeZone: "UTC",
      weekdays: [1],
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      created: true,
      startLocalDate: "2026-10-19",
      recurringMeal: { localTime: "09:15", weekdays: [1] },
    });
    expect(await recurring.list(user, { accessToken: "a" })).toHaveLength(1);
  });
  it("never performs a decision for a mismatched route candidate; controls round-trip", async () => {
    const { request, repo } = setup();
    const p = (await request("GET", "?timeZone=UTC")).json().suggestion;
    const decision = vi.spyOn(repo, "decide");
    expect(
      (
        await request("POST", "/mrs1-deadbeef/decision", {
          proposal: p,
          decision: "never",
        })
      ).statusCode,
    ).toBe(422);
    expect(decision).not.toHaveBeenCalled();
    expect(
      (await request("PATCH", "/preferences", { enabled: false })).json(),
    ).toEqual({ enabled: false });
    expect((await request("GET", "?timeZone=UTC")).json()).toEqual({
      enabled: false,
      suggestion: null,
    });
    expect((await request("GET", "/preferences")).json()).toEqual({
      enabled: false,
    });
    expect((await request("POST", "/reset", {})).json()).toEqual({ ok: true });
  });
  it("maps stale acceptance to standard redacted 409 envelope", async () => {
    const { request } = setup();
    const p = (await request("GET", "?timeZone=UTC")).json().suggestion;
    const result = await request("POST", `/${p.candidateId}/accept`, {
      operationId: "30000000-0000-4000-8000-000000000001",
      proposal: { ...p, caloriesKcal: 301 },
      localTime: p.localTime,
      timeZone: "UTC",
      weekdays: p.weekdays,
    });
    expect(result.statusCode).toBe(409);
    expect(result.json().error).toMatchObject({
      code: "CONFLICT",
      requestId: expect.any(String),
    });
    expect(result.body).not.toContain(p.name);
  });
});
