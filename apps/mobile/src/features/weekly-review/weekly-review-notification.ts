import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Weekly local notification: "Your weekly calorie check-in is ready", every
 * Monday at 09:00 device-local time. Default OFF (matches the other opt-in
 * reminders). Scheduled only while the preference is enabled AND the user
 * has an active goal; otherwise any scheduled notification is cancelled.
 */

export const WEEKLY_REVIEW_ROUTE = "/weekly-review";
export const WEEKLY_REVIEW_SOURCE = "weekly_calorie_review";
/** expo-notifications weekdays: Sunday = 1, Monday = 2. */
export const WEEKLY_REVIEW_TRIGGER = {
  weekday: 2,
  hour: 9,
  minute: 0,
} as const;

export interface WeeklyReviewReminderSettings {
  readonly enabled: boolean;
  readonly notificationId: string | null;
}

export const DEFAULT_WEEKLY_REVIEW_REMINDER: WeeklyReviewReminderSettings = {
  enabled: false,
  notificationId: null,
};

export interface WeeklyReviewReminderStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

export interface WeeklyReviewReminderScheduler {
  ensureChannel(): Promise<void>;
  getPermission(): Promise<"granted" | "denied" | "undetermined">;
  requestPermission(): Promise<"granted" | "denied" | "undetermined">;
  scheduleWeekly(payload: {
    readonly title: string;
    readonly body: string;
    readonly data: Record<string, unknown>;
    readonly trigger: typeof WEEKLY_REVIEW_TRIGGER;
  }): Promise<string>;
  cancel(id: string): Promise<void>;
}

export const weeklyReviewReminderKey = (userId: string): string =>
  `mizyun.weekly-review-reminder.${userId}`;

export const isWeeklyReviewReminderSettings = (
  value: unknown,
): value is WeeklyReviewReminderSettings => {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<WeeklyReviewReminderSettings>;
  return (
    typeof c.enabled === "boolean" &&
    (c.notificationId === null || typeof c.notificationId === "string")
  );
};

export const loadWeeklyReviewReminder = async (
  userId: string,
  store: WeeklyReviewReminderStore = SecureStore,
): Promise<WeeklyReviewReminderSettings> => {
  try {
    const raw = await store.getItemAsync(weeklyReviewReminderKey(userId));
    if (raw === null) return DEFAULT_WEEKLY_REVIEW_REMINDER;
    const parsed: unknown = JSON.parse(raw);
    return isWeeklyReviewReminderSettings(parsed)
      ? parsed
      : DEFAULT_WEEKLY_REVIEW_REMINDER;
  } catch {
    return DEFAULT_WEEKLY_REVIEW_REMINDER;
  }
};

export const NOTIFICATION_PAYLOAD = {
  title: "Your weekly calorie check-in is ready",
  body: "See how your week went and whether your calorie target should change.",
} as const;

export type ApplyWeeklyReviewReminderResult =
  | { readonly ok: true; readonly settings: WeeklyReviewReminderSettings }
  | {
      readonly ok: false;
      readonly reason: "permission_denied" | "unavailable";
    };

/**
 * Enable or disable the reminder. `hasActiveGoal` gates scheduling: with no
 * goal the preference is stored but nothing is scheduled.
 */
