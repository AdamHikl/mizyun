import {
  EXERCISE_CATALOG,
  findCatalogExerciseByAlias,
  getExerciseFromCatalog,
  type CatalogExercise,
} from "./exercise-catalog";
import { LEGACY_EXERCISE_CATALOG } from "./exercise-catalog-legacy";
import { findCatalogExerciseByExactName } from "./exercise-tracking";
import type { EquipmentOption } from "./profile";

/**
 * Evening stretch session (#298): turns today's finished workouts and
 * activities into a short, deterministic list of catalog stretches that
 * target the muscles worked most. Pure: no clock, storage or randomness.
 */

export type StretchActivity = "running" | "bouldering";

export interface StretchSessionExerciseInput {
  /** Saved exercise name from the workout. */
  readonly name: string;
  /** Optional catalog id when known; wins over the name. */
  readonly catalogId?: string;
  /** Completed sets (>= 0); timed activities count as their set count. */
  readonly setCount: number;
}

export interface StretchSessionInput {
  readonly exercises: readonly StretchSessionExerciseInput[];
  /** Runs / bouldering sessions finished today. */
  readonly activities: readonly StretchActivity[];
  /** Defaults to bodyweight only. */
  readonly availableEquipment?: readonly EquipmentOption[];
  /** Defaults to 6, clamped to [3, 8]. */
  readonly maxSteps?: number;
}

export interface StretchStep {
  readonly exerciseId: string;
  readonly name: string;
  /** Primary muscles of the stretch. */
  readonly targetMuscles: readonly string[];
  readonly instructions: readonly string[];
  /** Seconds per side. */
  readonly holdSeconds: number;
  readonly bothSides: boolean;
}

export interface StretchSessionPlan {
  /** Ranked, most-worked first, at most four. */
  readonly focusMuscles: readonly string[];
  /** "general" when nothing resolved to muscles. */
  readonly basis: "today" | "general";
  readonly steps: readonly StretchStep[];
  /** Sum of holdSeconds * (bothSides ? 2 : 1). */
  readonly totalSeconds: number;
}

export const STRETCH_HOLD_SECONDS = 30;

const DEFAULT_MAX_STEPS = 6;
const MIN_STEPS = 3;
const MAX_STEPS = 8;
const MAX_FOCUS_MUSCLES = 4;
/** Short plans get extra stretches for the most-worked muscles. */
const MIN_SESSION_STEPS = 4;

/**
 * Fixed full-body set, one bodyweight stretch each for hamstrings, hip
 * flexors, chest, lats, lower back and calves. Ids are asserted in tests.
 */
export const GENERAL_STRETCH_IDS: readonly string[] = [
  "exercise-seated-forward-fold",
  "exercise-kneeling-hip-flexor-stretch",
  "exercise-doorway-chest-stretch",
  "exercise-puppy-pose",
  "childs-pose",
  "exercise-standing-calf-stretch",
];

const ACTIVITY_LOADS: Readonly<
  Record<StretchActivity, Readonly<Record<string, number>>>
> = {
  running: {
    calves: 3,
    hamstrings: 3,
    quadriceps: 3,
    "hip flexors": 2,
    glutes: 2,
  },
  bouldering: {
    forearms: 3,
    lats: 3,
    "rear shoulders": 2,
    "front shoulders": 1,
    chest: 1,
    "hip flexors": 1,
  },
};

/**
 * Muscles without a direct stretch, redirected to ones that have one. The
 * earlier catalog's broader labels (still on many saved exercises) are
 * translated to the current vocabulary first.
 */
const MUSCLE_REMAP: Readonly<Record<string, readonly string[]>> = {
  shoulders: ["front shoulders", "side shoulders"],
  "middle back": ["rear shoulders", "traps"],
  "upper chest": ["chest"],
  hips: ["hip flexors"],
  "thoracic spine": ["lower back"],
  neck: ["traps"],
  biceps: ["chest", "front shoulders"],
  brachialis: ["forearms"],
  rhomboids: ["rear shoulders", "traps"],
  "side shoulders": ["rear shoulders"],
};

const BOTH_SIDES_PATTERN =
  /switch sides|other side|each side|opposite side|both sides/i;

const isStretch = (exercise: CatalogExercise): boolean =>
  exercise.category === "stretching";

