import { requireOptionalNativeModule } from "expo";

export type HealthExportCategory = "nutrition" | "workout";
export type HealthExportComponent =
  "nutrition" | "energy" | "protein" | "carbs" | "fat" | "workout";

/** Contains only the confirmed export projection; never source titles or notes. */
export interface HealthExportOperation {
  type: "upsert" | "delete";
  category: HealthExportCategory;
  clientId: string;
  revision: number;
  nutrition?: {
    consumedAt: string;
    energyKcal: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  };
  workout?: { startedAt: string; endedAt: string };
}

export interface HealthExportResult {
  status:
    | "ready"
    | "partial"
    | "unavailable"
    | "install_required"
    | "permission_required"
    | "error";
  acknowledgedComponents: HealthExportComponent[];
  writeAccess: "unknown" | "granted" | "denied" | "partial";
  errorCode?: string;
}

interface HealthExportNativeModule {
  installationIdAsync(): Promise<string | null>;
  availabilityAsync(): Promise<HealthExportResult>;
  requestWritePermissionAsync(
    category: HealthExportCategory,
  ): Promise<HealthExportResult>;
  applyOperationAsync(
    operation: HealthExportOperation,
  ): Promise<HealthExportResult>;
  invalidateAsync(): Promise<void>;
}

const nativeModule =
  requireOptionalNativeModule<HealthExportNativeModule>("MizyunHealthExport");
let generation = 0;

function empty(
  status: HealthExportResult["status"],
  errorCode?: string,
): HealthExportResult {
  return {
    status,
    acknowledgedComponents: [],
    writeAccess: "unknown",
    ...(errorCode ? { errorCode } : {}),
  };
}

// The native implementations also bound provider work. This bounds unavailable,
// older, or malfunctioning bridges without scheduling a second attempt or prompt.
async function safely(
  operation: (module: HealthExportNativeModule) => Promise<HealthExportResult>,
  timeoutMs: number,
): Promise<HealthExportResult> {
  if (!nativeModule) return empty("unavailable");
  const requestGeneration = generation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      operation(nativeModule),
      new Promise<HealthExportResult>((resolve) => {
        timer = setTimeout(
          () => resolve(empty("error", "native_timeout")),
          timeoutMs,
        );
      }),
    ]);
    return requestGeneration === generation
      ? result
      : empty("error", "operation_invalidated");
  } catch {
    // Platform exception messages can contain private values. Never expose them.
    return empty("error", "native_failure");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function availabilityAsync(): Promise<HealthExportResult> {
  return safely((module) => module.availabilityAsync(), 35_000);
}

/** Non-restored app-install sentinel; this contains no account or record identifier. */
export async function installationIdAsync(): Promise<string | null> {
  if (!nativeModule) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      nativeModule.installationIdAsync(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 5_000);
      }),
    ]);
    return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
      ? value.toLowerCase()
      : null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Only call from a deliberate foreground action for this specific category. */
export function requestWritePermissionAsync(
  category: HealthExportCategory,
): Promise<HealthExportResult> {
  return safely(
    (module) => module.requestWritePermissionAsync(category),
    125_000,
  );
}

/** Never requests permission or automatically retries. IDs/revisions survive retries. */
export function applyOperationAsync(
  operation: HealthExportOperation,
): Promise<HealthExportResult> {
  return safely((module) => module.applyOperationAsync(operation), 35_000);
}

/** Stops queued work and suppresses late acknowledgments; OS mutations may already be committed. */
export async function invalidateAsync(): Promise<void> {
  generation += 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      nativeModule?.invalidateAsync(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5_000);
      }),
    ]);
  } catch {
    // Old binaries remain usable; the JS generation still retires late results.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
