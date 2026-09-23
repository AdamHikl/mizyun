import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export interface FirstMealReminderSettings {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly routineLabel?: string | null;
  readonly promptDismissed?: boolean;
  readonly notificationIds: readonly string[];
  readonly lastReconciledDate?: string | null;
}

export const DEFAULT_FIRST_MEAL_REMINDERS: FirstMealReminderSettings = {
  enabled: false,
  hour: 8,
  minute: 30,
  routineLabel: null,
  promptDismissed: false,
  notificationIds: [],
  lastReconciledDate: null,
};

export interface ReminderStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

export interface FirstMealReminderScheduler {
  ensureChannel(): Promise<void>;
  getPermission(): Promise<"granted" | "denied" | "undetermined">;
  requestPermission(): Promise<"granted" | "denied" | "undetermined">;
  scheduleAtDate(
    date: Date,
    payload: {
      readonly title: string;
      readonly body: string;
      readonly data: Record<string, unknown>;
    },
  ): Promise<string>;
  cancel(id: string): Promise<void>;
}

const keyFor = (userId: string): string =>
  `mizyun.first-meal-reminders.${userId}`;

export const isFirstMealReminderSettings = (
  value: unknown,
): value is FirstMealReminderSettings => {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<FirstMealReminderSettings>;
  return (
    typeof c.enabled === "boolean" &&
    Number.isInteger(c.hour) &&
    (c.hour as number) >= 0 &&
    (c.hour as number) <= 23 &&
    Number.isInteger(c.minute) &&
    (c.minute as number) >= 0 &&
    (c.minute as number) <= 59 &&
    (c.routineLabel === undefined ||
      c.routineLabel === null ||
      typeof c.routineLabel === "string") &&
    (c.promptDismissed === undefined ||
      typeof c.promptDismissed === "boolean") &&
    Array.isArray(c.notificationIds) &&
    c.notificationIds.every((id) => typeof id === "string") &&
    (c.lastReconciledDate === undefined ||
      c.lastReconciledDate === null ||
      typeof c.lastReconciledDate === "string")
  );
};

export const loadFirstMealReminders = async (
  userId: string,
  store: ReminderStore = SecureStore,
): Promise<FirstMealReminderSettings> => {
  try {
    const raw = await store.getItemAsync(keyFor(userId));
    if (raw === null) return DEFAULT_FIRST_MEAL_REMINDERS;
    const parsed: unknown = JSON.parse(raw);
    if (!isFirstMealReminderSettings(parsed))
      return DEFAULT_FIRST_MEAL_REMINDERS;
    return parsed;
  } catch {
    return DEFAULT_FIRST_MEAL_REMINDERS;
  }
};

export const markFirstMealPromptDismissed = async (
  userId: string,
  store: ReminderStore = SecureStore,
): Promise<FirstMealReminderSettings> => {
  const current = await loadFirstMealReminders(userId, store);
  const updated: FirstMealReminderSettings = {
    ...current,
    promptDismissed: true,
  };
  await store.setItemAsync(keyFor(userId), JSON.stringify(updated));
  return updated;
};

const ROLLING_SCHEDULE_DAYS = 7;

export const computeReminderScheduleDates = (
  settings: { readonly hour: number; readonly minute: number },
  options: { readonly todayLogged: boolean; readonly now?: Date },
): Date[] => {
  const now = options.now ?? new Date();
  const dates: Date[] = [];

  for (let offset = 0; offset < ROLLING_SCHEDULE_DAYS; offset++) {
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      settings.hour,
      settings.minute,
      0,
      0,
    );

    if (offset === 0) {
      if (options.todayLogged) {
        // Suppress today's reminder because the first meal is already logged.
        continue;
      }
      if (target.getTime() <= now.getTime()) {
        // Target time today has already elapsed.
        continue;
      }
    }

    dates.push(target);
  }

  return dates;
};

const isoLocalDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const applyFirstMealReminders = async (
  userId: string,
  requested: {
    readonly enabled: boolean;
    readonly hour: number;
    readonly minute: number;
    readonly routineLabel?: string | null;
  },
  options: {
    readonly todayLogged?: boolean;
    readonly now?: () => Date;
  } = {},
  scheduler: FirstMealReminderScheduler = expoFirstMealReminderScheduler,
  store: ReminderStore = SecureStore,
): Promise<
  | { readonly ok: true; readonly settings: FirstMealReminderSettings }
  | { readonly ok: false; readonly reason: "permission_denied" | "unavailable" }
