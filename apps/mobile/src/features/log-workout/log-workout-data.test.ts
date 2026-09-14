import { describe, expect, it } from "vitest";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import {
  readWorkoutLifecycle,
  withWorkoutLifecycle,
  type Result,
} from "@mizyun/core";
import type { Exercise, Workout } from "@mizyun/contracts";

import {
  abandonWorkoutWith,
  addWorkoutSetWith,
  completeWorkoutWith,
  createExerciseWith,
  extractPlannedExercises,
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

  it("does not recover a saved routine as an active session", async () => {
    const routine = {
      ...WORKOUT,
      details: withWorkoutLifecycle(
        { coachPlan: { exercises: [{ name: "Squat", sets: 3 }] } },
        { kind: "routine" },
      ),
    };
    const workspace = await loadWorkoutWorkspaceWith(
      queuedClient([
        { ok: true, value: { exercises: [EXERCISE] } },
        { ok: true, value: { workouts: [routine] } },
      ]),
    );

    expect(workspace.workout).toBeNull();
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

  it("loads a specific workout when targetWorkoutId is provided", async () => {
    const OTHER_WORKOUT_ID = "00000000-0000-4000-8000-000000000099";
    const otherWorkout: Workout = {
      ...WORKOUT,
      id: OTHER_WORKOUT_ID,
      name: "Day 1 Upper",
    };
    const requests: RequestOptions[] = [];
    const workspace = await loadWorkoutWorkspaceWith(
      queuedClient(
        [
          { ok: true, value: { exercises: [EXERCISE] } },
          { ok: true, value: { workouts: [WORKOUT, otherWorkout] } },
          { ok: true, value: { workoutSets: [] } },
        ],
        requests,
      ),
      OTHER_WORKOUT_ID,
    );
    expect(workspace.workout?.id).toBe(OTHER_WORKOUT_ID);
    expect(workspace.workout?.name).toBe("Day 1 Upper");
    expect(requests[2]?.path).toBe(`/v1/workouts/${OTHER_WORKOUT_ID}/sets`);
  });

  it("prioritizes the earliest incomplete workout when no target is provided", async () => {
    const day1: Workout = {
      ...WORKOUT,
      id: "00000000-0000-4000-8000-000000000001",
      name: "Day 1 Upper",
      startedAt: "2026-08-25T12:00:00.000Z",
    };
    const day3: Workout = {
      ...WORKOUT,
      id: "00000000-0000-4000-8000-000000000003",
      name: "Day 3 Lower",
      startedAt: "2026-08-29T12:00:00.000Z",
    };
    const requests: RequestOptions[] = [];
    // Workouts returned newest-first from API (day3 first, then day1)
    const workspace = await loadWorkoutWorkspaceWith(
      queuedClient(
        [
          { ok: true, value: { exercises: [EXERCISE] } },
          { ok: true, value: { workouts: [day3, day1] } },
          { ok: true, value: { workoutSets: [] } },
        ],
        requests,
      ),
    );
    // Should pick day1 (earliest or matching today) instead of day3
    expect(workspace.workout?.id).toBe(day1.id);
    expect(workspace.workout?.name).toBe("Day 1 Upper");
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
    expect(
      readWorkoutLifecycle(
        (requests[0]?.body as { details: Record<string, unknown> }).details,
      ),
    ).toEqual({ kind: "session" });
  });

  it("retains the confirmed Coach proposal as workout provenance", async () => {
    const requests: RequestOptions[] = [];
    const proposal = {
      kind: "workout_start",
      prescriptionVersion: "training-prescription-v1",
      userConfirmed: true,
    };
    const result = await startWorkoutWith(
      queuedClient([{ ok: true, value: { workout: WORKOUT } }], requests),
      " Full body A ",
      " Coach plan ",
      () => NOW,
      { aiDraft: proposal },
    );
    expect(result.ok).toBe(true);
    expect(requests[0]?.body).toMatchObject({
      name: "Full body A",
      details: { aiDraft: proposal },
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
    if (result.ok) {
      expect(result.workoutSet).toBeDefined();
    }
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

  it("handles decimal load with comma separator (European keypad)", async () => {
    const requests: RequestOptions[] = [];
    const result = await addWorkoutSetWith(
      queuedClient([{ ok: true, value: { workoutSet: {} } }], requests),
      WORKOUT_ID,
      {
        exerciseId: EXERCISE_ID,
        repetitions: "7",
        load: "12,5",
        durationSeconds: "",
        distanceMeters: "",
        perceivedExertion: "",
        unitSystem: "metric",
      },
      () => NOW,
    );
    expect(result.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      method: "POST",
      body: {
        exerciseId: EXERCISE_ID,
        repetitions: 7,
        loadKg: 12.5,
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

  it("adjusts startedAt when completing a future-scheduled workout today", async () => {
    const requests: RequestOptions[] = [];
    const client = queuedClient(
      [{ ok: true, value: { workout: { ...WORKOUT, completedAt: NOW } } }],
      requests,
    );
    const FUTURE_STARTED_AT = "2026-08-29T12:00:00.000Z";
    const completed = await completeWorkoutWith(
      client,
      WORKOUT_ID,
      () => NOW,
      FUTURE_STARTED_AT,
    );
    expect(completed.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      method: "PUT",
      body: {
        completedAt: NOW.toISOString(),
        startedAt: NOW.toISOString(),
      },
    });
  });

  it("discards only the active session record", async () => {
    const requests: RequestOptions[] = [];
    const sessionId = "00000000-0000-4000-8000-000000000099";
    const result = await abandonWorkoutWith(
      queuedClient([{ ok: true, value: undefined }], requests),
      sessionId,
    );

    expect(result.ok).toBe(true);
    expect(requests).toEqual([
      {
        method: "DELETE",
        path: `/v1/workouts/${sessionId}`,
      },
    ]);
  });
});

describe("extractPlannedExercises", () => {
  it("extracts planned exercises with targetLoad from coachPlan", () => {
    const routineWorkout: Workout = {
      ...WORKOUT,
      details: {
        coachPlan: {
          exercises: [
            {
              catalogId: "barbell_deadlift",
              name: "Barbell Deadlift",
              sets: 3,
              targetSets: 3,
              targetReps: "4-5",
              targetLoad: "140 kg",
              restSeconds: 90,
            },
            {
              catalogId: "weighted_pull_ups",
              name: "Weighted Pull Ups",
              sets: 4,
              repsMin: 4,
              repsMax: 6,
              targetLoad: "15",
              restSeconds: 90,
            },
            {
              name: "Bodyweight Dips",
              sets: 3,
              targetReps: "10-12",
              restSeconds: 60,
            },
          ],
        },
      },
    };

    const planned = extractPlannedExercises(routineWorkout);
    expect(planned).toHaveLength(3);

    expect(planned[0]).toEqual({
      catalogId: "barbell_deadlift",
      name: "Barbell Deadlift",
      sets: 3,
      repsMin: 4,
      repsMax: 5,
      durationMinutes: null,
      restSeconds: 90,
      targetLoad: "140 kg",
    });

    expect(planned[1]).toEqual({
      catalogId: "weighted_pull_ups",
      name: "Weighted Pull Ups",
      sets: 4,
      repsMin: 4,
      repsMax: 6,
      durationMinutes: null,
      restSeconds: 90,
      targetLoad: "15",
    });

    expect(planned[2]).toEqual({
      catalogId: "",
      name: "Bodyweight Dips",
      sets: 3,
      repsMin: 10,
      repsMax: 12,
      durationMinutes: null,
      restSeconds: 60,
    });
  });

  it("handles numeric targetLoad and targetLoadKg in details", () => {
    const workout: Workout = {
      ...WORKOUT,
      details: {
        coachPlan: {
          exercises: [
            {
              name: "Bench Press",
              sets: 3,
              repsMin: 8,
              repsMax: 10,
              targetLoad: 80,
            },
            {
              name: "Squat",
              sets: 5,
              repsMin: 5,
              repsMax: 5,
              targetLoadKg: 120,
            },
          ],
        },
      },
    };

    const planned = extractPlannedExercises(workout);
    expect(planned[0]?.targetLoad).toBe("80");
    expect(planned[1]?.targetLoad).toBe("120 kg");
  });

  it("extracts from aiDraft and workoutProposal shapes", () => {
    const aiWorkout: Workout = {
      ...WORKOUT,
      details: {
        aiDraft: {
          session: {
            exercises: [
              {
                catalogId: "overhead_press",
                name: "Overhead Press",
                sets: 3,
                repsMin: 6,
                repsMax: 8,
                targetLoad: "50 kg",
                restSeconds: 90,
              },
            ],
          },
        },
      },
    };

    const planned = extractPlannedExercises(aiWorkout);
    expect(planned).toHaveLength(1);
    expect(planned[0]?.name).toBe("Overhead Press");
    expect(planned[0]?.targetLoad).toBe("50 kg");
  });

  it("returns empty array when workout has no details or empty exercises", () => {
    expect(extractPlannedExercises(null)).toEqual([]);
    expect(extractPlannedExercises(WORKOUT)).toEqual([]);
    expect(
      extractPlannedExercises({
        ...WORKOUT,
        details: { coachPlan: { exercises: [] } },
      }),
    ).toEqual([]);
  });
});
