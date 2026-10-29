import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { Exercise, Workout, WorkoutSet } from "@mizyun/contracts";
import { readWorkoutLifecycle, withWorkoutLifecycle } from "@mizyun/core";

import {
  calculateWorkoutVolume,
  extractPlannedExercisesFromWorkout,
  formatWorkoutDisplayDate,
  processWorkout,
  fetchWorkoutsHubData,
  fetchWorkout,
  deleteWorkout,
  createBlankWorkout,
  createBlankWorkoutWith,
  createCustomWorkout,
  startRoutineSessionWith,
  syncRoutineExerciseTargets,
  updateWorkoutDetails,
} from "./workouts-hub-data";

it("round trips planned set types through routine create, edit, progression and fresh session start", async () => {
  const types = ["warmup", "normal", "failure"] as const;
  let stored: Workout = {
    id: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000001",
    name: "Routine",
    startedAt: "2026-10-07T10:00:00.000Z",
    completedAt: null,
    source: "manual",
    notes: null,
    details: {},
    createdAt: "2026-10-07T10:00:00.000Z",
    updatedAt: "2026-10-07T10:00:00.000Z",
  };
  const request = vi.fn().mockImplementation(async ({ method, body }) => {
    if (method !== "GET") stored = { ...stored, ...body };
    return { ok: true, value: { workout: stored } };
  });
  const client = { request } as unknown as ApiClient;
  const created = await createCustomWorkout(
    {
      name: "Routine",
      plannedExercises: [
        { name: "Squat", targetSets: 3, targetReps: "8-12", setTypes: types },
      ],
    },
    client,
  );
  expect(created.ok).toBe(true);
  let exercises = extractPlannedExercisesFromWorkout(stored);
  expect(exercises[0]?.setTypes).toEqual(types);
  await updateWorkoutDetails(
    stored.id,
    { plannedExercises: exercises },
    client,
  );
  expect(extractPlannedExercisesFromWorkout(stored)[0]?.setTypes).toEqual(
    types,
  );
  await syncRoutineExerciseTargets(stored.id, new Map([["squat", 55]]), client);
  exercises = extractPlannedExercisesFromWorkout(stored);
  expect(exercises[0]).toMatchObject({ setTypes: types, targetLoad: "55 kg" });
  const started = await startRoutineSessionWith(
    client,
    stored,
    () => new Date("2026-10-07T12:00:00.000Z"),
  );
  expect(started.ok).toBe(true);
  expect(extractPlannedExercisesFromWorkout(stored)[0]?.setTypes).toEqual(
    types,
  );
  expect(readWorkoutLifecycle(stored.details)?.kind).toBe("session");
});

