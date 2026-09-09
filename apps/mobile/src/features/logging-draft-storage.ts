import * as SecureStore from "expo-secure-store";

export type LoggingDraftKind =
  "meal" | "workout" | "weight" | "coach" | `meal-edit-${string}`;

interface SecureKeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

const draftKey = (userId: string, kind: LoggingDraftKind): string =>
  `mizyun.logging-draft.${userId}.${kind}`;

export const loadLoggingDraft = async <T>(
  userId: string,
  kind: LoggingDraftKind,
  isDraft: (value: unknown) => value is T,
  store: SecureKeyValueStore = SecureStore,
): Promise<T | null> => {
  try {
    const raw = await store.getItemAsync(draftKey(userId, kind));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    // Draft recovery is best effort and must never block logging.
    return null;
  }
};

const writeQueues = new Map<string, Promise<unknown>>();
const storageGenerations = new Map<string, number>();

const enqueueWrite = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  writeQueues.set(key, current);
  current.finally(() => {
    if (writeQueues.get(key) === current) {
      writeQueues.delete(key);
    }
  });
  return current;
};

export const saveLoggingDraft = async <T extends object>(
  userId: string,
  kind: LoggingDraftKind,
  value: T,
  store: SecureKeyValueStore = SecureStore,
): Promise<boolean> => {
  const key = draftKey(userId, kind);
  const scheduledGen = storageGenerations.get(key) ?? 0;
  return enqueueWrite(key, async () => {
    const currentGen = storageGenerations.get(key) ?? 0;
    if (currentGen !== scheduledGen) {
      // A clear happened after this save was scheduled; drop this save.
      return false;
    }
    try {
      await store.setItemAsync(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  });
};

export const clearLoggingDraft = async (
  userId: string,
  kind: LoggingDraftKind,
  store: SecureKeyValueStore = SecureStore,
): Promise<boolean> => {
  const key = draftKey(userId, kind);
  const nextGen = (storageGenerations.get(key) ?? 0) + 1;
  storageGenerations.set(key, nextGen);
  return enqueueWrite(key, async () => {
    try {
      await store.deleteItemAsync(key);
      return true;
    } catch {
      return false;
    }
  });
};
