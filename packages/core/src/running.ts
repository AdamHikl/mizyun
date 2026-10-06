/** Pure manual-running rules. Timestamp anchors are transport values, not observations. */
export type RunDistanceUnit = "km" | "mi";
export interface RunSummaryCore {
  readonly version: 1;
  readonly activityDate: string;
  readonly recordingTimezone: string;
  readonly timePrecision: "day" | "instant";
  readonly startedAt: string | null;
  readonly durationSeconds: number;
  readonly durationBasis: "elapsed";
  readonly distanceMeters: number | null;
  readonly environment: "outdoor" | "treadmill" | "unspecified";
  readonly perceivedExertion: number | null;
  readonly origin: { readonly kind: "manual" };
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
    s.durationBasis !== "elapsed" ||
    !object(s.origin) ||
    s.origin.kind !== "manual" ||
    Object.keys(s.origin).length !== 1
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
