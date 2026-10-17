import {
  bareDurationUnit,
  formatTrackedDuration,
  isTimedTrackingMode,
  metresFromTrackedDistance,
  parseDurationInput,
  resolveExerciseTrackingMode,
  resolveTrackedDistanceUnit,
  trackedDistanceFromMetres,
  type ExerciseTrackingMode,
  type TrackedDistanceUnit,
} from "@mizyun/core";

type UnitSystem = "metric" | "imperial";

const MAX_DISTANCE_METERS = 1_000_000;

const UNIT_NAMES: Readonly<Record<TrackedDistanceUnit, string>> = {
  m: "metres",
  yd: "yards",
  km: "kilometres",
  mi: "miles",
};

/** Spoken unit name for labels and messages. */
export const distanceUnitName = (unit: TrackedDistanceUnit): string =>
  UNIT_NAMES[unit];

interface TrackingEntry {
  readonly id?: string;
  readonly name: string;
  readonly catalogId?: string;
}

interface TrackingExerciseRecord {
  readonly id: string;
  readonly name: string;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

/**
 * Tracking mode for a live entry: the saved exercise's metadata wins, then
 * the entry's catalog id, then an exact catalog name match.
 */
const trackedRecord = (
  entry: TrackingEntry,
  exercises: readonly TrackingExerciseRecord[],
) => {
  const name = entry.name.trim().toLowerCase();
  const record = exercises.find(
    (exercise) =>
      exercise.id === entry.id || exercise.name.trim().toLowerCase() === name,
  );
  return {
    name: entry.name,
    metadata: {
      ...(entry.catalogId ? { catalogId: entry.catalogId } : {}),
      ...(record?.metadata ?? {}),
    },
  };
};

export const entryTrackingMode = (
  entry: TrackingEntry,
  exercises: readonly TrackingExerciseRecord[],
): ExerciseTrackingMode =>
  resolveExerciseTrackingMode(trackedRecord(entry, exercises));

/** m/yd for swimming, rowing and SkiErg; km/mi for other distances. */
export const entryDistanceUnit = (
  entry: TrackingEntry,
  exercises: readonly TrackingExerciseRecord[],
  unitSystem: UnitSystem,
): TrackedDistanceUnit =>
  resolveTrackedDistanceUnit(trackedRecord(entry, exercises), unitSystem);

/** Metres stored on a set, as the number the user sees in `unit`. */
export const metersToDisplayDistance = (
  meters: number,
  unit: TrackedDistanceUnit,
): number => trackedDistanceFromMetres(meters, unit);

export type TimedSetFields =
  | {
      readonly ok: true;
      /** Whole seconds as a numeric string for `addWorkoutSet`. */
      readonly durationSeconds: string;
      /** Metres as a numeric string, or "" when no distance was entered. */
      readonly distanceMeters: string;
    }
  | { readonly ok: false; readonly message: string };

/** Validate and convert the pending time and distance text of a timed set. */
export const buildTimedSetFields = (
  mode: ExerciseTrackingMode,
  input: { readonly durationSeconds: string; readonly distanceMeters: string },
  unit: TrackedDistanceUnit,
): TimedSetFields => {
  const seconds = parseDurationInput(
    input.durationSeconds,
    bareDurationUnit(mode),
  );
  if (seconds === null)
    return { ok: false, message: "Enter a time, for example 10:00." };
  if (seconds === "invalid")
    return {
      ok: false,
      message: `Enter the time as mm:ss, h:mm:ss or whole ${bareDurationUnit(mode)}, up to 24 hours.`,
    };
  let distanceMeters = "";
  const rawDistance = input.distanceMeters.trim();
  if (mode === "duration_distance" && rawDistance.length > 0) {
    const normalized = rawDistance.replace(",", ".");
    // Plain decimals only, matching Log activity: no exponents or signs.
    const value = /^\d+(\.\d+)?$/.test(normalized)
      ? Number(normalized)
      : Number.NaN;
    const meters = Number.isFinite(value)
      ? metresFromTrackedDistance(value, unit)
      : Number.NaN;
    if (!Number.isFinite(meters) || meters <= 0 || meters > MAX_DISTANCE_METERS)
      return {
        ok: false,
        message: `Enter the distance as a number of ${UNIT_NAMES[unit]}.`,
      };
    distanceMeters = String(meters);
  }
  return { ok: true, durationSeconds: String(seconds), distanceMeters };
};

/** "10:00 · 400 m" for a saved timed set. */
export const formatTimedSet = (
  set: {
    readonly durationSeconds: number | null;
    readonly distanceMeters: number | null;
    readonly repetitions?: number | null;
  },
  unit: TrackedDistanceUnit,
): string => {
  const parts: string[] = [];
  if (set.durationSeconds !== null)
    parts.push(formatTrackedDuration(set.durationSeconds));
  if (set.distanceMeters !== null)
    parts.push(`${metersToDisplayDistance(set.distanceMeters, unit)} ${unit}`);
  if (parts.length > 0) return parts.join(" · ");
  // Sets logged before #278 may hold seconds or counts in reps; show them as stored.
  return set.repetitions != null ? `${set.repetitions} reps` : "—";
};

export { isTimedTrackingMode };
