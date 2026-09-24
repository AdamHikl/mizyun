import type { Workout } from "@mizyun/contracts";
import { isRoutineDetails, isSessionDetails } from "@mizyun/core";
import { extractPlannedExercises } from "@/features/log-workout/log-workout-data";

export interface ActiveWorkoutSummary {
  readonly id: string;
  readonly name: string;
  readonly startedAt: string;
}

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
    if (candidate.completedAt !== null || isRoutineDetails(candidate.details)) {
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
