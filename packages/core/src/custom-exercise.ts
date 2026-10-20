/**
 * Custom exercises in the Exercise library (ADR-0075).
 *
 * A custom exercise is an ordinary saved exercise record
 * (`public.exercises`) that does not resolve to a catalog entry: no
 * known `metadata.catalogId` and no exact catalog name. Records the
 * library creates also carry `metadata.custom = true` and an explicit
 * `metadata.trackingMode`, which `resolveExerciseTrackingMode` already
 * honours. Older name-only records (routine "Custom name" rows, custom
 * Log activity entries) count as custom too, so they are listed and
 * editable in the same place.
 *
 * Pure: names, duplicates and metadata only. Persistence, logged-set
 * checks and presentation live in the API and mobile layers.
 */
import { EXERCISE_NAME_MAX, INSTRUCTIONS_MAX } from "./exercise";
import { getExerciseFromCatalog } from "./exercise-catalog";
import {
  findCatalogExerciseByExactName,
  isExerciseTrackingMode,
  resolveExerciseTrackingMode,
  type ExerciseTrackingMode,
} from "./exercise-tracking";

export interface CustomExerciseRecord {
  readonly id: string;
  readonly name: string;
  readonly instructions?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | null | undefined;
}

export interface CustomExerciseDraft {
  readonly name: string;
  readonly notes: string;
  readonly trackingMode: ExerciseTrackingMode;
}

export interface NormalizedCustomExercise {
  readonly name: string;
  readonly instructions: string | null;
  readonly trackingMode: ExerciseTrackingMode;
}

export type CustomExerciseDraftError =
  | { readonly kind: "name_empty" }
  | { readonly kind: "name_too_long"; readonly max: number }
  | { readonly kind: "notes_too_long"; readonly max: number }
  | { readonly kind: "invalid_tracking_mode" }
  | { readonly kind: "matches_catalog"; readonly catalogName: string }
  | {
      readonly kind: "matches_saved";
      readonly exerciseId: string;
      readonly name: string;
    };

export type CustomExerciseDraftResult =
  | { readonly ok: true; readonly value: NormalizedCustomExercise }
  | { readonly ok: false; readonly error: CustomExerciseDraftError };

/** Trim and collapse inner whitespace so "Sled  push " equals "Sled push". */
export const normalizeCustomExerciseName = (name: string): string =>
  name.trim().replace(/\s+/g, " ");

const nameKey = (name: string): string =>
  normalizeCustomExerciseName(name).toLowerCase();

/** True when a saved record is not backed by a catalog entry. */
export const isCustomExerciseRecord = (
  record: Pick<CustomExerciseRecord, "name" | "metadata">,
): boolean => {
  const catalogId = record.metadata?.catalogId;
  if (typeof catalogId === "string" && getExerciseFromCatalog(catalogId)) {
    return false;
  }
  return findCatalogExerciseByExactName(record.name) === null;
};

/**
 * Validate a create or edit form. `saved` is the user's saved exercise
 * list; `editing` is the record being edited, excluded from the duplicate
 * check. A name that exactly matches a catalog exercise is rejected so
 * the user picks the catalog entry (and its history) instead. An edit
 * that keeps the record's name skips both name checks, so older records
 * that already share a name can still have their notes edited.
 */