const STRETCH_CATALOG: readonly CatalogExercise[] =
  EXERCISE_CATALOG.filter(isStretch);

/** Muscles that at least one catalog stretch targets as a primary muscle. */
const STRETCHABLE_MUSCLES: ReadonlySet<string> = new Set(
  STRETCH_CATALOG.flatMap((exercise) => exercise.primaryMuscles),
);

const normalizeExerciseName = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, " ");

/** Earlier catalog names that saved exercises still carry. */
const LEGACY_BY_NAME: ReadonlyMap<string, CatalogExercise> = new Map(
  [...LEGACY_EXERCISE_CATALOG]
    .reverse()
    .map((exercise) => [normalizeExerciseName(exercise.name), exercise]),
);

/**
 * Saved exercise → catalog entry: id, then the exact current or previous
 * name, then an earlier catalog name, then an everyday alias. No fuzzy
 * search, so a near-miss never borrows another exercise's muscles.
 */
export const resolveStretchSourceExercise = (
  input: Pick<StretchSessionExerciseInput, "name" | "catalogId">,
): CatalogExercise | null => {
  if (typeof input.catalogId === "string" && input.catalogId !== "") {
    const byId = getExerciseFromCatalog(input.catalogId);
    if (byId) return byId;
  }
  if (typeof input.name !== "string" || input.name.trim() === "") return null;
  return (
    findCatalogExerciseByExactName(input.name) ??
    LEGACY_BY_NAME.get(normalizeExerciseName(input.name)) ??
    findCatalogExerciseByAlias(input.name)
  );
};

const resolveExercise = resolveStretchSourceExercise;

/**
 * Non-finite or negative set counts are treated as 0; every resolved
 * exercise then still counts at least once (a logged exercise was worked).
 */
const effectiveSets = (setCount: number): number =>
  Math.max(Number.isFinite(setCount) && setCount > 0 ? setCount : 0, 1);

const addLoad = (
  loads: Map<string, number>,
  muscle: string,
  amount: number,
): void => {
  loads.set(muscle, (loads.get(muscle) ?? 0) + amount);
};

/** Add load, redirecting muscles without direct stretches (split equally). */
const addMappedLoad = (
  loads: Map<string, number>,
  muscle: string,
  amount: number,
  depth = 0,
): void => {
  const targets = MUSCLE_REMAP[muscle];
  // Two hops at most: an earlier label, then a muscle without a stretch.
  if (!targets || depth >= 2) {
    addLoad(loads, muscle, amount);
    return;
  }
  for (const target of targets) {
    addMappedLoad(loads, target, amount / targets.length, depth + 1);
  }
};

const computeMuscleLoads = (
  input: StretchSessionInput,
): readonly (readonly [string, number])[] => {
  const loads = new Map<string, number>();
  for (const item of input.exercises ?? []) {
    if (!item) continue;
    const exercise = resolveExercise(item);
    if (!exercise || isStretch(exercise)) continue;
    const sets = effectiveSets(item.setCount);
    for (const muscle of exercise.primaryMuscles) {
      addMappedLoad(loads, muscle, sets);
    }
    for (const muscle of exercise.secondaryMuscles) {
      addMappedLoad(loads, muscle, sets * 0.5);
    }
  }
  const seenActivities = new Set<StretchActivity>();
  for (const activity of input.activities ?? []) {
    // A repeated entry (two runs) does not double the fixed load.
    if (seenActivities.has(activity)) continue;
    seenActivities.add(activity);
    const fixed = ACTIVITY_LOADS[activity];
    if (!fixed) continue;
    for (const [muscle, amount] of Object.entries(fixed)) {
      addMappedLoad(loads, muscle, amount);
    }
  }
  return [...loads.entries()]
    .filter(([muscle]) => STRETCHABLE_MUSCLES.has(muscle))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
};

const clampMaxSteps = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_STEPS;
  }
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.floor(value)));
};

const toStep = (exercise: CatalogExercise): StretchStep => ({
  exerciseId: exercise.id,
  name: exercise.name,
  targetMuscles: [...exercise.primaryMuscles],
  instructions: [...exercise.instructions],
  holdSeconds: STRETCH_HOLD_SECONDS,
  bothSides: exercise.instructions.some((line) =>
    BOTH_SIDES_PATTERN.test(line),
  ),
});

