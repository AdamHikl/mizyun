import type { StretchStep } from "@mizyun/core";

/**
 * Where the guided session is: which stretch, which side, and the hold
 * countdown. The countdown is wall-clock based so a paused or backgrounded
 * timer never drifts.
 */
export type StretchProgress =
  | { readonly phase: "overview" }
  | {
      readonly phase: "holding";
      readonly index: number;
      readonly side: 0 | 1;
      /** Set while running; null while paused. */
      readonly endsAt: number | null;
      readonly remainingMs: number;
    }
  | { readonly phase: "done" };

export const startProgress = (
  steps: readonly StretchStep[],
  now: number,
): StretchProgress => holdAt(steps, 0, 0, now);

const holdAt = (
  steps: readonly StretchStep[],
  index: number,
  side: 0 | 1,
  now: number,
): StretchProgress => {
  const step = steps[index];
  if (!step) return { phase: "done" };
  const ms = step.holdSeconds * 1000;
  return { phase: "holding", index, side, endsAt: now + ms, remainingMs: ms };
};

/** The next side of a two-sided stretch, else the next stretch. */
export const advanceProgress = (
  steps: readonly StretchStep[],
  progress: StretchProgress,
  now: number,
): StretchProgress => {
  if (progress.phase !== "holding") return progress;
  const step = steps[progress.index];
  if (step?.bothSides && progress.side === 0) {
    return holdAt(steps, progress.index, 1, now);
  }
  return holdAt(steps, progress.index + 1, 0, now);
};

/** Skips the rest of the current stretch, both sides. */
export const skipStretch = (
  steps: readonly StretchStep[],
  progress: StretchProgress,
  now: number,
): StretchProgress =>
  progress.phase === "holding"
    ? holdAt(steps, progress.index + 1, 0, now)
    : progress;

/** Updates the countdown; advances when the hold has finished. */
export const tickProgress = (
  steps: readonly StretchStep[],
  progress: StretchProgress,
  now: number,
): StretchProgress => {
  if (progress.phase !== "holding" || progress.endsAt === null) return progress;
  const remainingMs = Math.max(0, progress.endsAt - now);
  if (remainingMs === 0) return advanceProgress(steps, progress, now);
  return remainingMs === progress.remainingMs
    ? progress
    : { ...progress, remainingMs };
};

export const togglePause = (
  progress: StretchProgress,
  now: number,
): StretchProgress => {
  if (progress.phase !== "holding") return progress;
  if (progress.endsAt === null) {
    return { ...progress, endsAt: now + progress.remainingMs };
  }
  return {
    ...progress,
    endsAt: null,
    remainingMs: Math.max(0, progress.endsAt - now),
  };
};

export const sideLabel = (step: StretchStep, side: 0 | 1): string | null =>
  step.bothSides ? (side === 0 ? "First side" : "Second side") : null;

export const formatMinutes = (totalSeconds: number): string => {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return `${minutes} min`;
};
