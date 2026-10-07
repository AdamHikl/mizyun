import * as SecureStore from "expo-secure-store";
import { isHealthExportPayload, type HealthExportPayload } from "@mizyun/core";
import type { HealthExportComponent } from "../../../modules/mizyun-health-export";

export const HEALTH_EXPORT_CAPACITY = 40;
export const HEALTH_EXPORT_MAX_BYTES = 1800;
const PREFIX = "mizyun.health-export.v1.slot.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPONENTS = new Set([
  "nutrition",
  "energy",
  "protein",
  "carbs",
  "fat",
  "workout",
]);
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface HealthExportMapping {
  schemaVersion: 1;
  installationId: string;
  accountId: string;
  sourceId: string;
  operation: HealthExportPayload;
  pending: boolean;
  acknowledgedComponents: HealthExportComponent[];
  /** Every interval that may still have an own platform copy after an ambiguous write. */
  cleanupIntervals: { from: string; to: string }[];
}
export interface HealthExportStorage {
  load(
    accountId: string,
    installationId: string,
  ): Promise<HealthExportMapping[]>;
  save(mapping: HealthExportMapping): Promise<void>;
  clearAccount(accountId: string, installationId?: string): Promise<void>;
}
export interface HealthExportSecureStore {
  getItemAsync(
    key: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<unknown>;
  deleteItemAsync(
    key: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<unknown>;
}
export class HealthExportStorageError extends Error {
  constructor(
    readonly code: "storage_failed" | "storage_full" | "storage_invalid",
  ) {
    super(code);
  }
}
export function isHealthExportScope(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function validMapping(value: unknown): value is HealthExportMapping {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).sort().join(",") ===
      "accountId,acknowledgedComponents,cleanupIntervals,installationId,operation,pending,schemaVersion,sourceId" &&
    item.schemaVersion === 1 &&
    isHealthExportScope(item.installationId) &&
    isHealthExportScope(item.accountId) &&
    isHealthExportScope(item.sourceId) &&
    isHealthExportPayload(item.operation) &&
    ![item.accountId, item.installationId, item.sourceId].some(
      (scope) =>
        (scope as string).toLowerCase() ===
        (item.operation as HealthExportPayload).clientId.toLowerCase(),
    ) &&
    typeof item.pending === "boolean" &&
    Array.isArray(item.acknowledgedComponents) &&
    item.acknowledgedComponents.length <= 6 &&
    item.acknowledgedComponents.every(
      (value) => typeof value === "string" && COMPONENTS.has(value),
    ) &&
    Array.isArray(item.cleanupIntervals) &&
    item.cleanupIntervals.length <= 8 &&
    item.cleanupIntervals.every((interval: unknown) => {
      if (
        typeof interval !== "object" ||
        interval === null ||
        Array.isArray(interval)
      )
        return false;
      const pair = interval as Record<string, unknown>;
      if (
        Object.keys(pair).sort().join(",") !== "from,to" ||
        typeof pair.from !== "string" ||
        typeof pair.to !== "string"
      )
        return false;
      const operation = item.operation as HealthExportPayload;
      return (
        isHealthExportPayload(
          operation.category === "nutrition"
            ? {
                ...operation,
                nutrition: { ...operation.nutrition, consumedAt: pair.from },
              }
            : {
                ...operation,
                workout: { startedAt: pair.from, endedAt: pair.to },
              },
        ) &&
        (operation.category !== "nutrition" || pair.from === pair.to)
      );
    }) &&
    (!item.pending || (item.cleanupIntervals as unknown[]).length > 0)
  );
}
function parse(raw: string): HealthExportMapping {
  // All accepted fields are ASCII UUIDs, timestamps, finite numbers and fixed enums.
  // Therefore string length is also the exact UTF-8 byte length.
  if (raw.length > HEALTH_EXPORT_MAX_BYTES)
    throw new HealthExportStorageError("storage_invalid");
  try {
    const value: unknown = JSON.parse(raw);
    if (validMapping(value)) return value;
  } catch {
    /* No payload or platform exception is included in the error. */
  }
  throw new HealthExportStorageError("storage_invalid");
}

/** Forty independent atomic slots avoid an item/index crash-consistency gap.
 * Completed mappings are retained: capacity exhaustion is explicit, never eviction.
 * The installation ID comes from a native file excluded from backup, not keychain.
 */
export class SecureHealthExportStorage implements HealthExportStorage {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: HealthExportSecureStore = SecureStore) {}
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail
      .catch(() => undefined)
      .then(async () => {
        try {
          return await action();
        } catch (error) {
          throw error instanceof HealthExportStorageError
            ? error
            : new HealthExportStorageError("storage_failed");
        }
      });
    this.tail = result;
    return result;
  }
  private async slots(): Promise<(HealthExportMapping | null)[]> {
    const result: (HealthExportMapping | null)[] = [];
    for (let slot = 0; slot < HEALTH_EXPORT_CAPACITY; slot++) {
      const raw = await this.store.getItemAsync(`${PREFIX}${slot}`, options);
      result.push(raw === null ? null : parse(raw));
    }
    return result;
  }
  load(
    accountId: string,
    installationId: string,
  ): Promise<HealthExportMapping[]> {
    return this.serialized(async () => {
      if (
        !isHealthExportScope(accountId) ||
        !isHealthExportScope(installationId)
      )
        throw new HealthExportStorageError("storage_invalid");
      const slots = await this.slots();
      return slots.filter(
        (item): item is HealthExportMapping =>
          item !== null &&
          item.accountId === accountId &&
          item.installationId === installationId,
      );
    });
  }
  save(mapping: HealthExportMapping): Promise<void> {
    return this.serialized(async () => {
      if (!validMapping(mapping))
        throw new HealthExportStorageError("storage_invalid");
      const raw = JSON.stringify(mapping);
      if (raw.length > HEALTH_EXPORT_MAX_BYTES)
        throw new HealthExportStorageError("storage_full");
      const slots = await this.slots();
      let slot = slots.findIndex(
        (item) =>
          item?.installationId === mapping.installationId &&
          item.accountId === mapping.accountId &&
          item.sourceId === mapping.sourceId &&
          item.operation.category === mapping.operation.category,
      );
      if (slot >= 0) {
        const existing = slots[slot]!;
        if (
          existing.operation.clientId !== mapping.operation.clientId ||
          existing.operation.revision > mapping.operation.revision ||
          (existing.operation.revision === mapping.operation.revision &&
            JSON.stringify(existing.operation) !==
              JSON.stringify(mapping.operation))
        )
          throw new HealthExportStorageError("storage_invalid");
      } else
        slot = slots.findIndex(
          (item) =>
            item === null || item.installationId !== mapping.installationId,
        );
      if (slot < 0) throw new HealthExportStorageError("storage_full");
      await this.store.setItemAsync(`${PREFIX}${slot}`, raw, options);
    });
  }
  /** Without an installation filter, erase this account's local payloads from
   * every retained installation. Account deletion never needs native authority. */
  clearAccount(accountId: string, installationId?: string): Promise<void> {
    return this.serialized(async () => {
      if (
        !isHealthExportScope(accountId) ||
        (installationId !== undefined && !isHealthExportScope(installationId))
      )
        throw new HealthExportStorageError("storage_invalid");
      const slots = await this.slots();
      for (let slot = 0; slot < slots.length; slot++) {
        const item = slots[slot];
        if (
          item?.accountId === accountId &&
          (installationId === undefined ||
            item.installationId === installationId)
        )
          await this.store.deleteItemAsync(`${PREFIX}${slot}`, options);
      }
    });
  }
}
