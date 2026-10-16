import type { BoulderActiveSessionResponse, Workout } from "@mizyun/contracts";
import {
  hasBoulderingActivity,
  hasRunningActivity,
  isRoutineDetails,
  isSessionDetails,
} from "@mizyun/core";
import { extractPlannedExercises } from "@/features/log-workout/log-workout-data";

export interface ActiveWorkoutSummary {
  readonly id: string;
  readonly name: string;
  readonly startedAt: string;
}

/** An active indoor bouldering session (ADR-0066), resumed into its own screen. */
export interface ActiveBoulderingSummary {
  readonly id: string;
  readonly name: string;
  readonly startedAt: string;
}

export const activeBoulderingFromResponse = (
  response: BoulderActiveSessionResponse,
): ActiveBoulderingSummary | null =>
  response.session && response.session.completedAt === null
    ? {
        id: response.session.id,
        name: response.session.session.gymName
          ? `Bouldering · ${response.session.session.gymName}`
          : "Bouldering",
        startedAt: response.session.startedAt,
      }
    : null;

export type SessionStartGuard =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "blocked";
      readonly title: string;
      readonly message: string;
      readonly resumeLabel: string;
      readonly resume:
        | { readonly pathname: "/log-workout"; readonly workoutId: string }
        | { readonly pathname: "/bouldering/session" };
    };

/**
 * ADR-0066 §3 client rule: only one live session across kinds. Starting a
 * strength workout while bouldering is active (or the reverse) is blocked
 * and offers Resume for the active one instead.
 */
export const guardSessionStart = (
  target: "strength" | "bouldering",
  active: {
    readonly workout: ActiveWorkoutSummary | null | undefined;
    readonly bouldering: ActiveBoulderingSummary | null | undefined;
  },
): SessionStartGuard => {
  if (target === "strength" && active.bouldering)
    return {
      kind: "blocked",
      title: "Bouldering session in progress",
      message:
        "Finish your bouldering session before starting a workout, or resume it now.",
      resumeLabel: "Resume bouldering",
      resume: { pathname: "/bouldering/session" },
    };
  if (target === "bouldering" && active.workout)
    return {
      kind: "blocked",
      title: "Workout in progress",
      message:
        "Finish your workout before starting a bouldering session, or resume it now.",
      resumeLabel: "Resume workout",
      resume: { pathname: "/log-workout", workoutId: active.workout.id },
    };
  return { kind: "allowed" };
};

export interface RestTimerState {
  readonly endsAt: number;
  readonly total: number;
  readonly exerciseName: string;
  readonly nextExerciseName?: string;
  readonly nextSetSummary?: string;
  readonly allPlannedSetsCompleted?: boolean;
  readonly notificationId?: string | null;
}

/**
 * Finds the current active incomplete workout session from a list of workouts.
 * Adheres strictly to ADR-0009: routine rows are excluded, and incomplete sessions
 * matching today's date (or the earliest incomplete session) are returned.
 */
export const findIncompleteWorkout = (
  workouts: ReadonlyArray<Workout>,
  todayIso: string = new Date().toISOString().slice(0, 10),
): Workout | null => {
  const incomplete = workouts.filter((candidate) => {
    if (
      candidate.completedAt !== null ||
      isRoutineDetails(candidate.details) ||
      // Bouldering and runs resume through their own screens, never as strength.
      hasBoulderingActivity(candidate.details) ||
      hasRunningActivity(candidate.details)
    ) {
      return false;
    }
    return (
      isSessionDetails(candidate.details) ||
      extractPlannedExercises(candidate).length === 0
    );
  });

  if (incomplete.length === 0) {
    return null;
  }

  const matchingToday = incomplete.find(
    (candidate) => candidate.startedAt.slice(0, 10) === todayIso,
  );
  if (matchingToday !== undefined) {
    return matchingToday;
  }

  const sortedIncomplete = [...incomplete].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
  return sortedIncomplete[0] ?? null;
};

/**
 * Calculates the wall-clock elapsed duration in seconds from the ISO startedAt timestamp.
 */
export const computeElapsedSeconds = (
  startedAtIso: string,
  nowMs: number = Date.now(),
): number => {
  const startMs = new Date(startedAtIso).getTime();
  if (Number.isNaN(startMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
};

/**
 * Formats elapsed seconds into mm:ss or hh:mm:ss.
 */
export const formatStopwatch = (totalSeconds: number): string => {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/**
 * Checks whether a rest timer is currently running.
 */
export const isRestTimerActive = (
  restTimer: RestTimerState | null,
  nowMs: number = Date.now(),
): boolean => {
  return restTimer !== null && nowMs < restTimer.endsAt;
};

/**
 * Computes remaining seconds for an active rest timer, or 0 if expired.
 */
export const computeRestRemainingSeconds = (
  restTimer: RestTimerState | null,
  nowMs: number = Date.now(),
): number => {
  if (!restTimer || nowMs >= restTimer.endsAt) {
    return 0;
  }
  return Math.max(0, Math.ceil((restTimer.endsAt - nowMs) / 1000));
};
