import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  summariseExerciseSets,
  validateWorkoutSetCreate,
  type StoredWorkoutSet,
} from "./workout-set.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;

const baseSet = (
  overrides: Partial<StoredWorkoutSet> = {},
): StoredWorkoutSet => ({
  id: "00000000-0000-4000-8000-00000000a001",
  userId,
  workoutId: "00000000-0000-4000-8000-00000000b001",
  exerciseId: "00000000-0000-4000-8000-00000000c001",
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
});

describe("validateWorkoutSetCreate", () => {
  it("accepts a rep-based set", () => {
    expect(validateWorkoutSetCreate({ repetitions: 8, loadKg: 60 })).toBeNull();
  });

  it("accepts a duration-based set", () => {
    expect(validateWorkoutSetCreate({ durationSeconds: 60 })).toBeNull();
  });

  it("accepts a distance-based set", () => {
    expect(validateWorkoutSetCreate({ distanceMeters: 1500 })).toBeNull();
  });

  it("accepts a mixed-field set", () => {
    expect(
      validateWorkoutSetCreate({
        repetitions: 30,
        loadKg: 50,
        durationSeconds: 600,
        distanceMeters: 8000,
      }),
    ).toBeNull();
  });

  it("rejects an empty set", () => {
    expect(validateWorkoutSetCreate({})).toEqual({ kind: "empty_set" });
  });

  it("treats null performance fields as absent", () => {
    expect(
      validateWorkoutSetCreate({
        repetitions: null,
        loadKg: null,
        durationSeconds: null,
        distanceMeters: null,
      }),
    ).toEqual({ kind: "empty_set" });
    expect(
      validateWorkoutSetCreate({ repetitions: null, durationSeconds: 30 }),
    ).toBeNull();
  });

  it("rejects a negative repetition", () => {
    expect(validateWorkoutSetCreate({ repetitions: -1 })).toEqual({
      kind: "repetitions_out_of_range",
      min: 0,
      max: 9999.99,
    });
  });

  it("rejects a load above the bound", () => {
    expect(validateWorkoutSetCreate({ loadKg: 99999 })).toEqual({
      kind: "load_kg_out_of_range",
      min: 0,
      max: 9999.999,
    });
  });

  it("rejects a duration above 24h", () => {
    expect(validateWorkoutSetCreate({ durationSeconds: 86_401 })).toEqual({
      kind: "duration_out_of_range",
      min: 0,
      max: 86_400,
    });
  });

  it("rejects a perceived exertion above 10", () => {
    expect(
      validateWorkoutSetCreate({ repetitions: 8, perceivedExertion: 11 }),
    ).toEqual({
      kind: "perceived_exertion_out_of_range",
      min: 0,
      max: 10,
    });
  });

  it("rejects a perceived exertion below 0", () => {
    expect(
      validateWorkoutSetCreate({ repetitions: 8, perceivedExertion: -1 }),
    ).toEqual({
      kind: "perceived_exertion_out_of_range",
      min: 0,
      max: 10,
    });
  });

  it("rejects a sequence of 0", () => {
    expect(validateWorkoutSetCreate({ sequence: 0, repetitions: 8 })).toEqual({
      kind: "sequence_out_of_range",
      min: 1,
      max: 9999,
    });
  });

  it("rejects a sequence above the cap", () => {
    expect(
      validateWorkoutSetCreate({ sequence: 10_000, repetitions: 8 }),
    ).toEqual({ kind: "sequence_out_of_range", min: 1, max: 9999 });
  });

  it("accepts a perceived exertion of exactly 0 and 10", () => {
    expect(
      validateWorkoutSetCreate({ repetitions: 8, perceivedExertion: 0 }),
    ).toBeNull();
    expect(
      validateWorkoutSetCreate({ repetitions: 8, perceivedExertion: 10 }),
    ).toBeNull();
  });

  it("accepts valid set types", () => {
    expect(
      validateWorkoutSetCreate({ repetitions: 8, setType: "normal" }),
    ).toBeNull();
    expect(
      validateWorkoutSetCreate({ repetitions: 8, setType: "warmup" }),
    ).toBeNull();
    expect(
      validateWorkoutSetCreate({ repetitions: 8, setType: "drop" }),
    ).toBeNull();
    expect(
      validateWorkoutSetCreate({ repetitions: 8, setType: "failure" }),
    ).toBeNull();
  });

  it("rejects an invalid set type", () => {
    expect(
      validateWorkoutSetCreate({ repetitions: 8, setType: "super_set" as any }),
    ).toEqual({ kind: "invalid_set_type" });
  });
});

