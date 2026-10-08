import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import {
  activateFirstMealReminders,
  suspendFirstMealReminders,
  reconcileFirstMealReminders,
} from "@/features/log-meal/first-meal-reminders";
import { fetchFoodDay } from "@/features/log-meal/meal-lifecycle-data";
import { loadQuickMealRepeat } from "@/features/dashboard/public-data";
import {
  FirstMealReminderLifecycle,
  sweepUnownedFirstMealNotifications,
} from "./first-meal-reminder-lifecycle";

const OWNER_KEY = "mizyun.first-meal-reminder-owners";
export const firstMealReminderLifecycle = new FirstMealReminderLifecycle({
  sweep: (owner) =>
    sweepUnownedFirstMealNotifications(owner, {
      list: () => Notifications.getAllScheduledNotificationsAsync(),
      cancel: (identifier) =>
        Notifications.cancelScheduledNotificationAsync(identifier),
    }),
  readOwners: async () => {
    const raw = await SecureStore.getItemAsync(OWNER_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((owner) => typeof owner === "string" && owner.length > 0)
    )
      throw new Error("Reminder owner journal unavailable");
    return parsed;
  },
  writeOwners: async (owners) => {
    await SecureStore.setItemAsync(OWNER_KEY, JSON.stringify(owners));
  },
  activate: activateFirstMealReminders,
  suspend: suspendFirstMealReminders,
  readToday: async (date, owner) => {
    // A confirmed local copy remains proof across restart and stale server reads.
    // Lifecycle activation precedes this read; its owner/day fence follows it.
    const repeat = await loadQuickMealRepeat(owner, date);
    if (repeat?.completed) return true;
    const result = await fetchFoodDay(date);
    return result.message === null && result.summary !== null
      ? result.summary.entryCount > 0
      : null;
  },
  reconcile: (owner, todayLogged) =>
    reconcileFirstMealReminders(owner, { todayLogged }),
  now: () => new Date(),
});
