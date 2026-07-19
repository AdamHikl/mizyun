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
