import { describe, expect, it } from "vitest";

import {
  computeWorkoutProgressions,
  evaluateExerciseProgression,
  parseTargetLoadString,
  POUNDS_TO_KG_MULTIPLIER,
} from "./progressive-overload.js";

describe("parseTargetLoadString", () => {
  it("parses plain numbers", () => {
    expect(parseTargetLoadString("80")).toBe(80);
    expect(parseTargetLoadString("140.5")).toBe(140.5);
    expect(parseTargetLoadString(80)).toBe(80);
    expect(parseTargetLoadString(140.5)).toBe(140.5);
  });

  it("parses metric kg strings", () => {
    expect(parseTargetLoadString("80 kg")).toBe(80);
    expect(parseTargetLoadString("80kg")).toBe(80);
    expect(parseTargetLoadString("80 KG")).toBe(80);
    expect(parseTargetLoadString("80.5 kg")).toBe(80.5);
    expect(parseTargetLoadString("80,5 kg")).toBe(80.5);
    expect(parseTargetLoadString("100 kgs")).toBe(100);
  });

  it("parses imperial lbs strings and converts to kg", () => {
    // 175.5 * 0.45359237 = 79.60546... -> rounds to 79.61 kg with 2 decimals
    expect(parseTargetLoadString("175.5 lbs")).toBe(79.61);
    expect(parseTargetLoadString("175.5lbs")).toBe(79.61);
    expect(parseTargetLoadString("175.5 lb")).toBe(79.61);
    expect(parseTargetLoadString("175,5 lb")).toBe(79.61);
    expect(parseTargetLoadString("200 pounds")).toBe(
      Math.round(200 * POUNDS_TO_KG_MULTIPLIER * 100) / 100,
    );
  });

  it("supports custom rounding decimals for imperial conversions", () => {
    expect(parseTargetLoadString("175.5 lbs", { roundDecimals: 3 })).toBe(
      79.605,
    );
    expect(parseTargetLoadString("175.5 lbs", { roundDecimals: 1 })).toBe(79.6);
  });

  it("returns null for invalid, empty, or negative values", () => {
    expect(parseTargetLoadString(null)).toBeNull();
    expect(parseTargetLoadString(undefined)).toBeNull();
    expect(parseTargetLoadString("")).toBeNull();
    expect(parseTargetLoadString("   ")).toBeNull();
    expect(parseTargetLoadString("0")).toBeNull();
    expect(parseTargetLoadString(0)).toBeNull();
    expect(parseTargetLoadString("-80")).toBeNull();
    expect(parseTargetLoadString("-80 kg")).toBeNull();
    expect(parseTargetLoadString("-175.5 lbs")).toBeNull();
    expect(parseTargetLoadString("abc")).toBeNull();
    expect(parseTargetLoadString("80 kg / 175 lbs")).toBeNull();
    expect(parseTargetLoadString(Number.NaN)).toBeNull();
  });
});

