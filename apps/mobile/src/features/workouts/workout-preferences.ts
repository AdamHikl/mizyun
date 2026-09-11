import * as SecureStore from "expo-secure-store";

export interface WorkoutPreferences {
  readonly defaultRestSeconds: number;
  readonly liveNotificationEnabled: boolean;
}

export const DEFAULT_REST_SECONDS = 180; // 3 minutes
export const DEFAULT_LIVE_NOTIFICATION_ENABLED = true;
export const MIN_REST_SECONDS = 15;
export const MAX_REST_SECONDS = 600; // 10 minutes
export const REST_DURATION_PRESETS = [60, 90, 120, 150, 180, 240, 300] as const;

export interface PreferencesStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
}

export const keyFor = (userId?: string): string =>
  `mizyun.workout-preferences.${userId ?? "global"}`;

export const loadWorkoutPreferences = async (
  userId?: string,
  store: PreferencesStore = SecureStore,
): Promise<WorkoutPreferences> => {
  try {
    const raw = await store.getItemAsync(keyFor(userId));
    if (raw === null) {
      return {
        defaultRestSeconds: DEFAULT_REST_SECONDS,
        liveNotificationEnabled: DEFAULT_LIVE_NOTIFICATION_ENABLED,
      };
    }
    const parsed: unknown = JSON.parse(raw);
    let defaultRestSeconds = DEFAULT_REST_SECONDS;
    let liveNotificationEnabled = DEFAULT_LIVE_NOTIFICATION_ENABLED;

    if (typeof parsed === "object" && parsed !== null) {
      const rec = parsed as Record<string, unknown>;
      if (
        "defaultRestSeconds" in rec &&
        typeof rec.defaultRestSeconds === "number" &&
        Number.isInteger(rec.defaultRestSeconds) &&
        rec.defaultRestSeconds >= MIN_REST_SECONDS &&
        rec.defaultRestSeconds <= MAX_REST_SECONDS
      ) {
        defaultRestSeconds = rec.defaultRestSeconds;
      }
      if (
        "liveNotificationEnabled" in rec &&
        typeof rec.liveNotificationEnabled === "boolean"
      ) {
        liveNotificationEnabled = rec.liveNotificationEnabled;
      }
    }
    return { defaultRestSeconds, liveNotificationEnabled };
  } catch {
    return {
      defaultRestSeconds: DEFAULT_REST_SECONDS,
      liveNotificationEnabled: DEFAULT_LIVE_NOTIFICATION_ENABLED,
    };
  }
};

export const saveWorkoutPreferences = async (
  prefs: Partial<WorkoutPreferences> & { defaultRestSeconds?: number },
  userId?: string,
  store: PreferencesStore = SecureStore,
): Promise<boolean> => {
  try {
    const existing = await loadWorkoutPreferences(userId, store);
    const restSec = prefs.defaultRestSeconds ?? existing.defaultRestSeconds;
    const clamped = Math.min(
      MAX_REST_SECONDS,
      Math.max(MIN_REST_SECONDS, Math.round(restSec)),
    );
    const toSave: WorkoutPreferences = {
      defaultRestSeconds: clamped,
      liveNotificationEnabled:
        prefs.liveNotificationEnabled ?? existing.liveNotificationEnabled,
    };
    await store.setItemAsync(keyFor(userId), JSON.stringify(toSave));
    return true;
  } catch {
    return false;
  }
};

export const formatRestDuration = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

export const formatRestDurationLabel = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes} min`;
  }
  if (remainingSeconds === 30 && minutes > 0) {
    return `${minutes}.5 min`;
  }
  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds}s`;
};
