import { requireOptionalNativeModule } from "expo";

export type HealthConnectionKind = "weight" | "workout" | "run";
export type HealthConnectionProvider = "apple_health" | "health_connect";

interface HealthConnectionSource {
  provider: HealthConnectionProvider;
  externalId: string;
  sourceAppId: string;
  sourceAppName: string | null;
  sourceTimeZone: string | null;
}

export interface HealthConnectionWeight extends HealthConnectionSource {
  kind: "weight";
  measuredAt: string;
  weightKg: number;
}

export interface HealthConnectionWorkout extends HealthConnectionSource {
  kind: "workout";
  startedAt: string;
  endedAt: string;
  activityType: string;
  durationSeconds: number;
}

/** A completed running workout. Distance is never zero-filled or estimated. */
export interface HealthConnectionRun extends HealthConnectionSource {
  kind: "run";
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  /** HealthKit workout duration is "active"; Health Connect session end-start is "elapsed". */
  durationBasis: "active" | "elapsed";
  /** Source distance in metres, or null when unavailable, not permitted or not positive. */
  distanceMeters: number | null;
  /** True for indoor/treadmill runs, false only when the source says outdoor, otherwise null. */
  indoor: boolean | null;
}

export type HealthConnectionRecord =
  HealthConnectionWeight | HealthConnectionWorkout | HealthConnectionRun;

export interface HealthConnectionResult {
  status:
    | "ready"
    | "unavailable"
    | "install_required"
    | "permission_required"
    | "error";
  records: HealthConnectionRecord[];
  nextPageToken: string | null;
  readAccess: "unknown" | "granted";
  errorCode?: string;
}

interface HealthConnectionsNativeModule {
  availabilityAsync(): Promise<HealthConnectionResult>;
  requestReadPermissionAsync(
    kind: HealthConnectionKind,
  ): Promise<HealthConnectionResult>;
  readPageAsync(
    kind: HealthConnectionKind,
    fromISO: string,
    toISO: string,
    pageToken: string | null,
  ): Promise<HealthConnectionResult>;
  invalidateAsync(): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<HealthConnectionsNativeModule>(
  "MizyunHealthConnections",
);

function empty(
  status: HealthConnectionResult["status"],
  errorCode?: string,
): HealthConnectionResult {
  return {
    status,
    records: [],
    nextPageToken: null,
    readAccess: "unknown",
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

async function safely(
  operation: (
    module: HealthConnectionsNativeModule,
  ) => Promise<HealthConnectionResult>,
): Promise<HealthConnectionResult> {
  if (nativeModule === null) return empty("unavailable");
  try {
    return await operation(nativeModule);
  } catch {
    // Never propagate platform exception messages or health metadata to JS/logs.
    return empty("error", "native_failure");
  }
}

export function availabilityAsync(): Promise<HealthConnectionResult> {
  return safely((module) => module.availabilityAsync());
}

export function requestReadPermissionAsync(
  kind: HealthConnectionKind,
): Promise<HealthConnectionResult> {
  return safely((module) => module.requestReadPermissionAsync(kind));
}

export function readPageAsync(
  kind: HealthConnectionKind,
  fromISO: string,
  toISO: string,
  pageToken: string | null = null,
): Promise<HealthConnectionResult> {
  return safely((module) =>
    module.readPageAsync(kind, fromISO, toISO, pageToken),
  );
}

/** Retire pending reads and all ephemeral page state on clear/unmount/account changes. */
export async function invalidateAsync(): Promise<void> {
  try {
    await nativeModule?.invalidateAsync();
  } catch {
    // No persistent state exists and unavailable/older binaries remain usable.
  }
}
