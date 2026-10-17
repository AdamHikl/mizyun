import type { EquipmentOption, TrainingLimitation } from "./profile";
import {
  REPDB_EXERCISE_CATALOG,
  LEGACY_EXERCISE_ALIASES,
} from "./exercise-catalog-data";
import { LEGACY_EXERCISE_CATALOG } from "./exercise-catalog-legacy";
import { SUPPLEMENTAL_EXERCISE_CATALOG } from "./exercise-catalog-supplement";

/** Future assets must describe this exact variant and have independently accepted rights/form. */
export interface ExerciseDemonstration {
  readonly variantId: string;
  readonly assets: readonly {
    readonly id: string;
    readonly kind: "video" | "animation" | "image";
    readonly uri: string;
    readonly provider: string;
    readonly licenseUrl: string;
    readonly attribution: string;
    readonly reviewStatus: "pending" | "accepted";
  }[];
}

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

export interface CatalogExercise {
  readonly id: string;
  readonly name: string;
  readonly movementPattern: MovementPattern;
  readonly equipment: readonly EquipmentOption[];
  readonly blockedBy: readonly TrainingLimitation[];
  readonly focusFit: readonly (
    "balanced" | "strength" | "hypertrophy" | "endurance"
  )[];
  readonly primaryMuscles: readonly string[];
  readonly secondaryMuscles: readonly string[];
  readonly instructions: readonly string[];
  readonly category: string;
  readonly level: "beginner" | "intermediate" | "expert";
  readonly mechanic: "compound" | "isolation" | null;
  readonly description?: string;
  readonly aliases?: readonly string[];
  readonly tips?: readonly string[];
  readonly commonMistakes?: readonly string[];
  readonly requiredEquipment?: readonly string[];
  readonly source?: {
    readonly provider: "repdb";
    readonly exerciseId: string;
    readonly version: string;
    readonly licenseUrl: string;
  };
  readonly contentReview?: {
    readonly status: "pending_professional" | "accepted";
    readonly reviewedAt: string | null;
  };
  readonly demonstration?: ExerciseDemonstration | null;
}

/**
 * RepDB import plus Mizyun-authored activities it lacks (#278). Each
 * supplement is placed before the first imported name that sorts after it,
 * so browsing stays alphabetical without reordering the import.
 */
export const EXERCISE_CATALOG: readonly CatalogExercise[] =
  SUPPLEMENTAL_EXERCISE_CATALOG.reduce<readonly CatalogExercise[]>(
    (catalog, extra) => {
      const index = catalog.findIndex(
        (ex) => ex.name.localeCompare(extra.name) > 0,
      );
      return index === -1
        ? [...catalog, extra]
        : [...catalog.slice(0, index), extra, ...catalog.slice(index)];
    },
    REPDB_EXERCISE_CATALOG,
  );

const catalogById = new Map<string, CatalogExercise>(
  EXERCISE_CATALOG.map((ex) => [ex.id, ex]),
);
const legacyById = new Map(LEGACY_EXERCISE_CATALOG.map((ex) => [ex.id, ex]));

/** Keep automatic prescriptions on deliberate equivalent variants in their original order. */
export const TRAINING_EXERCISE_CATALOG: readonly CatalogExercise[] =
  LEGACY_EXERCISE_CATALOG.flatMap((exercise) => {
    const active = catalogById.get(exercise.id);
    return active ? [active] : [];
  });

/** Exact previous labels only; never infer equivalent equipment from similar words. */
export const getCatalogExerciseNames = (
  exercise: CatalogExercise,
): readonly string[] => [
  ...new Set(
    [
      exercise.name,
      legacyById.get(exercise.id)?.name,
      ...Object.entries(LEGACY_EXERCISE_ALIASES)
        .filter(([, activeId]) => activeId === exercise.id)
        .map(([oldId]) => legacyById.get(oldId)?.name),
    ].filter((name): name is string => name !== undefined),
  ),
];

export const getExerciseFromCatalog = (id: string): CatalogExercise | null => {
  const normalized = id.toLowerCase().trim();
  // Archived IDs resolve to their original variants rather than a fuzzy replacement.
  return catalogById.get(normalized) ?? legacyById.get(normalized) ?? null;
};

