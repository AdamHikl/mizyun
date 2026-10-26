/**
 * History import (#333): Strava account-export `activities.csv` runs.
 * Only the CSV is read; GPS activity files named in `Filename` are never
 * opened. Rows are read by position because the export repeats the
 * `Elapsed Time` and `Distance` column names.
 */
import {
  HistoryImportFileError,
  type HistoryImportOptions,
  type ImportIssue,
  type ImportedRun,
  type ImportedRunEnvironment,
} from "./history-import";
import {
  collapseHistoryText,
  sliceHistoryText,
  countHistoryColumns,
  findHistoryColumn,
  findLastHistoryColumn,
  METERS_PER_MILE,
  parseHistoryDateTime,
  parseHistoryHeaders,
  readHistoryDecimal,
  type CsvRecord,
  type CsvTable,
  type HistoryImportLimitValues,
} from "./history-import-csv";

export interface StravaParseResult {
  readonly runs: ImportedRun[];
  readonly skippedActivities: Record<string, number>;
  /** True when the distance column is in `options.distanceUnit`. */
  readonly distanceFallback: boolean;
}

export const hasStravaColumns = (table: CsvTable): boolean => {
  const headers = parseHistoryHeaders(table.header);
  return (
    findHistoryColumn(headers, ["activity id"]) >= 0 &&
    findHistoryColumn(headers, ["activity type"]) >= 0 &&
    findHistoryColumn(headers, ["activity date"]) >= 0 &&
    findHistoryColumn(headers, ["elapsed time"]) >= 0
  );
};

const RUN_TYPES: Readonly<Record<string, "outdoor" | "treadmill" | "run">> = {
  run: "run",
  trailrun: "outdoor",
  virtualrun: "treadmill",
};

export const parseStravaRuns = (
  table: CsvTable,
  records: readonly CsvRecord[],
  options: HistoryImportOptions,
  limits: HistoryImportLimitValues,
  issues: ImportIssue[],
): StravaParseResult => {
  const headers = parseHistoryHeaders(table.header);
  const iId = findHistoryColumn(headers, ["activity id"]);
  const iDate = findHistoryColumn(headers, ["activity date"]);
  const iName = findHistoryColumn(headers, ["activity name"]);
  const iType = findHistoryColumn(headers, ["activity type"]);
  const iFile = findHistoryColumn(headers, ["filename"]);
  const iElapsed = findLastHistoryColumn(headers, ["elapsed time"]);
  const iDistance = findLastHistoryColumn(headers, ["distance"]);
  const distanceInMeters = countHistoryColumns(headers, "distance") >= 2;
  const distanceFactor = distanceInMeters
    ? 1
    : options.distanceUnit === "km"
      ? 1000
      : METERS_PER_MILE;
  const at = (record: CsvRecord, index: number): string =>
    index < 0 ? "" : (record.cells[index] ?? "").trim();

  const runs: ImportedRun[] = [];
  const skipped: Record<string, number> = {};
  const seen = new Set<string>();
  let distanceFallback = false;

  for (const record of records) {
    const typeText = at(record, iType);
    const typeKey = typeText.toLowerCase().replace(/[\s_]+/g, "");
    const kind = RUN_TYPES[typeKey];
    if (kind === undefined) {
      const label = typeText === "" ? "Unknown" : typeText;
      skipped[label] = (skipped[label] ?? 0) + 1;
      continue;
    }
    const fail = (code: ImportIssue["code"]): void => {
      issues.push({ line: record.line, code });
    };

    const id = at(record, iId);
    if (id === "" || id.length > 255) {
      fail("malformed_row");
      continue;
    }
    if (seen.has(id)) {
      fail("duplicate");
      continue;
    }
    seen.add(id);

    // Assumption (verify with a real export): `Activity Date` is written in
    // UTC, e.g. "Oct 26, 2026, 7:30:00 AM", so it is not shifted by the
    // user's time zone. ISO strings with an offset are honoured as written.
    const parsedDate = parseHistoryDateTime(at(record, iDate));
    if (parsedDate === null) {
      fail("invalid_date");
      continue;
    }
    const startMs =
      parsedDate.kind === "instant"
        ? parsedDate.ms
        : Date.UTC(
            parsedDate.local.year,
            parsedDate.local.month - 1,
            parsedDate.local.day,
            parsedDate.local.hour,
            parsedDate.local.minute,
            parsedDate.local.second,
          );

    const elapsed = readHistoryDecimal(at(record, iElapsed), false);
    const distance = readHistoryDecimal(at(record, iDistance), false);
    if (elapsed === "invalid" || distance === "invalid") {
      fail("invalid_number");
      continue;
    }
    const durationSeconds = elapsed === null ? 0 : Math.round(elapsed);
    if (durationSeconds < 1 || durationSeconds > 86_400) {
      fail("out_of_range");
      continue;
    }
    if (distance !== null && distance < 0) {
      fail("out_of_range");
      continue;
    }
    const meters =
      distance === null ? 0 : Math.round(distance * distanceFactor * 100) / 100;
    if (meters > 1_000_000) {
      fail("out_of_range");
      continue;
    }
    // The import RPC refuses runs before 1970; keep them out of the plan.
    if (!Number.isFinite(startMs) || startMs < 0) {
      fail("out_of_range");
      continue;
    }
    if (startMs + durationSeconds * 1000 > options.now.getTime()) {
      fail("future");
      continue;
    }
    if (!distanceInMeters && meters > 0) distanceFallback = true;

    const environment: ImportedRunEnvironment =
      kind === "treadmill"
        ? "treadmill"
        : kind === "outdoor"
          ? "outdoor"
          : at(record, iFile) !== ""
            ? "outdoor"
            : "unspecified";
    const name = sliceHistoryText(collapseHistoryText(at(record, iName)), 200);
    runs.push({
      externalId: id,
      name: name === "" ? "Run" : name,
      startedAt: new Date(startMs).toISOString(),
      durationSeconds,
      distanceMeters: meters > 0 ? meters : null,
      environment,
    });
    if (runs.length > limits.maxRuns) {
      throw new HistoryImportFileError("too_many_records");
    }
  }
  runs.sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
  );
  return { runs, skippedActivities: skipped, distanceFallback };
};
