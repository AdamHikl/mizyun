import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";
import type { Exercise, Workout } from "@mizyun/contracts";

import {
  addWorkoutSetWith,
  completeWorkoutWith,
  createExerciseWith,
  loadRecentPerformanceWith,
  loadWorkoutWorkspaceWith,
  startWorkoutWith,
} from "./log-workout-data";

const NOW = new Date("2026-07-19T10:15:00.000Z");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const WORKOUT_ID = "00000000-0000-4000-8000-000000000002";
const EXERCISE_ID = "00000000-0000-4000-8000-000000000003";

const EXERCISE: Exercise = {
  id: EXERCISE_ID,
  userId: USER_ID,
  name: "Back squat",
  instructions: null,
  metadata: {},
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

const WORKOUT: Workout = {
  id: WORKOUT_ID,
  userId: USER_ID,
  name: "Legs",
  startedAt: NOW.toISOString(),
  completedAt: null,
  notes: null,
  source: "manual",
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
    if (result === undefined) throw new Error("missing queued result");
    return Promise.resolve(result as Result<T, ApiError>);
  },
  status: () => ({ configured: true, baseUrl: "https://example.test" }),
});

describe("workout workspace", () => {
  it("recovers an incomplete workout and its persisted sets", async () => {
    const requests: RequestOptions[] = [];
    const workspace = await loadWorkoutWorkspaceWith(
      queuedClient(
        [
          { ok: true, value: { exercises: [EXERCISE] } },
          { ok: true, value: { workouts: [WORKOUT] } },
          { ok: true, value: { workoutSets: [] } },
        ],
        requests,
      ),
    );
    expect(workspace.workout).toEqual(WORKOUT);
    expect(workspace.exercises).toEqual([EXERCISE]);
    expect(requests[2]?.path).toBe(`/v1/workouts/${WORKOUT_ID}/sets`);
  });

  it("returns a retry message when the initial workspace load fails", async () => {
    const workspace = await loadWorkoutWorkspaceWith(
      queuedClient([
        { ok: false, error: { kind: "network_error", cause: new Error() } },
        { ok: true, value: { workouts: [] } },
      ]),
    );
    expect(workspace.message).toMatch(/Network unavailable/);
  });
});

describe("workout lifecycle", () => {
  it("starts an incomplete workout", async () => {
    const requests: RequestOptions[] = [];
    const result = await startWorkoutWith(
      queuedClient([{ ok: true, value: { workout: WORKOUT } }], requests),
      " Legs ",
      " Strength ",
      () => NOW,
    );
    expect(result.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/workouts",
      body: {
        name: "Legs",
        notes: "Strength",
        startedAt: NOW.toISOString(),
      },
    });
  });

  it("creates a custom exercise", async () => {
    const requests: RequestOptions[] = [];
    const result = await createExerciseWith(
      queuedClient([{ ok: true, value: { exercise: EXERCISE } }], requests),
      " Back squat ",
      " Brace ",
    );
    expect(result.ok).toBe(true);
    expect(requests[0]?.body).toEqual({
      name: "Back squat",
      instructions: "Brace",
    });
  });

  it("adds an imperial load as canonical kilograms", async () => {
    const requests: RequestOptions[] = [];
    const result = await addWorkoutSetWith(
      queuedClient([{ ok: true, value: { workoutSet: {} } }], requests),
      WORKOUT_ID,
      {
        exerciseId: EXERCISE_ID,
        repetitions: "5",
        load: "225",
        durationSeconds: "",
        distanceMeters: "",
        perceivedExertion: "8.5",
        unitSystem: "imperial",
      },
      () => NOW,
    );
    expect(result.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      method: "POST",
      body: {
        exerciseId: EXERCISE_ID,
        repetitions: 5,
        loadKg: 102.058,
        perceivedExertion: 8.5,
      },
    });
  });

  it("rejects an empty set without calling the API", async () => {
    const requests: RequestOptions[] = [];
    const result = await addWorkoutSetWith(
      queuedClient([], requests),
      WORKOUT_ID,
      {
        exerciseId: EXERCISE_ID,
        repetitions: "",
        load: "",
        durationSeconds: "",
        distanceMeters: "",
        perceivedExertion: "",
        unitSystem: "metric",
      },
    );
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("loads previous performance and completes the workout", async () => {
    const requests: RequestOptions[] = [];
    const client = queuedClient(
      [
        {
          ok: true,
          value: {
            sets: [],
            summary: {
              bestLoadKg: 100,
              lastSessionVolumeKg: 2000,
              totalSetCount: 10,
            },
          },
        },
        { ok: true, value: { workout: { ...WORKOUT, completedAt: NOW } } },
      ],
      requests,
    );
    const recent = await loadRecentPerformanceWith(
      client,
      EXERCISE_ID,
      WORKOUT_ID,
    );
    const completed = await completeWorkoutWith(client, WORKOUT_ID, () => NOW);
    expect(recent?.summary.bestLoadKg).toBe(100);
    expect(requests[0]?.path).toContain(`excludeWorkoutId=${WORKOUT_ID}`);
    expect(completed.ok).toBe(true);
    expect(requests[1]).toMatchObject({
      method: "PUT",
      body: { completedAt: NOW.toISOString() },
    });
  });
});
