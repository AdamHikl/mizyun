import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type {
  StoredExercise,
  StoredWorkout,
  StoredWorkoutSet,
  UserId,
  WorkoutSource,
} from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryExerciseRepository } from "../../exercise-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";

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
  const exerciseRepository = new InMemoryExerciseRepository();
  const workoutSetRepository = new InMemoryWorkoutSetRepository();
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    workoutRepository,
    exerciseRepository,
    workoutSetRepository,
  });
  apps.push(app);
  return { app, workoutRepository, exerciseRepository, workoutSetRepository };
};

const WORKOUT_ID = "00000000-0000-4000-8000-00000000b001";
const EXERCISE_ID = "00000000-0000-4000-8000-00000000c001";

const seedWorkout = (
  repo: InMemoryWorkoutRepository,
  overrides: Partial<StoredWorkout> = {},
): StoredWorkout => {
  const workout: StoredWorkout = {
    id: WORKOUT_ID,
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

const seedExercise = (
  repo: InMemoryExerciseRepository,
  overrides: Partial<StoredExercise> = {},
): StoredExercise => {
  const exercise: StoredExercise = {
    id: EXERCISE_ID,
    userId: userA,
    name: "Back squat",
    instructions: null,
    metadata: {},
    createdAt: new Date("2026-07-10T08:00:00Z"),
    updatedAt: new Date("2026-07-10T08:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(exercise);
  return exercise;
};

const seedSet = (
  repo: InMemoryWorkoutSetRepository,
  overrides: Partial<StoredWorkoutSet> = {},
): StoredWorkoutSet => {
  const set: StoredWorkoutSet = {
    id: "00000000-0000-4000-8000-00000000d001",
    userId: userA,
    workoutId: WORKOUT_ID,
    exerciseId: EXERCISE_ID,
    sequence: 1,
    setType: "normal",
    repetitions: 8,
    loadKg: 60,
    durationSeconds: null,
    distanceMeters: null,
    perceivedExertion: 7.5,
    completedAt: new Date("2026-07-10T09:00:00Z"),
    createdAt: new Date("2026-07-10T09:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(set);
  return set;
};

describe("POST /v1/workouts/:workoutId/sets", () => {
  it("creates a set and assigns the next free sequence", async () => {
    const { app, workoutRepository, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    seedExercise(exerciseRepository);
    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        exerciseId: EXERCISE_ID,
        repetitions: 8,
        loadKg: 100,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().workoutSet.sequence).toBe(1);
    expect(response.json().workoutSet.userId).toBe(userA);
    expect(response.json().workoutSet.workoutId).toBe(WORKOUT_ID);
    expect(response.json().workoutSet.setType).toBe("normal");
  });

  it("creates a set with explicit setType (e.g. warmup)", async () => {
    const { app, workoutRepository, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    seedExercise(exerciseRepository);
    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        exerciseId: EXERCISE_ID,
        repetitions: 10,
        loadKg: 40,
        setType: "warmup",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().workoutSet.setType).toBe("warmup");
  });

  it("rejects logging a set directly on a reusable routine", async () => {
    const { app, workoutRepository, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository, {
      completedAt: null,
      details: { workoutLifecycle: { kind: "routine" } },
    });
    seedExercise(exerciseRepository);

    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        exerciseId: EXERCISE_ID,
        repetitions: 8,
        loadKg: 100,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/Start a workout session/);
  });

  it("honours a client-supplied sequence", async () => {
    const { app, workoutRepository, workoutSetRepository, exerciseRepository } =
      build(tokenVerifierFor({ userId: userA }));
    seedWorkout(workoutRepository);
    seedExercise(exerciseRepository);
    seedSet(workoutSetRepository, { sequence: 1 });
    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        exerciseId: EXERCISE_ID,
        sequence: 2,
        repetitions: 8,
        loadKg: 100,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().workoutSet.sequence).toBe(2);
  });

  it("rejects a sequence collision with a 409", async () => {
    const { app, workoutRepository, workoutSetRepository, exerciseRepository } =
      build(tokenVerifierFor({ userId: userA }));
    seedWorkout(workoutRepository);
    seedExercise(exerciseRepository);
    seedSet(workoutSetRepository, { sequence: 1 });
    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        exerciseId: EXERCISE_ID,
        sequence: 1,
        repetitions: 8,
        loadKg: 100,
      },
    });
    expect(response.statusCode).toBe(409);
  });

  it("rejects an empty set body with a 422", async () => {
    const { app, workoutRepository, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    seedExercise(exerciseRepository);
    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        exerciseId: EXERCISE_ID,
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects an exercise the user does not own with a 422", async () => {
    const { app, workoutRepository, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    // Exercise belongs to userB.
    seedExercise(exerciseRepository, { id: EXERCISE_ID, userId: userB });
    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        exerciseId: EXERCISE_ID,
        repetitions: 8,
        loadKg: 100,
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 404 for a non-UUID workout id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/not-a-uuid/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        exerciseId: EXERCISE_ID,
        repetitions: 8,
        loadKg: 100,
      },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 when the workout belongs to another user", async () => {
    const { app, workoutRepository, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository, { userId: userB });
    seedExercise(exerciseRepository);
    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        exerciseId: EXERCISE_ID,
        repetitions: 8,
        loadKg: 100,
      },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/workouts/:workoutId/sets", () => {
  it("returns the workout's sets ordered by sequence", async () => {
    const { app, workoutRepository, workoutSetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    seedSet(workoutSetRepository, {
      id: "00000000-0000-4000-8000-00000000d001",
      sequence: 1,
    });
    seedSet(workoutSetRepository, {
      id: "00000000-0000-4000-8000-00000000d003",
      sequence: 3,
    });
    seedSet(workoutSetRepository, {
      id: "00000000-0000-4000-8000-00000000d002",
      sequence: 2,
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const sequences = response
      .json()
      .workoutSets.map((s: { sequence: number }) => s.sequence);
    expect(sequences).toEqual([1, 2, 3]);
  });

  it("returns 404 for a workout that belongs to another user", async () => {
    const { app, workoutRepository, workoutSetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository, { userId: userB });
    seedSet(workoutSetRepository);
    const response = await app.inject({
      method: "GET",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /v1/workouts/:workoutId/sets/:setId", () => {
  it("removes the set and a follow-up GET omits it", async () => {
    const { app, workoutRepository, workoutSetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    seedSet(workoutSetRepository);
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/workouts/${WORKOUT_ID}/sets/00000000-0000-4000-8000-00000000d001`,
      headers: { authorization: "Bearer valid" },
    });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({
      method: "GET",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: { authorization: "Bearer valid" },
    });
    expect(list.json().workoutSets).toHaveLength(0);
  });

  it("returns 404 when the set belongs to another user", async () => {
    const { app, workoutRepository, workoutSetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    seedSet(workoutSetRepository, { userId: userB });
    const response = await app.inject({
      method: "DELETE",
      url: `/v1/workouts/${WORKOUT_ID}/sets/00000000-0000-4000-8000-00000000d001`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 when the set is in a different workout", async () => {
    const { app, workoutRepository, workoutSetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedWorkout(workoutRepository);
    seedSet(workoutSetRepository, {
      workoutId: "00000000-0000-4000-8000-00000000b099",
    });
    const response = await app.inject({
      method: "DELETE",
      url: `/v1/workouts/${WORKOUT_ID}/sets/00000000-0000-4000-8000-00000000d001`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/exercises/:exerciseId/recent-sets", () => {
  it("returns the user's recent sets and a summary block", async () => {
    const { app, workoutRepository, exerciseRepository, workoutSetRepository } =
      build(tokenVerifierFor({ userId: userA }));
    seedWorkout(workoutRepository);
    seedExercise(exerciseRepository);
    seedSet(workoutSetRepository, {
      id: "00000000-0000-4000-8000-00000000d001",
      sequence: 1,
      loadKg: 80,
      repetitions: 8,
      workoutId: "00000000-0000-4000-8000-00000000b099",
    });
    seedSet(workoutSetRepository, {
      id: "00000000-0000-4000-8000-00000000d002",
      sequence: 1,
      loadKg: 100,
      repetitions: 5,
      workoutId: WORKOUT_ID,
      createdAt: new Date("2026-07-11T08:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/exercises/${EXERCISE_ID}/recent-sets`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.sets).toHaveLength(2);
    expect(body.summary.bestLoadKg).toBe(100);
    expect(body.summary.totalSetCount).toBe(2);
    // Newest session is WORKOUT_ID; volume = 100*5 = 500
    expect(body.summary.lastSessionVolumeKg).toBe(500);
  });

  it("returns a zero-summary for a fresh user", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const response = await app.inject({
      method: "GET",
      url: `/v1/exercises/${EXERCISE_ID}/recent-sets`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary).toEqual({
      bestLoadKg: null,
      lastSessionVolumeKg: null,
      totalSetCount: 0,
    });
  });

  it("excludes the active workout from previous performance", async () => {
    const { app, exerciseRepository, workoutSetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    seedSet(workoutSetRepository, {
      id: "00000000-0000-4000-8000-00000000d001",
      workoutId: "00000000-0000-4000-8000-00000000b099",
      loadKg: 80,
      repetitions: 5,
    });
    seedSet(workoutSetRepository, {
      id: "00000000-0000-4000-8000-00000000d002",
      workoutId: WORKOUT_ID,
      loadKg: 120,
      repetitions: 5,
      createdAt: new Date("2026-07-12T08:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/exercises/${EXERCISE_ID}/recent-sets?excludeWorkoutId=${WORKOUT_ID}`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().sets).toHaveLength(1);
    expect(response.json().sets[0].workoutId).not.toBe(WORKOUT_ID);
    expect(response.json().summary.bestLoadKg).toBe(80);
  });

  it("returns 404 for an exercise the user does not own", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository, { userId: userB });
    const response = await app.inject({
      method: "GET",
      url: `/v1/exercises/${EXERCISE_ID}/recent-sets`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects an out-of-range `limit` with a 422", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedExercise(exerciseRepository);
    const response = await app.inject({
      method: "GET",
      url: `/v1/exercises/${EXERCISE_ID}/recent-sets?limit=999`,
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
  });
});
