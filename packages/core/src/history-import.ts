/**
 * History import (#333, ADR-0083): shared shapes for the pure file parsers,
 * the exercise matcher and the write plan. Parsers turn one exported file
 * into normalized workouts and runs; nothing here talks to a database or a
 * provider API. Strava data comes only from the user's own account-export
 * `activities.csv`, never the Strava API.
 */
import type { WorkoutSetType } from "./workout-set";

export const HISTORY_IMPORT_FORMATS = [
  "hevy",
  "strong",
  "strava",
  "generic",
] as const;
export type HistoryImportFormat = (typeof HISTORY_IMPORT_FORMATS)[number];

export type HistoryWeightUnit = "kg" | "lb";
export type HistoryDistanceUnit = "km" | "mi";

/** Hard limits for one file. The API rejects larger bodies before parsing. */
export const HISTORY_IMPORT_LIMITS = {
  /** Characters of CSV text (about 8 MB of ASCII). */
  maxContentLength: 8_000_000,
  maxRows: 200_000,
  maxColumns: 120,
  maxCellLength: 4_000,
  maxWorkouts: 5_000,
  maxRuns: 5_000,
  maxSetsPerWorkout: 500,
  maxDistinctExercises: 400,
} as const;

export interface HistoryImportOptions {
  /** Named IANA zone used for files that store local wall-clock times. */
  readonly timezone: string;
  /** Unit for weight columns that do not name their unit. */
  readonly weightUnit: HistoryWeightUnit;
  /** Unit for distance columns that do not name their unit. */
  readonly distanceUnit: HistoryDistanceUnit;
  /** Records that end after this instant are skipped as `future`. */
  readonly now: Date;
}

/** One set with contract-ready values; zero or blank metrics are `null`. */
export interface ImportedSet {
  readonly setType: WorkoutSetType;
  /** 0.01 steps, 0 < reps <= 9999.99. */
  readonly repetitions: number | null;
  /** Kilograms in 0.001 steps, 0 < load <= 9999.999. */
  readonly loadKg: number | null;
  /** Whole seconds, 0 < duration <= 86400. */
  readonly durationSeconds: number | null;
  /** Metres in 0.01 steps, 0 < distance <= 1,000,000. */
  readonly distanceMeters: number | null;
  /** RPE 0..10 in 0.1 steps. */
  readonly perceivedExertion: number | null;
}

export interface ImportedExercise {
  /** Exercise name exactly as the file spells it (trimmed, inner spaces collapsed). */
  readonly sourceName: string;
  readonly sets: readonly ImportedSet[];
}

export interface ImportedWorkout {
  /**
   * Stable identity within the format, used for dedupe across re-imports:
   * the start instant for Hevy and Strong, start instant plus name for the
   * generic format. At most 255 characters.
   */
  readonly externalId: string;
  /** 1..200 characters. */
  readonly name: string;
  /** UTC ISO 8601 instants; completedAt >= startedAt. */
  readonly startedAt: string;
  readonly completedAt: string;
  /** At most 4000 characters. */
  readonly notes: string | null;
  /** In file order; every exercise has at least one set. */
  readonly exercises: readonly ImportedExercise[];
}

export type ImportedRunEnvironment = "outdoor" | "treadmill" | "unspecified";

export interface ImportedRun {
  /** Strava Activity ID. */
  readonly externalId: string;
  readonly name: string;
  /** UTC ISO 8601 instant. */
  readonly startedAt: string;
  /** Elapsed seconds, 1..86400. */
  readonly durationSeconds: number;
  readonly distanceMeters: number | null;
  readonly environment: ImportedRunEnvironment;
}

export type ImportIssueCode =
  | "malformed_row"
  | "invalid_date"
  | "invalid_number"
  | "empty_set"
  | "out_of_range"
  | "future"
  | "duplicate"
  | "too_many_sets";

export interface ImportIssue {
  /** 1-based physical CSV line of the offending record (header is line 1). */
  readonly line: number;
  readonly code: ImportIssueCode;
}

export interface ParsedHistory {
  readonly format: HistoryImportFormat;
  readonly workouts: readonly ImportedWorkout[];
  readonly runs: readonly ImportedRun[];
  readonly issues: readonly ImportIssue[];
  /** Strava activity types that are not imported, e.g. `{ Ride: 12 }`. */
  readonly skippedActivities: Readonly<Record<string, number>>;
  /** False when a weight or distance unit came from the options, not the file. */
  readonly unitsFromFile: boolean;
}

export type HistoryImportFileErrorCode =
  | "empty"
  | "too_large"
  | "unknown_format"
  | "missing_columns"
  | "too_many_rows"
  | "too_many_records"
  | "invalid_timezone";

/** The whole file is unusable; row-level problems are `ImportIssue`s instead. */
export class HistoryImportFileError extends Error {
  constructor(readonly code: HistoryImportFileErrorCode) {
    super(`history_import_${code}`);
    this.name = "HistoryImportFileError";
  }
}

/** Dedupe key stored with each imported record: `<format>:<externalId>`. */
export const historyImportKey = (
  format: HistoryImportFormat,
  externalId: string,
): string => `${format}:${externalId}`;
