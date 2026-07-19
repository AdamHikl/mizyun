import * as SecureStore from "expo-secure-store";

export type LoggingDraftKind =
  "meal" | "workout" | "weight" | `meal-edit-${string}`;

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

export const saveLoggingDraft = async <T extends object>(
  userId: string,
  kind: LoggingDraftKind,
  value: T,
  store: SecureKeyValueStore = SecureStore,
): Promise<boolean> => {
  try {
    await store.setItemAsync(draftKey(userId, kind), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const clearLoggingDraft = async (
  userId: string,
  kind: LoggingDraftKind,
  store: SecureKeyValueStore = SecureStore,
): Promise<boolean> => {
  try {
    await store.deleteItemAsync(draftKey(userId, kind));
    return true;
  } catch {
    return false;
  }
};