describe("evaluateExerciseProgression", () => {
  it("progresses when increasing load over target", () => {
    const result = evaluateExerciseProgression({
      currentTargetLoadKg: 80,
      completedSets: [
        { loadKg: 80, repetitions: 8 },
        { loadKg: 85, repetitions: 5 },
      ],
    });

    expect(result).toEqual({
      progressed: true,
      previousTargetKg: 80,
      nextTargetKg: 85,
      peakLoadKg: 85,
      reason: "load_increased",
    });
  });

  it("does not progress when meeting exact target without exceeding", () => {
    const result = evaluateExerciseProgression({
      currentTargetLoadKg: 80,
      completedSets: [
        { loadKg: 75, repetitions: 10 },
        { loadKg: 80, repetitions: 8 },
      ],
    });

    expect(result).toEqual({
      progressed: false,
      previousTargetKg: 80,
      nextTargetKg: 80,
      peakLoadKg: 80,
      reason: "target_not_exceeded",
    });
  });

  it("does not progress when falling short of target", () => {
    const result = evaluateExerciseProgression({
      currentTargetLoadKg: 80,
      completedSets: [
        { loadKg: 70, repetitions: 10 },
        { loadKg: 75, repetitions: 8 },
      ],
    });

    expect(result).toEqual({
      progressed: false,
      previousTargetKg: 80,
      nextTargetKg: 80,
      peakLoadKg: 75,
      reason: "target_not_exceeded",
    });
  });

  it("establishes first-time target when current target is null", () => {
    const result = evaluateExerciseProgression({
      currentTargetLoadKg: null,
      completedSets: [
        { loadKg: 60, repetitions: 10 },
        { loadKg: 65, repetitions: 8 },
      ],
    });

    expect(result).toEqual({
      progressed: true,
      previousTargetKg: null,
      nextTargetKg: 65,
      peakLoadKg: 65,
      reason: "initial_target_established",
    });
  });

  it("picks peak valid load from multiple sets with varied weights", () => {
    const result = evaluateExerciseProgression({
      currentTargetLoadKg: 70,
      completedSets: [
        { loadKg: 60, repetitions: 12 },
        { loadKg: 75, repetitions: 8 },
        { loadKg: 70, repetitions: 10 },
      ],
    });

    expect(result).toEqual({
      progressed: true,
      previousTargetKg: 70,
      nextTargetKg: 75,
      peakLoadKg: 75,
      reason: "load_increased",
    });
  });

  it("ignores zero reps, null load, zero load, or negative values", () => {
    const result = evaluateExerciseProgression({
      currentTargetLoadKg: 80,
      completedSets: [
        { loadKg: 100, repetitions: 0 }, // 0 reps -> ignored
        { loadKg: 100, repetitions: null }, // null reps -> ignored
        { loadKg: 0, repetitions: 10 }, // 0 load -> ignored
        { loadKg: null, repetitions: 10 }, // null load -> ignored
        { loadKg: -50, repetitions: 5 }, // negative load -> ignored
        { loadKg: 85, repetitions: 5 }, // valid set!
      ],
    });

    expect(result).toEqual({
      progressed: true,
      previousTargetKg: 80,
      nextTargetKg: 85,
      peakLoadKg: 85,
      reason: "load_increased",
    });
  });

  it("ignores warmup sets so warmups do not trigger progression", () => {
    const result = evaluateExerciseProgression({
      currentTargetLoadKg: 80,
      completedSets: [
        { loadKg: 100, repetitions: 5, setType: "warmup" }, // 100kg warmup should be ignored!
        { loadKg: 75, repetitions: 8, setType: "normal" }, // 75kg < 80kg target
      ],
    });

    expect(result).toEqual({
      progressed: false,
      previousTargetKg: 80,
      nextTargetKg: 80,
      peakLoadKg: 75,
      reason: "target_not_exceeded",
    });
  });

  it("evaluates progression using drop and failure sets as valid working sets", () => {
    const result = evaluateExerciseProgression({
      currentTargetLoadKg: 80,
      completedSets: [
        { loadKg: 60, repetitions: 10, setType: "warmup" },
        { loadKg: 80, repetitions: 8, setType: "normal" },
        { loadKg: 85, repetitions: 4, setType: "failure" }, // progressed on failure set
        { loadKg: 70, repetitions: 10, setType: "drop" },
      ],
    });

    expect(result).toEqual({
      progressed: true,
      previousTargetKg: 80,
      nextTargetKg: 85,
      peakLoadKg: 85,
      reason: "load_increased",
    });
  });

  it("reports no_valid_sets when only warmup sets are completed", () => {
    const result = evaluateExerciseProgression({
      currentTargetLoadKg: 80,
      completedSets: [
        { loadKg: 50, repetitions: 10, setType: "warmup" },
        { loadKg: 70, repetitions: 8, setType: "warmup" },
      ],
    });

    expect(result).toEqual({
      progressed: false,
      previousTargetKg: 80,
      nextTargetKg: 80,
      peakLoadKg: null,
      reason: "no_valid_sets",
    });
  });

  it("reports no_valid_sets when no completed sets meet validity criteria", () => {
    const resultEmpty = evaluateExerciseProgression({
      currentTargetLoadKg: 80,
      completedSets: [],
    });
    expect(resultEmpty).toEqual({
      progressed: false,
      previousTargetKg: 80,
      nextTargetKg: 80,
      peakLoadKg: null,
      reason: "no_valid_sets",
    });

    const resultInvalidOnly = evaluateExerciseProgression({
      currentTargetLoadKg: 80,
      completedSets: [
        { loadKg: 0, repetitions: 10 },
        { loadKg: 100, repetitions: 0 },
        { loadKg: null, repetitions: null },
      ],
    });
    expect(resultInvalidOnly).toEqual({
      progressed: false,
      previousTargetKg: 80,
      nextTargetKg: 80,
      peakLoadKg: null,
      reason: "no_valid_sets",
    });
  });
});

