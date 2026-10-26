/**
 * History import (#333): row mappers for the Hevy, Strong and generic
 * workout CSV formats. Each mapper turns data records into `StrengthRow`s,
 * recording an `ImportIssue` for every record it skips.
 */
import {
  type HistoryImportOptions,
  type ImportIssue,
  type ImportIssueCode,
} from "./history-import";
import {
  collapseHistoryText,
  findHistoryColumn,
  historyDateTimeToUtcMs,
  kgPerWeightUnit,
  metersPerDistanceUnit,
  normalizeDistanceUnit,
  normalizeWeightUnit,
  parseHistoryHeaders,
  readHistoryDecimal,
  readHistoryDuration,
  type CsvRecord,
  type CsvTable,
  type HistoryDistanceUnitName,
  type HistoryHeader,
  type HistoryNumber,
} from "./history-import-csv";
import {
  isInvalid,
  mapSetType,
  normalizeHistorySet,
  normalizeWorkoutName,
  normalizeWorkoutNotes,
  readHistoryRpe,
  type StrengthRow,
} from "./history-import-build";

export interface MapperState {
  readonly options: HistoryImportOptions;
  readonly issues: ImportIssue[];
  /** A non-zero weight was converted with `options.weightUnit`. */
  weightFallback: boolean;
  /** A non-zero distance was converted with `options.distanceUnit`. */
  distanceFallback: boolean;
}

export interface WeightColumn {
  readonly index: number;
  readonly unit: "kg" | "lb" | null;
}
export interface DistanceColumn {
  readonly index: number;
  readonly unit: HistoryDistanceUnitName | null;
}

const WEIGHT_KEYS: Readonly<Record<string, "kg" | "lb" | null>> = {
  weight: null,
  load: null,
  "weight kg": "kg",
  "weight kgs": "kg",
  "weight lb": "lb",
  "weight lbs": "lb",
};
const DISTANCE_KEYS: Readonly<Record<string, HistoryDistanceUnitName | null>> =
  {
    distance: null,
    "distance m": "m",
    "distance meters": "m",
    "distance metres": "m",
    "distance km": "km",
    "distance mi": "mi",
    "distance miles": "mi",
  };

export const locateWeightColumn = (
  headers: readonly HistoryHeader[],
): WeightColumn | null => {
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index] as HistoryHeader;
    if (!(header.key in WEIGHT_KEYS)) continue;
    return {
      index,
      unit: WEIGHT_KEYS[header.key] ?? normalizeWeightUnit(header.unit),
    };
  }
  return null;
};

export const locateDistanceColumn = (
  headers: readonly HistoryHeader[],
): DistanceColumn | null => {
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index] as HistoryHeader;
    if (!(header.key in DISTANCE_KEYS)) continue;
    return {
      index,
      unit: DISTANCE_KEYS[header.key] ?? normalizeDistanceUnit(header.unit),
    };
  }
  return null;
};

export const cellText = (record: CsvRecord, index: number): string =>
  index < 0 ? "" : (record.cells[index] ?? "").trim();

/** Cache of date text -> UTC ms for one parse. */
const makeDateReader = (timeZone: string) => {
  const cache = new Map<string, number | null>();
  return (text: string): number | null => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const ms = historyDateTimeToUtcMs(text, timeZone);
    cache.set(text, ms);
    return ms;
  };
};

const skip = (
  state: MapperState,
  record: CsvRecord,
  code: ImportIssueCode,
): null => {
  state.issues.push({ line: record.line, code });
  return null;
};

interface MeasureInput {
  readonly reps: HistoryNumber;
  readonly weight: HistoryNumber;
  readonly weightUnit: "kg" | "lb" | null;
  readonly duration: HistoryNumber;
  readonly distance: HistoryNumber;
  readonly distanceUnit: HistoryDistanceUnitName | null;
}

