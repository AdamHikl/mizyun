/**
 * History import (#333): format detection and the single entry point that
 * turns one exported CSV (Hevy, Strong, Strava `activities.csv` or the
 * Mizyun generic format) into normalized workouts and runs. Pure: no I/O.
 */
import {
  HISTORY_IMPORT_FORMATS,
  HistoryImportFileError,
  type HistoryImportFormat,
  type HistoryImportOptions,
  type ImportIssue,
  type ParsedHistory,
} from "./history-import";
import {
  buildStrengthWorkouts,
  type StrengthRow,
} from "./history-import-build";
import {
  isValidHistoryTimezone,
  parseHistoryHeaders,
  findHistoryColumn,
  readHistoryCsv,
  resolveHistoryImportLimits,
  type CsvRecord,
  type CsvTable,
  type HistoryImportLimitOverrides,
} from "./history-import-csv";
import {
  GENERIC_DATE_KEYS,
  GENERIC_EXERCISE_KEYS,
  mapGenericRows,
  mapHevyRows,
  mapStrongRows,
  type MapperState,
} from "./history-import-strength";
import { hasStravaColumns, parseStravaRuns } from "./history-import-strava";

const has = (
  headers: ReturnType<typeof parseHistoryHeaders>,
  keys: readonly string[],
): boolean => findHistoryColumn(headers, keys) >= 0;

/** Which format a header row looks like, or `null`. */
export const detectHistoryFormat = (
  headerCells: readonly string[],
): HistoryImportFormat | null => {
  const headers = parseHistoryHeaders(headerCells);
  if (has(headers, ["activity id"]) && has(headers, ["activity type"])) {
    return "strava";
  }
  if (has(headers, ["exercise title"]) && has(headers, ["start time"])) {
    return "hevy";
  }
  if (has(headers, ["exercise name"]) && has(headers, ["set order"])) {
    return "strong";
  }
  if (has(headers, GENERIC_DATE_KEYS) && has(headers, GENERIC_EXERCISE_KEYS)) {
    return "generic";
  }
  return null;
};

const hasRequiredColumns = (
  format: HistoryImportFormat,
  table: CsvTable,
): boolean => {
  const headers = parseHistoryHeaders(table.header);
  switch (format) {
    case "strava":
      return hasStravaColumns(table);
    case "hevy":
      return has(headers, ["exercise title"]) && has(headers, ["start time"]);
    case "strong":
      return (
        has(headers, ["exercise name"]) &&
        has(headers, ["set order"]) &&
        has(headers, ["date"])
      );
    case "generic":
      return (
        has(headers, GENERIC_DATE_KEYS) && has(headers, GENERIC_EXERCISE_KEYS)
      );
  }
};

/**
 * Records with the wrong number of cells: fewer cells than the header are
 * padded, extra cells are accepted only when empty, anything else (or an
 * oversize record) is a `malformed_row` issue and is dropped.
 */
const usableRecords = (table: CsvTable, issues: ImportIssue[]): CsvRecord[] => {
  const width = table.header.length;
  const usable: CsvRecord[] = [];
  for (const record of table.records) {
    if (record.oversize) {
      issues.push({ line: record.line, code: "malformed_row" });
      continue;
    }
    if (record.cells.length > width) {
      const extras = record.cells.slice(width);
      if (extras.some((cell) => cell.trim() !== "")) {
        issues.push({ line: record.line, code: "malformed_row" });
        continue;
      }
    }
    usable.push(
      record.cells.length >= width
        ? record
        : {
            ...record,
            cells: [
              ...record.cells,
              ...Array.from({ length: width - record.cells.length }, () => ""),
            ],
          },
    );
  }
  return usable;
};

/**
 * Parse one exported file. Detects the format from the header when `format`
 * is omitted. Throws `HistoryImportFileError` when the whole file is
 * unusable; row problems come back as `issues`. `limitOverrides` exists so
 * tests can exercise the limits with small inputs.
 */
export const parseHistoryFile = (
  content: string,
  options: HistoryImportOptions,
  format?: HistoryImportFormat,
  limitOverrides?: HistoryImportLimitOverrides,
): ParsedHistory => {
  if (!isValidHistoryTimezone(options.timezone)) {
    throw new HistoryImportFileError("invalid_timezone");
  }
  const limits = resolveHistoryImportLimits(limitOverrides);
  const table = readHistoryCsv(content, limitOverrides);
  const resolved = format ?? detectHistoryFormat(table.header);
  if (resolved === null || !HISTORY_IMPORT_FORMATS.includes(resolved)) {
    throw new HistoryImportFileError("unknown_format");
  }
  if (!hasRequiredColumns(resolved, table)) {
    throw new HistoryImportFileError("missing_columns");
  }
  if (table.records.length === 0) throw new HistoryImportFileError("empty");

  const issues: ImportIssue[] = [];
  const records = usableRecords(table, issues);

  if (resolved === "strava") {
    const result = parseStravaRuns(table, records, options, limits, issues);
    return {
      format: "strava",
      workouts: [],
      runs: result.runs,
      issues: sortIssues(issues),
      skippedActivities: result.skippedActivities,
      unitsFromFile: !result.distanceFallback,
    };
  }

  const state: MapperState = {
    options,
    issues,
    weightFallback: false,
    distanceFallback: false,
  };
  const rows: StrengthRow[] =
    resolved === "hevy"
      ? mapHevyRows(table, records, state)
      : resolved === "strong"
        ? mapStrongRows(table, records, state)
        : mapGenericRows(table, records, state);
  const workouts = buildStrengthWorkouts(
    rows,
    { now: options.now, limits, issues },
    resolved === "generic"
      ? (row, startedAt) => `${startedAt}|${row.name}`
      : (_row, startedAt) => startedAt,
    resolved !== "generic",
  );
  return {
    format: resolved,
    workouts,
    runs: [],
    issues: sortIssues(issues),
    skippedActivities: {},
    unitsFromFile: !state.weightFallback && !state.distanceFallback,
  };
};

const sortIssues = (issues: readonly ImportIssue[]): ImportIssue[] =>
  [...issues].sort((a, b) => a.line - b.line);
