import * as SecureStore from "expo-secure-store";

export const ANALYTICS_REMINDER_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

export interface AnalyticsReminderStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

export interface AnalyticsReminderPreference {
  readonly version: 1;
  readonly nextPromptAt: number;
  readonly neverAsk: boolean;
}

export const analyticsReminderKey = (ownerId: string): string => {
  if (!/^[a-zA-Z0-9._-]+$/.test(ownerId)) throw new Error("Invalid owner");
  return `mizyun.analytics-reminder.v1.${ownerId}`;
};

interface ReminderOperations {
  generation: number;
  erasurePending: boolean;
  tail: Promise<void>;
}

const operationsByStore = new WeakMap<
  AnalyticsReminderStore,
  Map<string, ReminderOperations>
>();

function ownerOperations(store: AnalyticsReminderStore, key: string) {
  let owners = operationsByStore.get(store);
  if (!owners) {
    owners = new Map();
    operationsByStore.set(store, owners);
  }
  let operations = owners.get(key);
  if (!operations) {
    operations = {
      generation: 0,
      erasurePending: false,
      tail: Promise.resolve(),
    };
    owners.set(key, operations);
  }
  return operations;
}

function enqueue<T>(
  operations: ReminderOperations,
  operation: () => Promise<T>,
) {
  const result = operations.tail.then(operation);
  // A failed operation remains visible to its caller without breaking erasure retries.
  operations.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function writePreference(
  store: AnalyticsReminderStore,
  key: string,
  operations: ReminderOperations,
  generation: number,
  preference: AnalyticsReminderPreference,
) {
  try {
    await store.setItemAsync(key, JSON.stringify(preference));
  } finally {
    // Native writes cannot be cancelled. Remove a retired result before the next
    // queued operation can write a current owner's preference, even on rejection.
    if (generation !== operations.generation) await store.deleteItemAsync(key);
  }
}

/** An unreadable preference suppresses reminders rather than resetting a refusal. */
export async function loadAnalyticsReminder(
  ownerId: string,
  store: AnalyticsReminderStore = SecureStore,
): Promise<AnalyticsReminderPreference | null> {
  try {
    const key = analyticsReminderKey(ownerId);
    const operations = ownerOperations(store, key);
    const generation = operations.generation;
    if (operations.erasurePending) return null;
    const raw = await store.getItemAsync(key);
    if (generation !== operations.generation || operations.erasurePending)
      return null;
    if (raw === null) return { version: 1, nextPromptAt: 0, neverAsk: false };
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      value.version !== 1 ||
      !("nextPromptAt" in value) ||
      typeof value.nextPromptAt !== "number" ||
      !Number.isSafeInteger(value.nextPromptAt) ||
      value.nextPromptAt < 0 ||
      !("neverAsk" in value) ||
      typeof value.neverAsk !== "boolean"
    )
      return null;
    return {
      version: 1,
      nextPromptAt: value.nextPromptAt,
      neverAsk: value.neverAsk,
    };
  } catch {
    return null;
  }
}

/** Persist before presentation, so a crash/dismissal cannot cause repeated asks. */
export async function reserveAnalyticsReminder(
  ownerId: string,
  store: AnalyticsReminderStore = SecureStore,
  now = Date.now(),
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  try {
    const key = analyticsReminderKey(ownerId);
    const operations = ownerOperations(store, key);
    const generation = operations.generation;
    return await enqueue(operations, async () => {
      if (generation !== operations.generation || operations.erasurePending)
        return false;
      const preference = await loadAnalyticsReminder(ownerId, store);
      if (
        generation !== operations.generation ||
        !isCurrent() ||
        !Number.isSafeInteger(now) ||
        now < 0 ||
        !preference ||
        preference.neverAsk ||
        now < preference.nextPromptAt
      )
        return false;
      await writePreference(store, key, operations, generation, {
        version: 1,
        nextPromptAt: now + ANALYTICS_REMINDER_INTERVAL_MS,
        neverAsk: false,
      });
      return generation === operations.generation && isCurrent();
    });
  } catch {
    return false;
  }
}

export async function stopAnalyticsReminders(
  ownerId: string,
  store: AnalyticsReminderStore = SecureStore,
): Promise<void> {
  const key = analyticsReminderKey(ownerId);
  const operations = ownerOperations(store, key);
  const generation = operations.generation;
  await enqueue(operations, async () => {
    if (generation !== operations.generation) return;
    if (operations.erasurePending) throw new Error("Reminder erasure pending");
    await writePreference(store, key, operations, generation, {
      version: 1,
      nextPromptAt: 0,
      neverAsk: true,
    });
  });
}

export async function clearAnalyticsReminder(
  ownerId: string,
  store: AnalyticsReminderStore = SecureStore,
): Promise<void> {
  const key = analyticsReminderKey(ownerId);
  const operations = ownerOperations(store, key);
  // Retire both in-flight and already queued writes synchronously.
  const generation = ++operations.generation;
  operations.erasurePending = true;
  await enqueue(operations, async () => {
    await store.deleteItemAsync(key);
    if (generation === operations.generation) operations.erasurePending = false;
  });
}
