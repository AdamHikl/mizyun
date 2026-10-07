/** INT-01 pure rules, deliberately independent of platform SDKs and storage. */
export type HealthPreviewKind = "weight" | "workout";
export type HealthPreviewProvider = "apple_health" | "health_connect";

interface HealthPreviewSource {
  provider: HealthPreviewProvider;
  externalId: string;
  sourceAppId: string;
  sourceAppName: string | null;
  sourceTimeZone: string | null;
}

export type HealthPreviewRecord = HealthPreviewSource &
  (
    | { kind: "weight"; measuredAt: string; weightKg: number }
    | {
        kind: "workout";
        startedAt: string;
        endedAt: string;
        activityType: string;
        durationSeconds: number;
      }
  );

export const HEALTH_PREVIEW_MAX_RECORDS = 500;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const OWN_SOURCE_IDS = new Set([
  "com.mizyun.app",
  "com.mizyun.dev",
  "com.mizyun.development",
]);
const SOURCE_KEYS = [
  "provider",
  "externalId",
  "sourceAppId",
  "sourceAppName",
  "sourceTimeZone",
];

function isOwnSourceId(sourceAppId: string): boolean {
  return [...OWN_SOURCE_IDS].some(
    (ownId) => sourceAppId === ownId || sourceAppId.startsWith(`${ownId}.`),
  );
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function nullableString(value: unknown, max: number): boolean {
  return value === null || boundedString(value, max);
}

/** Calendar round-trip prevents JavaScript's invalid-date rollover. */
function instantMs(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  ) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    return null;
  }
  return milliseconds;
}

function validRecord(raw: unknown): raw is HealthPreviewRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return false;
  const record = raw as Record<string, unknown>;
  if (
    (record.provider !== "apple_health" &&
      record.provider !== "health_connect") ||
    !boundedString(record.externalId, 256) ||
    !boundedString(record.sourceAppId, 256) ||
    !nullableString(record.sourceAppName, 256) ||
    !nullableString(record.sourceTimeZone, 128)
  ) {
    return false;
  }
  const ownKeys = Object.keys(record);
  const hasExactKeys = (kindKeys: string[]): boolean => {
    const allowedKeys = [...SOURCE_KEYS, "kind", ...kindKeys];
    return (
      ownKeys.length === allowedKeys.length &&
      allowedKeys.every((key) => Object.hasOwn(record, key))
    );
  };
  if (record.kind === "weight") {
    return (
      hasExactKeys(["measuredAt", "weightKg"]) &&
      instantMs(record.measuredAt) !== null &&
      typeof record.weightKg === "number" &&
      Number.isFinite(record.weightKg) &&
      record.weightKg >= 30 &&
      record.weightKg <= 250
    );
  }
  if (record.kind !== "workout") return false;
  const start = instantMs(record.startedAt);
  const end = instantMs(record.endedAt);
  return (
    hasExactKeys(["startedAt", "endedAt", "activityType", "durationSeconds"]) &&
    start !== null &&
    end !== null &&
    end > start &&
    boundedString(record.activityType, 128) &&
    typeof record.durationSeconds === "number" &&
    Number.isFinite(record.durationSeconds) &&
    record.durationSeconds > 0 &&
    record.durationSeconds <= 86_400 &&
    record.durationSeconds <= (end - start) / 1000 + 0.001
  );
}

/** A rolling local preview window, independent of provider history policy. */
export function getHealthPreviewWindow(now: Date): {
  from: string;
  to: string;
} {
  const milliseconds = now.getTime();
  if (!Number.isFinite(milliseconds))
    throw new RangeError("Invalid preview time.");
  return {
    from: new Date(milliseconds - WINDOW_MS).toISOString(),
    to: new Date(milliseconds).toISOString(),
  };
}

export interface NormalizeHealthPreviewArgs {
  records: readonly unknown[];
  kind: HealthPreviewKind;
  provider: HealthPreviewProvider;
  from: string;
  to: string;
}

export interface NormalizedHealthPreview {
  records: HealthPreviewRecord[];
  /** Malformed records or records with a mismatched kind/provider. */
  rejectedCount: number;
  /** Valid unique records omitted by the explicit 500-record preview limit. */
  truncated: boolean;
}

/** Only exact provider/source/id replays collapse; equal values stay distinct. */
export function normalizeHealthPreviewRecords({
  records,
  kind,
  provider,
  from,
  to,
}: NormalizeHealthPreviewArgs): NormalizedHealthPreview {
  const start = instantMs(from);
  const end = instantMs(to);
  if (start === null || end === null || start > end) {
    return { records: [], rejectedCount: records.length, truncated: false };
  }
  let rejectedCount = 0;
  const accepted: HealthPreviewRecord[] = [];
  for (const raw of records) {
    if (!validRecord(raw) || raw.kind !== kind || raw.provider !== provider) {
      rejectedCount += 1;
      continue;
    }
    if (isOwnSourceId(raw.sourceAppId)) continue;
    const recordStart = Date.parse(
      raw.kind === "weight" ? raw.measuredAt : raw.startedAt,
    );
    const recordEnd = Date.parse(
      raw.kind === "weight" ? raw.measuredAt : raw.endedAt,
    );
    if (recordStart < start || recordEnd > end) {
      continue;
    }
    // Fixed key order makes conflicting replay resolution independent of native
    // object construction order as well as native page order.
    const source: HealthPreviewSource = {
      provider: raw.provider,
      externalId: raw.externalId,
      sourceAppId: raw.sourceAppId,
      sourceAppName: raw.sourceAppName,
      sourceTimeZone: raw.sourceTimeZone,
    };
    accepted.push(
      raw.kind === "weight"
        ? {
            ...source,
            kind: "weight",
            measuredAt: raw.measuredAt,
            weightKg: raw.weightKg,
          }
        : {
            ...source,
            kind: "workout",
            startedAt: raw.startedAt,
            endedAt: raw.endedAt,
            activityType: raw.activityType,
            durationSeconds: raw.durationSeconds,
          },
    );
  }
  const identity = (record: HealthPreviewRecord): string =>
    JSON.stringify([
      record.provider,
      record.kind,
      record.sourceAppId,
      record.externalId,
    ]);
  const newest = (record: HealthPreviewRecord): number =>
    Date.parse(record.kind === "weight" ? record.measuredAt : record.endedAt);
  // Lexical tie-breaks are locale-independent; conflicting replays resolve equally
  // for any native page order, while source provenance remains part of identity.
  const lexical = (a: string, b: string): number =>
    a < b ? -1 : a > b ? 1 : 0;
  accepted.sort(
    (a, b) =>
      newest(b) - newest(a) ||
      lexical(identity(a), identity(b)) ||
      lexical(JSON.stringify(a), JSON.stringify(b)),
  );
  const seen = new Set<string>();
  const unique = accepted.filter((record) => {
    const key = identity(record);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return {
    records: unique.slice(0, HEALTH_PREVIEW_MAX_RECORDS),
    rejectedCount,
    truncated: unique.length > HEALTH_PREVIEW_MAX_RECORDS,
  };
}

/** Caller-supplied rights/metadata cannot elevate imported data or derivatives. */
export function getHealthPreviewAllowedUses(
  record: unknown,
): readonly "local_display"[] {
  return validRecord(record) && !isOwnSourceId(record.sourceAppId)
    ? ["local_display"]
    : [];
}