> => {
  const previous = await loadFirstMealReminders(userId, store);
  const nextIds: string[] = [];
  const now = options.now ? options.now() : new Date();

  try {
    if (requested.enabled) {
      await scheduler.ensureChannel();
      const existing = await scheduler.getPermission();
      const permission =
        existing === "granted" ? existing : await scheduler.requestPermission();
      if (permission !== "granted") {
        return { ok: false, reason: "permission_denied" };
      }

      const scheduleDates = computeReminderScheduleDates(requested, {
        todayLogged: options.todayLogged ?? false,
        now,
      });

      for (const date of scheduleDates) {
        const id = await scheduler.scheduleAtDate(date, {
          title: "First meal of the day",
          body: requested.routineLabel?.trim()
            ? `Time for ${requested.routineLabel.trim()} — log your meal or repeat a recent one.`
            : "Log your first meal or review recent meals to keep your day on track.",
          data: {
            url: "/log-meal",
            source: "first_meal_reminder",
          },
        });
        nextIds.push(id);
      }
    }

    // Cancel old notifications after scheduling new ones.
    await Promise.all(
      previous.notificationIds.map((id) => scheduler.cancel(id)),
    );

    const settings: FirstMealReminderSettings = {
      enabled: requested.enabled,
      hour: requested.hour,
      minute: requested.minute,
      routineLabel: requested.routineLabel ?? null,
      promptDismissed: true,
      notificationIds: nextIds,
      lastReconciledDate: isoLocalDate(now),
    };

    await store.setItemAsync(keyFor(userId), JSON.stringify(settings));
    return { ok: true, settings };
  } catch {
    await Promise.allSettled(nextIds.map((id) => scheduler.cancel(id)));
    return { ok: false, reason: "unavailable" };
  }
};

export const reconcileFirstMealReminders = async (
  userId: string,
  options: {
    readonly todayLogged: boolean;
    readonly now?: () => Date;
  },
  scheduler: FirstMealReminderScheduler = expoFirstMealReminderScheduler,
  store: ReminderStore = SecureStore,
): Promise<FirstMealReminderSettings> => {
  const current = await loadFirstMealReminders(userId, store);
  if (!current.enabled) {
    if (current.notificationIds.length > 0) {
      await Promise.allSettled(
        current.notificationIds.map((id) => scheduler.cancel(id)),
      );
      const cleaned: FirstMealReminderSettings = {
        ...current,
        notificationIds: [],
      };
      await store.setItemAsync(keyFor(userId), JSON.stringify(cleaned));
      return cleaned;
    }
    return current;
  }

  const result = await applyFirstMealReminders(
    userId,
    {
      enabled: true,
      hour: current.hour,
      minute: current.minute,
      routineLabel: current.routineLabel,
    },
    options,
    scheduler,
    store,
  );

  return result.ok ? result.settings : current;
};

export const clearFirstMealReminders = async (
  userId: string,
  scheduler: FirstMealReminderScheduler = expoFirstMealReminderScheduler,
  store: ReminderStore = SecureStore,
): Promise<void> => {
  try {
    const previous = await loadFirstMealReminders(userId, store);
    await Promise.allSettled(
      previous.notificationIds.map((id) => scheduler.cancel(id)),
    );
    if (typeof store.deleteItemAsync === "function") {
      await store.deleteItemAsync(keyFor(userId));
    } else {
      await store.setItemAsync(
        keyFor(userId),
        JSON.stringify(DEFAULT_FIRST_MEAL_REMINDERS),
      );
    }
  } catch {
    // Best-effort cleanup during account deletion or logout.
  }
};

export const expoFirstMealReminderScheduler: FirstMealReminderScheduler = {
  ensureChannel: async () => {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync("first-meal-reminders", {
      name: "First meal reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  },
  getPermission: async () => (await Notifications.getPermissionsAsync()).status,
  requestPermission: async () =>
    (await Notifications.requestPermissionsAsync()).status,
  scheduleAtDate: async (date, payload) =>
    Notifications.scheduleNotificationAsync({
      content: {
        title: payload.title,
        body: payload.body,
        data: payload.data,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        channelId: "first-meal-reminders",
      },
    }),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
};
