import {
  EXERCISE_NAME_MAX,
  findCatalogExerciseByExactName,
  normalizeCustomExerciseName,
} from "@mizyun/core";
import type {
  HistoryExerciseTargetWire,
  HistoryImportConfirmRequest,
  HistoryImportPreview,
} from "@mizyun/contracts";
import type { DistanceUnit, WeightUnit } from "./history-import-files";

export type PreviewExercise = HistoryImportPreview["exercises"][number];

/** What the user has chosen for one exercise in the file. */
export type ExerciseChoice =
  | {
      readonly kind: "catalog";
      readonly catalogId: string;
      readonly name: string;
      /** True for a suggested (not exact) match the user hasn't confirmed. */
      readonly suggested: boolean;
    }
  | { readonly kind: "custom"; readonly name: string }
  | { readonly kind: "skip" };

export type ChoiceMap = Readonly<Record<string, ExerciseChoice>>;

export type CustomNameCheck =
  { ok: true; name: string } | { ok: false; message: string };

/** Same rules the server applies to a custom exercise created by an import. */
export function checkCustomName(raw: string): CustomNameCheck {
  const name = normalizeCustomExerciseName(raw);
  if (name.length === 0)
    return { ok: false, message: "Enter a name for the exercise." };
  if (name.length > EXERCISE_NAME_MAX)
    return {
      ok: false,
      message: `Use ${EXERCISE_NAME_MAX} characters or fewer.`,
    };
  const builtIn = findCatalogExerciseByExactName(name);
  if (builtIn)
    return {
      ok: false,
      message: `"${builtIn.name}" is a built-in exercise. Choose it from the library instead.`,
    };
  return { ok: true, name };
}

/** Preselects the best option for one exercise without any user input. */
export function defaultChoice(exercise: PreviewExercise): ExerciseChoice {
  if (exercise.match)
    return {
      kind: "catalog",
      catalogId: exercise.match.catalogId,
      name: exercise.match.name,
      suggested: exercise.match.confidence !== "exact",
    };
  const normalized = normalizeCustomExerciseName(exercise.sourceName);
  const builtIn = findCatalogExerciseByExactName(normalized);
  if (builtIn)
    return {
      kind: "catalog",
      catalogId: builtIn.id,
      name: builtIn.name,
      suggested: false,
    };
  const name = normalized.slice(0, EXERCISE_NAME_MAX);
  return name ? { kind: "custom", name } : { kind: "skip" };
}

export function defaultChoices(preview: HistoryImportPreview): ChoiceMap {
  const choices: Record<string, ExerciseChoice> = {};
  for (const exercise of preview.exercises)
    choices[exercise.sourceName] = defaultChoice(exercise);
  return choices;
}

/** Short status shown on a mapping row. */
export function choiceLabel(choice: ExerciseChoice): string {
  switch (choice.kind) {
    case "catalog":
      return choice.suggested
        ? `Suggested — check: ${choice.name}`
        : `Matched: ${choice.name}`;
    case "custom":
      return `New custom exercise: ${choice.name}`;
    case "skip":
      return "Skipped — its sets won't be imported";
  }
}

export const setsAndWorkoutsLabel = (exercise: PreviewExercise): string =>
  `${exercise.setCount} ${exercise.setCount === 1 ? "set" : "sets"} in ${exercise.workoutCount} ${exercise.workoutCount === 1 ? "workout" : "workouts"}`;

const targetOf = (choice: ExerciseChoice): HistoryExerciseTargetWire =>
  choice.kind === "catalog"
    ? { kind: "catalog", catalogId: choice.catalogId }
    : choice.kind === "custom"
      ? { kind: "custom", name: choice.name }
      : { kind: "skip" };

/** Exactly one mapping per preview exercise, in preview order. */
export function buildMappings(
  preview: HistoryImportPreview,
  choices: ChoiceMap,
): HistoryImportConfirmRequest["mappings"] {
  return preview.exercises.map((exercise) => ({
    sourceName: exercise.sourceName,
    target: targetOf(choices[exercise.sourceName] ?? defaultChoice(exercise)),
  }));
}

export interface ConfirmRequestInput {
  readonly preview: HistoryImportPreview;
  readonly choices: ChoiceMap;
  readonly content: string;
  readonly fileName: string | null;
  readonly timezone: string;
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: DistanceUnit;
  readonly batchId: string;
  readonly skipOverlaps: boolean;
}

/** The immutable request a retry re-sends unchanged. */
export function buildConfirmRequest(
  input: ConfirmRequestInput,
): HistoryImportConfirmRequest {
  return {
    ...(input.fileName ? { fileName: input.fileName } : {}),
    content: input.content,
    timezone: input.timezone,
    weightUnit: input.weightUnit,
    distanceUnit: input.distanceUnit,
    batchId: input.batchId,
    mappings: buildMappings(input.preview, input.choices),
    skipOverlaps: input.skipOverlaps,
  };
}

/** How many exercises, sets and workouts the current choices will import. */
export function mappingTotals(
  preview: HistoryImportPreview,
  choices: ChoiceMap,
): { imported: number; skipped: number; custom: number; unchecked: number } {
  let imported = 0;
  let skipped = 0;
  let custom = 0;
  let unchecked = 0;
  for (const exercise of preview.exercises) {
    const choice = choices[exercise.sourceName] ?? defaultChoice(exercise);
    if (choice.kind === "skip") skipped++;
    else imported++;
    if (choice.kind === "custom") custom++;
    if (choice.kind === "catalog" && choice.suggested) unchecked++;
  }
  return { imported, skipped, custom, unchecked };
}
