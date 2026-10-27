/**
 * History import (#333, ADR-0083): turn a parsed file plus the user's
 * exercise choices into the records the import writes. Pure: the API resolves
 * each exercise spec to a saved exercise id and writes the plan in chunks.
 */
import {
  historyImportKey,
  type HistoryImportFormat,
  type ImportedRun,
  type ImportedSet,
  type ParsedHistory,
} from "./history-import";
import { summarizeHistoryExercises } from "./history-import-match";
import { normalizeCustomExerciseName } from "./custom-exercise";
import { getExerciseFromCatalog } from "./exercise-catalog";
import {
  findCatalogExerciseByExactName,
  getCatalogTrackingMode,
  type ExerciseTrackingMode,
} from "./exercise-tracking";
import { runningDate } from "./running";

export type HistoryExerciseTarget =
  | { readonly kind: "catalog"; readonly catalogId: string }
  | { readonly kind: "custom"; readonly name: string }
  | { readonly kind: "skip" };

export interface HistoryExerciseMapping {
  readonly sourceName: string;
  readonly target: HistoryExerciseTarget;
}

/** One saved exercise the import needs; several source names may share it. */
export interface HistoryExerciseSpec {
  readonly key: string;
  readonly kind: "catalog" | "custom";
  readonly catalogId?: string;
  readonly name: string;
  readonly trackingMode: ExerciseTrackingMode;
}

export interface PlannedHistorySet extends ImportedSet {
  readonly exerciseKey: string;
}

export interface PlannedHistoryWorkout {
  /** Full import key, `<format>:<externalId>`. */
  readonly key: string;
  readonly name: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly notes: string | null;
  readonly sets: readonly PlannedHistorySet[];
}

export interface PlannedHistoryRun extends ImportedRun {
  readonly key: string;
}

export interface HistoryImportPlan {
  readonly format: HistoryImportFormat;
  readonly exercises: readonly HistoryExerciseSpec[];
  readonly workouts: readonly PlannedHistoryWorkout[];
  readonly runs: readonly PlannedHistoryRun[];
  /** Sets left out because their exercise was skipped. */
  readonly skippedSets: number;
}

export type HistoryImportPlanError =
  | { readonly kind: "missing_mapping"; readonly sourceName: string }
  | { readonly kind: "unknown_exercise"; readonly sourceName: string }
  | { readonly kind: "unknown_catalog"; readonly sourceName: string }
  | { readonly kind: "invalid_custom_name"; readonly sourceName: string }
  | { readonly kind: "custom_name_is_catalog"; readonly sourceName: string };

export type HistoryImportPlanResult =
  | { readonly ok: true; readonly plan: HistoryImportPlan }
  | { readonly ok: false; readonly error: HistoryImportPlanError };

/** Records per chunk write; the SQL RPC accepts at most 200. */
export const HISTORY_IMPORT_CHUNK_SIZE = 200;
/**
 * Sets per chunk write (the RPC accepts at most 5,000). Each chunk is one
 * statement under the 8 s `authenticated` timeout; 2,500 sets stay well
 * below it (about 0.25 s measured locally).
 */
export const HISTORY_IMPORT_CHUNK_SETS = 2_500;

const sourceKey = (name: string): string => name.toLowerCase();

const mergeModes = (
  a: ExerciseTrackingMode,
  b: ExerciseTrackingMode,
): ExerciseTrackingMode =>
  a === "load_reps" || b === "load_reps"
    ? "load_reps"
    : a === "duration_distance" || b === "duration_distance"
      ? "duration_distance"
      : "duration";

/**
 * Apply one mapping per distinct source exercise. Every exercise in the file
 * needs exactly one mapping; unknown names, unknown catalog ids and custom
 * names that equal a catalog name are refused so the user picks the catalog
 * entry (ADR-0075).
 */