export const validateCustomExerciseDraft = (
  draft: CustomExerciseDraft,
  saved: ReadonlyArray<Pick<CustomExerciseRecord, "id" | "name">>,
  editing?: Pick<CustomExerciseRecord, "id" | "name">,
): CustomExerciseDraftResult => {
  const name = normalizeCustomExerciseName(draft.name);
  if (name.length === 0) return { ok: false, error: { kind: "name_empty" } };
  if (name.length > EXERCISE_NAME_MAX) {
    return {
      ok: false,
      error: { kind: "name_too_long", max: EXERCISE_NAME_MAX },
    };
  }
  const notes = draft.notes.trim();
  if (notes.length > INSTRUCTIONS_MAX) {
    return {
      ok: false,
      error: { kind: "notes_too_long", max: INSTRUCTIONS_MAX },
    };
  }
  if (!isExerciseTrackingMode(draft.trackingMode)) {
    return { ok: false, error: { kind: "invalid_tracking_mode" } };
  }
  const key = nameKey(name);
  const value: NormalizedCustomExercise = {
    name,
    instructions: notes.length > 0 ? notes : null,
    trackingMode: draft.trackingMode,
  };
  if (editing && nameKey(editing.name) === key) return { ok: true, value };
  const catalog = findCatalogExerciseByExactName(name);
  if (catalog) {
    return {
      ok: false,
      error: { kind: "matches_catalog", catalogName: catalog.name },
    };
  }
  const duplicate = saved.find(
    (record) => record.id !== editing?.id && nameKey(record.name) === key,
  );
  if (duplicate) {
    return {
      ok: false,
      error: {
        kind: "matches_saved",
        exerciseId: duplicate.id,
        name: duplicate.name,
      },
    };
  }
  return { ok: true, value };
};

/** At most this many earlier names are kept on a renamed exercise. */
export const CUSTOM_EXERCISE_PREVIOUS_NAMES_MAX = 10;

const previousNamesOf = (
  metadata: Readonly<Record<string, unknown>> | null | undefined,
): string[] =>
  Array.isArray(metadata?.previousNames)
    ? metadata.previousNames.filter(
        (name): name is string => typeof name === "string",
      )
    : [];

/**
 * Metadata for a created or edited custom exercise. Unrelated keys on an
 * existing record are kept; `custom` and `trackingMode` are set. When
 * `renamedFrom` differs from the new name it is remembered in
 * `previousNames`, because routines and sessions plan custom exercises by
 * name (see `findSavedExerciseByName`).
 */
export const customExerciseMetadata = (
  trackingMode: ExerciseTrackingMode,
  previous: Readonly<Record<string, unknown>> | null | undefined = {},
  rename?: { readonly from: string; readonly to: string },
): Record<string, unknown> => {
  const metadata: Record<string, unknown> = {
    ...(previous ?? {}),
    custom: true,
    trackingMode,
  };
  if (rename && nameKey(rename.from) !== nameKey(rename.to)) {
    const to = nameKey(rename.to);
    const names = [normalizeCustomExerciseName(rename.from)];
    for (const name of previousNamesOf(previous)) {
      if (
        nameKey(name) !== to &&
        !names.some((kept) => nameKey(kept) === nameKey(name))
      )
        names.push(name);
    }
    metadata.previousNames = names.slice(0, CUSTOM_EXERCISE_PREVIOUS_NAMES_MAX);
  }
  return metadata;
};

/**
 * The saved record a routine or session row planned by `name` refers to:
 * an exact (case-insensitive, whitespace-collapsed) current name first,
 * then a custom exercise's earlier name, so renaming one keeps routines
 * that still list the old name linked to it. Rows planned from a catalog
 * entry pass `includePreviousNames: false`. When two records share an
 * earlier name, the first in `records` wins.
 */
export const findSavedExerciseByName = <T extends CustomExerciseRecord>(
  records: ReadonlyArray<T>,
  name: string,
  options: { readonly includePreviousNames?: boolean } = {},
): T | undefined => {
  const key = nameKey(name);
  if (key.length === 0) return undefined;
  const current = records.find((record) => nameKey(record.name) === key);
  if (current || options.includePreviousNames === false) return current;
  return records.find((record) =>
    previousNamesOf(record.metadata).some(
      (previous) => nameKey(previous) === key,
    ),
  );
};

/** The tracking mode an edit form should start from. */
export const customExerciseTrackingMode = (
  record: Pick<CustomExerciseRecord, "name" | "metadata">,
): ExerciseTrackingMode => resolveExerciseTrackingMode(record);

/**
 * Custom records whose name contains every word of `query`
 * (case-insensitive), sorted by name.
 */
export const searchCustomExercises = <T extends CustomExerciseRecord>(
  records: ReadonlyArray<T>,
  query: string,
): T[] => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return records
    .filter(isCustomExerciseRecord)
    .filter((record) => {
      const name = record.name.toLowerCase();
      return words.every((word) => name.includes(word));
    })
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
};
