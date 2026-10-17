/**
 * How a set of an exercise is measured (#278).
 *
 * - `load_reps`: weight and repetitions (the default for strength work).
 * - `duration`: time only, e.g. planks, holds, jump rope.
 * - `duration_distance`: time plus optional distance, e.g. swimming.
 *
 * Sets already store `durationSeconds` and `distanceMeters`; the mode only
 * decides which inputs the app shows. It is derived from the catalog entry,
 * or read from a saved exercise's `metadata.trackingMode` when present.
 */
import {
  EXERCISE_CATALOG,
  getCatalogExerciseNames,
  getExerciseFromCatalog,
  type CatalogExercise,
} from "./exercise-catalog";

export const EXERCISE_TRACKING_MODES = [
  "load_reps",
  "duration",
  "duration_distance",
] as const;
export type ExerciseTrackingMode = (typeof EXERCISE_TRACKING_MODES)[number];

/** Aerobic entries where a distance is meaningful. */
const DURATION_DISTANCE_IDS: ReadonlySet<string> = new Set([
  "exercise-swimming",
  "exercise-outdoor-cycling",
  "exercise-hiking",
  "exercise-walking",
  "exercise-running",
  "exercise-treadmill-running",
  "exercise-incline-treadmill-walk",
  "exercise-rowing-machine",
  "exercise-ski-erg",
  "exercise-elliptical-trainer",
  "exercise-air-bike",
  "stationary-bike",
]);

/** Continuous or held work measured by time. Rep-based moves stay `load_reps`. */
const DURATION_IDS: ReadonlySet<string> = new Set([
  "exercise-stair-climber",
  "exercise-jump-rope",
  "exercise-battle-ropes",
  "front-plank",
  "exercise-high-plank",
  "exercise-side-plank",
  "exercise-reverse-plank",
  "exercise-trx-plank",
  "exercise-trx-side-plank",
  "exercise-side-plank-leg-lift-hold",
  "exercise-hollow-body-hold",
  "exercise-bird-dog-hold",
  "exercise-dead-bug-hold",
  "exercise-chin-tuck-hold",
  "exercise-clamshells-hold",
  "exercise-glute-bridge-hold",
  "exercise-single-leg-glute-bridge-hold",
  "exercise-glute-kickback-hold",
  "exercise-reverse-tabletop-hold",
  "exercise-side-lying-hip-abduction-hold",
  "exercise-side-lying-hip-adduction-hold",
  "exercise-dead-hang",
  "exercise-ring-dead-hang",
  "exercise-wall-sit",
]);

export const isExerciseTrackingMode = (
  value: unknown,
): value is ExerciseTrackingMode =>
  (EXERCISE_TRACKING_MODES as readonly unknown[]).includes(value);

export const getCatalogTrackingMode = (
  exercise: Pick<CatalogExercise, "id">,
): ExerciseTrackingMode =>
  DURATION_DISTANCE_IDS.has(exercise.id)
    ? "duration_distance"
    : DURATION_IDS.has(exercise.id)
      ? "duration"
      : "load_reps";

const normalizeName = (name: string): string => name.trim().toLowerCase();

