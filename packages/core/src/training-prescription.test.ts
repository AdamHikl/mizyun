import { describe, expect, it } from "vitest";

import { buildTrainingPrescription } from "./training-prescription";
import type { CoachingPreferences } from "./profile";

const preferences = (
  overrides: Partial<CoachingPreferences> = {},
): CoachingPreferences => ({
  experienceLevel: "intermediate",
  trainingDaysPerWeek: 4,
  sessionDurationMinutes: 60,
  trainingFocus: "hypertrophy",
  availableEquipment: ["dumbbells", "bench"],
  dietaryPreferences: ["omnivore"],
  trainingLimitations: [],
  ...overrides,
});

describe("buildTrainingPrescription", () => {
  it("creates a goal-, equipment-, and schedule-aware weekly plan", () => {
    const result = buildTrainingPrescription({
      goalKind: "bulk",
      preferences: preferences(),
      completedSessionsLast7Days: 3,
      completedSetsLast7Days: 45,
      averageRpeLast7Days: 7.5,
      now: new Date("2026-07-26T10:00:00Z"),
    });
    expect(result.complete).toBe(true);
    expect(result.resistanceDaysPerWeek).toBe(4);
    expect(result.volumeAction).toBe("hold");
    expect(result.sessions).toHaveLength(4);
    const allExercises = result.sessions.flatMap(
      (session) => session.exercises,
    );
    expect(allExercises.length).toBeGreaterThanOrEqual(12);
    expect(allExercises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sets: 3,
          repsMin: 8,
          repsMax: 12,
        }),
      ]),
    );
  });

  it("removes exercises incompatible with explicit movement constraints", () => {
    const result = buildTrainingPrescription({
      goalKind: "maintain",
      preferences: preferences({
        trainingDaysPerWeek: 2,
        availableEquipment: ["full_gym"],
        trainingLimitations: [
          "no_overhead_work",
          "limited_spinal_loading",
          "limited_knee_flexion",
        ],
      }),
      completedSessionsLast7Days: 0,
      completedSetsLast7Days: 0,
      averageRpeLast7Days: null,
      now: new Date("2026-07-26T10:00:00Z"),
    });
    const ids = result.sessions.flatMap((session) =>
      session.exercises.map((exercise) => exercise.catalogId),
    );
    expect(ids).not.toContain("barbell-squat");
    expect(ids).not.toContain("barbell-rdl");
    expect(ids).not.toContain("dumbbell-overhead-press");
  });

  it("reduces volume after high exertion and caps resistance days", () => {
    const result = buildTrainingPrescription({
      goalKind: "recomp",
      preferences: preferences({ trainingDaysPerWeek: 7 }),
      completedSessionsLast7Days: 5,
      completedSetsLast7Days: 100,
      averageRpeLast7Days: 9,
      now: new Date("2026-07-26T10:00:00Z"),
    });
    expect(result.resistanceDaysPerWeek).toBe(4);
    expect(result.volumeAction).toBe("reduce");
    expect(result.warnings).toContain(
      "Resistance training is capped at four days; use remaining preferred days for aerobic activity or recovery.",
    );
  });

  it("returns typed missing inputs rather than guessing", () => {
    const result = buildTrainingPrescription({
      goalKind: null,
      preferences: preferences({
        experienceLevel: null,
        trainingDaysPerWeek: null,
        sessionDurationMinutes: null,
      }),
      completedSessionsLast7Days: 0,
      completedSetsLast7Days: 0,
      averageRpeLast7Days: null,
      now: new Date("2026-07-26T10:00:00Z"),
    });
    expect(result.complete).toBe(false);
    expect(result.missingInputs).toEqual([
      "active_goal",
      "experience_level",
      "training_days",
      "session_duration",
    ]);
    expect(result.sessions).toEqual([]);
  });
});

describe("buildTrainingPrescription — session distribution", () => {
  const lowerPatterns = new Set(["knee_dominant", "hip_hinge"]);
  const upperPatterns = new Set([
    "horizontal_push",
    "horizontal_pull",
    "vertical_push",
    "vertical_pull",
  ]);

  it("labels and restricts exercises per session when distribution is supplied", () => {
    const result = buildTrainingPrescription({
      goalKind: "bulk",
      preferences: preferences({
        trainingDaysPerWeek: 3,
        availableEquipment: ["full_gym"],
      }),
      completedSessionsLast7Days: 0,
      completedSetsLast7Days: 0,
      averageRpeLast7Days: null,
      now: new Date("2026-07-26T10:00:00Z"),
      sessionDistribution: ["upper", "upper", "lower"],
    });
    expect(result.sessions).toHaveLength(3);
    expect(result.sessions.map((session) => session.label)).toEqual([
      "Upper body",
      "Upper body",
      "Lower body",
    ]);
    const upperSessionPatterns = result.sessions[0]!.exercises.map(
      (exercise) => exercise.movementPattern,
    );
    const lowerSessionPatterns = result.sessions[2]!.exercises.map(
      (exercise) => exercise.movementPattern,
    );
    for (const pattern of upperSessionPatterns) {
      expect(
        upperPatterns.has(pattern) ||
          pattern === "core" ||
          pattern === "mobility",
      ).toBe(true);
      expect(lowerPatterns.has(pattern)).toBe(false);
    }
    for (const pattern of lowerSessionPatterns) {
      expect(
        lowerPatterns.has(pattern) ||
          pattern === "core" ||
          pattern === "mobility",
      ).toBe(true);
      expect(upperPatterns.has(pattern)).toBe(false);
    }
  });

  it("falls back to generic Session N labels when no distribution is supplied", () => {
    const result = buildTrainingPrescription({
      goalKind: "bulk",
      preferences: preferences(),
      completedSessionsLast7Days: 0,
      completedSetsLast7Days: 0,
      averageRpeLast7Days: null,
      now: new Date("2026-07-26T10:00:00Z"),
    });
    expect(result.sessions.map((session) => session.label)).toEqual([
      "Session 1",
      "Session 2",
      "Session 3",
      "Session 4",
    ]);
  });
});
