import type {
  CoachingPreferences,
  EquipmentOption,
  TrainingLimitation,
} from "./profile";
import type { GoalKind } from "./goal";

export const TRAINING_PRESCRIPTION_VERSION =
  "v1-general-resistance-2026-07" as const;

export type MovementPattern =
  | "knee_dominant"
  | "hip_hinge"
  | "horizontal_push"
  | "horizontal_pull"
  | "vertical_push"
  | "vertical_pull"
  | "core"
  | "aerobic"
  | "mobility";

export type TrainingVolumeAction = "build" | "hold" | "reduce";

/**
 * AI-ACT-006 — per-session focus distribution. Extracted from the
 * user's free-text request ("two upper body days and one lower body
 * day") by the pattern matcher and forwarded to the prescription
 * engine. The engine uses it to filter movement patterns to upper
 * or lower body per session, and to label the session
 * ("Upper body" / "Lower body" / "Full body") instead of the
 * generic "Session N".
 */
export type SessionFocus = "upper" | "lower" | "full";

const SESSION_FOCUS_LABELS: Record<SessionFocus, string> = {
  upper: "Upper body",
  lower: "Lower body",
  full: "Full body",
};

export const sessionFocusLabel = (focus: SessionFocus): string =>
  SESSION_FOCUS_LABELS[focus];

const UPPER_BODY_PATTERNS: ReadonlySet<MovementPattern> = new Set([
  "horizontal_push",
  "horizontal_pull",
  "vertical_push",
  "vertical_pull",
]);

const LOWER_BODY_PATTERNS: ReadonlySet<MovementPattern> = new Set([
  "knee_dominant",
  "hip_hinge",
]);

const isUpperOnlyPattern = (pattern: MovementPattern): boolean =>
  UPPER_BODY_PATTERNS.has(pattern);

const isLowerOnlyPattern = (pattern: MovementPattern): boolean =>
  LOWER_BODY_PATTERNS.has(pattern);

const allowedPatternsFor = (
  focus: SessionFocus,
  allPatterns: readonly MovementPattern[],
): MovementPattern[] => {
  if (focus === "upper") {
    return allPatterns.filter((pattern) => !isLowerOnlyPattern(pattern));
  }
  if (focus === "lower") {
    return allPatterns.filter((pattern) => !isUpperOnlyPattern(pattern));
  }
  return [...allPatterns];
};

export type TrainingPrescriptionMissingInput =
  "active_goal" | "experience_level" | "training_days" | "session_duration";

import {
  TRAINING_EXERCISE_CATALOG as CATALOG,
  type CatalogExercise,
} from "./exercise-catalog";

export interface TrainingPrescription {
  readonly version: typeof TRAINING_PRESCRIPTION_VERSION;
  readonly computedAt: Date;
  readonly complete: boolean;
  readonly missingInputs: readonly TrainingPrescriptionMissingInput[];
  readonly goalKind: GoalKind | null;
  readonly requestedDaysPerWeek: number | null;
  readonly resistanceDaysPerWeek: number | null;
  readonly aerobicMinutesPerWeek: number;
  readonly recentLoad: {
    readonly completedSessionsLast7Days: number;
    readonly completedSetsLast7Days: number;
    readonly averageRpeLast7Days: number | null;
  };
  readonly volumeAction: TrainingVolumeAction;
  readonly sessions: readonly {
    readonly index: number;
    readonly label: string;
    readonly estimatedMinutes: number;
    readonly exercises: readonly {
      readonly catalogId: string;
      readonly name: string;
      readonly movementPattern: MovementPattern;
      readonly equipment: readonly EquipmentOption[];
      readonly sets: number;
      readonly repsMin: number | null;
      readonly repsMax: number | null;
      readonly durationMinutes: number | null;
      readonly restSeconds: number;
      readonly progression: "double_progression" | "time_progression";
    }[];
  }[];
  readonly assumptions: readonly string[];
  readonly warnings: readonly string[];
}

const focusFrom = (
  goalKind: GoalKind,
  preferences: CoachingPreferences,
): NonNullable<CoachingPreferences["trainingFocus"]> => {
  if (preferences.trainingFocus !== null) return preferences.trainingFocus;
  if (goalKind === "bulk") return "hypertrophy";
  if (goalKind === "cut") return "strength";
  return "balanced";
};

