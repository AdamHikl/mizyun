import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import {
  WorkoutSetSequenceCollisionError,
  type StoredExercise,
  type StoredWorkout,
  type StoredWorkoutSet,
  type UserId,
  type WorkoutSource,
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

  it("rejects a body whose performance fields are all null with a 422", async () => {
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
        repetitions: null,
        loadKg: null,
        durationSeconds: null,
        distanceMeters: null,
      },
    });
    expect(response.statusCode).toBe(422);
    const empty = await app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { exerciseId: EXERCISE_ID },
    });
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(response.json().error.message).toBe(empty.json().error.message);
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

describe("past workout entry (log a workout after the fact)", () => {
  it("accepts a backdated completed session and keeps newer live performance as the last session", async () => {
    const { app, workoutRepository, exerciseRepository, workoutSetRepository } =
      build(tokenVerifierFor({ userId: userA }));
    seedExercise(exerciseRepository);
    // A live session from yesterday, entered when it happened.
    seedWorkout(workoutRepository, {
      startedAt: new Date("2026-10-16T08:00:00Z"),
      completedAt: new Date("2026-10-16T09:00:00Z"),
    });
    seedSet(workoutSetRepository, {
      loadKg: 100,
      repetitions: 5,
      completedAt: new Date("2026-10-16T08:30:00Z"),
      createdAt: new Date("2026-10-16T08:30:00Z"),
    });
    const headers = {
      authorization: "Bearer valid",
      "content-type": "application/json",
    };
    const workoutBody = {
      clientOperationId: "00000000-0000-4000-8000-00000000e001",
      name: "Remembered push",
      startedAt: "2026-10-10T17:00:00.000Z",
      completedAt: "2026-10-10T18:00:00.000Z",
      details: {
        sessionMode: "one_time",
        entryMode: "past",
        sessionExercises: [{ name: "Back squat", restSeconds: 90 }],
        workoutLifecycle: { kind: "session" },
      },
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers,
      payload: workoutBody,
    });
    expect(created.statusCode).toBe(200);
    const workout = created.json().workout;
    expect(workout.completedAt).toBe(workoutBody.completedAt);
    // A replay after a lost response returns the same workout.
    const replay = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers,
      payload: workoutBody,
    });
    expect(replay.json().workout.id).toBe(workout.id);

    const set = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workout.id}/sets`,
      headers,
      payload: {
        exerciseId: EXERCISE_ID,
        sequence: 1,
        repetitions: 8,
        loadKg: 60,
        completedAt: workoutBody.completedAt,
      },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().workoutSet.completedAt).toBe(workoutBody.completedAt);
    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workout.id}/sets`,
      headers,
      payload: {
        exerciseId: EXERCISE_ID,
        sequence: 1,
        repetitions: 8,
        completedAt: workoutBody.completedAt,
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const recent = await app.inject({
      method: "GET",
      url: `/v1/exercises/${EXERCISE_ID}/recent-sets`,
      headers: { authorization: "Bearer valid" },
    });
    expect(recent.statusCode).toBe(200);
    // The backdated set was inserted last but performed earlier.
    expect(recent.json().sets[0].workoutId).toBe(WORKOUT_ID);
    expect(recent.json().summary.lastSessionVolumeKg).toBe(500);
  });
});

