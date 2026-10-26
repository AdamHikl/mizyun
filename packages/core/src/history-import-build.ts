/**
 * History import (#333): shared pieces of the strength-workout parsers
 * (set normalization and grouping rows into workouts). Internal to the
 * history-import modules.
 */
import {
  HistoryImportFileError,
  type ImportIssue,
  type ImportIssueCode,
  type ImportedExercise,
  type ImportedSet,
  type ImportedWorkout,
} from "./history-import";
import {
  collapseHistoryText,
  sliceHistoryText,
  readHistoryDecimal,
  type HistoryImportLimitValues,
  type HistoryNumber,
} from "./history-import-csv";
import type { WorkoutSetType } from "./workout-set";

export interface RawMeasures {
  readonly repetitions: number | null;
  readonly loadKg: number | null;
  readonly durationSeconds: number | null;
  readonly distanceMeters: number | null;
}

const round = (value: number, step: number): number =>
  Math.round(value * step) / step;

/**
 * Validate and normalize one set. Zero or blank becomes `null`, negatives and
 * values above the contract bounds are `out_of_range`, a set with nothing left
 * is `empty_set`.
 */
export const normalizeHistorySet = (
  raw: RawMeasures,
  setType: WorkoutSetType,
  perceivedExertion: number | null,
): ImportedSet | ImportIssueCode => {
  const values = [
    raw.repetitions,
    raw.loadKg,
    raw.durationSeconds,
    raw.distanceMeters,
  ];
  if (values.some((value) => value !== null && value < 0)) {
    return "out_of_range";
  }
  const reps = raw.repetitions === null ? null : round(raw.repetitions, 100);
  const load = raw.loadKg === null ? null : round(raw.loadKg, 1000);
  const seconds =
    raw.durationSeconds === null ? null : Math.round(raw.durationSeconds);
  const distance =
    raw.distanceMeters === null ? null : round(raw.distanceMeters, 100);
  if (
    (reps !== null && reps > 9999.99) ||
    (load !== null && load > 9999.999) ||
    (seconds !== null && seconds > 86_400) ||
    (distance !== null && distance > 1_000_000)
  ) {
    return "out_of_range";
  }
  const nonZero = (value: number | null): number | null =>
    value === null || value === 0 ? null : value;
  const set: ImportedSet = {
    setType,
    repetitions: nonZero(reps),
    loadKg: nonZero(load),
    durationSeconds: nonZero(seconds),
    distanceMeters: nonZero(distance),
    perceivedExertion,
  };
  if (
    set.repetitions === null &&
    set.loadKg === null &&
    set.durationSeconds === null &&
    set.distanceMeters === null
  ) {
    return "empty_set";
  }
  return set;
};

/** RPE: blank, 0, out of range or non-numeric all become `null`. */
export const readHistoryRpe = (
  text: string,
  decimalComma: boolean,
): number | null => {
  const value = readHistoryDecimal(text, decimalComma);
  if (value === null || value === "invalid" || value <= 0 || value > 10) {
    return null;
  }
  return Math.round(value * 10) / 10;
};

export const isInvalid = (value: HistoryNumber): value is "invalid" =>
  value === "invalid";

/** Treat a parsed number as `null` when blank. Call only after `isInvalid`. */
export const orNull = (value: HistoryNumber): number | null =>
  value === "invalid" ? null : value;

export interface StrengthRow {
  readonly line: number;
  /** Rows with the same key (in one contiguous run for app exports) form one workout. */
  readonly key: string;
  readonly startMs: number;
  /** End of the workout when the row knows it. */
  readonly endMs: number | null;
  readonly name: string;
  readonly notes: string;
  readonly exercise: string;
  /** File-provided set order (Hevy `set_index`), when present. */
  readonly order: number | null;
  readonly set: ImportedSet;
}

export interface BuildContext {
  readonly now: Date;
  readonly limits: HistoryImportLimitValues;
  readonly issues: ImportIssue[];
}

/** Longest session the import accepts (a workout left running for days). */
const MAX_SESSION_MS = 2 * 86_400_000;

interface ExerciseAccumulator {
  readonly sourceName: string;
  readonly entries: { order: number | null; set: ImportedSet }[];
}

