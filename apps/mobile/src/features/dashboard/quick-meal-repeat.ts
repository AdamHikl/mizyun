import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import {
  foodEntryCreateSchema,
  type FoodEntry,
  type FoodEntryCreate,
} from "@mizyun/contracts";
import { createFoodCopyPayload } from "../log-meal/public-data";

export interface QuickMealRepeatStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}
export interface PendingQuickMealRepeat {
  readonly owner: string;
  readonly localDate: string;
  readonly sourceEntryId: string;
  readonly payload: FoodEntryCreate;
  readonly completed: false;
}
export interface CompletedQuickMealRepeat {
  readonly owner: string;
  readonly localDate: string;
  readonly operationId: string;
  readonly completed: true;
}
export type QuickMealRepeatOperation =
  PendingQuickMealRepeat | CompletedQuickMealRepeat;
const keyFor = (owner: string) => `mizyun.quick-meal-repeat.${owner}`;
const deletedOwners = new Set<string>();
export const isQuickMealRepeatOwnerActive = (owner: string): boolean =>
  !deletedOwners.has(owner);
function requireOwner(owner: string): void {
  if (!isQuickMealRepeatOwnerActive(owner))
    throw new Error("The meal copy owner was deleted");
}
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  const pending = (queues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(action);
  queues.set(key, pending);
  const settled = () => {
    if (queues.get(key) === pending) queues.delete(key);
  };
  void pending.then(settled, settled);
  return pending;
}
function parsePending(raw: string, owner: string): QuickMealRepeatOperation {
  const pending = JSON.parse(raw) as QuickMealRepeatOperation;
  if (pending?.completed === true) {
    if (
      pending.owner !== owner ||
      !/^\d{4}-\d{2}-\d{2}$/.test(pending.localDate) ||
      !foodEntryCreateSchema.safeParse({
        name: "Saved meal",
        clientOperationId: pending.operationId,
      }).success ||
      !pending.operationId
    )
      throw new Error("Cannot recover the saved meal copy safely");
    return {
      owner,
      localDate: pending.localDate,
      operationId: pending.operationId,
      completed: true,
    };
  }
  const parsed = foodEntryCreateSchema.safeParse(pending?.payload);
  if (
    pending.completed !== false ||
    !parsed.success ||
    !parsed.data.clientOperationId ||
    !parsed.data.consumedAt ||
    pending.owner !== owner ||
    !/^\d{4}-\d{2}-\d{2}$/.test(pending.localDate) ||
    typeof pending.sourceEntryId !== "string" ||
    !pending.sourceEntryId
  ) {
    throw new Error("Cannot recover the meal copy safely");
  }
  return { ...pending, payload: parsed.data };
}

// SecureStore protects the immutable nutrition snapshot. Any read/write error
// blocks dispatch: a fresh UUID would duplicate a possibly committed request.
export function prepareQuickMealRepeat(
  owner: string,
  localDate: string,
  source: FoodEntry,
  includeAdvanced = false,
  store: QuickMealRepeatStore = SecureStore,
  now: () => Date = () => new Date(),
): Promise<QuickMealRepeatOperation> {
  const key = keyFor(owner);
  return serialized(key, async () => {
    requireOwner(owner);
    const raw = await store.getItemAsync(key);
    requireOwner(owner);
    if (raw !== null) {
      const existing = parsePending(raw, owner);
      if (existing.localDate === localDate) return existing;
    }
    const payload = foodEntryCreateSchema.parse(
      createFoodCopyPayload(source, includeAdvanced, {
        clientOperationId: Crypto.randomUUID(),
        consumedAt: now().toISOString(),
      }),
    );
    const pending = {
      owner,
      localDate,
      sourceEntryId: source.id,
      payload,
      completed: false,
    };
    await store.setItemAsync(key, JSON.stringify(pending));
    requireOwner(owner);
    // Match the on-disk snapshot, including removal of undefined values.
    return parsePending(JSON.stringify(pending), owner);
  });
}

// Replace health content with a completion marker before refreshing the dashboard.
// A restart with stale empty totals must not generate another meal operation.
export function completeQuickMealRepeat(
  pending: PendingQuickMealRepeat,
  store: QuickMealRepeatStore = SecureStore,
): Promise<void> {
  const key = keyFor(pending.owner);
  return serialized(key, async () => {
    requireOwner(pending.owner);
    const raw = await store.getItemAsync(key);
    requireOwner(pending.owner);
    if (raw === null) throw new Error("The pending meal copy disappeared");
    const existing = parsePending(raw, pending.owner);
    if (existing.localDate !== pending.localDate)
      throw new Error("The pending meal day changed");
    const id = existing.completed
      ? existing.operationId
      : existing.payload.clientOperationId;
    if (id !== pending.payload.clientOperationId)
      throw new Error("The pending meal copy changed");
    await store.setItemAsync(
      key,
      JSON.stringify({
        owner: pending.owner,
        localDate: pending.localDate,
        operationId: pending.payload.clientOperationId,
        completed: true,
      }),
    );
  });
}

// Read on mount without dispatching. Only today's record can be displayed.
export function loadQuickMealRepeat(
  owner: string,
  localDate: string,
  store: QuickMealRepeatStore = SecureStore,
): Promise<QuickMealRepeatOperation | null> {
  return serialized(keyFor(owner), async () => {
    requireOwner(owner);
    const raw = await store.getItemAsync(keyFor(owner));
    requireOwner(owner);
    if (raw === null) return null;
    const pending = parsePending(raw, owner);
    return pending.localDate === localDate ? pending : null;
  });
}

// Permanent account deletion fences every pending write synchronously, then
// erases the single bounded record after earlier queued writes have settled.
export function clearQuickMealRepeat(
  owner: string,
  store: QuickMealRepeatStore = SecureStore,
): Promise<void> {
  deletedOwners.add(owner);
  return serialized(keyFor(owner), async () => {
    await store.deleteItemAsync(keyFor(owner));
  });
}