/** Convert units and normalize; returns the set or the issue code. */
const finishSet = (
  state: MapperState,
  input: MeasureInput,
  setType: ReturnType<typeof mapSetType>,
  rpe: number | null,
) => {
  if (
    isInvalid(input.reps) ||
    isInvalid(input.weight) ||
    isInvalid(input.duration) ||
    isInvalid(input.distance)
  ) {
    return "invalid_number" as const;
  }
  let weightUnit = input.weightUnit;
  if (weightUnit === null) {
    weightUnit = state.options.weightUnit;
    if (input.weight !== null && input.weight !== 0) {
      state.weightFallback = true;
    }
  }
  let distanceUnit = input.distanceUnit;
  if (distanceUnit === null) {
    distanceUnit = state.options.distanceUnit;
    if (input.distance !== null && input.distance !== 0) {
      state.distanceFallback = true;
    }
  }
  return normalizeHistorySet(
    {
      repetitions: input.reps,
      loadKg:
        input.weight === null
          ? null
          : input.weight * kgPerWeightUnit(weightUnit),
      durationSeconds: input.duration,
      distanceMeters:
        input.distance === null
          ? null
          : input.distance * metersPerDistanceUnit(distanceUnit),
    },
    setType,
    rpe,
  );
};

// ---------------------------------------------------------------- Hevy

export const mapHevyRows = (
  table: CsvTable,
  records: readonly CsvRecord[],
  state: MapperState,
): StrengthRow[] => {
  const headers = parseHistoryHeaders(table.header);
  const dc = table.delimiter === ";";
  const readDate = makeDateReader(state.options.timezone);
  const col = (...keys: string[]): number => findHistoryColumn(headers, keys);
  const iTitle = col("title");
  const iStart = col("start time");
  const iEnd = col("end time");
  const iDescription = col("description");
  const iExercise = col("exercise title");
  const iIndex = col("set index");
  const iType = col("set type");
  const iReps = col("reps");
  const iDuration = col("duration seconds");
  const iRpe = col("rpe");
  const weight = locateWeightColumn(headers);
  const distance = locateDistanceColumn(headers);

  const rows: StrengthRow[] = [];
  for (const record of records) {
    const exercise = collapseHistoryText(cellText(record, iExercise));
    if (exercise === "") {
      skip(state, record, "malformed_row");
      continue;
    }
    const startText = cellText(record, iStart);
    const startMs = readDate(startText);
    if (startMs === null) {
      skip(state, record, "invalid_date");
      continue;
    }
    const endText = cellText(record, iEnd);
    const endMs = endText === "" ? null : readDate(endText);
    const set = finishSet(
      state,
      {
        reps: readHistoryDecimal(cellText(record, iReps), dc),
        weight: weight
          ? readHistoryDecimal(cellText(record, weight.index), dc)
          : null,
        weightUnit: weight?.unit ?? null,
        duration: readHistoryDecimal(cellText(record, iDuration), dc),
        distance: distance
          ? readHistoryDecimal(cellText(record, distance.index), dc)
          : null,
        distanceUnit: distance?.unit ?? null,
      },
      mapSetType(cellText(record, iType)),
      readHistoryRpe(cellText(record, iRpe), dc),
    );
    if (typeof set === "string") {
      skip(state, record, set);
      continue;
    }
    const order = readHistoryDecimal(cellText(record, iIndex), dc);
    rows.push({
      line: record.line,
      key: `${cellText(record, iTitle)}\u0000${startText}`,
      startMs,
      endMs,
      name: normalizeWorkoutName(cellText(record, iTitle)),
      notes: normalizeWorkoutNotes(cellText(record, iDescription)),
      exercise,
      order: typeof order === "number" ? order : null,
      set,
    });
  }
  return rows;
};

// -------------------------------------------------------------- Strong

const STRONG_SKIP = Symbol("skip");

const strongSetType = (
  text: string,
): ReturnType<typeof mapSetType> | typeof STRONG_SKIP => {
  const value = text.trim();
  if (/^\d+(?:\.0+)?$/.test(value)) return "normal";
  switch (value.toLowerCase()) {
    case "w":
      return "warmup";
    case "d":
      return "drop";
    case "f":
      return "failure";
    default:
      return STRONG_SKIP;
  }
};