describe("workouts-hub-data", () => {
  const mockExercise: Exercise = {
    id: "ex-1",
    userId: "usr-1",
    name: "Barbell Bench Press",
    instructions: null,
    metadata: {},
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };

  const mockPlannedWorkout: Workout = {
    id: "w-planned-1",
    userId: "usr-1",
    name: "Session 1: Upper Body",
    startedAt: "2026-08-26T08:00:00.000Z",
    completedAt: null,
    source: "manual",
    notes: "Planned upper body push/pull routine",
    details: {
      coachPlan: {
        exercises: [
          {
            name: "Barbell Bench Press",
            targetSets: 3,
            targetReps: "8-10",
            targetLoad: "70 kg",
          },
          {
            name: "Pull Up",
            sets: 3,
            repsMin: 6,
            repsMax: 8,
          },
        ],
      },
    },
    createdAt: "2026-08-26T08:00:00.000Z",
    updatedAt: "2026-08-26T08:00:00.000Z",
  };

  const mockCompletedWorkout: Workout = {
    id: "w-completed-1",
    userId: "usr-1",
    name: "Full Body Strength",
    startedAt: "2026-08-25T09:00:00.000Z",
    completedAt: "2026-08-25T10:00:00.000Z",
    source: "manual",
    notes: null,
    details: {},
    createdAt: "2026-08-25T09:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
  };

  const mockSets: WorkoutSet[] = [
    {
      id: "set-1",
      userId: "usr-1",
      workoutId: "w-completed-1",
      exerciseId: "ex-1",
      sequence: 1,
      setType: "normal" as const,
      repetitions: 10,
      loadKg: 80,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 8,
      completedAt: null,
      createdAt: "2026-08-25T09:15:00.000Z",
    },
    {
      id: "set-2",
      userId: "usr-1",
      workoutId: "w-completed-1",
      exerciseId: "ex-1",
      sequence: 2,
      setType: "normal" as const,
      repetitions: 8,
      loadKg: 85,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 9,
      completedAt: null,
      createdAt: "2026-08-25T09:20:00.000Z",
    },
  ];

  it("extracts planned exercises from coachPlan details with targetSets or sets/repsMin/repsMax", () => {
    const planned = extractPlannedExercisesFromWorkout(mockPlannedWorkout);
    expect(planned).toHaveLength(2);
    expect(planned[0]?.name).toBe("Barbell Bench Press");
    expect(planned[0]?.targetSets).toBe(3);
    expect(planned[0]?.targetReps).toBe("8-10");
    expect(planned[0]?.targetLoad).toBe("70 kg");
    expect(planned[1]?.name).toBe("Pull Up");
    expect(planned[1]?.targetSets).toBe(3);
    expect(planned[1]?.targetReps).toBe("6-8");
  });

  it("formats display dates with Today/Yesterday relative labels", () => {
    const fixedToday = new Date("2026-08-26T12:00:00.000Z");
    expect(
      formatWorkoutDisplayDate("2026-08-26T08:00:00.000Z", fixedToday),
    ).toContain("Today");
    expect(
      formatWorkoutDisplayDate("2026-08-25T08:00:00.000Z", fixedToday),
    ).toContain("Yesterday");
    expect(
      formatWorkoutDisplayDate("2026-08-27T08:00:00.000Z", fixedToday),
    ).toContain("Tomorrow");
  });

  it("calculates total volume correctly for completed sets", () => {
    const volume = calculateWorkoutVolume(mockSets);
    // 10 * 80 + 8 * 85 = 800 + 680 = 1480 kg
    expect(volume).toBe(1480);
  });

  it("keeps warmups in workout history without counting them as working volume", () => {
    const sets: WorkoutSet[] = [
      { ...mockSets[0]!, id: "warmup", setType: "warmup", loadKg: 100 },
      ...(["normal", "drop", "failure"] as const).map((setType, index) => ({
        ...mockSets[1]!,
        id: `working-${index}`,
        sequence: index + 2,
        setType,
      })),
    ];
    const workout = processWorkout(mockCompletedWorkout, sets, [mockExercise]);
    expect(workout.completedSetCount).toBe(4);
    expect(workout.totalVolumeKg).toBe(2040);
    expect(workout.exerciseSummaries[0]?.topLoadKg).toBe(85);
    expect(calculateWorkoutVolume([sets[0]!])).toBe(0);
    expect(
      processWorkout(mockCompletedWorkout, [sets[0]!], [mockExercise])
        .exerciseSummaries[0],
    ).toMatchObject({ setCount: 1, topLoadKg: null });
  });

  it("processes workouts into correct status and exercise summaries", () => {
    const today = new Date("2026-08-26T12:00:00.000Z");
    const processedPlanned = processWorkout(
      mockPlannedWorkout,
      [],
      [mockExercise],
      today,
    );
    expect(processedPlanned.status).toBe("planned");
    expect(processedPlanned.plannedExercises).toHaveLength(2);
    expect(processedPlanned.completedSetCount).toBe(0);

    const processedZeroSetSession = processWorkout(
      {
        ...mockPlannedWorkout,
        id: "w-session-1",
        details: withWorkoutLifecycle(mockPlannedWorkout.details, {
          kind: "session",
          routineId: mockPlannedWorkout.id,
        }),
      },
      [],
      [mockExercise],
      today,
    );
    expect(processedZeroSetSession.status).toBe("in_progress");

    const processedCompleted = processWorkout(
      mockCompletedWorkout,
      mockSets,
      [mockExercise],
      today,
    );
    expect(processedCompleted.status).toBe("completed");
    expect(processedCompleted.completedSetCount).toBe(2);
    expect(processedCompleted.totalVolumeKg).toBe(1480);
    expect(processedCompleted.durationMinutes).toBe(60);
    expect(processedCompleted.exerciseSummaries).toHaveLength(1);
    expect(processedCompleted.exerciseSummaries[0]?.exerciseName).toBe(
      "Barbell Bench Press",
    );
    expect(processedCompleted.exerciseSummaries[0]?.topLoadKg).toBe(85);
  });

  it.each(["routine", "exercises", "sets"])(
    "marks partial %s reads incomplete so navigation can retry",
    async (failure) => {
      const client = {
        request: vi.fn(async ({ path }: { path: string }) => {
          if (path.startsWith("/v1/runs"))
            return { ok: true, value: { runs: [], nextCursor: null } };
          if (
            (failure === "routine" && path.includes("kind=routine")) ||
            (failure === "exercises" && path.includes("/exercises")) ||
            (failure === "sets" && path.includes("/sets"))
          )
            return {
              ok: false,
              error: { kind: "network_error", cause: "fixture" },
            };
          if (path.includes("/exercises"))
            return { ok: true, value: { exercises: [mockExercise] } };
          if (path.includes("/sets"))
            return { ok: true, value: { workoutSets: mockSets } };
          return { ok: true, value: { workouts: [mockCompletedWorkout] } };
        }),
      } as unknown as ApiClient;
      const result = await fetchWorkoutsHubData(client);
      expect(result.completed).toHaveLength(1);
      expect(result.message).toContain("could not be loaded");
    },
  );

  it("fetches workouts and separates active/planned and completed", async () => {
    const client: ApiClient = {
      request: vi
        .fn()
        .mockImplementation(async ({ path }: { path: string }) => {
          if (path.startsWith("/v1/runs"))
            return { ok: true, value: { runs: [], nextCursor: null } };
          if (path.startsWith("/v1/workouts?")) {
            return {
              ok: true,
              value: { workouts: [mockPlannedWorkout, mockCompletedWorkout] },
            };
          }
          if (path.startsWith("/v1/exercises?")) {
            return {
              ok: true,
              value: { exercises: [mockExercise] },
            };
          }
          if (path.includes("/sets")) {
            return {
              ok: true,
              value: { workoutSets: mockSets },
            };
          }
          return { ok: true, value: {} };
        }),
    } as unknown as ApiClient;

    const result = await fetchWorkoutsHubData(client);
    expect(result.message).toBeNull();
    expect(result.activeAndPlanned).toHaveLength(1);
    expect(result.activeAndPlanned[0]?.workout.id).toBe("w-planned-1");
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]?.workout.id).toBe("w-completed-1");
  });

  it("handles fetchWorkout by id", async () => {
    const client: ApiClient = {
      request: vi.fn().mockResolvedValue({
        ok: true,
        value: { workout: mockPlannedWorkout },
      }),
    } as unknown as ApiClient;

    const res = await fetchWorkout("w-planned-1", client);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.workout.id).toBe("w-planned-1");
    }
  });

  it("handles delete workout and create blank workout", async () => {
    const deleteClient: ApiClient = {
      request: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as ApiClient;

    const deleteRes = await deleteWorkout("w-planned-1", deleteClient);
    expect(deleteRes.ok).toBe(true);

    const createClient: ApiClient = {
      request: vi.fn().mockResolvedValue({
        ok: true,
        value: { workout: mockPlannedWorkout },
      }),
    } as unknown as ApiClient;

    const createRes = await createBlankWorkout("New Session", createClient);
    expect(createRes.ok).toBe(true);
  });

  it("creates custom workout with planned exercises and notes", async () => {
    const client: ApiClient = {
      request: vi.fn().mockImplementation(async ({ body }: { body: any }) => {
        expect(body.name).toBe("Push Day Focus");
        expect(body.notes).toBe("Heavy chest focus");
        expect(body.details.coachPlan.exercises).toHaveLength(2);
        expect(body.details.coachPlan.exercises[0].name).toBe(
          "Incline Dumbbell Press",
        );
        expect(body.details.coachPlan.exercises[0].sets).toBe(4);
        expect(readWorkoutLifecycle(body.details)).toEqual({ kind: "routine" });
        return {
          ok: true,
          value: { workout: { ...mockPlannedWorkout, name: body.name } },
        };
      }),
    } as unknown as ApiClient;

    const res = await createCustomWorkout(
      {
        name: "Push Day Focus",
        notes: "Heavy chest focus",
        plannedExercises: [
          { name: "Incline Dumbbell Press", targetSets: 4, targetReps: "8-12" },
          { name: "Dips", targetSets: 3, targetReps: "10-15" },
        ],
      },
      client,
    );

    expect(res.ok).toBe(true);
  });

  it("starts a fresh session copy while retaining the routine origin", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        workout: {
          ...mockPlannedWorkout,
          id: "w-session-copy",
          startedAt: "2026-08-26T12:30:00.000Z",
          details: withWorkoutLifecycle(mockPlannedWorkout.details, {
            kind: "session",
            routineId: mockPlannedWorkout.id,
          }),
        },
      },
    });
    const client = { request } as unknown as ApiClient;

    const result = await startRoutineSessionWith(
      client,
      mockPlannedWorkout,
      () => new Date("2026-08-26T12:30:00.000Z"),
    );

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    const body = request.mock.calls[0]?.[0].body as Record<string, unknown>;
    expect(body.startedAt).toBe("2026-08-26T12:30:00.000Z");
    expect(
      readWorkoutLifecycle(body.details as Record<string, unknown>),
    ).toEqual({
      kind: "session",
      routineId: mockPlannedWorkout.id,
    });
    expect((body.details as Record<string, unknown>).coachPlan).toEqual(
      mockPlannedWorkout.details.coachPlan,
    );
  });

  it("starts an ad-hoc workout as a session", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: { workout: mockPlannedWorkout },
    });
    await createBlankWorkoutWith(
      { request } as unknown as ApiClient,
      "Quick session",
      () => new Date("2026-08-26T13:00:00.000Z"),
    );
    const body = request.mock.calls[0]?.[0].body as Record<string, unknown>;
    expect(
      readWorkoutLifecycle(body.details as Record<string, unknown>),
    ).toEqual({
      kind: "session",
    });
    expect(body.details).toMatchObject({
      sessionMode: "one_time",
      sessionExercises: [],
    });
  });

  it("creates native-safe operation IDs without a browser crypto global", async () => {
    vi.stubGlobal("crypto", undefined);
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: { workout: mockPlannedWorkout },
    });
    const client = { request } as unknown as ApiClient;

    try {
      await createBlankWorkoutWith(client, "Quick session");
      await startRoutineSessionWith(client, mockPlannedWorkout);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(request).toHaveBeenCalledTimes(2);
    for (const [options] of request.mock.calls) {
      expect(options.body.clientOperationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });

  it("updates workout details and planned exercises", async () => {
    const client: ApiClient = {
      request: vi
        .fn()
        .mockImplementation(
          async ({ path, body }: { path: string; body: any }) => {
            expect(path).toBe("/v1/workouts/w-planned-1");
            expect(body.name).toBe("Updated Upper Body");
            expect(body.details.coachPlan.exercises[0].name).toBe(
              "Overhead Press",
            );
            return {
              ok: true,
              value: { workout: { ...mockPlannedWorkout, name: body.name } },
            };
          },
        ),
    } as unknown as ApiClient;

    const res = await updateWorkoutDetails(
      "w-planned-1",
      {
        name: "Updated Upper Body",
        notes: "New notes",
        plannedExercises: [
          { name: "Overhead Press", targetSets: 4, targetReps: "6-8" },
        ],
      },
      client,
    );

    expect(res.ok).toBe(true);
  });

  it("discovers old routines via kind=routine even if main list only has recent sessions", async () => {
    const oldRoutine: Workout = {
      ...mockPlannedWorkout,
      id: "w-old-routine",
      name: "Old Routine",
      startedAt: "2026-01-01T00:00:00.000Z",
      details: withWorkoutLifecycle(mockPlannedWorkout.details, {
        kind: "routine",
      }),
    };

    const requestedPaths: string[] = [];
    const client: ApiClient = {
      request: vi
        .fn()
        .mockImplementation(async ({ path }: { path: string }) => {
          if (path.startsWith("/v1/runs"))
            return { ok: true, value: { runs: [], nextCursor: null } };
          requestedPaths.push(path);
          if (path === "/v1/workouts?limit=200") {
            // Main list only has recent completed session
            return { ok: true, value: { workouts: [mockCompletedWorkout] } };
          }
          if (path === "/v1/workouts?kind=routine&limit=200") {
            // Dedicated routine query returns the old routine
            return { ok: true, value: { workouts: [oldRoutine] } };
          }
          if (path.startsWith("/v1/exercises")) {
            return { ok: true, value: { exercises: [mockExercise] } };
          }
          if (path.includes("/sets")) {
            return { ok: true, value: { workoutSets: mockSets } };
          }
          return { ok: true, value: {} };
        }),
    } as unknown as ApiClient;

    const result = await fetchWorkoutsHubData(client);
    expect(result.message).toBeNull();
    // Old routine is discovered!
    expect(result.activeAndPlanned).toHaveLength(1);
    expect(result.activeAndPlanned[0]?.workout.id).toBe("w-old-routine");
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]?.workout.id).toBe("w-completed-1");

    // Routine query was dispatched
    expect(requestedPaths).toContain("/v1/workouts?kind=routine&limit=200");
    // Sets were only fetched for completed session, NOT for routine
    expect(requestedPaths).toContain(
      `/v1/workouts/${encodeURIComponent(mockCompletedWorkout.id)}/sets`,
    );
    expect(requestedPaths).not.toContain(
      `/v1/workouts/${encodeURIComponent(oldRoutine.id)}/sets`,
    );
  });

  it("passes supplied clientOperationId to POST /v1/workouts for session-start idempotency", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        workout: {
          ...mockPlannedWorkout,
          id: "w-session-copy",
          clientOperationId: "33333333-4444-4555-8666-777777777777",
          details: withWorkoutLifecycle(mockPlannedWorkout.details, {
            kind: "session",
            routineId: mockPlannedWorkout.id,
          }),
        },
      },
    });
    const client = { request } as unknown as ApiClient;
    const clientOperationId = "33333333-4444-4555-8666-777777777777";

    const result = await startRoutineSessionWith(
      client,
      mockPlannedWorkout,
      () => new Date("2026-08-26T12:30:00.000Z"),
      clientOperationId,
    );

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    const body = request.mock.calls[0]?.[0].body as Record<string, unknown>;
    expect(body.clientOperationId).toBe(clientOperationId);
  });

  it("omits startedAt by default when starting a routine session so server assigns time without millisecond retry conflict", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        workout: {
          ...mockPlannedWorkout,
          id: "w-session-copy",
          clientOperationId: "33333333-4444-4555-8666-777777777777",
          details: withWorkoutLifecycle(mockPlannedWorkout.details, {
            kind: "session",
            routineId: mockPlannedWorkout.id,
          }),
        },
      },
    });
    const client = { request } as unknown as ApiClient;
    const clientOperationId = "33333333-4444-4555-8666-777777777777";

    const result = await startRoutineSessionWith(
      client,
      mockPlannedWorkout,
      undefined,
      clientOperationId,
    );

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    const body = request.mock.calls[0]?.[0].body as Record<string, unknown>;
    expect(body.clientOperationId).toBe(clientOperationId);
    expect(body.startedAt).toBeUndefined();
  });

  describe("syncRoutineExerciseTargets", () => {
    it("updates routine planned exercise target load when matching exercise progresses", async () => {
      const routine: Workout = {
        ...mockPlannedWorkout,
        id: "w-routine-123",
      };
      const updatedWorkout: Workout = {
        ...routine,
        details: {
          coachPlan: {
            exercises: [
              {
                name: "Barbell Bench Press",
                targetSets: 3,
                targetReps: "8-10",
                targetLoad: "75 kg",
              },
              {
                name: "Pull Up",
                sets: 3,
                repsMin: 6,
                repsMax: 8,
              },
            ],
          },
        },
      };

      const request = vi
        .fn()
        .mockImplementation((opt: { method: string; path: string }) => {
          if (opt.method === "GET") {
            return Promise.resolve({ ok: true, value: { workout: routine } });
          }
          if (opt.method === "PUT") {
            return Promise.resolve({
              ok: true,
              value: { workout: updatedWorkout },
            });
          }
          return Promise.resolve({
            ok: false,
            error: { kind: "http_error", status: 500 },
          });
        });
      const client = { request } as unknown as ApiClient;

      const targetsMap = new Map<string, number>([["barbell bench press", 75]]);

      const result = await syncRoutineExerciseTargets(
        "w-routine-123",
        targetsMap,
        client,
      );
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);

      const putCall = request.mock.calls[1]?.[0];
      expect(putCall.method).toBe("PUT");
      expect(putCall.path).toBe("/v1/workouts/w-routine-123");
      const details = putCall.body.details as Record<string, unknown>;
      const coachPlan = details.coachPlan as {
        exercises: Array<{ name: string; targetLoad?: string }>;
      };
      expect(coachPlan.exercises[0]?.targetLoad).toBe("75 kg");
    });

    it("returns ok immediately without PUT when no exercises match updated targets", async () => {
      const routine: Workout = {
        ...mockPlannedWorkout,
        id: "w-routine-123",
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: { workout: routine } });
      const client = { request } as unknown as ApiClient;

      const targetsMap = new Map<string, number>([["deadlift", 150]]);

      const result = await syncRoutineExerciseTargets(
        "w-routine-123",
        targetsMap,
        client,
      );
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledTimes(1); // Only GET, no PUT
    });

    it("handles fetch failure gracefully", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: "http_error", status: 404 },
      });
      const client = { request } as unknown as ApiClient;

      const targetsMap = new Map<string, number>([["barbell bench press", 75]]);

      const result = await syncRoutineExerciseTargets(
        "w-nonexistent",
        targetsMap,
        client,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toBe("That workout record no longer exists.");
      }
    });
  });
});