describe("computeWorkoutProgressions", () => {
  it("performs batch evaluation across multiple exercises in a workout", () => {
    const exercises = [
      { id: "bench-press", name: "Bench Press" },
      { id: "squat", name: "Barbell Back Squat" },
      { id: "overhead-press", name: "Overhead Press" },
      { id: "barbell-row", name: "Barbell Row" },
    ];

    const plannedExercises = [
      { name: "Bench Press", targetLoadKg: 80 },
      { name: "Barbell Back Squat", targetLoad: "120 kg" },
      { name: "Overhead Press", targetLoad: "50 kg" },
      // barbell-row has no planned target
    ];

    const completedSets = [
      // Bench press: increased load (85 > 80)
      { exerciseId: "bench-press", loadKg: 80, repetitions: 8 },
      { exerciseId: "bench-press", loadKg: 85, repetitions: 5 },
      // Squat: exact target met (120 === 120)
      { exerciseId: "squat", loadKg: 110, repetitions: 8 },
      { exerciseId: "squat", loadKg: 120, repetitions: 6 },
      // Overhead press: fell short (45 < 50)
      { exerciseId: "overhead-press", loadKg: 45, repetitions: 6 },
      // Barbell row: first-time target established (null -> 70)
      { exerciseId: "barbell-row", loadKg: 70, repetitions: 8 },
    ];

    const progressions = computeWorkoutProgressions({
      exercises,
      plannedExercises,
      completedSets,
    });

    expect(progressions).toHaveLength(4);

    expect(progressions[0]).toMatchObject({
      exerciseId: "bench-press",
      exerciseName: "Bench Press",
      currentTargetLoadKg: 80,
      progressed: true,
      previousTargetKg: 80,
      nextTargetKg: 85,
      peakLoadKg: 85,
      reason: "load_increased",
    });

    expect(progressions[1]).toMatchObject({
      exerciseId: "squat",
      exerciseName: "Barbell Back Squat",
      currentTargetLoadKg: 120,
      progressed: false,
      previousTargetKg: 120,
      nextTargetKg: 120,
      peakLoadKg: 120,
      reason: "target_not_exceeded",
    });

    expect(progressions[2]).toMatchObject({
      exerciseId: "overhead-press",
      exerciseName: "Overhead Press",
      currentTargetLoadKg: 50,
      progressed: false,
      previousTargetKg: 50,
      nextTargetKg: 50,
      peakLoadKg: 45,
      reason: "target_not_exceeded",
    });

    expect(progressions[3]).toMatchObject({
      exerciseId: "barbell-row",
      exerciseName: "Barbell Row",
      currentTargetLoadKg: null,
      progressed: true,
      previousTargetKg: null,
      nextTargetKg: 70,
      peakLoadKg: 70,
      reason: "initial_target_established",
    });
  });

  it("handles exercises with metadata target loads as fallback", () => {
    const exercises = [
      {
        id: "deadlift",
        name: "Deadlift",
        metadata: { targetLoadKg: 140 },
      },
      {
        id: "incline-press",
        name: "Incline Dumbbell Press",
        metadata: { targetLoad: "30 kg" },
      },
    ];

    const completedSets = [
      { exerciseId: "deadlift", loadKg: 145, repetitions: 3 },
      { exerciseId: "incline-press", loadKg: 30, repetitions: 10 },
    ];

    const progressions = computeWorkoutProgressions({
      exercises,
      completedSets,
    });

    expect(progressions[0]).toMatchObject({
      exerciseId: "deadlift",
      currentTargetLoadKg: 140,
      progressed: true,
      reason: "load_increased",
      nextTargetKg: 145,
    });

    expect(progressions[1]).toMatchObject({
      exerciseId: "incline-press",
      currentTargetLoadKg: 30,
      progressed: false,
      reason: "target_not_exceeded",
      nextTargetKg: 30,
    });
  });

  it("handles exercises without completed sets gracefully", () => {
    const exercises = [{ id: "pullups", name: "Pull-ups" }];
    const plannedExercises = [{ name: "Pull-ups", targetLoadKg: 10 }];

    const progressions = computeWorkoutProgressions({
      exercises,
      plannedExercises,
      completedSets: [],
    });

    expect(progressions).toHaveLength(1);
    expect(progressions[0]).toMatchObject({
      exerciseId: "pullups",
      currentTargetLoadKg: 10,
      progressed: false,
      peakLoadKg: null,
      reason: "no_valid_sets",
    });
  });

  it("includes extra exercises from completedSets even if not in exercises list", () => {
    const progressions = computeWorkoutProgressions({
      exercises: [],
      plannedExercises: [{ name: "lateral-raise", targetLoadKg: 12 }],
      completedSets: [
        { exerciseId: "lateral-raise", loadKg: 14, repetitions: 12 },
      ],
    });

    expect(progressions).toHaveLength(1);
    expect(progressions[0]).toMatchObject({
      exerciseId: "lateral-raise",
      currentTargetLoadKg: 12,
      progressed: true,
      peakLoadKg: 14,
      nextTargetKg: 14,
      reason: "load_increased",
    });
  });

  it("filters out warmup sets during batch workout evaluation", () => {
    const exercises = [{ id: "bench", name: "Bench Press" }];
    const plannedExercises = [{ name: "Bench Press", targetLoadKg: 100 }];
    const completedSets = [
      {
        exerciseId: "bench",
        loadKg: 110,
        repetitions: 3,
        setType: "warmup" as const,
      },
      {
        exerciseId: "bench",
        loadKg: 95,
        repetitions: 6,
        setType: "normal" as const,
      },
    ];

    const progressions = computeWorkoutProgressions({
      exercises,
      plannedExercises,
      completedSets,
    });

    expect(progressions).toHaveLength(1);
    expect(progressions[0]).toMatchObject({
      exerciseId: "bench",
      currentTargetLoadKg: 100,
      progressed: false,
      peakLoadKg: 95,
      nextTargetKg: 100,
      reason: "target_not_exceeded",
    });
  });
});