export const applyWeeklyReviewReminder = async (
  userId: string,
  requested: { readonly enabled: boolean },
  context: { readonly hasActiveGoal: boolean },
  scheduler: WeeklyReviewReminderScheduler = expoWeeklyReviewScheduler,
  store: WeeklyReviewReminderStore = SecureStore,
): Promise<ApplyWeeklyReviewReminderResult> => {
  const previous = await loadWeeklyReviewReminder(userId, store);
  let nextId: string | null = null;
  try {
    if (requested.enabled && context.hasActiveGoal) {
      await scheduler.ensureChannel();
      const existing = await scheduler.getPermission();
      const permission =
        existing === "granted" ? existing : await scheduler.requestPermission();
      if (permission !== "granted") {
        return { ok: false, reason: "permission_denied" };
      }
      nextId = await scheduler.scheduleWeekly({
        ...NOTIFICATION_PAYLOAD,
        data: {
          url: WEEKLY_REVIEW_ROUTE,
          source: WEEKLY_REVIEW_SOURCE,
          userId,
        },
        trigger: WEEKLY_REVIEW_TRIGGER,
      });
    }
    // Cancel the old one only after the new one exists.
    if (previous.notificationId !== null) {
      await scheduler.cancel(previous.notificationId);
    }
    const settings: WeeklyReviewReminderSettings = {
      enabled: requested.enabled,
      notificationId: nextId,
    };
    await store.setItemAsync(
      weeklyReviewReminderKey(userId),
      JSON.stringify(settings),
    );
    return { ok: true, settings };
  } catch {
    if (nextId !== null) await scheduler.cancel(nextId).catch(() => {});
    return { ok: false, reason: "unavailable" };
  }
};

/**
 * Keep the schedule in line with the goal: schedule when the preference is on
 * and a goal exists (and nothing is scheduled), cancel when the goal is gone.
 * Never prompts for permission.
 */
export const reconcileWeeklyReviewReminder = async (
  userId: string,
  context: { readonly hasActiveGoal: boolean },
  scheduler: WeeklyReviewReminderScheduler = expoWeeklyReviewScheduler,
  store: WeeklyReviewReminderStore = SecureStore,
): Promise<WeeklyReviewReminderSettings> => {
  const current = await loadWeeklyReviewReminder(userId, store);
  const shouldBeScheduled = current.enabled && context.hasActiveGoal;
  try {
    if (shouldBeScheduled && current.notificationId === null) {
      if ((await scheduler.getPermission()) !== "granted") return current;
      const result = await applyWeeklyReviewReminder(
        userId,
        { enabled: true },
        context,
        scheduler,
        store,
      );
      return result.ok ? result.settings : current;
    }
    if (!shouldBeScheduled && current.notificationId !== null) {
      await scheduler.cancel(current.notificationId);
      const cleaned = { ...current, notificationId: null };
      await store.setItemAsync(
        weeklyReviewReminderKey(userId),
        JSON.stringify(cleaned),
      );
      return cleaned;
    }
  } catch {
    // Reconciliation is best effort.
  }
  return current;
};

export const clearWeeklyReviewReminder = async (
  userId: string,
  scheduler: WeeklyReviewReminderScheduler = expoWeeklyReviewScheduler,
  store: WeeklyReviewReminderStore = SecureStore,
): Promise<void> => {
  try {
    const previous = await loadWeeklyReviewReminder(userId, store);
    if (previous.notificationId !== null) {
      await scheduler.cancel(previous.notificationId).catch(() => {});
    }
    if (typeof store.deleteItemAsync === "function") {
      await store.deleteItemAsync(weeklyReviewReminderKey(userId));
    } else {
      await store.setItemAsync(
        weeklyReviewReminderKey(userId),
        JSON.stringify(DEFAULT_WEEKLY_REVIEW_REMINDER),
      );
    }
  } catch {
    // Best-effort cleanup during account deletion or logout.
  }
};

export const expoWeeklyReviewScheduler: WeeklyReviewReminderScheduler = {
  ensureChannel: async () => {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync("weekly-review", {
      name: "Weekly calorie check-in",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  },
  getPermission: async () => (await Notifications.getPermissionsAsync()).status,
  requestPermission: async () =>
    (await Notifications.requestPermissionsAsync()).status,
  scheduleWeekly: async (payload) =>
    Notifications.scheduleNotificationAsync({
      content: {
        title: payload.title,
        body: payload.body,
        data: payload.data,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: payload.trigger.weekday,
        hour: payload.trigger.hour,
        minute: payload.trigger.minute,
        channelId: "weekly-review",
      },
    }),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
};