describe("complete running week", () => {
  it("follows week-range cursors independently from the history page", async () => {
    const { fetchRunningWeek } = await import("./workouts-hub-data");
    const run = (id: string) => ({
      id,
      summary: {
        activityDate: "2026-10-05",
        durationSeconds: 1500,
        distanceMeters: null,
      },
    });
    const request = vi.fn(async ({ path }: { path: string }) => ({
      ok: true,
      value: path.includes("cursor=next")
        ? { runs: [run("second")], nextCursor: null }
        : { runs: [run("first")], nextCursor: "next" },
    }));
    const result = await fetchRunningWeek(
      { request } as unknown as ApiClient,
      new Date("2026-10-06T12:00:00Z"),
      "Europe/Bratislava",
    );
    expect(result.runs.map((r) => r.id)).toEqual(["first", "second"]);
    expect(result.week).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
      incomplete: false,
    });
    expect(request.mock.calls[1]?.[0].path).toContain(
      "cursor=next&from=2026-10-05&to=2026-10-11",
    );
  });
  it("reports incomplete totals when a later page fails", async () => {
    const { fetchRunningWeek } = await import("./workouts-hub-data");
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          runs: [{ id: "first", summary: { activityDate: "2026-10-05" } }],
          nextCursor: "next",
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "network_error", cause: "offline" },
      });
    const result = await fetchRunningWeek(
      { request } as unknown as ApiClient,
      new Date("2026-10-06T12:00:00Z"),
      "UTC",
    );
    expect(result.runs).toHaveLength(1);
    expect(result.week.incomplete).toBe(true);
  });
});

