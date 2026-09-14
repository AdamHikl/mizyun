/**
 * Lightweight discriminator stored inside a workout's open `details` object.
 *
 * The current persistence model stores reusable routines and performed workout
 * sessions in the same table. This marker keeps their lifecycles distinct:
 * routines are stable templates, while sessions are disposable executions that
 * may point back to the routine they were copied from.
 */
export type WorkoutLifecycle =
  | { readonly kind: "routine" }
  | { readonly kind: "session"; readonly routineId?: string };

export const WORKOUT_LIFECYCLE_KEY = "workoutLifecycle";

export const readWorkoutLifecycle = (
  details: Readonly<Record<string, unknown>> | null | undefined,
): WorkoutLifecycle | null => {
  if (!details || typeof details !== "object") return null;
  const raw = details[WORKOUT_LIFECYCLE_KEY];
  if (!raw || typeof raw !== "object") return null;

  const lifecycle = raw as Record<string, unknown>;
  if (lifecycle.kind === "routine") return { kind: "routine" };
  if (lifecycle.kind !== "session") return null;

  return typeof lifecycle.routineId === "string" &&
    lifecycle.routineId.trim().length > 0
    ? { kind: "session", routineId: lifecycle.routineId }
    : { kind: "session" };
};

export const withWorkoutLifecycle = (
  details: Readonly<Record<string, unknown>> | null | undefined,
  lifecycle: WorkoutLifecycle,
): Record<string, unknown> => ({
  ...(details ?? {}),
  [WORKOUT_LIFECYCLE_KEY]: lifecycle,
});

export const isRoutineDetails = (
  details: Readonly<Record<string, unknown>> | null | undefined,
): boolean => readWorkoutLifecycle(details)?.kind === "routine";

export const isSessionDetails = (
  details: Readonly<Record<string, unknown>> | null | undefined,
): boolean => readWorkoutLifecycle(details)?.kind === "session";