describe("POST /v1/workouts/:workoutId/sets retry identity (REL-02 / REL-04)", () => {
  const OPERATION = "0000000A-0000-4000-8000-00000000E0A1";
  const headers = {
    authorization: "Bearer valid",
    "content-type": "application/json",
  };
  const keyedBody = {
    clientOperationId: OPERATION,
    exerciseId: EXERCISE_ID,
    sequence: 1,
    repetitions: 8,
    loadKg: 82.125,
    perceivedExertion: 8,
    completedAt: "2026-07-10T08:30:00.000+02:00",
  };
  const post = (
    app: ReturnType<typeof buildApp>,
    payload: unknown,
    authorization = headers.authorization,
  ) =>
    app.inject({
      method: "POST",
      url: `/v1/workouts/${WORKOUT_ID}/sets`,
      headers: { ...headers, authorization },
      payload: payload as Record<string, unknown>,
    });

  const setup = () => {
    const built = build(tokenVerifierFor({ userId: userA }));
    seedWorkout(built.workoutRepository);
    seedExercise(built.exerciseRepository);
    return built;
  };

  it("returns the saved set for an identical replay without a second row", async () => {
    const { app, workoutSetRepository } = setup();
    const first = await post(app, keyedBody);
    expect(first.statusCode).toBe(200);
    const replay = await post(app, keyedBody);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(first.json().workoutSet).not.toHaveProperty("clientOperationId");
    const rows = await workoutSetRepository.listForWorkout(WORKOUT_ID, {
      accessToken: "test-token",
    });
    expect(rows).toHaveLength(1);
    // Stored lowercase so differently cased replays share one identity.
    expect(rows[0]?.clientOperationId).toBe(OPERATION.toLowerCase());
    const lowerReplay = await post(app, {
      ...keyedBody,
      clientOperationId: OPERATION.toLowerCase(),
      completedAt: "2026-07-10T06:30:00.000Z",
    });
    expect(lowerReplay.json().workoutSet.id).toBe(first.json().workoutSet.id);
  });

  it("rejects a replay whose payload changed with a 409 CONFLICT", async () => {
    const { app, workoutSetRepository } = setup();
    await post(app, keyedBody);
    for (const change of [
      { loadKg: 82.5 },
      { repetitions: 9 },
      { setType: "warmup" },
      { completedAt: "2026-07-10T06:31:00.000Z" },
      { perceivedExertion: null },
    ]) {
      const response = await post(app, { ...keyedBody, ...change });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("CONFLICT");
    }
    expect(
      await workoutSetRepository.listForWorkout(WORKOUT_ID, {
        accessToken: "test-token",
      }),
    ).toHaveLength(1);
  });

  it("requires a non-null completedAt for keyed creates", async () => {
    const { app } = setup();
    for (const completedAt of [undefined, null]) {
      const response = await post(app, { ...keyedBody, completedAt });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("keeps keyless older-client appends unchanged", async () => {
    const { app, workoutSetRepository } = setup();
    const body = { exerciseId: EXERCISE_ID, repetitions: 8, loadKg: 60 };
    const a = await post(app, body);
    const b = await post(app, body);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().workoutSet.id).not.toBe(b.json().workoutSet.id);
    expect(b.json().workoutSet.sequence).toBe(2);
    expect(
      await workoutSetRepository.listForWorkout(WORKOUT_ID, {
        accessToken: "test-token",
      }),
    ).toHaveLength(2);
    // A keyless sequence collision is still rejected.
    const collision = await post(app, { ...body, sequence: 1 });
    expect(collision.statusCode).toBe(409);
  });

  it("moves a keyed set to the next free sequence when its number is taken, and replays it", async () => {
    const { app, workoutSetRepository } = setup();
    seedSet(workoutSetRepository, { sequence: 1 });
    seedSet(workoutSetRepository, {
      id: "00000000-0000-4000-8000-00000000d002",
      sequence: 2,
    });
    const saved = await post(app, keyedBody);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().workoutSet.sequence).toBe(3);
    const replay = await post(app, keyedBody);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().workoutSet.id).toBe(saved.json().workoutSet.id);
    expect(replay.json().workoutSet.sequence).toBe(3);
    expect(
      await workoutSetRepository.listForWorkout(WORKOUT_ID, {
        accessToken: "test-token",
      }),
    ).toHaveLength(3);
  });

  it("returns the concurrent winner when another replay saved the identity mid-retry", async () => {
    const { app, workoutSetRepository } = setup();
    seedSet(workoutSetRepository, { sequence: 1 });
    const originalCreate =
      workoutSetRepository.create.bind(workoutSetRepository);
    const find =
      workoutSetRepository.findByClientOperationId.bind(workoutSetRepository);
    let lookups = 0;
    workoutSetRepository.findByClientOperationId = async (...args) => {
      lookups += 1;
      return find(...args);
    };
    let first = true;
    workoutSetRepository.create = async (userId, set, options) => {
      if (first) {
        first = false;
        // A concurrent replay of the same operation wins at sequence 2
        // while this request's insert reports only the sequence 1
        // collision (Postgres may report either unique violation).
        await originalCreate(
          userId,
          { ...set, id: "00000000-0000-4000-8000-00000000d0aa", sequence: 2 },
          options,
        );
        throw new WorkoutSetSequenceCollisionError(set.workoutId, set.sequence);
      }
      return originalCreate(userId, set, options);
    };
    const response = await post(app, keyedBody);
    expect(response.statusCode).toBe(200);
    expect(response.json().workoutSet.id).toBe(
      "00000000-0000-4000-8000-00000000d0aa",
    );
    // Initial lookup plus the re-check before moving the sequence.
    expect(lookups).toBe(2);
    expect(
      await workoutSetRepository.listForWorkout(WORKOUT_ID, {
        accessToken: "test-token",
      }),
    ).toHaveLength(2);
  });

  it("keeps a keyed create retryable when the database fails, never a discardable 409", async () => {
    const { app, workoutSetRepository } = setup();
    const originalCreate =
      workoutSetRepository.create.bind(workoutSetRepository);
    workoutSetRepository.create = async () => {
      throw new Error("connection terminated");
    };
    const failed = await post(app, keyedBody);
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    workoutSetRepository.create = originalCreate;
    const replay = await post(app, keyedBody);
    expect(replay.statusCode).toBe(200);
    expect(
      await workoutSetRepository.listForWorkout(WORKOUT_ID, {
        accessToken: "test-token",
      }),
    ).toHaveLength(1);
  });

  it("answers a retryable 503, not a discardable 409, when keyed renumbering is exhausted", async () => {
    const { app, workoutSetRepository } = setup();
    workoutSetRepository.create = async (_userId, set) => {
      throw new WorkoutSetSequenceCollisionError(set.workoutId, set.sequence);
    };
    const response = await post(app, keyedBody);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("rejects a concurrent winner with a different payload", async () => {
    const { app, workoutSetRepository } = setup();
    const originalCreate =
      workoutSetRepository.create.bind(workoutSetRepository);
    workoutSetRepository.create = async (userId, set, options) => {
      await originalCreate(
        userId,
        {
          ...set,
          id: "00000000-0000-4000-8000-00000000d0bb",
          sequence: 5,
          loadKg: 90,
        },
        options,
      );
      return originalCreate(userId, set, options);
    };
    const response = await post(app, keyedBody);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONFLICT");
  });

  it("rejects an identity already used in a different workout", async () => {
    const { app, workoutRepository } = setup();
    const otherWorkout = "00000000-0000-4000-8000-00000000b002";
    seedWorkout(workoutRepository, { id: otherWorkout });
    await post(app, keyedBody);
    const response = await app.inject({
      method: "POST",
      url: `/v1/workouts/${otherWorkout}/sets`,
      headers,
      payload: keyedBody,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONFLICT");
  });

  it("returns 404 for a replay after the workout was deleted", async () => {
    const { app } = setup();
    expect((await post(app, keyedBody)).statusCode).toBe(200);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/workouts/${WORKOUT_ID}`,
      headers: { authorization: headers.authorization },
    });
    expect(deleted.statusCode).toBe(204);
    const replay = await post(app, keyedBody);
    expect(replay.statusCode).toBe(404);
  });

  it("treats another user's identical UUID as an independent operation", async () => {
    const verifier: AccessTokenVerifier = {
      verify: async (token) =>
        token === "valid" || token === "valid-b"
          ? {
              userId: token === "valid" ? userA : userB,
              role: "authenticated",
              accessToken: "test-token",
            }
          : null,
    };
    const { app, workoutRepository, exerciseRepository, workoutSetRepository } =
      build(verifier);
    seedWorkout(workoutRepository);
    seedExercise(exerciseRepository);
    const workoutB = "00000000-0000-4000-8000-00000000b0b0";
    const exerciseB = "00000000-0000-4000-8000-00000000c0b0";
    seedWorkout(workoutRepository, { id: workoutB, userId: userB });
    seedExercise(exerciseRepository, { id: exerciseB, userId: userB });
    const a = await post(app, keyedBody);
    const b = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workoutB}/sets`,
      headers: { ...headers, authorization: "Bearer valid-b" },
      payload: { ...keyedBody, exerciseId: exerciseB },
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json().workoutSet.id).not.toBe(a.json().workoutSet.id);
    expect(b.json().workoutSet.userId).toBe(userB);
    expect(
      await workoutSetRepository.findByClientOperationId(
        userA,
        OPERATION.toLowerCase(),
        { accessToken: "test-token" },
      ),
    ).toMatchObject({ id: a.json().workoutSet.id });
  });
});
