import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export interface EveningCatchUpReminderSettings {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly notificationIds: readonly string[];
  readonly lastReconciledDate?: string | null;
}

export const DEFAULT_EVENING_REMINDERS: EveningCatchUpReminderSettings = {
  enabled: false,
  hour: 20,
  minute: 30,
  notificationIds: [],
  lastReconciledDate: null,
};

export interface EveningReminderStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

export interface EveningReminderScheduler {
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
  `mizyun.evening-catchup-reminders.${userId}`;

export const isEveningReminderSettings = (
  value: unknown,
): value is EveningCatchUpReminderSettings => {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<EveningCatchUpReminderSettings>;
  return (
    typeof c.enabled === "boolean" &&
    Number.isInteger(c.hour) &&
    (c.hour as number) >= 0 &&
    (c.hour as number) <= 23 &&
    Number.isInteger(c.minute) &&
    (c.minute as number) >= 0 &&
    (c.minute as number) <= 59 &&
    Array.isArray(c.notificationIds) &&
    c.notificationIds.every((id) => typeof id === "string") &&
    (c.lastReconciledDate === undefined ||
      c.lastReconciledDate === null ||
      typeof c.lastReconciledDate === "string")
  );
};

export const loadEveningReminders = async (
  userId: string,
  store: EveningReminderStore = SecureStore,
): Promise<EveningCatchUpReminderSettings> => {
  try {
    const raw = await store.getItemAsync(keyFor(userId));
    if (raw === null) return DEFAULT_EVENING_REMINDERS;
    const parsed: unknown = JSON.parse(raw);
    if (!isEveningReminderSettings(parsed)) return DEFAULT_EVENING_REMINDERS;
    return parsed;
  } catch {
    return DEFAULT_EVENING_REMINDERS;
  }
};

const ROLLING_SCHEDULE_DAYS = 7;

export interface EveningReminderScheduleOptions {
  readonly todayCompleted?: boolean;
  readonly hasMealAfter6Pm?: boolean;
  readonly calorieTargetReached?: boolean;
  readonly now?: Date | (() => Date);
}

export const computeEveningReminderScheduleDates = (
  settings: { readonly hour: number; readonly minute: number },
  options: EveningReminderScheduleOptions = {},
): Date[] => {
  const now =
    typeof options.now === "function"
      ? options.now()
      : (options.now ?? new Date());
  const dates: Date[] = [];
  const shouldSuppressToday =
    Boolean(options.todayCompleted) ||
    Boolean(options.hasMealAfter6Pm) ||
    Boolean(options.calorieTargetReached);

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
      if (shouldSuppressToday) {
        // Suppress today's evening reminder because the user explicitly confirmed day completion,
        // logged a meal after 6:00 PM, or reached their daily calorie target.
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

export const applyEveningReminders = async (
  userId: string,
  requested: {
    readonly enabled: boolean;
    readonly hour: number;
    readonly minute: number;
  },
  options: EveningReminderScheduleOptions = {},
  scheduler: EveningReminderScheduler = expoEveningReminderScheduler,
  store: EveningReminderStore = SecureStore,
): Promise<
  | { readonly ok: true; readonly settings: EveningCatchUpReminderSettings }
  | { readonly ok: false; readonly reason: "permission_denied" | "unavailable" }
> => {
  const previous = await loadEveningReminders(userId, store);
  const nextIds: string[] = [];
  const now =
    typeof options.now === "function"
      ? options.now()
      : (options.now ?? new Date());

  try {
    if (requested.enabled) {
      await scheduler.ensureChannel();
      const existing = await scheduler.getPermission();
      const permission =
        existing === "granted" ? existing : await scheduler.requestPermission();
      if (permission !== "granted") {
        return { ok: false, reason: "permission_denied" };
      }

      const scheduleDates = computeEveningReminderScheduleDates(requested, {
        todayCompleted: options.todayCompleted,
        hasMealAfter6Pm: options.hasMealAfter6Pm,
        calorieTargetReached: options.calorieTargetReached,
        now,
      });

      for (const date of scheduleDates) {
        const id = await scheduler.scheduleAtDate(date, {
          title: "Evening food log catch-up",
          body: "Anything else to add from today? Add missed meals or review your day.",
          data: {
            url: "/meals",
            source: "evening_catch_up_reminder",
          },
        });
        nextIds.push(id);
      }
    }

    // Cancel old notifications after scheduling new ones.
    await Promise.all(
      previous.notificationIds.map((id) => scheduler.cancel(id)),
    );

    const settings: EveningCatchUpReminderSettings = {
      enabled: requested.enabled,
      hour: requested.hour,
      minute: requested.minute,
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

export const reconcileEveningReminders = async (
  userId: string,
  options: EveningReminderScheduleOptions = {},
  scheduler: EveningReminderScheduler = expoEveningReminderScheduler,
  store: EveningReminderStore = SecureStore,
): Promise<EveningCatchUpReminderSettings> => {
  const current = await loadEveningReminders(userId, store);
  if (!current.enabled) {
    if (current.notificationIds.length > 0) {
      await Promise.allSettled(
        current.notificationIds.map((id) => scheduler.cancel(id)),
      );
      const cleaned: EveningCatchUpReminderSettings = {
        ...current,
        notificationIds: [],
      };
      await store.setItemAsync(keyFor(userId), JSON.stringify(cleaned));
      return cleaned;
    }
    return current;
  }

  const result = await applyEveningReminders(
    userId,
    {
      enabled: true,
      hour: current.hour,
      minute: current.minute,
    },
    options,
    scheduler,
    store,
  );

  return result.ok ? result.settings : current;
};

export const clearEveningReminders = async (
  userId: string,
  scheduler: EveningReminderScheduler = expoEveningReminderScheduler,
  store: EveningReminderStore = SecureStore,
): Promise<void> => {
  try {
    const previous = await loadEveningReminders(userId, store);
    await Promise.allSettled(
      previous.notificationIds.map((id) => scheduler.cancel(id)),
    );
    if (typeof store.deleteItemAsync === "function") {
      await store.deleteItemAsync(keyFor(userId));
    } else {
      await store.setItemAsync(
        keyFor(userId),
        JSON.stringify(DEFAULT_EVENING_REMINDERS),
      );
    }
  } catch {
    // Best-effort cleanup during account deletion or logout.
  }
};

export const expoEveningReminderScheduler: EveningReminderScheduler = {
  ensureChannel: async () => {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync("evening-reminders", {
      name: "Evening catch-up reminders",
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
        channelId: "evening-reminders",
      },
    }),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
};
