import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { Exercise, Workout, WorkoutSet } from "@mizyun/contracts";

import {
  calculateEstimated1RM,
  calculateExerciseProgression,
  extractPlannedTargetLoadKg,
  fetchExerciseProgression,
  updateExerciseTargetLoad,
} from "./exercise-progression-data";

describe("exercise-progression-data", () => {
  const mockExercise: Exercise = {
    id: "ex-bench-1",
    userId: "usr-1",
    name: "Barbell Bench Press",
    instructions: null,
    metadata: {
      targetLoadKg: 85,
      targetReps: "8-10",
      movementPattern: "horizontal_push",
    },
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };

  const mockWorkouts: Workout[] = [
    {
      id: "w-1",
      userId: "usr-1",
      name: "Push Day 1",
      startedAt: "2026-08-10T09:00:00.000Z",
      completedAt: "2026-08-10T10:00:00.000Z",
      source: "manual",
      notes: null,
      details: {
        coachPlan: {
          exercises: [{ name: "Barbell Bench Press", targetLoad: "75 kg" }],
        },
      },
      createdAt: "2026-08-10T09:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z",
    },
    {
      id: "w-2",
      userId: "usr-1",
      name: "Push Day 2",
      startedAt: "2026-08-18T09:00:00.000Z",
      completedAt: "2026-08-18T10:00:00.000Z",
      source: "manual",
      notes: null,
      details: {
        coachPlan: {
          exercises: [{ name: "Barbell Bench Press", targetLoad: "80 kg" }],
        },
      },
      createdAt: "2026-08-18T09:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    },
    {
      id: "w-3",
      userId: "usr-1",
      name: "Push Day 3",
      startedAt: "2026-08-26T09:00:00.000Z",
      completedAt: "2026-08-26T10:00:00.000Z",
      source: "manual",
      notes: null,
      details: {
        coachPlan: {
          exercises: [{ name: "Barbell Bench Press", targetLoad: "85 kg" }],
        },
      },
      createdAt: "2026-08-26T09:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
    },
  ];

  const mockSets: WorkoutSet[] = [
    // Session 1 (Aug 10): 70kg x 10, 75kg x 8 (Peak: 75kg, 1RM: 95kg)
    {
      id: "s-1",
      userId: "usr-1",
      workoutId: "w-1",
      exerciseId: "ex-bench-1",
      sequence: 1,
      setType: "normal" as const,
      repetitions: 10,
      loadKg: 70,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 7,
      completedAt: "2026-08-10T09:15:00.000Z",
      createdAt: "2026-08-10T09:15:00.000Z",
    },
    {
      id: "s-2",
      userId: "usr-1",
      workoutId: "w-1",
      exerciseId: "ex-bench-1",
      sequence: 2,
      setType: "normal" as const,
      repetitions: 8,
      loadKg: 75,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 8,
      completedAt: "2026-08-10T09:20:00.000Z",
      createdAt: "2026-08-10T09:20:00.000Z",
    },
    // Session 2 (Aug 18): 75kg x 10, 80kg x 8 (Peak: 80kg, 1RM: 101.3kg)
    {
      id: "s-3",
      userId: "usr-1",
      workoutId: "w-2",
      exerciseId: "ex-bench-1",
      sequence: 1,
      setType: "normal" as const,
      repetitions: 10,
      loadKg: 75,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 7.5,
      completedAt: "2026-08-18T09:15:00.000Z",
      createdAt: "2026-08-18T09:15:00.000Z",
    },
    {
      id: "s-4",
      userId: "usr-1",
      workoutId: "w-2",
      exerciseId: "ex-bench-1",
      sequence: 2,
      setType: "normal" as const,
      repetitions: 8,
      loadKg: 80,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 8.5,
      completedAt: "2026-08-18T09:20:00.000Z",
      createdAt: "2026-08-18T09:20:00.000Z",
    },
    // Session 3 (Aug 26): 80kg x 8, 87.5kg x 5 (Peak: 87.5kg, 1RM: 102.1kg)
    {
      id: "s-5",
      userId: "usr-1",
      workoutId: "w-3",
      exerciseId: "ex-bench-1",
      sequence: 1,
      setType: "normal" as const,
      repetitions: 8,
      loadKg: 80,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 8,
      completedAt: "2026-08-26T09:15:00.000Z",
      createdAt: "2026-08-26T09:15:00.000Z",
    },
    {
      id: "s-6",
      userId: "usr-1",
      workoutId: "w-3",
      exerciseId: "ex-bench-1",
      sequence: 2,
      setType: "normal" as const,
      repetitions: 5,
      loadKg: 87.5,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 9.5,
      completedAt: "2026-08-26T09:20:00.000Z",
      createdAt: "2026-08-26T09:20:00.000Z",
    },
  ];

  it("calculates estimated 1RM using the Epley formula", () => {
    expect(calculateEstimated1RM(100, 1)).toBe(100);
    expect(calculateEstimated1RM(100, 5)).toBe(116.7);
    expect(calculateEstimated1RM(80, 10)).toBe(106.7);
    expect(calculateEstimated1RM(null, 10)).toBeNull();
    expect(calculateEstimated1RM(100, null)).toBe(100);
  });

  it("extracts planned target load from workout details", () => {
    const target1 = extractPlannedTargetLoadKg(
      mockWorkouts[0] ?? null,
      "Barbell Bench Press",
      "metric",
    );
    expect(target1).toBe(75);

    const target2 = extractPlannedTargetLoadKg(
      mockWorkouts[1] ?? null,
      "Barbell Bench Press",
      "metric",
    );
    expect(target2).toBe(80);
  });

  it("calculates comprehensive exercise progression over time", () => {
    const progression = calculateExerciseProgression(
      mockExercise,
      "Barbell Bench Press",
      mockSets,
      mockWorkouts,
      "metric",
    );

    expect(progression.exerciseName).toBe("Barbell Bench Press");
    expect(progression.currentTargetLoadKg).toBe(85);
    expect(progression.allTimeBestLoadKg).toBe(87.5);
    expect(progression.totalSessionsCount).toBe(3);
    expect(progression.totalSetsCount).toBe(6);

    // Progression sessions
    expect(progression.sessionsChronological).toHaveLength(3);
    expect(progression.sessionsChronological[0]?.peakLoadKg).toBe(75);
    expect(progression.sessionsChronological[0]?.targetStatus).toBe(
      "hit_target",
    ); // 75kg vs 75kg

    expect(progression.sessionsChronological[1]?.peakLoadKg).toBe(80);
    expect(progression.sessionsChronological[1]?.targetStatus).toBe(
      "hit_target",
    ); // 80kg vs 80kg

    expect(progression.sessionsChronological[2]?.peakLoadKg).toBe(87.5);
    expect(progression.sessionsChronological[2]?.targetStatus).toBe(
      "exceeded_target",
    ); // 87.5kg vs 85kg

    // Progression Delta from first (75kg) to latest (87.5kg)
    expect(progression.loadDeltaKg).toBe(12.5);
    expect(progression.loadDeltaPercent).toBe(16.7);
  });

  it("fetches exercise progression from API", async () => {
    const client: ApiClient = {
      request: vi
        .fn()
        .mockImplementation(async ({ path }: { path: string }) => {
          if (path.startsWith("/v1/exercises?")) {
            return {
              ok: true,
              value: { exercises: [mockExercise] },
            };
          }
          if (path.startsWith("/v1/workouts?")) {
            return {
              ok: true,
              value: { workouts: mockWorkouts },
            };
          }
          if (path === "/v1/exercises/ex-bench-1") {
            return { ok: true, value: { exercise: mockExercise } };
          }
          if (path.includes("/recent-sets")) {
            return {
              ok: true,
              value: {
                sets: mockSets,
                summary: {
                  bestLoadKg: 87.5,
                  lastSessionVolumeKg: 1077.5,
                  totalSetCount: 6,
                },
              },
            };
          }
          return { ok: true, value: {} };
        }),
    } as unknown as ApiClient;

    const result = await fetchExerciseProgression(
      { exerciseId: "ex-bench-1", exerciseName: "Barbell Bench Press" },
      "metric",
      client,
    );

    expect(result.message).toBeNull();
    expect(result.progression).not.toBeNull();
    expect(result.progression?.allTimeBestLoadKg).toBe(87.5);
    expect(result.progression?.currentTargetLoadKg).toBe(85);
  });

  it("updates exercise target load via PUT /v1/exercises/:id", async () => {
    const client: ApiClient = {
      request: vi
        .fn()
        .mockImplementation(
          async ({
            path,
            method,
            body,
          }: {
            path: string;
            method: string;
            body: any;
          }) => {
            if (method === "GET") {
              expect(path).toBe("/v1/exercises/ex-bench-1");
              return { ok: true, value: { exercise: mockExercise } };
            }
            expect(method).toBe("PUT");
            expect(path).toBe("/v1/exercises/ex-bench-1");
            expect(body.metadata.targetLoadKg).toBe(90);
            expect(body.metadata.targetReps).toBe("6-8");
            return {
              ok: true,
              value: {
                exercise: {
                  ...mockExercise,
                  metadata: body.metadata,
                },
              },
            };
          },
        ),
    } as unknown as ApiClient;

    const res = await updateExerciseTargetLoad(
      "Barbell Bench Press",
      90,
      "6-8",
      "ex-bench-1",
      client,
    );

    expect(res.ok).toBe(true);
    expect(res.exercise?.metadata?.targetLoadKg).toBe(90);
  });
});

describe("catalog rename history and target preservation", () => {
  const original: Exercise = {
    id: "original-rdl-uuid",
    userId: "synthetic-owner",
    name: "Romanian deadlift",
    instructions: "My personal setup cue.",
    metadata: {
      targetLoadKg: 55,
      targetReps: "8-10",
      source: "manual",
      movementPattern: "hip_hinge",
    },
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
  };
  function clientFor(records: readonly Exercise[]) {
    const request = vi
      .fn()
      .mockImplementation(
        async ({
          path,
          method,
          body,
        }: {
          path: string;
          method: string;
          body: any;
        }) => {
          if (method === "GET" && path.startsWith("/v1/exercises?"))
            return { ok: true, value: { exercises: records } };
          if (method === "GET" && path.startsWith("/v1/workouts?"))
            return { ok: true, value: { workouts: [] } };
          if (method === "GET" && path.includes("/recent-sets"))
            return { ok: true, value: { sets: [] } };
          if (method === "GET" && path === `/v1/exercises/${original.id}`)
            return { ok: true, value: { exercise: original } };
          return {
            ok: true,
            value: { exercise: { ...original, metadata: body.metadata } },
          };
        },
      );
    return { request } as unknown as ApiClient;
  }
  it("loads the original UUID and target when the catalog name changed", async () => {
    const client = clientFor([original]);
    const result = await fetchExerciseProgression(
      { exerciseName: "Barbell Romanian deadlift" },
      "metric",
      client,
    );
    expect(result.progression?.exerciseId).toBe(original.id);
    expect(result.progression?.currentTargetLoadKg).toBe(55);
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/v1/exercises/${original.id}/recent-sets?limit=50`,
      }),
    );
  });
  it("saves to the original UUID and retains metadata, name and instructions", async () => {
    const client = clientFor([original]);
    const result = await updateExerciseTargetLoad(
      "Barbell Romanian deadlift",
      60,
      undefined,
      undefined,
      client,
    );
    expect(result.ok).toBe(true);
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: `/v1/exercises/${original.id}`,
        body: {
          metadata: expect.objectContaining({
            targetLoadKg: 60,
            targetReps: "8-10",
            source: "manual",
            movementPattern: "hip_hinge",
          }),
        },
      }),
    );
    expect(result.exercise?.name).toBe(original.name);
    expect(result.exercise?.instructions).toBe(original.instructions);
    expect(
      (client.request as ReturnType<typeof vi.fn>).mock.calls.some(
        ([request]) => request.method === "POST",
      ),
    ).toBe(false);
  });
  it("does not resolve or mutate ambiguous previous UUIDs", async () => {
    const client = clientFor([
      original,
      { ...original, id: "another-rdl-uuid" },
    ]);
    const fetched = await fetchExerciseProgression(
      { exerciseName: "Barbell Romanian deadlift" },
      "metric",
      client,
    );
    expect(fetched.progression?.exerciseId).toBeNull();
    const saved = await updateExerciseTargetLoad(
      "Barbell Romanian deadlift",
      60,
      undefined,
      undefined,
      client,
    );
    expect(saved.ok).toBe(false);
    expect(
      (client.request as ReturnType<typeof vi.fn>).mock.calls.every(
        ([request]) => request.method === "GET",
      ),
    ).toBe(true);
  });
  it("gives an explicit UUID precedence and reads metadata before saving", async () => {
    const client = clientFor([
      original,
      { ...original, id: "canonical-uuid", name: "Barbell Romanian deadlift" },
    ]);
    const fetched = await fetchExerciseProgression(
      { exerciseId: original.id, exerciseName: "Barbell Romanian deadlift" },
      "metric",
      client,
    );
    expect(fetched.progression?.exerciseId).toBe(original.id);
    const saved = await updateExerciseTargetLoad(
      "Barbell Romanian deadlift",
      60,
      undefined,
      original.id,
      client,
    );
    expect(saved.exercise?.metadata?.source).toBe("manual");
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: `/v1/exercises/${original.id}`,
      }),
    );
  });
  it("does not create or update after a failed lookup", async () => {
    for (const exerciseId of [undefined, original.id]) {
      const request = vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "network_error" } });
      const saved = await updateExerciseTargetLoad(
        "Barbell Romanian deadlift",
        60,
        undefined,
        exerciseId,
        { request } as unknown as ApiClient,
      );
      expect(saved.ok).toBe(false);
      expect(request.mock.calls).toHaveLength(1);
      expect(request.mock.calls[0]?.[0].method).toBe("GET");
    }
  });
  it("reads an explicit UUID directly when it is outside the first 200 records", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      ...original,
      id: `other-${index}`,
      name: `Other exercise ${index}`,
    }));
    const client = clientFor(firstPage);
    const fetched = await fetchExerciseProgression(
      { exerciseId: original.id, exerciseName: "Barbell Romanian deadlift" },
      "metric",
      client,
    );
    expect(fetched.progression?.exerciseId).toBe(original.id);
    expect(fetched.progression?.currentTargetLoadKg).toBe(55);
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: `/v1/exercises/${original.id}`,
      }),
    );
  });
  it("does not invent missing history or a new UUID from a full truncated page", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      ...original,
      id: `other-${index}`,
      name: `Other exercise ${index}`,
    }));
    const client = clientFor(firstPage);
    const fetched = await fetchExerciseProgression(
      { exerciseName: "Barbell Romanian deadlift" },
      "metric",
      client,
    );
    expect(fetched.progression).toBeNull();
    expect(fetched.message).toContain("complete exercise list");
    const saved = await updateExerciseTargetLoad(
      "Barbell Romanian deadlift",
      60,
      undefined,
      undefined,
      client,
    );
    expect(saved.ok).toBe(false);
    expect(saved.message).toContain("complete exercise list");
    expect(
      (client.request as ReturnType<typeof vi.fn>).mock.calls.every(
        ([request]) => request.method === "GET",
      ),
    ).toBe(true);
  });
});