describe("synchronous warmed workout projection", () => {
  const session = {
    user: { id: "owner" },
    accessToken: "token",
  } as import("@mizyun/identity").AuthSession;
  const fixture = (options: { path: string }) => {
    if (options.path.startsWith("/v1/runs"))
      return { ok: true, value: { runs: [], nextCursor: null } };
    if (options.path.startsWith("/v1/exercises"))
      return { ok: true, value: { exercises: [] } };
    if (options.path.endsWith("/sets"))
      return { ok: true, value: { workoutSets: [] } };
    return { ok: true, value: { workouts: [] } };
  };
  it("uses the same complete empty projection and request identities as async startup", async () => {
    const { peekWorkoutsHubData } = await import("./workouts-hub-data");
    const request = vi.fn(async (options) => fixture(options));
    const read = vi.fn((options, owner) => {
      expect(owner).toBe(session);
      return fixture(options);
    });
    const live = await fetchWorkoutsHubData({
      request,
    } as unknown as ApiClient);
    const warm = peekWorkoutsHubData(session, read as any);
    expect(warm).toEqual(live);
    expect(warm?.message).toBeNull();
    expect(read.mock.calls.map(([options]) => options.path).sort()).toEqual(
      request.mock.calls.map(([options]) => options.path).sort(),
    );
  });
  it.each(["workouts", "routine", "exercises", "running-week"])(
    "requires the cached %s read before declaring the hub loaded",
    async (missing) => {
      const { peekWorkoutsHubData } = await import("./workouts-hub-data");
      const read = vi.fn((options) => {
        if (
          (missing === "workouts" &&
            options.path === "/v1/workouts?limit=200") ||
          (missing === "routine" && options.path.includes("kind=routine")) ||
          (missing === "exercises" &&
            options.path.startsWith("/v1/exercises")) ||
          (missing === "running-week" && options.path.includes("&from="))
        )
          return null;
        return fixture(options);
      });
      expect(peekWorkoutsHubData(session, read as any)).toBeNull();
    },
  );
  it("requires every session's set read rather than displaying unconfirmed empty sets", async () => {
    const { peekWorkoutsHubData } = await import("./workouts-hub-data");
    const workout = {
      id: "warm-session",
      userId: "owner",
      name: "Workout",
      startedAt: "2026-10-12T10:00:00Z",
      completedAt: "2026-10-12T11:00:00Z",
      details: {},
      notes: null,
      source: "manual",
      createdAt: "2026-10-12T10:00:00Z",
      updatedAt: "2026-10-12T11:00:00Z",
    };
    const read = vi.fn((options) => {
      if (options.path.endsWith("/sets")) return null;
      if (options.path === "/v1/workouts?limit=200")
        return { ok: true, value: { workouts: [workout] } };
      return fixture(options);
    });
    expect(peekWorkoutsHubData(session, read as any)).toBeNull();
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/v1/workouts/warm-session/sets" }),
      session,
    );
  });
});