export const mapStrongRows = (
  table: CsvTable,
  records: readonly CsvRecord[],
  state: MapperState,
): StrengthRow[] => {
  const headers = parseHistoryHeaders(table.header);
  const dc = table.delimiter === ";";
  const readDate = makeDateReader(state.options.timezone);
  const col = (...keys: string[]): number => findHistoryColumn(headers, keys);
  const iNumber = col("workout #", "workout");
  const iDate = col("date");
  const iName = col("workout name");
  const iDuration = col("duration");
  const iExercise = col("exercise name");
  const iOrder = col("set order");
  const iReps = col("reps");
  const iSeconds = col("seconds");
  const iRpe = col("rpe");
  const iWorkoutNotes = col("workout notes");
  const iWeightUnit = col("weight unit");
  const iDistanceUnit = col("distance unit");
  const weight = locateWeightColumn(headers);
  const distance = locateDistanceColumn(headers);
  const durationIsPlainSeconds = /^(sec|secs|seconds|s)$/.test(
    (headers[iDuration]?.unit ?? "").toLowerCase(),
  );

  const rows: StrengthRow[] = [];
  for (const record of records) {
    const setType = strongSetType(cellText(record, iOrder));
    if (setType === STRONG_SKIP) continue;
    const exercise = collapseHistoryText(cellText(record, iExercise));
    if (exercise === "") {
      skip(state, record, "malformed_row");
      continue;
    }
    const dateText = cellText(record, iDate);
    const startMs = readDate(dateText);
    if (startMs === null) {
      skip(state, record, "invalid_date");
      continue;
    }
    const durationValue = durationIsPlainSeconds
      ? readHistoryDecimal(cellText(record, iDuration), dc)
      : readHistoryDuration(cellText(record, iDuration), dc);
    const workoutSeconds =
      typeof durationValue === "number" && durationValue > 0
        ? Math.round(durationValue)
        : null;
    const set = finishSet(
      state,
      {
        reps: readHistoryDecimal(cellText(record, iReps), dc),
        weight: weight
          ? readHistoryDecimal(cellText(record, weight.index), dc)
          : null,
        weightUnit:
          normalizeWeightUnit(cellText(record, iWeightUnit)) ??
          weight?.unit ??
          null,
        duration: readHistoryDecimal(cellText(record, iSeconds), dc),
        distance: distance
          ? readHistoryDecimal(cellText(record, distance.index), dc)
          : null,
        distanceUnit:
          normalizeDistanceUnit(cellText(record, iDistanceUnit)) ??
          distance?.unit ??
          null,
      },
      setType,
      readHistoryRpe(cellText(record, iRpe), dc),
    );
    if (typeof set === "string") {
      skip(state, record, set);
      continue;
    }
    const nameText = cellText(record, iName);
    rows.push({
      line: record.line,
      key: `${cellText(record, iNumber)}\u0000${dateText}\u0000${nameText}`,
      startMs,
      endMs: workoutSeconds === null ? null : startMs + workoutSeconds * 1000,
      name: normalizeWorkoutName(nameText),
      notes: normalizeWorkoutNotes(cellText(record, iWorkoutNotes)),
      exercise,
      order: null,
      set,
    });
  }
  return rows;
};

// ------------------------------------------------------------- generic

export const GENERIC_DATE_KEYS = [
  "date",
  "start",
  "started at",
  "start time",
  "datetime",
  "date time",
] as const;
export const GENERIC_EXERCISE_KEYS = [
  "exercise",
  "exercise name",
  "exercise title",
] as const;

