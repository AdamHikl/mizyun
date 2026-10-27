/** Pure running rules. Timestamp anchors are transport values, not observations. */
export type RunDistanceUnit = "km" | "mi";
export type RunImportProviderCore = "apple_health" | "health_connect";
export interface RunHealthImportOriginCore {
  readonly kind: "health_import";
  readonly provider: RunImportProviderCore;
  readonly sourceAppId: string;
  readonly sourceAppName: string | null;
  readonly externalId: string;
}
/** A run from the user's own Strava account export (ADR-0083), never the API. */
export interface RunFileImportOriginCore {
  readonly kind: "file_import";
  readonly format: "strava";
  readonly externalId: string;
}
export type RunOriginCore =
  | { readonly kind: "manual" }
  | RunHealthImportOriginCore
  | RunFileImportOriginCore;
export interface RunSummaryCore {
  readonly version: 1;
  readonly activityDate: string;
  readonly recordingTimezone: string;
  readonly timePrecision: "day" | "instant";
  readonly startedAt: string | null;
  readonly durationSeconds: number;
  readonly durationBasis: "elapsed" | "active";
  readonly distanceMeters: number | null;
  readonly environment: "outdoor" | "treadmill" | "unspecified";
  readonly perceivedExertion: number | null;
  readonly origin: RunOriginCore;
  readonly timestampEnvelope: "observed" | "date_anchor";
  readonly revision: number;
}
export interface RunSummaryInput {
  readonly activityDate: string;
  readonly recordingTimezone: string;
  readonly startedAt: string | null;
  readonly durationSeconds: number;
  readonly distanceMeters: number | null;
  readonly environment: RunSummaryCore["environment"];
  readonly perceivedExertion: number | null;
}
export const validRunningDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};
export const runningDate = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= max &&
  value.trim() === value;
/** Strictly read a run origin: exact keys, closed provider enum and bounded identifiers. */
const validRunOrigin = (value: unknown): value is RunOriginCore => {
  if (!object(value)) return false;
  const keys = Object.keys(value);
  if (value.kind === "manual") return keys.length === 1;
  if (value.kind === "file_import")
    return (
      keys.length === 3 &&
      ["kind", "format", "externalId"].every((key) => keys.includes(key)) &&
      value.format === "strava" &&
      boundedText(value.externalId, 255)
    );
  const importKeys = [
    "kind",
    "provider",
    "sourceAppId",
    "sourceAppName",
    "externalId",
  ];
  return (
    value.kind === "health_import" &&
    keys.length === importKeys.length &&
    keys.every((key) => importKeys.includes(key)) &&
    (value.provider === "apple_health" ||
      value.provider === "health_connect") &&
    boundedText(value.sourceAppId, 255) &&
    boundedText(value.externalId, 255) &&
    (value.sourceAppName === null || boundedText(value.sourceAppName, 200))
  );
};
/** Health or file imports: their recorded facts are read-only. */
export const isImportedRunSummary = (
  summary: RunSummaryCore,
): summary is RunSummaryCore & {
  readonly origin: RunHealthImportOriginCore | RunFileImportOriginCore;
} => summary.origin.kind !== "manual";
export const hasRunningActivity = (
  details: Readonly<Record<string, unknown>>,
): boolean => details.activityType === "running";
export const readRunSummary = (
  details: Readonly<Record<string, unknown>>,
): RunSummaryCore | null => {
  if (!hasRunningActivity(details) || !object(details.runSummary)) return null;
  const s = details.runSummary;
  const keys = [
    "version",
    "activityDate",
    "recordingTimezone",
    "timePrecision",
    "startedAt",
    "durationSeconds",
    "durationBasis",
    "distanceMeters",
    "environment",
    "perceivedExertion",
    "origin",
    "timestampEnvelope",
    "revision",
  ];
  if (
    Object.keys(s).length !== keys.length ||
    Object.keys(s).some((key) => !keys.includes(key))
  )
    return null;
  if (
    s.version !== 1 ||
    typeof s.activityDate !== "string" ||
    !validRunningDate(s.activityDate) ||
    typeof s.recordingTimezone !== "string" ||
    (s.durationBasis !== "elapsed" && s.durationBasis !== "active") ||
    !validRunOrigin(s.origin)
  )
    return null;
  // Manual runs record elapsed time; imported provider facts need an observed start.
  if (
    s.origin.kind === "manual"
      ? s.durationBasis !== "elapsed"
      : s.timePrecision !== "instant" ||
        (s.origin.kind === "file_import" && s.durationBasis !== "elapsed")
  )
    return null;
  if (
    typeof s.durationSeconds !== "number" ||
    !Number.isInteger(s.durationSeconds) ||
    s.durationSeconds < 1 ||
    s.durationSeconds > 86400 ||
    typeof s.revision !== "number" ||
    !Number.isInteger(s.revision) ||
    s.revision < 1
  )
    return null;
  if (
    s.distanceMeters !== null &&
    (typeof s.distanceMeters !== "number" ||
      !Number.isFinite(s.distanceMeters) ||
      s.distanceMeters <= 0 ||
      s.distanceMeters > 1000000 ||
      Math.abs(s.distanceMeters * 100 - Math.round(s.distanceMeters * 100)) >
        1e-6)
  )
    return null;
  if (
    s.perceivedExertion !== null &&
    (typeof s.perceivedExertion !== "number" ||
      !Number.isFinite(s.perceivedExertion) ||
      s.perceivedExertion < 0 ||
      s.perceivedExertion > 10 ||
      Math.abs(
        s.perceivedExertion * 10 - Math.round(s.perceivedExertion * 10),
      ) > 1e-6)
  )
    return null;
  if (!["outdoor", "treadmill", "unspecified"].includes(String(s.environment)))
    return null;
  if (s.timePrecision === "day") {
    if (s.startedAt !== null || s.timestampEnvelope !== "date_anchor")
      return null;
  } else if (s.timePrecision === "instant") {
    if (
      typeof s.startedAt !== "string" ||
      !Number.isFinite(Date.parse(s.startedAt)) ||
      s.timestampEnvelope !== "observed"
    )
      return null;
  } else return null;
  try {
    runningDate(new Date(0), s.recordingTimezone);
    if (
      s.startedAt !== null &&
      runningDate(new Date(String(s.startedAt)), s.recordingTimezone) !==
        s.activityDate
    )
      return null;
  } catch {
    return null;
  }
  return s as unknown as RunSummaryCore;
};
export const createRunSummary = (
  input: RunSummaryInput,
  revision = 1,
): RunSummaryCore => {
  const summary: RunSummaryCore = {
    activityDate: input.activityDate,
    recordingTimezone: input.recordingTimezone,
    startedAt: input.startedAt,
    durationSeconds: input.durationSeconds,
    distanceMeters: input.distanceMeters,
    environment: input.environment,
    perceivedExertion: input.perceivedExertion,
    version: 1,
    durationBasis: "elapsed",
    origin: { kind: "manual" },
    revision,
    timePrecision: input.startedAt === null ? "day" : "instant",
    timestampEnvelope: input.startedAt === null ? "date_anchor" : "observed",
  };
  if (!readRunSummary({ activityType: "running", runSummary: summary }))
    throw new Error("Invalid running summary");
  if (
    summary.startedAt !== null &&
    runningDate(new Date(summary.startedAt), summary.recordingTimezone) !==
      summary.activityDate
  )
    throw new Error("Run start does not match its activity date");
  return summary;
};
export interface ImportedRunSummaryInput {
  readonly provider: RunImportProviderCore;
  readonly sourceAppId: string;
  readonly sourceAppName: string | null;
  readonly externalId: string;
  readonly startedAt: string;
  readonly recordingTimezone: string;
  readonly durationSeconds: number;
  readonly durationBasis: "elapsed" | "active";
  readonly distanceMeters: number | null;
  readonly environment: RunSummaryCore["environment"];
}
/**
 * Build the summary for one user-selected Health workout. The activity date is
 * the local date of the observed start in the recording timezone.
 */
