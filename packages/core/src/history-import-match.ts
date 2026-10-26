/**
 * History import (#333): map exercise names from an exported file onto the
 * Mizyun catalog. Deterministic and pure. Steps 1-5 are "exact" matches the
 * import may apply automatically; step 6 is only a suggestion.
 */
import type { ParsedHistory } from "./history-import";
import {
  EXERCISE_CATALOG,
  findCatalogExerciseByAlias,
  getCatalogExerciseNames,
  getExerciseFromCatalog,
  searchExerciseCatalog,
  type CatalogExercise,
} from "./exercise-catalog";
import {
  findCatalogExerciseByExactName,
  getCatalogTrackingMode,
  type ExerciseTrackingMode,
} from "./exercise-tracking";

export interface HistoryExerciseMatch {
  readonly catalogId: string;
  readonly name: string;
  readonly confidence: "exact" | "suggested";
}

export interface HistoryExerciseSummary {
  readonly sourceName: string;
  readonly setCount: number;
  readonly workoutCount: number;
  readonly trackingMode: ExerciseTrackingMode;
  readonly match: HistoryExerciseMatch | null;
}

/**
 * Common Hevy and Strong names whose catalog name differs. Keys are display
 * names (compared loosely); values are catalog ids. Only clear equivalents.
 */
export const HISTORY_EXERCISE_ALIASES: Readonly<Record<string, string>> = {
  "Squat (Barbell)": "barbell-squat",
  "Deadlift (Barbell)": "barbell-deadlift",
  "Overhead Press (Barbell)": "exercise-ohp",
  "Pull Up": "pull-up",
  "Chin Up": "exercise-chin-ups",
  "Lat Pulldown (Cable)": "exercise-lat-pulldown",
  "Bicep Curl (Dumbbell)": "dumbbell-bicep-curl",
  "Triceps Pushdown (Cable - Straight Bar)": "exercise-tricep-pushdown",
  Running: "exercise-running",
  Treadmill: "exercise-treadmill-running",
  Plank: "front-plank",
  "Leg Press": "leg-press",
  "Leg Press (Machine)": "leg-press",
  "Romanian Deadlift (Barbell)": "barbell-rdl",
  "Hip Thrust (Barbell)": "barbell-hip-thrust",
  "Seated Cable Row - V Grip (Cable)": "seated-cable-row",
  "Incline Bench Press (Dumbbell)": "incline-dumbbell-press",
  "Bent Over Row (Barbell)": "bent-over-barbell-row",
};

const looseKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const aliasIndex: ReadonlyMap<string, string> = new Map(
  Object.entries(HISTORY_EXERCISE_ALIASES).map(([name, id]) => [
    looseKey(name),
    id,
  ]),
);

/** Lower-case tokens, trailing "s" dropped from tokens over 3 chars, sorted. */
const tokenKey = (value: string): string =>
  looseKey(value)
    .split(" ")
    .filter((token) => token !== "")
    .map((token) =>
      token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token,
    )
    .sort()
    .join(" ");

let tokenIndex: ReadonlyMap<string, readonly CatalogExercise[]> | null = null;
const catalogByTokenKey = (): ReadonlyMap<
  string,
  readonly CatalogExercise[]
> => {
  if (tokenIndex) return tokenIndex;
  const index = new Map<string, CatalogExercise[]>();
  for (const exercise of EXERCISE_CATALOG) {
    for (const name of getCatalogExerciseNames(exercise)) {
      const key = tokenKey(name);
      if (key === "") continue;
      const list = index.get(key) ?? [];
      if (!list.some((entry) => entry.id === exercise.id)) list.push(exercise);
      index.set(key, list);
    }
  }
  tokenIndex = index;
  return index;
};

const BODYWEIGHT_EQUIPMENT = new Set(["bodyweight", "body weight", "none"]);

