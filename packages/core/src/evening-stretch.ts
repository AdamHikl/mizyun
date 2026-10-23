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
  /**
   * Id of the workout this exercise came from. Exercises without it share
   * one implicit source.
   */
  readonly session?: string;
  /** A timed activity logged as one set (e.g. "Log activity"). */
  readonly timed?: boolean;
}

export interface StretchSessionInput {
  readonly exercises: readonly StretchSessionExerciseInput[];
  /** Runs / bouldering sessions finished today. */
  readonly activities: readonly StretchActivity[];
  /** Defaults to bodyweight only. */
  readonly availableEquipment?: readonly EquipmentOption[];
  /** Defaults to 6, clamped to [3, 8]. */
  readonly maxSteps?: number;
  /**
   * Muscles for saved names the catalog cannot resolve (custom
   * exercises), keyed by name as entered. Counted as primary muscles;
   * names the catalog resolves ignore their tag.
   */
  readonly muscleTags?: Readonly<Record<string, readonly string[]>>;
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
/** Bounds for a refined (AI-chosen) hold, per side. */
export const STRETCH_MIN_HOLD_SECONDS = 20;
export const STRETCH_MAX_HOLD_SECONDS = 45;
/** Bounds for the number of stretches in a refined plan. */
export const STRETCH_MIN_REFINED_STEPS = 3;
export const STRETCH_MAX_REFINED_STEPS = 6;

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

/** Per-muscle load of an unresolved, untagged timed activity. */
const GENERAL_TIMED_LOAD = 2;
const GENERAL_TIMED_MUSCLES: readonly string[] = [
  "hamstrings",
  "hip flexors",
  "chest",
  "lats",
  "lower back",
  "calves",
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

/** Current catalog muscle names; tags outside this list are ignored. */
export const STRETCH_MUSCLE_VOCABULARY: readonly string[] = [
  ...new Set(
    EXERCISE_CATALOG.flatMap((exercise) => [
      ...exercise.primaryMuscles,
      ...exercise.secondaryMuscles,
    ]),
  ),
].sort();
const MUSCLE_VOCABULARY_SET: ReadonlySet<string> = new Set(
  STRETCH_MUSCLE_VOCABULARY,
);

const tagsFor = (
  input: StretchSessionInput,
  name: string,
): readonly string[] => {
  const tags = input.muscleTags;
  if (!tags || typeof name !== "string") return [];
  const wanted = normalizeExerciseName(name);
  for (const [key, muscles] of Object.entries(tags)) {
    if (normalizeExerciseName(key) !== wanted || !Array.isArray(muscles)) {
      continue;
    }
    return [...new Set(muscles)].filter(
      (muscle): muscle is string =>
        typeof muscle === "string" && MUSCLE_VOCABULARY_SET.has(muscle),
    );
  }
  return [];
};

/** Saved names the catalog cannot resolve, as entered, without duplicates. */
export const unresolvedStretchExerciseNames = (
  input: StretchSessionInput,
): readonly string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of input.exercises ?? []) {
    if (!item || typeof item.name !== "string" || item.name.trim() === "") {
      continue;
    }
    if (resolveExercise(item)) continue;
    const key = normalizeExerciseName(item.name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(item.name.trim());
  }
  return names;
};

const compareEntries = (
  a: readonly [string, number],
  b: readonly [string, number],
): number => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** Add the loads of some exercises and activities to `loads`. */
const accumulateLoads = (
  input: StretchSessionInput,
  exercises: readonly StretchSessionExerciseInput[],
  activities: readonly StretchActivity[],
  loads: Map<string, number>,
): void => {
  // A timed activity counts once per source, however often it is logged.
  const seenTimed = new Set<string>();
  for (const item of exercises) {
    if (!item) continue;
    const exercise = resolveExercise(item);
    if (!exercise) {
      // A custom exercise counts only through its muscle tags.
      const sets = effectiveSets(item.setCount);
      const tags = tagsFor(input, item.name);
      for (const muscle of tags) {
        addMappedLoad(loads, muscle, sets);
      }
      if (tags.length === 0 && item.timed === true) {
        const key = `${item.session ?? ""}\u0000${normalizeExerciseName(item.name)}`;
        if (seenTimed.has(key)) continue;
        seenTimed.add(key);
        for (const muscle of GENERAL_TIMED_MUSCLES) {
          addMappedLoad(loads, muscle, GENERAL_TIMED_LOAD);
        }
      }
      continue;
    }
    if (isStretch(exercise)) continue;
    const sets = effectiveSets(item.setCount);
    for (const muscle of exercise.primaryMuscles) {
      addMappedLoad(loads, muscle, sets);
    }
    for (const muscle of exercise.secondaryMuscles) {
      addMappedLoad(loads, muscle, sets * 0.5);
    }
  }
  const seenActivities = new Set<StretchActivity>();
  for (const activity of activities) {
    // A repeated entry (two runs) does not double the fixed load.
    if (seenActivities.has(activity)) continue;
    seenActivities.add(activity);
    const fixed = ACTIVITY_LOADS[activity];
    if (!fixed) continue;
    for (const [muscle, amount] of Object.entries(fixed)) {
      addMappedLoad(loads, muscle, amount);
    }
  }
};

/** Stretchable muscles of a load map, most-worked first. */
const rankLoads = (
  loads: ReadonlyMap<string, number>,
): readonly (readonly [string, number])[] =>
  [...loads.entries()]
    .filter(([muscle]) => STRETCHABLE_MUSCLES.has(muscle))
    .sort(compareEntries);

const computeMuscleLoads = (
  input: StretchSessionInput,
): readonly (readonly [string, number])[] => {
  const loads = new Map<string, number>();
  accumulateLoads(input, input.exercises ?? [], input.activities ?? [], loads);
  return rankLoads(loads);
};

interface StretchSource {
  readonly key: string;
  readonly ranked: readonly (readonly [string, number])[];
  readonly total: number;
}

/**
 * Each distinct workout (`session`, plus the implicit no-session one) and
 * each distinct activity, with its own stretchable muscle loads. Sources
 * that load no stretchable muscle are left out.
 */
const computeSources = (input: StretchSessionInput): StretchSource[] => {
  const bySession = new Map<string, StretchSessionExerciseInput[]>();
  for (const item of input.exercises ?? []) {
    if (!item) continue;
    const key = `s:${item.session ?? ""}`;
    const group = bySession.get(key);
    if (group) group.push(item);
    else bySession.set(key, [item]);
  }
  const groups: [string, StretchSessionExerciseInput[], StretchActivity[]][] = [
    ...bySession.entries(),
  ].map(([key, items]) => [key, items, []]);
  for (const activity of new Set(input.activities ?? [])) {
    groups.push([`a:${activity}`, [], [activity]]);
  }
  const sources: StretchSource[] = [];
  for (const [key, items, activities] of groups) {
    const loads = new Map<string, number>();
    accumulateLoads(input, items, activities, loads);
    const ranked = rankLoads(loads);
    if (ranked.length === 0) continue;
    sources.push({
      key,
      ranked,
      total: ranked.reduce((sum, [, amount]) => sum + amount, 0),
    });
  }
  return sources.sort(
    (a, b) => b.total - a.total || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
};

/**
 * Whether a plan (e.g. an AI-chosen one) stretches one of the two
 * most-worked muscles of every source of today's training, so a bigger session cannot crowd out a
 * smaller one. Plans for a single source always pass.
 */
export const stretchPlanCoversEverySource = (
  input: StretchSessionInput,
  plan: Pick<StretchSessionPlan, "steps">,
): boolean => {
  const sources = computeSources(input ?? { exercises: [], activities: [] });
  if (sources.length <= 1) return true;
  const stretched = new Set(plan.steps.flatMap((step) => step.targetMuscles));
  // The same bar as the planner: one of the source's top two muscles.
  return sources.every((source) =>
    source.ranked.slice(0, 2).some(([muscle]) => stretched.has(muscle)),
  );
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

const allowedStretches = (
  equipment: readonly EquipmentOption[] | undefined,
): readonly CatalogExercise[] => {
  const allowed = new Set<EquipmentOption>(equipment ?? ["bodyweight"]);
  return STRETCH_CATALOG.filter((exercise) =>
    exercise.equipment.every((option) => allowed.has(option)),
  );
};

/**
 * The beginner-first stretch for `muscle` (as a primary muscle) that also
 * reaches the most of today's worked muscles; ties keep catalog order.
 */
const bestStretchFor = (
  muscle: string,
  candidates: readonly CatalogExercise[],
  excludedIds: ReadonlySet<string>,
  workedMuscles: readonly string[],
): CatalogExercise | null => {
  const worked = new Set(workedMuscles);
  const coverage = (exercise: CatalogExercise): number =>
    new Set(
      [...exercise.primaryMuscles, ...exercise.secondaryMuscles].filter(
        (target) => worked.has(target),
      ),
    ).size;
  let best: CatalogExercise | null = null;
  let bestKey: readonly [number, number] | null = null;
  for (const exercise of candidates) {
    if (excludedIds.has(exercise.id)) continue;
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

/**
 * Required muscles: the three most-worked that a stretch can reach, each
 * with at least a quarter of the top load. Redirected muscles (biceps) are
 * split between their targets, so a half-load bar would drop a curl day's
 * biceps.
 */
const MAX_REQUIRED_MUSCLES = 3;
const REQUIRED_LOAD_SHARE = 0.25;

/**
 * Today's most-worked muscles that every plan must stretch (as a primary
 * muscle). Biceps count through their remap (chest, front shoulders).
 * Model muscle tags are ignored: the device validates without them and
 * must reach the same set as the server. Empty for the general set.
 */
export const stretchRequiredMuscles = (
  input: StretchSessionInput,
): readonly string[] => {
  const ranked = computeMuscleLoads({
    exercises: input?.exercises ?? [],
    activities: input?.activities ?? [],
  });
  const top = ranked[0]?.[1] ?? 0;
  if (top <= 0) return [];
  const reachable = new Set(
    allowedStretches(input?.availableEquipment).flatMap(
      (exercise) => exercise.primaryMuscles,
    ),
  );
  return ranked
    .filter(
      ([muscle, amount]) =>
        amount >= top * REQUIRED_LOAD_SHARE && reachable.has(muscle),
    )
    .slice(0, MAX_REQUIRED_MUSCLES)
    .map(([muscle]) => muscle);
};

export interface StretchOption {
  readonly id: string;
  readonly name: string;
  readonly primaryMuscles: readonly string[];
  readonly secondaryMuscles: readonly string[];
  readonly bothSides: boolean;
  readonly level: CatalogExercise["level"];
}

/** Every stretch a plan may use with this equipment (bodyweight by default). */
export const listStretchOptions = (
  equipment?: readonly EquipmentOption[],
): readonly StretchOption[] =>
  allowedStretches(equipment).map((exercise) => ({
    id: exercise.id,
    name: exercise.name,
    primaryMuscles: [...exercise.primaryMuscles],
    secondaryMuscles: [...exercise.secondaryMuscles],
    bothSides: toStep(exercise).bothSides,
    level: exercise.level,
  }));

export interface StretchChoice {
  readonly picks: readonly {
    readonly id: string;
    readonly holdSeconds: number;
  }[];
  readonly focusMuscles?: readonly string[];
}

/**
 * Add the deterministic stretch for each required muscle no step stretches,
 * in place. Returns the muscles added for, or null when the plan cannot stay
 * within six stretches.
 */
const addRequiredStretches = (
  input: StretchSessionInput,
  steps: StretchStep[],
  seen: Set<string>,
): string[] | null => {
  const required = stretchRequiredMuscles(input);
  const candidates = allowedStretches(input?.availableEquipment);
  const worked = computeMuscleLoads(input).map(([muscle]) => muscle);
  const added: string[] = [];
  for (const muscle of required) {
    if (steps.some((step) => step.targetMuscles.includes(muscle))) continue;
    const exercise = bestStretchFor(muscle, candidates, seen, worked);
    if (!exercise) continue;
    if (steps.length >= STRETCH_MAX_REFINED_STEPS) {
      // Drop the last pick whose muscles the other picks already stretch,
      // never one that is the only stretch for a required muscle.
      let redundant = -1;
      for (
        let index = steps.length - 1;
        index >= 0 && redundant === -1;
        index--
      ) {
        const coveredElsewhere = steps[index]!.targetMuscles.every((target) =>
          steps.some(
            (other, otherIndex) =>
              otherIndex !== index && other.targetMuscles.includes(target),
          ),
        );
        if (coveredElsewhere) redundant = index;
      }
      if (redundant === -1) return null;
      steps.splice(redundant, 1);
    }
    steps.push(toStep(exercise));
    seen.add(exercise.id);
    added.push(muscle);
  }
  return added;
};

/**
 * Turn a chosen list of stretches (from a model, or echoed back by the
 * server) into a plan, or null when it breaks any rule: 3–6 distinct
 * allowed catalog stretches. Holds are rounded and clamped to 20–45 s;
 * focus muscles outside the stretchable vocabulary are dropped and, when
 * none remain, the deterministic ranking is used. Instructions always come
 * from the catalog.
 *
 * A choice that leaves out one of `stretchRequiredMuscles` gets the
 * deterministic stretch for it (30 s), replacing a pick whose muscles other
 * picks already stretch when the plan would exceed six; null when it still
 * cannot fit.
 */
export const stretchPlanFromChoice = (
  input: StretchSessionInput,
  choice: StretchChoice,
): StretchSessionPlan | null => {
  if (!choice || !Array.isArray(choice.picks)) return null;
  const picks = choice.picks;
  if (
    picks.length < STRETCH_MIN_REFINED_STEPS ||
    picks.length > STRETCH_MAX_REFINED_STEPS
  ) {
    return null;
  }
  const allowed = new Map(
    allowedStretches(input?.availableEquipment).map((exercise) => [
      exercise.id,
      exercise,
    ]),
  );
  const seen = new Set<string>();
  const steps: StretchStep[] = [];
  for (const pick of picks) {
    if (!pick || typeof pick.id !== "string") return null;
    const exercise = allowed.get(pick.id);
    if (!exercise || seen.has(pick.id)) return null;
    seen.add(pick.id);
    const hold =
      typeof pick.holdSeconds === "number" && Number.isFinite(pick.holdSeconds)
        ? Math.round(pick.holdSeconds)
        : STRETCH_HOLD_SECONDS;
    steps.push({
      ...toStep(exercise),
      holdSeconds: Math.min(
        STRETCH_MAX_HOLD_SECONDS,
        Math.max(STRETCH_MIN_HOLD_SECONDS, hold),
      ),
    });
  }
  const added = addRequiredStretches(input, steps, seen);
  if (added === null) return null;
  const chosenFocus = [
    ...new Set(
      (Array.isArray(choice.focusMuscles) ? choice.focusMuscles : []).filter(
        (muscle): muscle is string =>
          typeof muscle === "string" && STRETCHABLE_MUSCLES.has(muscle),
      ),
    ),
  ].slice(0, MAX_FOCUS_MUSCLES);
  const deterministic = buildEveningStretchSession(input);
  // An added stretch's muscle is named, so the header matches the list;
  // known muscles are ordered by today's load.
  const rank = computeMuscleLoads(input).map(([muscle]) => muscle);
  const order = (muscle: string): number => {
    const index = rank.indexOf(muscle);
    return index === -1 ? rank.length : index;
  };
  const focusMuscles =
    chosenFocus.length > 0
      ? [
          ...new Set([
            ...chosenFocus.slice(0, MAX_FOCUS_MUSCLES - added.length),
            ...added,
          ]),
        ].sort((a, b) => order(a) - order(b))
      : deterministic.focusMuscles;
  return {
    focusMuscles,
    basis: "today",
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

  const candidates = allowedStretches(input.availableEquipment);
  const rankedMuscles = ranked.map(([muscle]) => muscle);

  const chosen: CatalogExercise[] = [];
  const chosenIds = new Set<string>();
  const bestFor = (muscle: string): CatalogExercise | null =>
    bestStretchFor(muscle, candidates, chosenIds, rankedMuscles);
  const choose = (exercise: CatalogExercise) => {
    chosen.push(exercise);
    chosenIds.add(exercise.id);
  };

  const covered = new Set<string>();

  // A small source (a climb, a second workout, a timed activity) must not be
  // crowded out by a bigger one: give each source without a stretch for its
  // top two muscles one for its most-worked muscle that has a stretch.
  const sources = computeSources(input);
  if (sources.length > 1) {
    for (const source of sources) {
      if (chosen.length >= maxSteps) break;
      const topTwo = new Set(source.ranked.slice(0, 2).map(([m]) => m));
      if (chosen.some((c) => c.primaryMuscles.some((m) => topTwo.has(m)))) {
        continue;
      }
      for (const [muscle] of source.ranked) {
        const best = bestFor(muscle);
        if (!best) continue;
        choose(best);
        for (const primary of best.primaryMuscles) covered.add(primary);
        break;
      }
    }
  }

  // One stretch per worked muscle, most-worked first.
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

  // Each source's most-worked muscle that a chosen stretch targets first
  // (global rank order), then the ranking.
  // A single source keeps the plain ranking.
  const stretched = new Set(chosen.flatMap((c) => c.primaryMuscles));
  const sourceTops = new Set(
    sources.length > 1
      ? sources.map(
          (source) =>
            (source.ranked.find(([muscle]) => stretched.has(muscle)) ??
              source.ranked[0]!)[0],
        )
      : [],
  );
  const focusMuscles = [
    ...rankedMuscles.filter((muscle) => sourceTops.has(muscle)),
    ...rankedMuscles.filter((muscle) => !sourceTops.has(muscle)),
  ].slice(0, MAX_FOCUS_MUSCLES);

  return {
    focusMuscles,
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