const generalSteps = (): StretchStep[] =>
  GENERAL_STRETCH_IDS.flatMap((id) => {
    const exercise = getExerciseFromCatalog(id);
    return exercise && isStretch(exercise) ? [toStep(exercise)] : [];
  });

const levelRank = (exercise: CatalogExercise): number =>
  exercise.level === "beginner" ? 0 : exercise.level === "intermediate" ? 1 : 2;

const totalSecondsOf = (steps: readonly StretchStep[]): number =>
  steps.reduce(
    (sum, step) => sum + step.holdSeconds * (step.bothSides ? 2 : 1),
    0,
  );

const generalPlan = (maxSteps: number): StretchSessionPlan => {
  const steps = generalSteps().slice(0, maxSteps);
  return {
    focusMuscles: [],
    basis: "general",
    steps,
    totalSeconds: totalSecondsOf(steps),
  };
};

export const buildEveningStretchSession = (
  input: StretchSessionInput,
): StretchSessionPlan => {
  const maxSteps = clampMaxSteps(input?.maxSteps);
  const ranked = computeMuscleLoads(input ?? { exercises: [], activities: [] });

  if (ranked.length === 0) return generalPlan(maxSteps);

  const allowed = new Set<EquipmentOption>(
    input.availableEquipment ?? ["bodyweight"],
  );
  const candidates = STRETCH_CATALOG.filter((exercise) =>
    exercise.equipment.every((option) => allowed.has(option)),
  );
  const rankedMuscles = ranked.map(([muscle]) => muscle);
  const rankedSet = new Set(rankedMuscles);
  const coverage = (exercise: CatalogExercise): number =>
    new Set(
      [...exercise.primaryMuscles, ...exercise.secondaryMuscles].filter(
        (muscle) => rankedSet.has(muscle),
      ),
    ).size;

  const chosen: CatalogExercise[] = [];
  const chosenIds = new Set<string>();
  const bestFor = (muscle: string): CatalogExercise | null => {
    let best: CatalogExercise | null = null;
    let bestKey: readonly [number, number] | null = null;
    for (const exercise of candidates) {
      if (chosenIds.has(exercise.id)) continue;
      if (!exercise.primaryMuscles.includes(muscle)) continue;
      const key = [levelRank(exercise), -coverage(exercise)] as const;
      if (
        bestKey === null ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && key[1] < bestKey[1])
      ) {
        best = exercise;
        bestKey = key;
      }
    }
    return best;
  };
  const choose = (exercise: CatalogExercise) => {
    chosen.push(exercise);
    chosenIds.add(exercise.id);
  };

  // One stretch per worked muscle, most-worked first.
  const covered = new Set<string>();
  for (const muscle of rankedMuscles) {
    if (chosen.length >= maxSteps) break;
    if (covered.has(muscle)) continue;
    const best = bestFor(muscle);
    if (!best) continue;
    choose(best);
    for (const primary of best.primaryMuscles) covered.add(primary);
  }

  // A short plan gets a second stretch for the most-worked muscles, never
  // stretches for muscles that were not trained today.
  const minSteps = Math.min(maxSteps, MIN_SESSION_STEPS);
  const focus = rankedMuscles.slice(0, MAX_FOCUS_MUSCLES);
  let added = true;
  while (chosen.length < minSteps && added) {
    added = false;
    for (const muscle of focus) {
      if (chosen.length >= minSteps) break;
      const extra = bestFor(muscle);
      if (!extra) continue;
      choose(extra);
      added = true;
    }
  }

  const steps = chosen.map(toStep);
  if (steps.length === 0) return generalPlan(maxSteps);

  return {
    focusMuscles: rankedMuscles.slice(0, MAX_FOCUS_MUSCLES),
    basis: "today",
    steps,
    totalSeconds: totalSecondsOf(steps),
  };
};

const capitalize = (text: string): string =>
  text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);

/** "Hamstrings, glutes and lower back"; "Full body" for the general set. */
export const formatStretchFocus = (plan: StretchSessionPlan): string => {
  const muscles = plan.focusMuscles;
  if (plan.basis === "general" || muscles.length === 0) return "Full body";
  const joined =
    muscles.length === 1
      ? muscles[0]!
      : `${muscles.slice(0, -1).join(", ")} and ${muscles[muscles.length - 1]!}`;
  return capitalize(joined);
};