/** "Bench Press (Barbell)" -> ["Barbell Bench Press", ...]; the name itself last. */
const candidateNames = (sourceName: string): readonly string[] => {
  const name = sourceName.replace(/\s+/g, " ").trim();
  const candidates: string[] = [name];
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(name);
  if (match) {
    const base = (match[1] ?? "").trim();
    const inner = (match[2] ?? "").trim();
    const equipment = inner.split(/\s+-\s+/)[0]?.trim() ?? inner;
    if (base !== "") {
      if (BODYWEIGHT_EQUIPMENT.has(equipment.toLowerCase())) {
        candidates.unshift(base);
      } else {
        candidates.unshift(`${equipment} ${base}`);
        if (equipment !== inner) candidates.splice(1, 0, `${inner} ${base}`);
      }
    }
  }
  return [...new Set(candidates)];
};

const toMatch = (
  exercise: CatalogExercise,
  confidence: "exact" | "suggested",
): HistoryExerciseMatch => ({
  catalogId: exercise.id,
  name: exercise.name,
  confidence,
});

export const matchHistoryExercise = (
  sourceName: string,
): HistoryExerciseMatch | null => {
  const name = sourceName.replace(/\s+/g, " ").trim();
  if (name === "") return null;
  const candidates = candidateNames(name);
  const reordered = candidates.filter((candidate) => candidate !== name);

  const direct = findCatalogExerciseByExactName(name);
  if (direct) return toMatch(direct, "exact");

  for (const candidate of reordered) {
    const found = findCatalogExerciseByExactName(candidate);
    if (found) return toMatch(found, "exact");
  }

  for (const candidate of candidates) {
    const found = findCatalogExerciseByAlias(candidate);
    if (found) return toMatch(found, "exact");
  }

  for (const candidate of candidates) {
    const found = catalogByTokenKey().get(tokenKey(candidate));
    if (found && found.length === 1)
      return toMatch(found[0] as CatalogExercise, "exact");
  }

  const aliasId = aliasIndex.get(looseKey(name));
  const aliased =
    aliasId === undefined ? null : getExerciseFromCatalog(aliasId);
  if (aliased) return toMatch(aliased, "exact");

  const query = reordered[0] ?? name;
  const suggestion = searchExerciseCatalog({ query, limit: 1 })[0];
  return suggestion ? toMatch(suggestion, "suggested") : null;
};

const inferTrackingMode = (
  sets: readonly {
    readonly repetitions: number | null;
    readonly loadKg: number | null;
    readonly distanceMeters: number | null;
  }[],
): ExerciseTrackingMode => {
  if (sets.some((set) => set.repetitions !== null || set.loadKg !== null)) {
    return "load_reps";
  }
  if (sets.some((set) => set.distanceMeters !== null)) {
    return "duration_distance";
  }
  return "duration";
};

/** One row per distinct source exercise, most-used first. */
export const summarizeHistoryExercises = (
  parsed: ParsedHistory,
): HistoryExerciseSummary[] => {
  interface Accumulator {
    sourceName: string;
    setCount: number;
    workouts: Set<number>;
    sets: {
      repetitions: number | null;
      loadKg: number | null;
      distanceMeters: number | null;
    }[];
  }
  const byName = new Map<string, Accumulator>();
  parsed.workouts.forEach((workout, workoutIndex) => {
    for (const exercise of workout.exercises) {
      const key = exercise.sourceName.toLowerCase();
      let accumulator = byName.get(key);
      if (!accumulator) {
        accumulator = {
          sourceName: exercise.sourceName,
          setCount: 0,
          workouts: new Set(),
          sets: [],
        };
        byName.set(key, accumulator);
      }
      accumulator.setCount += exercise.sets.length;
      accumulator.workouts.add(workoutIndex);
      accumulator.sets.push(...exercise.sets);
    }
  });

  return [...byName.values()]
    .map((accumulator): HistoryExerciseSummary => {
      const match = matchHistoryExercise(accumulator.sourceName);
      const catalog =
        match && match.confidence === "exact"
          ? getExerciseFromCatalog(match.catalogId)
          : null;
      return {
        sourceName: accumulator.sourceName,
        setCount: accumulator.setCount,
        workoutCount: accumulator.workouts.size,
        trackingMode: catalog
          ? getCatalogTrackingMode(catalog)
          : inferTrackingMode(accumulator.sets),
        match,
      };
    })
    .sort(
      (a, b) =>
        b.setCount - a.setCount ||
        (a.sourceName < b.sourceName
          ? -1
          : a.sourceName > b.sourceName
            ? 1
            : 0),
    );
};
