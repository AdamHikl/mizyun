import { describe, expect, it } from "vitest";
import type { StoredWorkoutSet, UserId } from "@mizyun/core";

import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";
import { buildGetExerciseHistoryTool } from "./exercise-history.js";

const USER_ID = "00000000-0000-4000-8000-000000000001" as UserId;
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002" as UserId;
const NOW = new Date("2026-09-10T12:00:00.000Z");

const createSet = (
  overrides: Partial<StoredWorkoutSet> = {},
): StoredWorkoutSet => ({
  id: "set-1",
  userId: USER_ID,
  workoutId: "workout-1",
  exerciseId: "barbell-bench-press",
  sequence: 1,
  repetitions: 10,
  loadKg: 100,
  durationSeconds: null,
  distanceMeters: null,
  perceivedExertion: 8,
  completedAt: NOW,
  createdAt: NOW,
  ...overrides,
});

describe("buildGetExerciseHistoryTool", () => {
  it("resolves exercise by name and returns deterministic PR and set progression", async () => {
    const workoutSetRepository = new InMemoryWorkoutSetRepository();
    const tool = buildGetExerciseHistoryTool({
      workoutSetRepository,
      clock: { now: () => NOW },
    });

    // Seed sets for Barbell Bench Press (catalog ID: "barbell-bench-press")
    await workoutSetRepository.create(
      USER_ID,
      createSet({
        id: "set-1",
        exerciseId: "barbell-bench-press",
        sequence: 1,
        repetitions: 10,
        loadKg: 80,
      }),
      { accessToken: "token" },
    );
    await workoutSetRepository.create(
      USER_ID,
      createSet({
        id: "set-2",
        exerciseId: "barbell-bench-press",
        sequence: 2,
        repetitions: 8,
        loadKg: 100, // PR load
      }),
      { accessToken: "token" },
    );

    const result = await tool.execute({
      principalUserId: USER_ID,
      accessToken: "token",
      clock: { now: () => NOW },
      args: { exercise_name: "barbell bench press" },
    });

    expect(result.kind).toBe("training");
    expect(result.confirmed).toBe(true);

    const data = result.data as Record<string, unknown>;
    expect(data.found).toBe(true);

    const exercise = data.exercise as Record<string, unknown>;
    expect(exercise.id).toBe("barbell-bench-press");
    expect(exercise.name).toBe("Barbell Bench Press");

    const summary = data.summary as Record<string, unknown>;
    expect(summary.bestLoadKg).toBe(100);
    expect(summary.totalLoggedSets).toBe(2);

    const sets = data.recentSets as unknown[];
    expect(sets).toHaveLength(2);
  });

  it("resolves exercise by alias (e.g. 'rdl' -> Romanian Deadlift)", async () => {
    const workoutSetRepository = new InMemoryWorkoutSetRepository();
    const tool = buildGetExerciseHistoryTool({
      workoutSetRepository,
      clock: { now: () => NOW },
    });

    const result = await tool.execute({
      principalUserId: USER_ID,
      accessToken: "token",
      clock: { now: () => NOW },
      args: { exercise_name: "rdl" },
    });

    const data = result.data as Record<string, unknown>;
    expect(data.found).toBe(true);
    const exercise = data.exercise as Record<string, unknown>;
    expect(String(exercise.name).toLowerCase()).toContain("deadlift");
  });

  it("handles unknown exercise queries gracefully", async () => {
    const workoutSetRepository = new InMemoryWorkoutSetRepository();
    const tool = buildGetExerciseHistoryTool({
      workoutSetRepository,
      clock: { now: () => NOW },
    });

    const result = await tool.execute({
      principalUserId: USER_ID,
      accessToken: "token",
      clock: { now: () => NOW },
      args: { exercise_name: "nonexistent-fantasy-movement-xyz" },
    });

    const data = result.data as Record<string, unknown>;
    expect(data.found).toBe(false);
    expect(data.message).toContain("No exercise matching");
    expect(data.recentSets).toEqual([]);
  });

  it("enforces tenant isolation across users", async () => {
    const workoutSetRepository = new InMemoryWorkoutSetRepository();
    const tool = buildGetExerciseHistoryTool({
      workoutSetRepository,
      clock: { now: () => NOW },
    });

    // Seed set for other user
    await workoutSetRepository.create(
      OTHER_USER_ID,
      createSet({
        id: "set-other",
        userId: OTHER_USER_ID,
        exerciseId: "barbell-bench-press",
        loadKg: 200,
      }),
      { accessToken: "token" },
    );

    const result = await tool.execute({
      principalUserId: USER_ID,
      accessToken: "token",
      clock: { now: () => NOW },
      args: { exercise_name: "barbell bench press" },
    });

    const data = result.data as Record<string, unknown>;
    expect(data.found).toBe(true);
    const summary = data.summary as Record<string, unknown>;
    expect(summary.totalLoggedSets).toBe(0);
    expect(summary.bestLoadKg).toBeNull();
    expect(data.recentSets).toEqual([]);
  });

  it("resolves exercise directly by exercise_id and handles NaN limit gracefully", async () => {
    const workoutSetRepository = new InMemoryWorkoutSetRepository();
    const tool = buildGetExerciseHistoryTool({
      workoutSetRepository,
      clock: { now: () => NOW },
    });

    await workoutSetRepository.create(
      USER_ID,
      createSet({
        id: "set-1",
        exerciseId: "barbell-bench-press",
        loadKg: 105,
      }),
      { accessToken: "token" },
    );

    const result = await tool.execute({
      principalUserId: USER_ID,
      accessToken: "token",
      clock: { now: () => NOW },
      args: {
        exercise_id: "barbell-bench-press",
        limit: Number.NaN,
      },
    });

    const data = result.data as Record<string, unknown>;
    expect(data.found).toBe(true);
    const exercise = data.exercise as Record<string, unknown>;
    expect(exercise.id).toBe("barbell-bench-press");
    const summary = data.summary as Record<string, unknown>;
    expect(summary.bestLoadKg).toBe(105);
    expect(summary.totalLoggedSets).toBe(1);
  });
});
