import * as SecureStore from "expo-secure-store";
import {
  ROUTINE_SUGGESTION_DISMISS_DAYS,
  type RoutineSuggestion,
} from "@mizyun/core";

/**
 * Per-user "Not now" memory for the Save-as-routine suggestion. Entries are
 * keyed by a hash of the exercise-set signature and expire after 30 days.
 */
export interface RoutineSuggestionStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

const MAX_ENTRIES = 20;

export const routineSuggestionKeyFor = (userId: string): string =>
  `mizyun.workout-routine-suggestion.${userId}`;

/** cyrb53 string hash: keeps stored keys short and free of raw exercise ids. */
export const hashRoutineSignature = (value: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

const readEntries = async (
  userId: string,
  store: RoutineSuggestionStore,
): Promise<Record<string, string>> => {
  try {
    const raw = await store.getItemAsync(routineSuggestionKeyFor(userId));
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
        entries[key] = value;
    }
    return entries;
  } catch {
    return {};
  }
};

/** Hashes of signatures whose 30-day snooze is still running. */
export const loadDismissedRoutineSuggestions = async (
  userId: string,
  now: Date = new Date(),
  store: RoutineSuggestionStore = SecureStore,
): Promise<ReadonlySet<string>> => {
  const cutoff = now.getTime() - ROUTINE_SUGGESTION_DISMISS_DAYS * 86_400_000;
  const entries = await readEntries(userId, store);
  return new Set(
    Object.entries(entries)
      .filter(([, at]) => Date.parse(at) > cutoff)
      .map(([hash]) => hash),
  );
};

export const isRoutineSuggestionDismissed = (
  dismissed: ReadonlySet<string>,
  suggestion: Pick<RoutineSuggestion, "signature">,
): boolean => dismissed.has(hashRoutineSignature(suggestion.signature));

export const dismissRoutineSuggestion = async (
  userId: string,
  suggestion: Pick<RoutineSuggestion, "signature">,
  now: Date = new Date(),
  store: RoutineSuggestionStore = SecureStore,
): Promise<boolean> => {
  try {
    const cutoff = now.getTime() - ROUTINE_SUGGESTION_DISMISS_DAYS * 86_400_000;
    const entries = await readEntries(userId, store);
    const live = Object.entries(entries).filter(
      ([, at]) => Date.parse(at) > cutoff,
    );
    live.push([hashRoutineSignature(suggestion.signature), now.toISOString()]);
    const next = Object.fromEntries(
      [...new Map(live).entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .slice(-MAX_ENTRIES),
    );
    await store.setItemAsync(
      routineSuggestionKeyFor(userId),
      JSON.stringify(next),
    );
    return true;
  } catch {
    return false;
  }
};

export const clearRoutineSuggestionDismissals = async (
  userId: string,
  store: RoutineSuggestionStore = SecureStore,
): Promise<void> => {
  try {
    if (typeof store.deleteItemAsync === "function")
      await store.deleteItemAsync(routineSuggestionKeyFor(userId));
    else await store.setItemAsync(routineSuggestionKeyFor(userId), "{}");
  } catch {
    // Best-effort cleanup during account deletion or logout.
  }
};