interface TrackedExerciseRecord {
  readonly name: string;
  readonly metadata?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * The catalog entry behind a saved exercise record: `metadata.catalogId`
 * first, then an exact (case-insensitive) catalog name or previous name.
 * Fuzzy search hits do not count.
 */
const resolveTrackedCatalogExercise = (
  exercise: TrackedExerciseRecord,
): CatalogExercise | null => {
  const metadata = exercise.metadata ?? {};
  if (typeof metadata.catalogId === "string") {
    const byId = getExerciseFromCatalog(metadata.catalogId);
    if (byId) return byId;
  }
  const name = normalizeName(exercise.name);
  return name ? (catalogByExactName().get(name) ?? null) : null;
};

let exactNameIndex: ReadonlyMap<string, CatalogExercise> | null = null;

/**
 * Exact current and previous catalog names, built once from the names
 * alone (no search): the catalog is static and cards resolve their mode on
 * every render. No two entries share an exact name; if one ever did, the
 * first catalog entry would win.
 */
const catalogByExactName = (): ReadonlyMap<string, CatalogExercise> => {
  if (exactNameIndex) return exactNameIndex;
  const index = new Map<string, CatalogExercise>();
  for (const exercise of EXERCISE_CATALOG) {
    for (const raw of getCatalogExerciseNames(exercise)) {
      const name = normalizeName(raw);
      if (!index.has(name)) index.set(name, exercise);
    }
  }
  exactNameIndex = index;
  return index;
};

/** The catalog exercise with exactly this current or previous name. */
export const findCatalogExerciseByExactName = (
  name: string,
): CatalogExercise | null =>
  catalogByExactName().get(normalizeName(name)) ?? null;

/**
 * Resolve the mode for a saved exercise record. An explicit valid
 * `metadata.trackingMode` wins, then the catalog entry (see above).
 * Anything else is `load_reps`, so unknown custom exercises keep today's
 * behaviour.
 */
export const resolveExerciseTrackingMode = (
  exercise: TrackedExerciseRecord,
): ExerciseTrackingMode => {
  const metadata = exercise.metadata ?? {};
  if (isExerciseTrackingMode(metadata.trackingMode)) {
    return metadata.trackingMode;
  }
  const catalog = resolveTrackedCatalogExercise(exercise);
  return catalog ? getCatalogTrackingMode(catalog) : "load_reps";
};

/** Activities measured in pool or machine-display units (m / yd). */
const SHORT_DISTANCE_IDS: ReadonlySet<string> = new Set([
  "exercise-swimming",
  "exercise-rowing-machine",
  "exercise-ski-erg",
]);

export type TrackedDistanceUnit = "m" | "yd" | "km" | "mi";

/**
 * Display unit for an exercise's distance. Swimming, rowing and SkiErg use
 * m (metric) or yd (imperial); everything else uses km or mi. Storage is
 * always metres.
 */
export const resolveTrackedDistanceUnit = (
  exercise: TrackedExerciseRecord,
  unitSystem: "metric" | "imperial",
): TrackedDistanceUnit => {
  const catalog = resolveTrackedCatalogExercise(exercise);
  const short = catalog !== null && SHORT_DISTANCE_IDS.has(catalog.id);
  if (unitSystem === "imperial") return short ? "yd" : "mi";
  return short ? "m" : "km";
};

const METRES_PER_UNIT: Readonly<Record<TrackedDistanceUnit, number>> = {
  m: 1,
  yd: 0.9144,
  km: 1000,
  mi: 1609.344,
};

/** Metres for a displayed distance, rounded to the set contract's 0.01 m. */
export const metresFromTrackedDistance = (
  value: number,
  unit: TrackedDistanceUnit,
): number => Math.round(value * METRES_PER_UNIT[unit] * 100) / 100;

/** Displayed distance for stored metres: whole m/yd, two decimals km/mi. */
export const trackedDistanceFromMetres = (
  metres: number,
  unit: TrackedDistanceUnit,
): number => {
  const places = unit === "m" || unit === "yd" ? 0 : 2;
  const factor = 10 ** places;
  return Math.round((metres / METRES_PER_UNIT[unit]) * factor) / factor;
};

export const isTimedTrackingMode = (mode: ExerciseTrackingMode): boolean =>
  mode !== "load_reps";

/** Holds are short, so a bare number is seconds; activities use minutes. */
export const bareDurationUnit = (
  mode: ExerciseTrackingMode,
): "minutes" | "seconds" => (mode === "duration" ? "seconds" : "minutes");

/** Catalog activities offered by Log activity; running saves as a run. */
export const TIMED_ACTIVITY_IDS = [
  "exercise-swimming",
  "exercise-outdoor-cycling",
  "stationary-bike",
  "exercise-walking",
  "exercise-hiking",
  "exercise-rowing-machine",
  "exercise-elliptical-trainer",
  "exercise-stair-climber",
  "exercise-ski-erg",
  "exercise-jump-rope",
] as const;

export const listTimedActivities = (): readonly CatalogExercise[] =>
  TIMED_ACTIVITY_IDS.flatMap((id) => {
    const exercise = getExerciseFromCatalog(id);
    return exercise ? [exercise] : [];
  });

/** Upper bound of a set duration, mirroring the `workout_sets` contract. */
export const MAX_TRACKED_DURATION_SECONDS = 86_400;

/**
 * Parse a duration typed as `mm:ss`, `h:mm:ss` or a bare number. A bare
 * number means minutes by default (`45` → a 45-minute swim); pass
 * `"seconds"` for holds, where `45` means a 45-second plank. Returns `null`
 * for empty input and `"invalid"` for anything else that is not a positive
 * duration within one day.
 */
export const parseDurationInput = (
  raw: string,
  bareNumber: "minutes" | "seconds" = "minutes",
): number | null | "invalid" => {
  const text = raw.trim();
  if (text.length === 0) return null;
  const parts = text.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d{1,4}$/.test(part))) {
    return "invalid";
  }
  const numbers = parts.map(Number);
  let seconds: number;
  if (numbers.length === 1) {
    seconds = (numbers[0] ?? 0) * (bareNumber === "seconds" ? 1 : 60);
  } else {
    const [lead = 0, ...rest] = numbers;
    if (rest.some((value) => value > 59)) return "invalid";
    seconds =
      numbers.length === 2
        ? lead * 60 + (rest[0] ?? 0)
        : lead * 3600 + (rest[0] ?? 0) * 60 + (rest[1] ?? 0);
  }
  return seconds > 0 && seconds <= MAX_TRACKED_DURATION_SECONDS
    ? seconds
    : "invalid";
};

/** `m:ss` under an hour, `h:mm:ss` from one hour. */
export const formatTrackedDuration = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}`
    : `${minutes}:${ss}`;
};
