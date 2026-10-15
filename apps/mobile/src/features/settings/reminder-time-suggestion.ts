import * as SecureStore from "expo-secure-store";
import {
  learnEveningReminderTime,
  learnFirstMealReminderTime,
  shouldSuggestReminderTime,
  REMINDER_LEARNING_WINDOW_DAYS,
  type MealInstant,
} from "@mizyun/core";

import { fetchFoodHistory } from "../log-meal/meal-lifecycle-data";

/**
 * Learned reminder times are only ever *suggested*. Applying one goes through
 * the same confirmed save path as a manual time change; dismissing one is
 * remembered per account for that exact suggested time.
 */

export type ReminderSuggestionKind = "first-meal" | "evening";

export interface ReminderTimeSuggestion {
  readonly hour: number;
  readonly minute: number;
  readonly usualHour: number;
  readonly usualMinute: number;
}

export interface SuggestionStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

const KINDS: readonly ReminderSuggestionKind[] = ["first-meal", "evening"];
const dismissalKey = (userId: string, kind: ReminderSuggestionKind): string =>
  `mizyun.reminder-suggestion-dismissed.${userId}.${kind}`;

export const formatClock = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

export const loadDismissedSuggestion = async (
  userId: string,
  kind: ReminderSuggestionKind,
  store: SuggestionStore = SecureStore,
): Promise<string | null> => {
  try {
    const raw = await store.getItemAsync(dismissalKey(userId, kind));
    return raw !== null && /^\d{2}:\d{2}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
};

export const dismissReminderSuggestion = async (
  userId: string,
  kind: ReminderSuggestionKind,
  time: { readonly hour: number; readonly minute: number },
  store: SuggestionStore = SecureStore,
): Promise<boolean> => {
  try {
    await store.setItemAsync(
      dismissalKey(userId, kind),
      formatClock(time.hour, time.minute),
    );
    return true;
  } catch {
    return false;
  }
};

/** Account deletion: remove every kind's dismissal marker. */
export const clearReminderSuggestionDismissals = async (
  userId: string,
  store: SuggestionStore = SecureStore,
): Promise<void> => {
  await Promise.all(
    KINDS.map((kind) =>
      typeof store.deleteItemAsync === "function"
        ? store.deleteItemAsync(dismissalKey(userId, kind))
        : store.setItemAsync(dismissalKey(userId, kind), ""),
    ),
  );
};

const MAX_PAGES = 3;
const DAY_MS = 86_400_000;

/** Confirmed meal instants from the last two weeks; null if they can't be read. */
export const loadRecentMealInstants = async (
  now: Date = new Date(),
  fetchHistory: typeof fetchFoodHistory = fetchFoodHistory,
): Promise<readonly MealInstant[] | null> => {
  const iso = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const from = iso(
    new Date(now.getTime() - REMINDER_LEARNING_WINDOW_DAYS * DAY_MS),
  );
  const to = iso(now);
  const instants: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchHistory({ from, to, cursor, limit: 200 });
    if (result.message !== null) return null;
    for (const entry of result.entries)
      if (entry.confirmedByUser) instants.push(entry.consumedAt);
    cursor = result.nextCursor ?? null;
    if (cursor === null) break;
  }
  return instants;
};

export const deviceTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Pure decision: the suggestion to show, or null. A suggestion needs enough
 * history, a difference of at least 30 minutes from the saved time, and must
 * not match a time the user already dismissed.
 */
export const decideReminderSuggestion = (input: {
  readonly kind: ReminderSuggestionKind;
  readonly instants: readonly MealInstant[] | null;
  readonly saved: { readonly hour: number; readonly minute: number };
  readonly dismissed: string | null;
  readonly timeZone: string;
  readonly now?: Date;
}): ReminderTimeSuggestion | null => {
  if (input.instants === null) return null;
  const learn =
    input.kind === "first-meal"
      ? learnFirstMealReminderTime
      : learnEveningReminderTime;
  const learned = learn(input.instants, input.timeZone, {
    ...(input.now ? { now: input.now } : {}),
  });
  if (learned === null) return null;
  if (!shouldSuggestReminderTime(input.saved, learned)) return null;
  if (input.dismissed === formatClock(learned.hour, learned.minute))
    return null;
  return {
    hour: learned.hour,
    minute: learned.minute,
    usualHour: learned.usualHour,
    usualMinute: learned.usualMinute,
  };
};

export const suggestionMessage = (
  kind: ReminderSuggestionKind,
  suggestion: ReminderTimeSuggestion,
): string =>
  kind === "first-meal"
    ? `You usually log your first meal around ${formatClock(suggestion.usualHour, suggestion.usualMinute)}. Remind at ${formatClock(suggestion.hour, suggestion.minute)}?`
    : `You usually log your last meal around ${formatClock(suggestion.usualHour, suggestion.usualMinute)}. Remind at ${formatClock(suggestion.hour, suggestion.minute)}?`;
