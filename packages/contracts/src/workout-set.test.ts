import { describe, expect, it } from "vitest";

import {
  exerciseRecentSetsQuerySchema,
  workoutSetCreateSchema,
  workoutSetSchema,
  workoutSetTypeSchema,
} from "./workout-set";

describe("exercise recent-set queries", () => {
  it("accepts a workout UUID to exclude from previous performance", () => {
    const excludeWorkoutId = "00000000-0000-4000-8000-000000000001";
    expect(
      exerciseRecentSetsQuerySchema.parse({ excludeWorkoutId })
        .excludeWorkoutId,
    ).toBe(excludeWorkoutId);
  });

  it("rejects a malformed excluded workout id", () => {
    expect(
      exerciseRecentSetsQuerySchema.safeParse({
        excludeWorkoutId: "not-a-workout",
      }).success,
    ).toBe(false);
  });
});

describe("workoutSetCreateSchema performance-field rule", () => {
  const exerciseId = "00000000-0000-4000-8000-000000000004";

  it("rejects a body whose performance fields are all null", () => {
    expect(
      workoutSetCreateSchema.safeParse({
        exerciseId,
        repetitions: null,
        loadKg: null,
        durationSeconds: null,
        distanceMeters: null,
      }).success,
    ).toBe(false);
  });

  it("accepts one non-null performance field beside nulls", () => {
    expect(
      workoutSetCreateSchema.safeParse({
        exerciseId,
        repetitions: null,
        durationSeconds: 45,
      }).success,
    ).toBe(true);
  });
});

describe("workout set types wire contracts", () => {
  it("accepts valid set types in workoutSetTypeSchema", () => {
    expect(workoutSetTypeSchema.parse("normal")).toBe("normal");
    expect(workoutSetTypeSchema.parse("warmup")).toBe("warmup");
    expect(workoutSetTypeSchema.parse("drop")).toBe("drop");
    expect(workoutSetTypeSchema.parse("failure")).toBe("failure");
    expect(workoutSetTypeSchema.safeParse("invalid").success).toBe(false);
  });

  it("defaults setType to normal in workoutSetSchema when omitted", () => {
    const parsed = workoutSetSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      workoutId: "00000000-0000-4000-8000-000000000003",
      exerciseId: "00000000-0000-4000-8000-000000000004",
      sequence: 1,
      repetitions: 8,
      loadKg: 60,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: null,
      completedAt: null,
      createdAt: "2026-07-10T09:00:00.000Z",
    });
    expect(parsed.setType).toBe("normal");
  });

  it("preserves explicit setType in workoutSetSchema", () => {
    const parsed = workoutSetSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      workoutId: "00000000-0000-4000-8000-000000000003",
      exerciseId: "00000000-0000-4000-8000-000000000004",
      sequence: 1,
      setType: "warmup",
      repetitions: 8,
      loadKg: 60,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: null,
      completedAt: null,
      createdAt: "2026-07-10T09:00:00.000Z",
    });
    expect(parsed.setType).toBe("warmup");
  });

  it("accepts optional setType in workoutSetCreateSchema", () => {
    const parsedWith = workoutSetCreateSchema.parse({
      exerciseId: "00000000-0000-4000-8000-000000000004",
      setType: "failure",
      repetitions: 10,
    });
    expect(parsedWith.setType).toBe("failure");

    const parsedWithout = workoutSetCreateSchema.parse({
      exerciseId: "00000000-0000-4000-8000-000000000004",
      repetitions: 10,
    });
    expect(parsedWithout.setType).toBeUndefined();

    expect(
      workoutSetCreateSchema.safeParse({
        exerciseId: "00000000-0000-4000-8000-000000000004",
        setType: "invalid-type",
        repetitions: 10,
      }).success,
    ).toBe(false);
  });
});
