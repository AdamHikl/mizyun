import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { API_COMPAT_HEADER, API_COMPAT_VERSION } from "@mizyun/contracts";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";

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
  const goalRepository = new InMemoryGoalRepository();
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    goalRepository,
  });
  apps.push(app);
  return { app, goalRepository };
};

describe("GET /v1/goals/active", () => {
  it("returns 404 when the user has no active goal", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/goals/active",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/goals/active",
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /v1/goals", () => {
  it("creates an active goal for the verified user", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.goal.kind).toBe("cut");
    expect(body.goal.status).toBe("active");
    expect(body.goal.userId).toBe(userA);
  });

  it("rejects a body where targetDate precedes startsOn", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-04-01",
        targetDate: "2026-01-01",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects an out-of-range weight with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 5 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects an unknown field via the strict() schema", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
        mystery: "x",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects a second active goal for the same user with a 409", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const first = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "maintain",
        pace: "steady",
        target: { weightKg: 80 },
        startsOn: "2026-05-01",
        targetDate: "2026-08-01",
      },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});

describe("PUT /v1/goals/:id", () => {
  it("transitions active -> completed", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const created = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      },
    });
    const id = created.json().goal.id;
    const response = await app.inject({
      method: "PUT",
      url: `/v1/goals/${id}`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { status: "completed" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().goal.status).toBe("completed");
  });

  it("rejects an invalid status transition with a 409", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const created = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      },
    });
    const id = created.json().goal.id;
    // archive first
    await app.inject({
      method: "PUT",
      url: `/v1/goals/${id}`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { status: "archived" },
    });
    // attempt to re-activate archived (invalid)
    const response = await app.inject({
      method: "PUT",
      url: `/v1/goals/${id}`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { status: "active" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("returns 404 for an unknown goal id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/goals/00000000-0000-4000-8000-000000000999",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { status: "completed" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("returns 404 for a goal id that belongs to another user", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    // Seed user B with a goal.
    const { app: appB, goalRepository } = build(
      tokenVerifierFor({ userId: userB }),
    );
    void appB; // not used directly
    const created = await appB.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      },
    });
    const userBGoalId = created.json().goal.id;
    // User A tries to update user B's goal.
    const response = await app.inject({
      method: "PUT",
      url: `/v1/goals/${userBGoalId}`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { status: "completed" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    void goalRepository;
  });

  it("returns 404 for a malformed goal id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/goals/not-a-uuid",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { status: "completed" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("GET /v1/goals/history", () => {
  it("returns the user's full history newest-first", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const created = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      },
    });
    const id = created.json().goal.id;
    // transition through completed -> archived
    await app.inject({
      method: "PUT",
      url: `/v1/goals/${id}`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { status: "completed" },
    });
    const history = await app.inject({
      method: "GET",
      url: "/v1/goals/history",
      headers: { authorization: "Bearer valid" },
    });
    expect(history.statusCode).toBe(200);
    const body = history.json();
    expect(body.goals).toHaveLength(1);
    expect(body.goals[0].status).toBe("completed");
  });

  it("returns an empty array for a user with no goals", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/goals/history",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ goals: [] });
  });
});

describe("optional goal target date", () => {
  const headers = {
    authorization: "Bearer valid",
    "content-type": "application/json",
    [API_COMPAT_HEADER]: API_COMPAT_VERSION,
  };
  const createBody = {
    kind: "cut",
    pace: "steady",
    target: { weightKg: 78 },
    startsOn: "2026-01-01",
  };

  it("creates a goal without a target date and returns targetDate null", async () => {
    const { app, goalRepository } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers,
      payload: createBody,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().goal).toHaveProperty("targetDate", null);
    const stored = await goalRepository.getActive(userA, {
      accessToken: "test-token",
    });
    expect(stored?.targetDate).toBeNull();
    const active = await app.inject({
      method: "GET",
      url: "/v1/goals/active",
      headers,
    });
    expect(active.statusCode).toBe(200);
    expect(active.json().goal).toHaveProperty("targetDate", null);
  });

  it("accepts an explicit null target date on create", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers,
      payload: { ...createBody, targetDate: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().goal.targetDate).toBeNull();
  });

  it("clears a target date with PUT {targetDate: null} and sets it again", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const created = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers,
      payload: { ...createBody, targetDate: "2026-04-01" },
    });
    const id = created.json().goal.id as string;
    const cleared = await app.inject({
      method: "PUT",
      url: `/v1/goals/${id}`,
      headers,
      payload: { targetDate: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().goal.targetDate).toBeNull();

    const untouched = await app.inject({
      method: "PUT",
      url: `/v1/goals/${id}`,
      headers,
      payload: { pace: "gradual" },
    });
    expect(untouched.json().goal.targetDate).toBeNull();

    const set = await app.inject({
      method: "PUT",
      url: `/v1/goals/${id}`,
      headers,
      payload: { targetDate: "2026-09-01" },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().goal.targetDate).toBe("2026-09-01");
  });

  it("still rejects a PUT target date before startsOn", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const created = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers,
      payload: createBody,
    });
    const id = created.json().goal.id as string;
    const response = await app.inject({
      method: "PUT",
      url: `/v1/goals/${id}`,
      headers,
      payload: { targetDate: "2025-12-01" },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});

describe("goal target date for installed build-9 clients", () => {
  const current = {
    authorization: "Bearer valid",
    "content-type": "application/json",
    [API_COMPAT_HEADER]: API_COMPAT_VERSION,
  };
  const legacy = {
    authorization: "Bearer valid",
    "content-type": "application/json",
  };

  it("shows startsOn + 90 days to legacy clients only and never stores it", async () => {
    const { app, goalRepository } = build(tokenVerifierFor({ userId: userA }));
    const created = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: current,
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-12-15",
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().goal.targetDate).toBeNull();
    const id = created.json().goal.id as string;

    const active = await app.inject({
      method: "GET",
      url: "/v1/goals/active",
      headers: legacy,
    });
    expect(active.json().goal.targetDate).toBe("2027-03-15");
    const history = await app.inject({
      method: "GET",
      url: "/v1/goals/history",
      headers: legacy,
    });
    expect(history.json().goals[0].targetDate).toBe("2027-03-15");
    // Build 9's goal settings update sends only target and pace.
    const updated = await app.inject({
      method: "PUT",
      url: `/v1/goals/${id}`,
      headers: legacy,
      payload: { target: { weightKg: 77 }, pace: "gradual" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().goal.targetDate).toBe("2027-03-15");

    expect(
      (await goalRepository.getActive(userA, { accessToken: "test-token" }))
        ?.targetDate,
    ).toBeNull();
    const currentRead = await app.inject({
      method: "GET",
      url: "/v1/goals/active",
      headers: current,
    });
    expect(currentRead.json().goal.targetDate).toBeNull();
  });

  it("returns a stored target date unchanged to legacy clients", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: legacy,
      payload: {
        kind: "cut",
        pace: "steady",
        target: { weightKg: 78 },
        startsOn: "2026-01-01",
        targetDate: "2026-02-01",
      },
    });
    const active = await app.inject({
      method: "GET",
      url: "/v1/goals/active",
      headers: legacy,
    });
    expect(active.json().goal.targetDate).toBe("2026-02-01");
  });
});