export const buildHistoryImportPlan = (
  parsed: ParsedHistory,
  mappings: readonly HistoryExerciseMapping[],
): HistoryImportPlanResult => {
  const summaries = new Map(
    summarizeHistoryExercises(parsed).map((summary) => [
      sourceKey(summary.sourceName),
      summary,
    ]),
  );
  const chosen = new Map<string, HistoryExerciseMapping>();
  for (const mapping of mappings) {
    const key = sourceKey(mapping.sourceName);
    if (!summaries.has(key) || chosen.has(key))
      return {
        ok: false,
        error: { kind: "unknown_exercise", sourceName: mapping.sourceName },
      };
    chosen.set(key, mapping);
  }

  const specs = new Map<string, HistoryExerciseSpec>();
  const specKeyBySource = new Map<string, string | null>();
  for (const [key, summary] of summaries) {
    const mapping = chosen.get(key);
    if (!mapping)
      return {
        ok: false,
        error: { kind: "missing_mapping", sourceName: summary.sourceName },
      };
    const target = mapping.target;
    if (target.kind === "skip") {
      specKeyBySource.set(key, null);
      continue;
    }
    let spec: HistoryExerciseSpec;
    if (target.kind === "catalog") {
      const catalog = getExerciseFromCatalog(target.catalogId);
      if (!catalog || catalog.id !== target.catalogId)
        return {
          ok: false,
          error: { kind: "unknown_catalog", sourceName: summary.sourceName },
        };
      spec = {
        key: `catalog:${catalog.id}`,
        kind: "catalog",
        catalogId: catalog.id,
        name: catalog.name,
        trackingMode: getCatalogTrackingMode(catalog),
      };
    } else {
      const name = normalizeCustomExerciseName(target.name);
      if (name.length < 1 || name.length > 120)
        return {
          ok: false,
          error: {
            kind: "invalid_custom_name",
            sourceName: summary.sourceName,
          },
        };
      if (findCatalogExerciseByExactName(name))
        return {
          ok: false,
          error: {
            kind: "custom_name_is_catalog",
            sourceName: summary.sourceName,
          },
        };
      spec = {
        key: `custom:${name.toLowerCase()}`,
        kind: "custom",
        name,
        trackingMode: summary.trackingMode,
      };
    }
    const existing = specs.get(spec.key);
    specs.set(
      spec.key,
      existing && spec.kind === "custom"
        ? {
            ...existing,
            trackingMode: mergeModes(existing.trackingMode, spec.trackingMode),
          }
        : (existing ?? spec),
    );
    specKeyBySource.set(key, spec.key);
  }

  let skippedSets = 0;
  const workouts: PlannedHistoryWorkout[] = [];
  for (const workout of parsed.workouts) {
    const sets: PlannedHistorySet[] = [];
    for (const exercise of workout.exercises) {
      const exerciseKey = specKeyBySource.get(sourceKey(exercise.sourceName));
      if (!exerciseKey) {
        skippedSets += exercise.sets.length;
        continue;
      }
      for (const set of exercise.sets) sets.push({ ...set, exerciseKey });
    }
    if (sets.length === 0) continue;
    workouts.push({
      key: historyImportKey(parsed.format, workout.externalId),
      name: workout.name,
      startedAt: workout.startedAt,
      completedAt: workout.completedAt,
      notes: workout.notes,
      sets,
    });
  }
  const runs = parsed.runs.map((run) => ({
    ...run,
    key: historyImportKey(parsed.format, run.externalId),
  }));
  return {
    ok: true,
    plan: {
      format: parsed.format,
      exercises: [...specs.values()],
      workouts,
      runs,
      skippedSets,
    },
  };
};

/** Records the preview checks for existing copies and overlaps. */
export interface HistoryImportCheckItem {
  readonly key: string;
  readonly kind: "workout" | "run";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly activityDate?: string;
}

export const historyImportCheckItems = (
  parsed: ParsedHistory,
  timezone: string,
): HistoryImportCheckItem[] => [
  ...parsed.workouts.map((workout): HistoryImportCheckItem => ({
    key: historyImportKey(parsed.format, workout.externalId),
    kind: "workout",
    startedAt: workout.startedAt,
    completedAt: workout.completedAt,
  })),
  ...parsed.runs.map((run): HistoryImportCheckItem => ({
    key: historyImportKey(parsed.format, run.externalId),
    kind: "run",
    startedAt: run.startedAt,
    completedAt: new Date(
      Date.parse(run.startedAt) + run.durationSeconds * 1000,
    ).toISOString(),
    activityDate: runningDate(new Date(run.startedAt), timezone),
  })),
];

/**
 * Split a plan into ordered chunks of at most `size` records and, for
 * workouts, at most `maxSets` sets (a workout has at most 500).
 */
export const chunkHistoryImportPlan = (
  plan: HistoryImportPlan,
  size = HISTORY_IMPORT_CHUNK_SIZE,
  maxSets = HISTORY_IMPORT_CHUNK_SETS,
): {
  readonly workouts: readonly PlannedHistoryWorkout[];
  readonly runs: readonly PlannedHistoryRun[];
}[] => {
  const chunks: {
    workouts: readonly PlannedHistoryWorkout[];
    runs: readonly PlannedHistoryRun[];
  }[] = [];
  let current: PlannedHistoryWorkout[] = [];
  let sets = 0;
  for (const workout of plan.workouts) {
    if (
      current.length > 0 &&
      (current.length >= size || sets + workout.sets.length > maxSets)
    ) {
      chunks.push({ workouts: current, runs: [] });
      current = [];
      sets = 0;
    }
    current.push(workout);
    sets += workout.sets.length;
  }
  if (current.length > 0) chunks.push({ workouts: current, runs: [] });
  for (let i = 0; i < plan.runs.length; i += size)
    chunks.push({ workouts: [], runs: plan.runs.slice(i, i + size) });
  return chunks;
};