export const createImportedRunSummary = (
  input: ImportedRunSummaryInput,
): RunSummaryCore => {
  const start = new Date(input.startedAt);
  if (!Number.isFinite(start.getTime()))
    throw new Error("Invalid imported run start");
  const summary: RunSummaryCore = {
    version: 1,
    activityDate: runningDate(start, input.recordingTimezone),
    recordingTimezone: input.recordingTimezone,
    timePrecision: "instant",
    startedAt: input.startedAt,
    durationSeconds: input.durationSeconds,
    durationBasis: input.durationBasis,
    distanceMeters: input.distanceMeters,
    environment: input.environment,
    perceivedExertion: null,
    origin: {
      kind: "health_import",
      provider: input.provider,
      sourceAppId: input.sourceAppId,
      sourceAppName: input.sourceAppName,
      externalId: input.externalId,
    },
    timestampEnvelope: "observed",
    revision: 1,
  };
  if (!readRunSummary({ activityType: "running", runSummary: summary }))
    throw new Error("Invalid imported running summary");
  return summary;
};
/**
 * Build the summary for one run from the user's own Strava export (ADR-0083).
 * The start is kept to the second, as the SQL import stores it.
 */
export const createFileImportedRunSummary = (input: {
  readonly externalId: string;
  readonly startedAt: string;
  readonly recordingTimezone: string;
  readonly durationSeconds: number;
  readonly distanceMeters: number | null;
  readonly environment: RunSummaryCore["environment"];
}): RunSummaryCore => {
  const ms = Date.parse(input.startedAt);
  if (!Number.isFinite(ms)) throw new Error("Invalid imported run start");
  const start = new Date(Math.floor(ms / 1000) * 1000);
  const summary: RunSummaryCore = {
    version: 1,
    activityDate: runningDate(start, input.recordingTimezone),
    recordingTimezone: input.recordingTimezone,
    timePrecision: "instant",
    startedAt: `${start.toISOString().slice(0, 19)}Z`,
    durationSeconds: input.durationSeconds,
    durationBasis: "elapsed",
    distanceMeters: input.distanceMeters,
    environment: input.environment,
    perceivedExertion: null,
    origin: {
      kind: "file_import",
      format: "strava",
      externalId: input.externalId,
    },
    timestampEnvelope: "observed",
    revision: 1,
  };
  if (!readRunSummary({ activityType: "running", runSummary: summary }))
    throw new Error("Invalid imported running summary");
  return summary;
};
/** Provider facts an imported run keeps for its whole life. */
export const sameImportedRunMetrics = (
  a: RunSummaryCore,
  b: RunSummaryCore,
): boolean => {
  if (a.origin.kind === "manual" || b.origin.kind === "manual") return false;
  const sameOrigin =
    a.origin.kind === "health_import" && b.origin.kind === "health_import"
      ? a.origin.provider === b.origin.provider &&
        a.origin.sourceAppId === b.origin.sourceAppId &&
        a.origin.sourceAppName === b.origin.sourceAppName &&
        a.origin.externalId === b.origin.externalId
      : a.origin.kind === "file_import" && b.origin.kind === "file_import"
        ? a.origin.format === b.origin.format &&
          a.origin.externalId === b.origin.externalId
        : false;
  return (
    sameOrigin &&
    a.activityDate === b.activityDate &&
    a.recordingTimezone === b.recordingTimezone &&
    a.timePrecision === b.timePrecision &&
    a.startedAt === b.startedAt &&
    a.durationSeconds === b.durationSeconds &&
    a.durationBasis === b.durationBasis &&
    a.distanceMeters === b.distanceMeters
  );
};
/** Apply the user-editable fields to a stored imported run, keeping its provider facts. */
export const reviseImportedRunSummary = (
  stored: RunSummaryCore,
  edits: {
    readonly environment: RunSummaryCore["environment"];
    readonly perceivedExertion: number | null;
  },
  revision: number,
): RunSummaryCore => {
  if (stored.origin.kind === "manual")
    throw new Error("Only imported runs keep provider metrics");
  const summary: RunSummaryCore = {
    ...stored,
    environment: edits.environment,
    perceivedExertion: edits.perceivedExertion,
    revision,
  };
  if (!readRunSummary({ activityType: "running", runSummary: summary }))
    throw new Error("Invalid imported running summary");
  return summary;
};
/** Resolve local noon without assuming a fixed DST offset. Verify the resulting local day. */
export const runTimestampEnvelope = (
  summary: RunSummaryCore,
): { startedAt: Date; completedAt: Date } => {
  if (summary.startedAt !== null) {
    const startedAt = new Date(summary.startedAt);
    return {
      startedAt,
      completedAt: new Date(
        startedAt.getTime() + summary.durationSeconds * 1000,
      ),
    };
  }
  const wanted = Date.parse(`${summary.activityDate}T12:00:00Z`);
  let guess = wanted;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: summary.recordingTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(guess);
    const get = (key: string): string =>
      parts.find((p) => p.type === key)?.value ?? "";
    const local = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
    );
    const delta = wanted - local;
    if (delta === 0) break;
    guess += delta;
  }
  const parts = formatter.formatToParts(guess);
  if (
    runningDate(new Date(guess), summary.recordingTimezone) !==
      summary.activityDate ||
    parts.find((p) => p.type === "hour")?.value !== "12"
  )
    throw new Error("The selected local date is unavailable");
  return { startedAt: new Date(guess), completedAt: new Date(guess) };
};
export const metresFromDistance = (
  value: number,
  unit: RunDistanceUnit,
): number => Math.round(value * (unit === "km" ? 1000 : 1609.344) * 100) / 100;
export const distanceFromMetres = (
  value: number,
  unit: RunDistanceUnit,
): number => value / (unit === "km" ? 1000 : 1609.344);
export const formatRunPace = (
  seconds: number,
  metres: number | null,
  unit: RunDistanceUnit,
): string | null => {
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    metres === null ||
    !Number.isFinite(metres) ||
    metres <= 0
  )
    return null;
  const pace = Math.round(seconds / distanceFromMetres(metres, unit));
  return `${Math.floor(pace / 60)}:${String(pace % 60).padStart(2, "0")} /${unit}`;
};
export const formatRunDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
    : `${minutes}:${String(total % 60).padStart(2, "0")}`;
};
export const summarizeRuns = (
  runs: ReadonlyArray<{ readonly summary: RunSummaryCore }>,
  from: string,
  to: string,
): {
  count: number;
  durationSeconds: number;
  distanceMeters: number;
  missingDistanceCount: number;
} => {
  let count = 0,
    durationSeconds = 0,
    distanceMeters = 0,
    missingDistanceCount = 0;
  for (const { summary: s } of runs) {
    if (s.activityDate < from || s.activityDate > to) continue;
    count++;
    durationSeconds += s.durationSeconds;
    if (s.distanceMeters === null) missingDistanceCount++;
    else distanceMeters += s.distanceMeters;
  }
  return { count, durationSeconds, distanceMeters, missingDistanceCount };
};