describe("offline Workouts after a restart", () => {
  it.each([
    ["no connection", { kind: "network_error", cause: "airplane mode" }],
    [
      "the API's retryable 503",
      { kind: "http_error", status: 503, code: "SERVICE_UNAVAILABLE" },
    ],
  ] as const)(
    "shows saved routines, history and the in-progress workout's sets after set replays fail with %s",
    async (_, replayError) => {
      const { SessionReadCache } =
        await import("@/composition/session-read-cache");
      const { createPersonalReadStorage } =
        await import("@/features/offline-cache/personal-read-storage");
      const userId = "00000000-0000-4000-8000-0000000000a1";
      const session = {
        user: { id: userId },
        accessToken: "synthetic-token",
      } as import("@mizyun/identity").AuthSession;
      const workout = (
        id: string,
        name: string,
        completedAt: string | null,
        details: Workout["details"] = {},
      ): Workout => ({
        id,
        userId,
        name,
        startedAt: "2026-10-28T09:00:00.000Z",
        completedAt,
        source: "manual",
        notes: null,
        details,
        createdAt: "2026-10-28T09:00:00.000Z",
        updatedAt: "2026-10-28T09:00:00.000Z",
      });
      const routine = workout(
        "00000000-0000-4000-8000-0000000000b1",
        "Upper routine",
        null,
        withWorkoutLifecycle({}, { kind: "routine" }),
      );
      const done = workout(
        "00000000-0000-4000-8000-0000000000b2",
        "Yesterday",
        "2026-10-28T10:00:00.000Z",
      );
      const live = workout(
        "00000000-0000-4000-8000-0000000000b3",
        "Live session",
        null,
        withWorkoutLifecycle({}, { kind: "session" }),
      );
      const exercise: Exercise = {
        id: "00000000-0000-4000-8000-0000000000c1",
        userId,
        name: "Bench Press",
        instructions: null,
        metadata: {},
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-01T10:00:00.000Z",
      };
      const set: WorkoutSet = {
        id: "00000000-0000-4000-8000-0000000000d1",
        userId,
        workoutId: live.id,
        exerciseId: exercise.id,
        sequence: 1,
        setType: "normal",
        repetitions: 8,
        loadKg: 60,
        durationSeconds: null,
        distanceMeters: null,
        perceivedExertion: null,
        completedAt: "2026-10-28T09:10:00.000Z",
        createdAt: "2026-10-28T09:10:00.000Z",
      };
      const server = vi.fn(
        async ({ method, path }: { method: string; path: string }) => {
          if (method !== "GET") return { ok: true, value: {} };
          if (path.startsWith("/v1/runs"))
            return { ok: true, value: { runs: [], nextCursor: null } };
          if (path.startsWith("/v1/exercises"))
            return {
              ok: true,
              value: { exercises: [exercise], nextCursor: null },
            };
          if (path.endsWith("/sets"))
            return {
              ok: true,
              value: { workoutSets: path.includes(live.id) ? [set] : [] },
            };
          if (path.includes("kind=routine"))
            return {
              ok: true,
              value: { workouts: [routine], nextCursor: null },
            };
          return {
            ok: true,
            value: { workouts: [routine, done, live], nextCursor: null },
          };
        },
      );
      const offline = vi.fn(async () => ({
        ok: false as const,
        error: { kind: "network_error" as const, cause: "airplane mode" },
      }));
      const failing = vi.fn(async () => ({
        ok: false as const,
        error: replayError,
      }));
      const values = new Map<string, string>();
      const store = {
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: async (key: string) => {
          values.delete(key);
        },
      };
      let time = new Date("2026-10-29T08:00:00.000Z").getTime();
      const launch = (request: ApiClient["request"]) =>
        new SessionReadCache(
          {
            request,
            status: () => ({ configured: false, reason: "fixture" }),
          } as ApiClient,
          async () => session,
          () => time,
          createPersonalReadStorage(store, () => time),
        );
      const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

      const online = launch(server as unknown as ApiClient["request"]);
      const first = await fetchWorkoutsHubData(online);
      expect(first.message).toBeNull();
      expect(first.savedAt).toBeUndefined();
      await settle();

      // Airplane mode: the live workout's queued sets fail to replay.
      const writing = launch(failing as unknown as ApiClient["request"]);
      time += 60_000;
      for (let attempt = 0; attempt < 3; attempt++)
        expect(
          (
            await writing.request({
              method: "POST",
              path: `/v1/workouts/${live.id}/sets`,
              body: { clientOperationId: `synthetic-${attempt}` },
            })
          ).ok,
        ).toBe(false);
      await settle();

      // Force-quit, then reopen still offline.
      time += 60_000;
      const hub = await fetchWorkoutsHubData(
        launch(offline as unknown as ApiClient["request"]),
      );
      expect(hub.message).toBeNull();
      expect(hub.savedAt).toBe(time - 120_000);
      expect(
        hub.activeAndPlanned.map((item) => item.workout.id).sort(),
      ).toEqual([routine.id, live.id].sort());
      expect(hub.completed.map((item) => item.workout.id)).toEqual([done.id]);
      const inProgress = hub.activeAndPlanned.find(
        (item) => item.workout.id === live.id,
      );
      expect(inProgress?.sets.map((row) => row.id)).toEqual([set.id]);
    },
  );
});
