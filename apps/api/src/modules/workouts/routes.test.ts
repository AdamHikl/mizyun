import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { StoredWorkout, UserId, WorkoutSource } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";

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
  const workoutRepository = new InMemoryWorkoutRepository();
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    workoutRepository,
  });
  apps.push(app);
  return { app, workoutRepository };
};

const seedWorkout = (
  repo: InMemoryWorkoutRepository,
  overrides: Partial<StoredWorkout> = {},
): StoredWorkout => {
  const workout: StoredWorkout = {
    id: "00000000-0000-4000-8000-00000000a001",
    userId: userA,
    name: "Leg day",
    startedAt: new Date("2026-07-10T08:00:00Z"),
    completedAt: new Date("2026-07-10T09:00:00Z"),
    notes: null,
    source: "manual" as WorkoutSource,
    details: {},
    createdAt: new Date("2026-07-10T08:00:00Z"),
    updatedAt: new Date("2026-07-10T08:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(workout);
  return workout;
};

describe("GET /v1/workouts", () => {
  it("returns an empty list for a fresh user", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/workouts",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ workouts: [] });
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({ method: "GET", url: "/v1/workouts" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it("returns the verified user's workouts newest-first", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      name: "Earlier",
      startedAt: new Date("2026-07-10T08:00:00Z"),
      completedAt: new Date("2026-07-10T09:00:00Z"),
    });
    seedWorkout(workoutRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      name: "Later",
      startedAt: new Date("2026-07-12T08:00:00Z"),
      completedAt: new Date("2026-07-12T09:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/workouts",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json().workouts.map((w: { name: string }) => w.name),
    ).toEqual(["Later", "Earlier"]);
  });

  it("never returns another user's workouts", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/workouts",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ workouts: [] });
  });

  it("filters by `from` and `to` inclusive", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      startedAt: new Date("2026-07-09T08:00:00Z"),
      completedAt: new Date("2026-07-09T09:00:00Z"),
    });
    seedWorkout(workoutRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      startedAt: new Date("2026-07-11T12:00:00Z"),
      completedAt: new Date("2026-07-11T13:00:00Z"),
    });
    seedWorkout(workoutRepository, {
      id: "00000000-0000-4000-8000-00000000a003",
      startedAt: new Date("2026-07-13T08:00:00Z"),
      completedAt: new Date("2026-07-13T09:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/workouts?from=2026-07-11&to=2026-07-13",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const ids = response.json().workouts.map((w: { id: string }) => w.id);
    expect(ids).toContain("00000000-0000-4000-8000-00000000a002");
    expect(ids).toContain("00000000-0000-4000-8000-00000000a003");
    expect(ids).not.toContain("00000000-0000-4000-8000-00000000a001");
  });

  it("rejects `from > to` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/workouts?from=2026-07-15&to=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects an out-of-range `limit` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/workouts?limit=999",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("POST /v1/workouts", () => {
  it("creates a workout with startedAt and completedAt", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Leg day",
        startedAt: "2026-07-10T08:00:00Z",
        completedAt: "2026-07-10T09:00:00Z",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.workout.name).toBe("Leg day");
    expect(body.workout.source).toBe("manual");
    expect(body.workout.completedAt).toBe("2026-07-10T09:00:00.000Z");
    expect(body.workout.userId).toBe(userA);
  });

  it("creates an in-flight workout when only `name` is provided", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Quick session" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.workout.name).toBe("Quick session");
    expect(body.workout.completedAt).toBeNull();
    // startedAt defaults to "now" — parse and assert it's recent.
    const ms = Date.parse(body.workout.startedAt);
    expect(Math.abs(Date.now() - ms)).toBeLessThan(10_000);
  });

  it("rejects completedAt < startedAt with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Leg day",
        startedAt: "2026-07-10T09:00:00Z",
        completedAt: "2026-07-10T08:00:00Z",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects a blank name with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "   " },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects an unknown field with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Leg day", mystery: "x" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 401 when the bearer token is missing", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: { "content-type": "application/json" },
      payload: { name: "Leg day" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /v1/workouts/:id", () => {
  it("returns the workout by id for the verified user", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().workout.name).toBe("Leg day");
  });

  it("returns 404 when another user's id is requested", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for a non-UUID id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/workouts/not-a-uuid",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("PUT /v1/workouts/:id", () => {
  it("applies a single-field patch and persists it", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    const patch = await app.inject({
      method: "PUT",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Pull day" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().workout.name).toBe("Pull day");

    const read = await app.inject({
      method: "GET",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(read.json().workout.name).toBe("Pull day");
  });

  it("rejects an empty patch with a 422", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    const response = await app.inject({
      method: "PUT",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(response.statusCode).toBe(422);
  });

  it("can re-open a finished workout (set completedAt to null)", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository, {
      completedAt: new Date("2026-07-10T09:00:00Z"),
    });
    const cleared = await app.inject({
      method: "PUT",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { completedAt: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().workout.completedAt).toBeNull();
  });

  it("returns 404 when another user tries to patch", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    const close: Promise<void>[] = apps.map((a) => a.close());
    await Promise.all(close);
    apps.length = 0;
    const second = build(tokenVerifierFor({ userId: userB }));
    const response = await second.app.inject({
      method: "PUT",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { name: "Hacked" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /v1/workouts/:id", () => {
  it("removes the workout and a follow-up GET returns 404", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    const del = await app.inject({
      method: "DELETE",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(del.statusCode).toBe(204);
    const read = await app.inject({
      method: "GET",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(read.statusCode).toBe(404);
  });

  it("returns 404 when another user tries to delete", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    const close: Promise<void>[] = apps.map((a) => a.close());
    await Promise.all(close);
    apps.length = 0;
    const second = build(tokenVerifierFor({ userId: userB }));
    const response = await second.app.inject({
      method: "DELETE",
      url: "/v1/workouts/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/workouts?kind=...", () => {
  it("filters routines vs sessions correctly", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      name: "Push Routine",
      startedAt: new Date("2026-07-01T08:00:00Z"),
      completedAt: null,
      details: { workoutLifecycle: { kind: "routine" } },
    });
    seedWorkout(workoutRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      name: "Push Session 1",
      startedAt: new Date("2026-07-02T08:00:00Z"),
      completedAt: new Date("2026-07-02T09:00:00Z"),
      details: {
        workoutLifecycle: {
          kind: "session",
          routineId: "00000000-0000-4000-8000-00000000a001",
        },
      },
    });

    // Query routines
    const routineRes = await app.inject({
      method: "GET",
      url: "/v1/workouts?kind=routine",
      headers: { authorization: "Bearer valid" },
    });
    expect(routineRes.statusCode).toBe(200);
    const routineBody = routineRes.json();
    expect(routineBody.workouts).toHaveLength(1);
    expect(routineBody.workouts[0].name).toBe("Push Routine");

    // Query sessions
    const sessionRes = await app.inject({
      method: "GET",
      url: "/v1/workouts?kind=session",
      headers: { authorization: "Bearer valid" },
    });
    expect(sessionRes.statusCode).toBe(200);
    const sessionBody = sessionRes.json();
    expect(sessionBody.workouts).toHaveLength(1);
    expect(sessionBody.workouts[0].name).toBe("Push Session 1");

    // Query all (no kind)
    const allRes = await app.inject({
      method: "GET",
      url: "/v1/workouts",
      headers: { authorization: "Bearer valid" },
    });
    expect(allRes.statusCode).toBe(200);
    expect(allRes.json().workouts).toHaveLength(2);
  });
});

describe("POST /v1/workouts idempotency and routine reference validation", () => {
  it("deduplicates identical workout creations with same clientOperationId", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const clientOperationId = "11111111-2222-4333-8444-555555555555";
    const payload = {
      name: "Leg day",
      clientOperationId,
      startedAt: "2026-07-10T08:00:00.000Z",
      notes: "Heavy squats",
      details: { program: "5/3/1" },
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.workout.clientOperationId).toBe(clientOperationId);
    expect(firstBody.workout.name).toBe("Leg day");

    // Replay with identical payload
    const second = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.workout.id).toBe(firstBody.workout.id);
  });

  it("returns 409 CONFLICT on clientOperationId reuse with different payload", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const clientOperationId = "22222222-3333-4444-8555-666666666666";

    const first = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Leg day",
        clientOperationId,
      },
    });
    expect(first.statusCode).toBe(200);

    // Replay with different name
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Arm day",
        clientOperationId,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "CONFLICT" },
    });
  });

  it("validates routine reference: succeeds when routine exists and belongs to user", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const routineId = "00000000-0000-4000-8000-00000000a001";
    seedWorkout(workoutRepository, {
      id: routineId,
      name: "Upper Body Routine",
      completedAt: null,
      details: { workoutLifecycle: { kind: "routine" } },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Upper Body Session",
        details: { workoutLifecycle: { kind: "session", routineId } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workout.details.workoutLifecycle).toEqual({
      kind: "session",
      routineId,
    });
  });

  it("validates routine reference: rejects malformed routine UUID with 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Session",
        details: {
          workoutLifecycle: { kind: "session", routineId: "not-a-uuid" },
        },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("valid UUID");
  });

  it("validates routine reference: rejects non-existent routine with 404", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "Session",
        details: {
          workoutLifecycle: {
            kind: "session",
            routineId: "00000000-0000-4000-8000-999999999999",
          },
        },
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain("Referenced routine not found");
  });

  it("validates routine reference: rejects cross-user routine with 404", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const routineId = "00000000-0000-4000-8000-00000000b001";
    // Seed routine belonging to userB
    seedWorkout(workoutRepository, {
      id: routineId,
      userId: userB,
      name: "User B's Routine",
      completedAt: null,
      details: { workoutLifecycle: { kind: "routine" } },
    });

    // User A tries to start session from User B's routine
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "User A's Session",
        details: { workoutLifecycle: { kind: "session", routineId } },
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain("Referenced routine not found");
  });

  it("validates routine reference: rejects referenced workout if it is a session rather than routine with 422", async () => {
    const { app, workoutRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const sessionId = "00000000-0000-4000-8000-00000000a002";
    // Seed workout that is a session, not a routine
    seedWorkout(workoutRepository, {
      id: sessionId,
      name: "Existing Session",
      details: { workoutLifecycle: { kind: "session" } },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        name: "New Session",
        details: {
          workoutLifecycle: { kind: "session", routineId: sessionId },
        },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("not a routine template");
  });
});