describe("summariseExerciseSets", () => {
  it("returns zero-summary for an empty list", () => {
    expect(summariseExerciseSets([])).toEqual({
      bestLoadKg: null,
      lastSessionVolumeKg: null,
      totalSetCount: 0,
    });
  });

  it("computes best load as the maximum loadKg across all sets", () => {
    const sets = [
      baseSet({ id: "00000000-0000-4000-8000-00000000a001", loadKg: 60 }),
      baseSet({ id: "00000000-0000-4000-8000-00000000a002", loadKg: 80 }),
      baseSet({ id: "00000000-0000-4000-8000-00000000a003", loadKg: 70 }),
    ];
    expect(summariseExerciseSets(sets).bestLoadKg).toBe(80);
  });

  it("ignores sets without a load for bestLoad", () => {
    const sets = [
      baseSet({ id: "00000000-0000-4000-8000-00000000a001", loadKg: null }),
      baseSet({ id: "00000000-0000-4000-8000-00000000a002", loadKg: 80 }),
    ];
    expect(summariseExerciseSets(sets).bestLoadKg).toBe(80);
  });

  it("computes lastSessionVolumeKg for the newest session (load × reps summed)", () => {
    // Most recent set is at index 0; its workoutId identifies the
    // "newest session". Volume = sum(load * reps) for sets in
    // that workoutId only.
    const sets = [
      baseSet({
        id: "00000000-0000-4000-8000-00000000a001",
        workoutId: "00000000-0000-4000-8000-00000000b003",
        loadKg: 100,
        repetitions: 5,
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a002",
        workoutId: "00000000-0000-4000-8000-00000000b003",
        loadKg: 90,
        repetitions: 5,
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a003",
        workoutId: "00000000-0000-4000-8000-00000000b002",
        loadKg: 50,
        repetitions: 10,
      }),
    ];
    // Newest session (workoutId ending b003): 100*5 + 90*5 = 950
    expect(summariseExerciseSets(sets).lastSessionVolumeKg).toBe(950);
  });

  it("returns null for lastSessionVolumeKg when the newest session has a non-load set", () => {
    // Mixed session with a cardio set yields no volume (volume
    // is meaningless when load is nullable).
    const sets = [
      baseSet({
        id: "00000000-0000-4000-8000-00000000a001",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: 100,
        repetitions: 5,
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a002",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: null,
        durationSeconds: 60,
      }),
    ];
    expect(summariseExerciseSets(sets).lastSessionVolumeKg).toBeNull();
  });

  it("returns null for lastSessionVolumeKg when the newest set is a cardio-only set", () => {
    const sets = [
      baseSet({
        id: "00000000-0000-4000-8000-00000000a001",
        loadKg: null,
        durationSeconds: 1200,
      }),
    ];
    expect(summariseExerciseSets(sets).lastSessionVolumeKg).toBeNull();
  });

  it("counts every input as a set", () => {
    const sets = [
      baseSet({ id: "00000000-0000-4000-8000-00000000a001" }),
      baseSet({ id: "00000000-0000-4000-8000-00000000a002" }),
    ];
    expect(summariseExerciseSets(sets).totalSetCount).toBe(2);
  });

  it("rounds volume to three decimals to match the SQL numeric(8,3) precision", () => {
    // 12.345 * 5 = 61.725
    const sets = [
      baseSet({
        id: "00000000-0000-4000-8000-00000000a001",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: 12.345,
        repetitions: 5,
      }),
    ];
    expect(summariseExerciseSets(sets).lastSessionVolumeKg).toBe(61.725);
  });

  it("ignores warmup sets when computing bestLoadKg", () => {
    const sets = [
      baseSet({
        id: "00000000-0000-4000-8000-00000000a001",
        loadKg: 120,
        setType: "warmup",
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a002",
        loadKg: 100,
        setType: "normal",
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a003",
        loadKg: 95,
        setType: "failure",
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a004",
        loadKg: 80,
        setType: "drop",
      }),
    ];
    // 120kg was a warmup, so working best load is 100kg
    expect(summariseExerciseSets(sets).bestLoadKg).toBe(100);
  });

  it("includes normal, drop, and failure sets in lastSessionVolumeKg while excluding warmup sets", () => {
    const sets = [
      baseSet({
        id: "00000000-0000-4000-8000-00000000a001",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: 50,
        repetitions: 10,
        setType: "warmup", // 50 * 10 = 500 (excluded)
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a002",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: 100,
        repetitions: 5,
        setType: "normal", // 100 * 5 = 500
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a003",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: 100,
        repetitions: 4,
        setType: "failure", // 100 * 4 = 400
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a004",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: 80,
        repetitions: 8,
        setType: "drop", // 80 * 8 = 640
      }),
    ];
    // Volume: 500 (normal) + 400 (failure) + 640 (drop) = 1540 (warmup excluded)
    const summary = summariseExerciseSets(sets);
    expect(summary.lastSessionVolumeKg).toBe(1540);
    expect(summary.totalSetCount).toBe(4);
  });

  it("does not taint lastSessionVolumeKg when a warmup set lacks load/reps", () => {
    const sets = [
      baseSet({
        id: "00000000-0000-4000-8000-00000000a001",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: null,
        durationSeconds: 300,
        setType: "warmup", // warmup stretching/cardio with no load
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a002",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: 100,
        repetitions: 5,
        setType: "normal",
      }),
    ];
    // Normal set contributes 500; warmup cardio set does not taint working volume
    expect(summariseExerciseSets(sets).lastSessionVolumeKg).toBe(500);
  });

  it("returns null for lastSessionVolumeKg when a session contains only warmup sets", () => {
    const sets = [
      baseSet({
        id: "00000000-0000-4000-8000-00000000a001",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: 40,
        repetitions: 10,
        setType: "warmup",
      }),
      baseSet({
        id: "00000000-0000-4000-8000-00000000a002",
        workoutId: "00000000-0000-4000-8000-00000000b001",
        loadKg: 60,
        repetitions: 5,
        setType: "warmup",
      }),
    ];
    expect(summariseExerciseSets(sets).lastSessionVolumeKg).toBeNull();
  });
});
