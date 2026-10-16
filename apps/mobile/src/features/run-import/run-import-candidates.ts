import {
  isStorableRunTimezone,
  runImportSchema,
  type RunImport,
  type RunRecord,
} from "@mizyun/contracts";
import { runningDate } from "@mizyun/core";

export type RunImportProvider = RunImport["provider"];

/** A Health run that passed bridge validation. Held in memory only. */
export interface RunImportCandidate {
  readonly key: string;
  readonly provider: RunImportProvider;
  readonly sourceAppId: string;
  readonly sourceAppName: string | null;
  readonly externalId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly activityDate: string;
  readonly recordingTimezone: string;
  readonly durationSeconds: number;
  readonly durationBasis: "active" | "elapsed";
  readonly distanceMeters: number | null;
  readonly environment: RunImport["environment"];
  /** This exact Health record is already a run in the account. */
  readonly alreadyImported: boolean;
  /** A logged run overlaps it; the user decides whether to add it. */
  readonly possibleDuplicate: boolean;
}

const MAX_CANDIDATES = 500;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max
    ? value.trim()
    : null;
const validZone = (zone: unknown): string | null => {
  if (
    typeof zone !== "string" ||
    zone.length > 100 ||
    !isStorableRunTimezone(zone)
  )
    return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return null;
  }
};

export const candidateKey = (
  provider: string,
  sourceAppId: string,
  externalId: string,
) => JSON.stringify([provider, sourceAppId, externalId]);

const interval = (run: RunRecord): { start: number; end: number } | null => {
  if (!run.summary.startedAt) return null;
  const start = Date.parse(run.summary.startedAt);
  return { start, end: start + run.summary.durationSeconds * 1000 };
};

/**
 * Validate raw bridge records and flag overlaps with existing runs. Unknown or
 * malformed records are dropped, never repaired; distance is never estimated.
 */
export function buildRunImportCandidates(input: {
  readonly records: readonly unknown[];
  readonly provider: RunImportProvider;
  readonly deviceTimezone: string;
  readonly existingRuns: readonly RunRecord[];
  readonly now: Date;
}): { candidates: RunImportCandidate[]; rejectedCount: number } {
  const imported = new Set<string>();
  for (const run of input.existingRuns) {
    const origin = run.summary.origin;
    if (origin.kind === "health_import")
      imported.add(
        candidateKey(origin.provider, origin.sourceAppId, origin.externalId),
      );
  }
  const seen = new Set<string>();
  const candidates: RunImportCandidate[] = [];
  let rejectedCount = 0;
  for (const raw of input.records) {
    const candidate = parse(raw, input);
    if (!candidate) {
      rejectedCount++;
      continue;
    }
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    const start = Date.parse(candidate.startedAt);
    const end = start + candidate.durationSeconds * 1000;
    const possibleDuplicate = input.existingRuns.some((run) => {
      if (run.summary.origin.kind === "health_import") {
        const origin = run.summary.origin;
        if (
          candidateKey(
            origin.provider,
            origin.sourceAppId,
            origin.externalId,
          ) === candidate.key
        )
          return false;
      }
      const existing = interval(run);
      // A date-only manual run can't be placed in time; same day is enough to ask.
      if (!existing) return run.summary.activityDate === candidate.activityDate;
      return existing.start < end && start < existing.end;
    });
    candidates.push({
      ...candidate,
      alreadyImported: imported.has(candidate.key),
      possibleDuplicate,
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  // Two apps can copy the same run into Health (e.g. a watch and Strava).
  const flagged = new Set<number>();
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (
        Date.parse(a.startedAt) < Date.parse(b.endedAt) &&
        Date.parse(b.startedAt) < Date.parse(a.endedAt)
      ) {
        flagged.add(i);
        flagged.add(j);
      }
    }
  const result = candidates.map((c, i) =>
    flagged.has(i) && !c.alreadyImported
      ? { ...c, possibleDuplicate: true }
      : c,
  );
  result.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { candidates: result, rejectedCount };
}

function parse(
  raw: unknown,
  input: { provider: RunImportProvider; deviceTimezone: string; now: Date },
): Omit<RunImportCandidate, "alreadyImported" | "possibleDuplicate"> | null {
  if (!object(raw) || raw.kind !== "run" || raw.provider !== input.provider)
    return null;
  const sourceAppId = text(raw.sourceAppId, 255);
  const externalId = text(raw.externalId, 255);
  const sourceAppName =
    raw.sourceAppName === null ? null : text(raw.sourceAppName, 200);
  if (!sourceAppId || !externalId) return null;
  if (raw.sourceAppName !== null && sourceAppName === null) return null;
  if (typeof raw.startedAt !== "string" || typeof raw.endedAt !== "string")
    return null;
  const start = Date.parse(raw.startedAt);
  const end = Date.parse(raw.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return null;
  if (end > input.now.getTime()) return null;
  const basis = raw.durationBasis;
  if (basis !== "active" && basis !== "elapsed") return null;
  if (
    typeof raw.durationSeconds !== "number" ||
    !Number.isFinite(raw.durationSeconds)
  )
    return null;
  const durationSeconds = Math.round(raw.durationSeconds);
  if (durationSeconds < 1 || durationSeconds > 86400) return null;
  if (durationSeconds * 1000 > end - start + 1000) return null;
  let distanceMeters: number | null = null;
  if (raw.distanceMeters !== null) {
    if (
      typeof raw.distanceMeters !== "number" ||
      !Number.isFinite(raw.distanceMeters) ||
      raw.distanceMeters < 0 ||
      raw.distanceMeters > 1_000_000
    )
      return null;
    const rounded = Math.round(raw.distanceMeters * 100) / 100;
    distanceMeters = rounded > 0 ? rounded : null;
  }
  if (raw.indoor !== null && typeof raw.indoor !== "boolean") return null;
  // Offset-only source zones (Health Connect) fall back to the device zone.
  const recordingTimezone =
    validZone(raw.sourceTimeZone) ?? validZone(input.deviceTimezone) ?? "UTC";
  const startedAt = new Date(start).toISOString();
  let activityDate: string;
  try {
    activityDate = runningDate(new Date(start), recordingTimezone);
  } catch {
    return null;
  }
  return {
    key: candidateKey(input.provider, sourceAppId, externalId),
    provider: input.provider,
    sourceAppId,
    sourceAppName,
    externalId,
    startedAt,
    endedAt: new Date(end).toISOString(),
    activityDate,
    recordingTimezone,
    durationSeconds,
    durationBasis: basis,
    distanceMeters,
    environment:
      raw.indoor === true
        ? "treadmill"
        : raw.indoor === false
          ? "outdoor"
          : "unspecified",
  };
}

export function toRunImport(
  candidate: RunImportCandidate,
  clientOperationId: string,
): RunImport | null {
  const parsed = runImportSchema.safeParse({
    clientOperationId,
    provider: candidate.provider,
    sourceAppId: candidate.sourceAppId,
    sourceAppName: candidate.sourceAppName,
    externalId: candidate.externalId,
    startedAt: candidate.startedAt,
    recordingTimezone: candidate.recordingTimezone,
    durationSeconds: candidate.durationSeconds,
    durationBasis: candidate.durationBasis,
    distanceMeters: candidate.distanceMeters,
    environment: candidate.environment,
  });
  return parsed.success ? parsed.data : null;
}

/** New, non-overlapping runs start selected; possible duplicates need a choice. */
export const defaultSelection = (
  candidates: readonly RunImportCandidate[],
): Set<string> =>
  new Set(
    candidates
      .filter((c) => !c.alreadyImported && !c.possibleDuplicate)
      .map((c) => c.key),
  );