const exerciseAvailable = (
  exercise: CatalogExercise,
  equipment: ReadonlySet<EquipmentOption>,
  limitations: ReadonlySet<TrainingLimitation>,
): boolean => {
  const equipmentAvailable =
    equipment.has("full_gym") ||
    exercise.equipment.every((item) => equipment.has(item));
  return (
    equipmentAvailable &&
    !exercise.blockedBy.some((item) => limitations.has(item))
  );
};

const baseSetCount = (
  goalKind: GoalKind,
  experience: NonNullable<CoachingPreferences["experienceLevel"]>,
): number => {
  const goalBase = goalKind === "bulk" || goalKind === "recomp" ? 3 : 2;
  if (experience === "beginner") return Math.min(2, goalBase);
  return goalBase;
};

const repRange = (
  movement: MovementPattern,
  focus: NonNullable<CoachingPreferences["trainingFocus"]>,
): { min: number | null; max: number | null; duration: number | null } => {
  if (movement === "aerobic" || movement === "mobility") {
    return {
      min: null,
      max: null,
      duration: movement === "aerobic" ? 20 : 10,
    };
  }
  if (focus === "strength" && movement !== "core") {
    return { min: 4, max: 6, duration: null };
  }
  if (focus === "endurance" || movement === "core") {
    return { min: 12, max: 15, duration: null };
  }
  return { min: 8, max: 12, duration: null };
};

