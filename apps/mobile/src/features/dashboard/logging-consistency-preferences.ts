import * as SecureStore from "expo-secure-store";
import { WEEKLY_LOG_GOAL_DEFAULT, clampWeeklyLogGoal } from "@mizyun/core";

/** Per-user, on-device preference for the weekly logging card (HABIT-01). */
export interface LoggingConsistencyPreferences {
  readonly weeklyGoal: number;
  readonly hidden: boolean;
}

export const DEFAULT_LOGGING_CONSISTENCY_PREFERENCES: LoggingConsistencyPreferences =
  { weeklyGoal: WEEKLY_LOG_GOAL_DEFAULT, hidden: false };

export interface LoggingConsistencyStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

export const loggingConsistencyKey = (userId: string): string =>
  `mizyun.logging-consistency.${userId}`;

export const loadLoggingConsistencyPreferences = async (
  userId: string,
  store: LoggingConsistencyStore = SecureStore,
): Promise<LoggingConsistencyPreferences> => {
  try {
    const raw = await store.getItemAsync(loggingConsistencyKey(userId));
    if (raw === null) return DEFAULT_LOGGING_CONSISTENCY_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return DEFAULT_LOGGING_CONSISTENCY_PREFERENCES;
    const record = parsed as Record<string, unknown>;
    return {
      weeklyGoal: clampWeeklyLogGoal(record.weeklyGoal),
      hidden: record.hidden === true,
    };
  } catch {
    return DEFAULT_LOGGING_CONSISTENCY_PREFERENCES;
  }
};

/** Returns false when the preference could not be persisted. */
export const saveLoggingConsistencyPreferences = async (
  userId: string,
  preferences: LoggingConsistencyPreferences,
  store: LoggingConsistencyStore = SecureStore,
): Promise<boolean> => {
  try {
    await store.setItemAsync(
      loggingConsistencyKey(userId),
      JSON.stringify({
        weeklyGoal: clampWeeklyLogGoal(preferences.weeklyGoal),
        hidden: preferences.hidden,
      }),
    );
    return true;
  } catch {
    return false;
  }
};

/** Account deletion: remove the stored preference. */
export const clearLoggingConsistencyPreferences = async (
  userId: string,
  store: LoggingConsistencyStore = SecureStore,
): Promise<void> => {
  if (typeof store.deleteItemAsync === "function")
    await store.deleteItemAsync(loggingConsistencyKey(userId));
  else await store.setItemAsync(loggingConsistencyKey(userId), "");
};