export interface ExerciseSearchOptions {
  readonly query?: string | undefined;
  readonly movementPattern?: MovementPattern | undefined;
  readonly equipment?: readonly EquipmentOption[] | undefined;
  readonly category?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

const normalizeSearch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const activeAlias = (id: string): CatalogExercise | undefined =>
  catalogById.get(LEGACY_EXERCISE_ALIASES[id] ?? id);

const searchNames = (ex: CatalogExercise): readonly string[] => [
  normalizeSearch(ex.name),
  ...getCatalogExerciseNames(ex).slice(1).map(normalizeSearch),
  ...(ex.aliases ?? []).map(normalizeSearch),
  ...Object.entries(COMMON_EXERCISE_ALIASES)
    .filter(([, id]) => activeAlias(id)?.id === ex.id)
    .map(([alias]) => normalizeSearch(alias)),
];

export const searchExerciseCatalog = (
  options?: ExerciseSearchOptions,
): readonly CatalogExercise[] => {
  const query = normalizeSearch(options?.query ?? "");
  const limit = Math.max(0, options?.limit ?? 50);
  const offset = Math.max(0, options?.offset ?? 0);
  let results = EXERCISE_CATALOG;

  if (options?.movementPattern !== undefined) {
    results = results.filter(
      (ex) => ex.movementPattern === options.movementPattern,
    );
  }

  if (options?.category !== undefined) {
    results = results.filter(
      (ex) => ex.category.toLowerCase() === options.category!.toLowerCase(),
    );
  }

  if (options?.equipment !== undefined && options.equipment.length > 0) {
    const eqSet = new Set(options.equipment);
    results = results.filter(
      (ex) =>
        ex.equipment.length === 0 ||
        ex.equipment.every((eq) => eqSet.has(eq) || eqSet.has("full_gym")),
    );
  }

  if (query && query.length > 0) {
    const tokens = query.split(/\s+/);
    results = results.filter((ex) => {
      const fullText = normalizeSearch(
        [
          ...searchNames(ex),
          ...ex.primaryMuscles,
          ...ex.secondaryMuscles,
          ...ex.equipment,
          ...(ex.requiredEquipment ?? []),
        ].join(" "),
      );
      return tokens.every((token) => fullText.includes(token));
    });
    const rank = (ex: CatalogExercise): number => {
      const names = searchNames(ex);
      if (names[0] === query) return 0;
      if (names.includes(query)) return 1;
      if (names.some((name) => name.startsWith(query))) return 2;
      if (names.some((name) => tokens.every((token) => name.includes(token))))
        return 3;
      return 4;
    };
    results = [...results].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  }

  return results.slice(offset, offset + limit);
};

const COMMON_EXERCISE_ALIASES: Readonly<Record<string, string>> = {
  rdl: "romanian-deadlift",
  "romanian deadlift": "romanian-deadlift",
  "db bench": "dumbbell-bench-press",
  "dumbbell bench": "dumbbell-bench-press",
  "incline db press": "incline-dumbbell-press",
  "incline dumbbell bench press": "incline-dumbbell-press",
  "db incline press": "incline-dumbbell-press",
  "db row": "exercise-single-arm-db-row",
  "dumbbell row": "exercise-single-arm-db-row",
  "one arm dumbbell row": "exercise-single-arm-db-row",
  ohp: "exercise-ohp",
  "overhead press": "exercise-ohp",
  "military press": "exercise-ohp",
  "lat raise": "exercise-lateral-raise",
  "lateral raise": "exercise-lateral-raise",
  "lateral raises": "exercise-lateral-raise",
  "side lateral raise": "exercise-lateral-raise",
  "side lateral raises": "exercise-lateral-raise",
  "cable lateral raise": "exercise-cable-lateral-raise",
  "cable lateral raises": "exercise-cable-lateral-raise",
  "cable fly": "exercise-cable-fly",
  "cable flyes": "exercise-cable-fly",
  "cable flys": "exercise-cable-fly",
  "cable crossovers": "exercise-cable-fly",
  "face pull": "exercise-face-pull",
  "face pulls": "exercise-face-pull",
  "bicep curl": "dumbbell-bicep-curl",
  "bicep curls": "dumbbell-bicep-curl",
  "dumbbell curls": "dumbbell-bicep-curl",
  "dumbbell curl": "dumbbell-bicep-curl",
  "hammer curl": "exercise-hammer-curl",
  "hammer curls": "exercise-hammer-curl",
  "tricep pushdown": "exercise-tricep-pushdown",
  "tricep pushdowns": "exercise-tricep-pushdown",
  "skull crusher": "exercise-ez-bar-lying-tricep-extension",
  "skull crushers": "exercise-ez-bar-lying-tricep-extension",
  "bulgarian split squat": "exercise-bulgarian-split-squat",
  "bulgarian split squats": "exercise-bulgarian-split-squat",
  "split squat": "exercise-dumbbell-split-squat",
  "leg press": "leg-press",
  "leg curl": "seated-leg-curl",
  "leg curls": "seated-leg-curl",
  "hamstring curl": "seated-leg-curl",
  "hamstring curls": "seated-leg-curl",
  "leg extension": "exercise-leg-extension",
  "leg extensions": "exercise-leg-extension",
  "calf raise": "exercise-standing-calf-raise",
  "calf raises": "exercise-standing-calf-raise",
  pullup: "pull-up",
  pullups: "pull-up",
  "pull ups": "pull-up",
  "pull up": "pull-up",
  chinup: "exercise-chin-ups",
  chinups: "exercise-chin-ups",
  "chin up": "exercise-chin-ups",
  "chin ups": "exercise-chin-ups",
  pushup: "push-up",
  pushups: "push-up",
  "push ups": "push-up",
  "push up": "push-up",
  dip: "exercise-dips",
  dips: "exercise-dips",
  squat: "barbell-squat",
  squats: "barbell-squat",
  "barbell squat": "barbell-squat",
  "back squat": "barbell-squat",
  "front squat": "exercise-front-squat",
  deadlift: "barbell-deadlift",
  deadlifts: "barbell-deadlift",
  "bench press": "barbell-bench-press",
  "barbell bench press": "barbell-bench-press",
  "lat pulldown": "exercise-lat-pulldown",
  "lat pulldowns": "exercise-lat-pulldown",
  plank: "plank",
  "dead bug": "dead-bug",
  "seated cable row": "seated-cable-row",
  "cable row": "seated-cable-row",
  "cable rows": "seated-cable-row",
};

/**
 * Fresh name searches select only active entries. Saved IDs use getExerciseFromCatalog.
 */
export const findCatalogExercise = (
  rawNameOrQuery: string,
): CatalogExercise | null => {
  const trimmed = rawNameOrQuery.trim().toLowerCase();
  if (!trimmed) return null;

  // 1. Direct ID lookup
  const byId = catalogById.get(trimmed);
  if (byId) return byId;

  return searchExerciseCatalog({ query: trimmed, limit: 1 })[0] ?? null;
};