export const buildTrainingPrescription = (input: {
  readonly goalKind: GoalKind | null;
  readonly preferences: CoachingPreferences;
  readonly completedSessionsLast7Days: number;
  readonly completedSetsLast7Days: number;
  readonly averageRpeLast7Days: number | null;
  readonly now: Date;
  /**
   * Optional per-session focus distribution, length must equal the
   * computed `sessions.length`. When omitted, every session uses
   * the default "full body" rotation. When supplied, the engine
   * filters movement patterns to upper or lower body per session
   * and uses a human-friendly session label.
   */
  readonly sessionDistribution?: readonly SessionFocus[];
}): TrainingPrescription => {
  const missingInputs: TrainingPrescriptionMissingInput[] = [];
  if (input.goalKind === null) missingInputs.push("active_goal");
  if (input.preferences.experienceLevel === null) {
    missingInputs.push("experience_level");
  }
  if (input.preferences.trainingDaysPerWeek === null) {
    missingInputs.push("training_days");
  }
  if (input.preferences.sessionDurationMinutes === null) {
    missingInputs.push("session_duration");
  }
  const recentLoad = {
    completedSessionsLast7Days: Math.max(
      0,
      Math.floor(input.completedSessionsLast7Days),
    ),
    completedSetsLast7Days: Math.max(
      0,
      Math.floor(input.completedSetsLast7Days),
    ),
    averageRpeLast7Days:
      input.averageRpeLast7Days === null
        ? null
        : Math.max(0, Math.min(10, input.averageRpeLast7Days)),
  };
  if (
    input.goalKind === null ||
    input.preferences.experienceLevel === null ||
    input.preferences.trainingDaysPerWeek === null ||
    input.preferences.sessionDurationMinutes === null
  ) {
    return {
      version: TRAINING_PRESCRIPTION_VERSION,
      computedAt: input.now,
      complete: false,
      missingInputs,
      goalKind: input.goalKind,
      requestedDaysPerWeek: input.preferences.trainingDaysPerWeek,
      resistanceDaysPerWeek: null,
      aerobicMinutesPerWeek: 150,
      recentLoad,
      volumeAction: "hold",
      sessions: [],
      assumptions: [],
      warnings: [
        "Complete the missing Coach preferences before Mizyun creates a training prescription.",
      ],
    };
  }

  const goalKind = input.goalKind;
  const preferences = input.preferences;
  const trainingDaysPerWeek = input.preferences.trainingDaysPerWeek;
  const sessionDurationMinutes = input.preferences.sessionDurationMinutes;
  const experienceLevel = input.preferences.experienceLevel;
  const focus = focusFrom(goalKind, preferences);
  const resistanceDaysPerWeek = Math.min(4, trainingDaysPerWeek);
  const equipment = new Set<EquipmentOption>([
    "bodyweight",
    ...preferences.availableEquipment,
  ]);
  const limitations = new Set(preferences.trainingLimitations);
  const available = CATALOG.filter((exercise) =>
    exerciseAvailable(exercise, equipment, limitations),
  );
  const patterns: readonly MovementPattern[] = [
    "knee_dominant",
    "hip_hinge",
    "horizontal_push",
    "horizontal_pull",
    "vertical_push",
    "vertical_pull",
    "core",
    "mobility",
  ];
  const exerciseCount =
    sessionDurationMinutes <= 20
      ? 2
      : sessionDurationMinutes <= 30
        ? 3
        : sessionDurationMinutes <= 45
          ? 5
          : sessionDurationMinutes <= 60
            ? 6
            : 7;
  const baseSets = baseSetCount(goalKind, experienceLevel);
  const projectedBaseSets = resistanceDaysPerWeek * exerciseCount * baseSets;
  const volumeAction: TrainingVolumeAction =
    (recentLoad.averageRpeLast7Days ?? 0) >= 8.5 ||
    recentLoad.completedSetsLast7Days > projectedBaseSets * 1.25
      ? "reduce"
      : recentLoad.completedSessionsLast7Days >= resistanceDaysPerWeek &&
          (recentLoad.averageRpeLast7Days ?? 10) <= 8
        ? "build"
        : "hold";
  const prescribedSets =
    volumeAction === "reduce" ? Math.max(1, baseSets - 1) : baseSets;
  const warnings: string[] = [];
  if (trainingDaysPerWeek < 2) {
    warnings.push(
      "The requested schedule is below the general two-day muscle-strengthening baseline; the plan stays within the one day selected.",
    );
  }
  if (trainingDaysPerWeek > 4) {
    warnings.push(
      "Resistance training is capped at four days; use remaining preferred days for aerobic activity or recovery.",
    );
  }

  const sessions = Array.from(
    { length: resistanceDaysPerWeek },
    (_, sessionIndex) => {
      const sessionFocus: SessionFocus =
        input.sessionDistribution?.[sessionIndex] ?? "full";
      const allowedForFocus = allowedPatternsFor(sessionFocus, patterns);
      const rotated = allowedForFocus.map(
        (_, index) =>
          allowedForFocus[(index + sessionIndex * 2) % allowedForFocus.length]!,
      );
      const exercises = rotated
        .map((pattern, patternIdx) => {
          const choices = available.filter(
            (candidate) => candidate.movementPattern === pattern,
          );
          const preferred = choices.filter((candidate) =>
            candidate.focusFit.includes(focus),
          );
          const pool = preferred.length > 0 ? preferred : choices;
          const offset =
            (sessionIndex * 3 + patternIdx * 2) % Math.max(1, pool.length);
          return pool[offset] ?? null;
        })
        .filter((exercise): exercise is CatalogExercise => exercise !== null)
        .slice(0, exerciseCount)
        .map((exercise) => {
          const range = repRange(exercise.movementPattern, focus);
          return {
            catalogId: exercise.id,
            name: exercise.name,
            movementPattern: exercise.movementPattern,
            equipment: exercise.equipment,
            sets:
              exercise.movementPattern === "mobility" ||
              exercise.movementPattern === "aerobic"
                ? 1
                : prescribedSets,
            repsMin: range.min,
            repsMax: range.max,
            durationMinutes: range.duration,
            restSeconds:
              focus === "strength" &&
              exercise.movementPattern !== "core" &&
              exercise.movementPattern !== "mobility"
                ? 150
                : 90,
            progression:
              range.duration === null
                ? ("double_progression" as const)
                : ("time_progression" as const),
          };
        });
      if (exercises.length < exerciseCount) {
        warnings.push(
          `Session ${sessionIndex + 1} has fewer exercises because the selected equipment and movement constraints leave no compatible option for every pattern.`,
        );
      }
      const label =
        input.sessionDistribution === undefined ||
        input.sessionDistribution[sessionIndex] === undefined
          ? `Session ${sessionIndex + 1}`
          : sessionFocusLabel(input.sessionDistribution[sessionIndex]!);
      return {
        index: sessionIndex + 1,
        label,
        estimatedMinutes: sessionDurationMinutes,
        exercises,
      };
    },
  );

  return {
    version: TRAINING_PRESCRIPTION_VERSION,
    computedAt: input.now,
    complete: sessions.every((session) => session.exercises.length > 0),
    missingInputs,
    goalKind,
    requestedDaysPerWeek: trainingDaysPerWeek,
    resistanceDaysPerWeek,
    aerobicMinutesPerWeek: 150,
    recentLoad,
    volumeAction,
    sessions,
    assumptions: [
      `Training focus resolved to ${focus}.`,
      "Bodyweight movements are always considered available.",
      "Progress load only after all prescribed sets reach the top of the rep range with controlled technique and RPE at or below 8.",
      "Exercise choices are general wellness suggestions and do not interpret pain, injury, or medical restrictions.",
    ],
    warnings: [...new Set(warnings)],
  };
};