/**
 * Mizyun generic workout CSV. One row per set; header names are matched
 * case-insensitively and may use `_`, `-` or spaces.
 *
 * Required columns:
 * - `date` (aliases `start`, `started_at`, `start_time`, `datetime`):
 *   `2026-10-26 07:30[:00]`, `2026-10-26T07:30Z`, `26 Oct 2026, 07:30`,
 *   `Oct 26, 2026, 7:30 AM`, or a date alone (`2026-10-26`, 12:00 local).
 *   Local times use the importing user's time zone; ISO offsets are honoured.
 * - `exercise` (aliases `exercise_name`, `exercise_title`)
 *
 * Optional columns:
 * - `workout` (`workout_name`, `title`): defaults to "Workout". Rows with the
 *   same date text and workout name, next to each other, form one workout.
 * - `set_type` (`type`): normal | warmup | drop | dropset | failure | w | d | f
 * - `reps` (`repetitions`)
 * - `weight` (`load`, `weight_kg`, `weight_lb`, `weight_lbs`), with a
 *   per-row `weight_unit` (kg | lb | lbs); a column suffix names the unit
 * - `duration_seconds` (`duration`, `seconds`): plain seconds, `1h 5m`,
 *   `mm:ss` or `hh:mm:ss`
 * - `distance` (`distance_m`, `distance_km`, `distance_mi`), with a per-row
 *   `distance_unit` (m | km | mi)
 * - `rpe`: 0-10
 * - `notes`: workout-level notes
 *
 * A weight or distance without a unit uses the import options and clears
 * `unitsFromFile`. Workout identity is `<start instant>|<name>`.
 */
export const mapGenericRows = (
  table: CsvTable,
  records: readonly CsvRecord[],
  state: MapperState,
): StrengthRow[] => {
  const headers = parseHistoryHeaders(table.header);
  const dc = table.delimiter === ";";
  const readDate = makeDateReader(state.options.timezone);
  const col = (...keys: readonly string[]): number =>
    findHistoryColumn(headers, keys);
  const iDate = col(...GENERIC_DATE_KEYS);
  const iName = col("workout", "workout name", "title");
  const iExercise = col(...GENERIC_EXERCISE_KEYS);
  const iType = col("set type", "type");
  const iReps = col("reps", "repetitions");
  const iDuration = col(
    "duration seconds",
    "duration",
    "seconds",
    "duration sec",
  );
  const iRpe = col("rpe");
  const iNotes = col("notes");
  const iWeightUnit = col("weight unit");
  const iDistanceUnit = col("distance unit");
  const weight = locateWeightColumn(headers);
  const distance = locateDistanceColumn(headers);

  const rows: StrengthRow[] = [];
  for (const record of records) {
    const exercise = collapseHistoryText(cellText(record, iExercise));
    if (exercise === "") {
      skip(state, record, "malformed_row");
      continue;
    }
    const dateText = cellText(record, iDate);
    const startMs = readDate(dateText);
    if (startMs === null) {
      skip(state, record, "invalid_date");
      continue;
    }
    const set = finishSet(
      state,
      {
        reps: readHistoryDecimal(cellText(record, iReps), dc),
        weight: weight
          ? readHistoryDecimal(cellText(record, weight.index), dc)
          : null,
        weightUnit:
          normalizeWeightUnit(cellText(record, iWeightUnit)) ??
          weight?.unit ??
          null,
        duration: readHistoryDuration(cellText(record, iDuration), dc),
        distance: distance
          ? readHistoryDecimal(cellText(record, distance.index), dc)
          : null,
        distanceUnit:
          normalizeDistanceUnit(cellText(record, iDistanceUnit)) ??
          distance?.unit ??
          null,
      },
      mapSetType(cellText(record, iType)),
      readHistoryRpe(cellText(record, iRpe), dc),
    );
    if (typeof set === "string") {
      skip(state, record, set);
      continue;
    }
    const name = normalizeWorkoutName(cellText(record, iName));
    rows.push({
      line: record.line,
      key: `${dateText}\u0000${name}`,
      startMs,
      endMs: null,
      name,
      notes: normalizeWorkoutNotes(cellText(record, iNotes)),
      exercise,
      order: null,
      set,
    });
  }
  return rows;
};
