import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export interface CoachReminderSettings {
  readonly dailyEnabled: boolean;
  readonly weeklyEnabled: boolean;
  readonly hour: number;
  readonly minute: number;
  /** Expo weekday: 1 Sunday through 7 Saturday. */
  readonly weeklyWeekday: number;
  readonly notificationIds: readonly string[];
}

export const DEFAULT_COACH_REMINDERS: CoachReminderSettings = {
  dailyEnabled: false,
  weeklyEnabled: false,
  hour: 19,
  minute: 0,
  weeklyWeekday: 1,
  notificationIds: [],
};

interface ReminderStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
}

export interface ReminderScheduler {
  ensureChannel(): Promise<void>;
  getPermission(): Promise<"granted" | "denied" | "undetermined">;
  requestPermission(): Promise<"granted" | "denied" | "undetermined">;
  schedule(input: {
    readonly kind: "daily" | "weekly";
    readonly hour: number;
    readonly minute?: number;
    readonly weekday?: number;
  }): Promise<string>;
  cancel(id: string): Promise<void>;
}

const keyFor = (userId: string): string => `mizyun.coach-reminders.${userId}`;

export const isCoachReminderSettings = (
  value: unknown,
): value is CoachReminderSettings => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CoachReminderSettings>;
  return (
    typeof candidate.dailyEnabled === "boolean" &&
    typeof candidate.weeklyEnabled === "boolean" &&
    Number.isInteger(candidate.hour) &&
    (candidate.hour as number) >= 0 &&
    (candidate.hour as number) <= 23 &&
    (candidate.minute === undefined ||
      (Number.isInteger(candidate.minute) &&
        (candidate.minute as number) >= 0 &&
        (candidate.minute as number) <= 59)) &&
    Number.isInteger(candidate.weeklyWeekday) &&
    (candidate.weeklyWeekday as number) >= 1 &&
    (candidate.weeklyWeekday as number) <= 7 &&
    Array.isArray(candidate.notificationIds) &&
    candidate.notificationIds.every((id) => typeof id === "string")
  );
};

export const loadCoachReminders = async (
  userId: string,
  store: ReminderStore = SecureStore,
): Promise<CoachReminderSettings> => {
  try {
    const raw = await store.getItemAsync(keyFor(userId));
    if (raw === null) return DEFAULT_COACH_REMINDERS;
    const parsed: unknown = JSON.parse(raw);
    if (!isCoachReminderSettings(parsed)) return DEFAULT_COACH_REMINDERS;
    return {
      ...parsed,
      minute: parsed.minute ?? 0,
    };
  } catch {
    return DEFAULT_COACH_REMINDERS;
  }
};

export const applyCoachReminders = async (
  userId: string,
  requested: {
    readonly dailyEnabled: boolean;
    readonly weeklyEnabled: boolean;
    readonly hour: number;
    readonly minute?: number;
    readonly weeklyWeekday: number;
  },
  scheduler: ReminderScheduler = expoReminderScheduler,
  store: ReminderStore = SecureStore,
): Promise<
  | { readonly ok: true; readonly settings: CoachReminderSettings }
  | { readonly ok: false; readonly reason: "permission_denied" | "unavailable" }
> => {
  const previous = await loadCoachReminders(userId, store);
  const nextIds: string[] = [];
  try {
    const enabled = requested.dailyEnabled || requested.weeklyEnabled;
    if (enabled) {
      await scheduler.ensureChannel();
      const existing = await scheduler.getPermission();
      const permission =
        existing === "granted" ? existing : await scheduler.requestPermission();
      if (permission !== "granted") {
        return { ok: false, reason: "permission_denied" };
      }
    }
    if (requested.dailyEnabled) {
      nextIds.push(
        await scheduler.schedule({
          kind: "daily",
          hour: requested.hour,
          minute: requested.minute,
        }),
      );
    }
    if (requested.weeklyEnabled) {
      nextIds.push(
        await scheduler.schedule({
          kind: "weekly",
          hour: requested.hour,
          minute: requested.minute,
          weekday: requested.weeklyWeekday,
        }),
      );
    }
    await Promise.all(
      previous.notificationIds.map((id) => scheduler.cancel(id)),
    );
    const settings = {
      ...requested,
      minute: requested.minute ?? 0,
      notificationIds: nextIds,
    };
    await store.setItemAsync(keyFor(userId), JSON.stringify(settings));
    return { ok: true, settings };
  } catch {
    await Promise.allSettled(nextIds.map((id) => scheduler.cancel(id)));
    return { ok: false, reason: "unavailable" };
  }
};

export const expoReminderScheduler: ReminderScheduler = {
  ensureChannel: async () => {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync("coach-reminders", {
      name: "Coach reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  },
  getPermission: async () => (await Notifications.getPermissionsAsync()).status,
  requestPermission: async () =>
    (await Notifications.requestPermissionsAsync()).status,
  schedule: async (input) =>
    Notifications.scheduleNotificationAsync({
      content:
        input.kind === "daily"
          ? {
              title: "Your Mizyun day",
              body: "Open Coach to review what remains for nutrition and training.",
              data: {
                url: "/coach",
                prompt: "What should I do today?",
                autoSend: "true",
              },
            }
          : {
              title: "Review your confirmed week",
              body: "Open Coach for an evidence-gated weekly adaptation.",
              data: {
                url: "/coach",
                prompt: "Review my week",
                autoSend: "true",
              },
            },
      trigger:
        input.kind === "daily"
          ? {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
              hour: input.hour,
              minute: input.minute ?? 0,
              channelId: "coach-reminders",
            }
          : {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: input.weekday ?? 1,
              hour: input.hour,
              minute: input.minute ?? 0,
              channelId: "coach-reminders",
            },
    }),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
};