/**
 * Group rows into workouts. App exports (Hevy, Strong) write each workout as
 * a contiguous run of rows, so a workout exported twice is recognised by its
 * repeated external id and skipped as `duplicate`. Hand-made generic files
 * may interleave rows, so `contiguous: false` groups by key across the file.
 */
export const buildStrengthWorkouts = (
  rows: readonly StrengthRow[],
  context: BuildContext,
  externalIdOf: (row: StrengthRow, startedAt: string) => string,
  contiguous = true,
): ImportedWorkout[] => {
  const { limits, issues } = context;
  const blocks: StrengthRow[][] = [];
  const byKey = new Map<string, StrengthRow[]>();
  for (const row of rows) {
    const last = contiguous ? blocks[blocks.length - 1] : byKey.get(row.key);
    if (last && (last[0] as StrengthRow).key === row.key) last.push(row);
    else {
      const block = [row];
      blocks.push(block);
      byKey.set(row.key, block);
    }
  }

  const seen = new Set<string>();
  const workouts: ImportedWorkout[] = [];
  for (const block of blocks) {
    const first = block[0] as StrengthRow;
    const endCandidate = block.find((row) => row.endMs !== null)?.endMs;
    const endMs =
      endCandidate !== undefined &&
      endCandidate !== null &&
      endCandidate >= first.startMs
        ? endCandidate
        : first.startMs;
    if (endMs > context.now.getTime()) {
      issues.push({ line: first.line, code: "future" });
      continue;
    }
    // The import RPC refuses starts before 1970 and sessions over two days.
    if (first.startMs < 0 || endMs - first.startMs > MAX_SESSION_MS) {
      issues.push({ line: first.line, code: "out_of_range" });
      continue;
    }
    const startedAt = new Date(first.startMs).toISOString();
    const externalId = sliceHistoryText(externalIdOf(first, startedAt), 255);
    if (seen.has(externalId)) {
      issues.push({ line: first.line, code: "duplicate" });
      continue;
    }
    seen.add(externalId);

    const byName = new Map<string, ExerciseAccumulator>();
    let setCount = 0;
    let truncated = false;
    for (const row of block) {
      if (setCount >= limits.maxSetsPerWorkout) {
        truncated = true;
        break;
      }
      const id = row.exercise.toLowerCase();
      let accumulator = byName.get(id);
      if (!accumulator) {
        accumulator = { sourceName: row.exercise, entries: [] };
        byName.set(id, accumulator);
      }
      accumulator.entries.push({ order: row.order, set: row.set });
      setCount += 1;
    }
    if (truncated) issues.push({ line: first.line, code: "too_many_sets" });

    const exercises: ImportedExercise[] = [...byName.values()].map(
      (accumulator) => {
        const entries = accumulator.entries.every((e) => e.order !== null)
          ? [...accumulator.entries].sort(
              (a, b) => (a.order as number) - (b.order as number),
            )
          : accumulator.entries;
        return {
          sourceName: accumulator.sourceName,
          sets: entries.map((entry) => entry.set),
        };
      },
    );
    const notes = block.map((row) => row.notes).find((n) => n !== "") ?? "";
    workouts.push({
      externalId,
      name: first.name,
      startedAt,
      completedAt: new Date(endMs).toISOString(),
      notes: notes === "" ? null : sliceHistoryText(notes, 4000),
      exercises,
    });
    if (workouts.length > limits.maxWorkouts) {
      throw new HistoryImportFileError("too_many_records");
    }
  }
  return workouts.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
};

export const normalizeWorkoutName = (value: string): string => {
  const name = collapseHistoryText(value);
  return name === "" ? "Workout" : sliceHistoryText(name, 200);
};

export const normalizeWorkoutNotes = (value: string): string =>
  sliceHistoryText(value.trim(), 4000);

export const mapSetType = (text: string): WorkoutSetType => {
  switch (text.trim().toLowerCase()) {
    case "warmup":
    case "warm-up":
    case "warm up":
    case "w":
      return "warmup";
    case "dropset":
    case "drop set":
    case "drop":
    case "d":
      return "drop";
    case "failure":
    case "f":
      return "failure";
    default:
      return "normal";
  }
};
