import { describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import {
  applyFirstMealReminders,
  clearFirstMealReminders,
  computeReminderScheduleDates,
  DEFAULT_FIRST_MEAL_REMINDERS,
  expoFirstMealReminderScheduler,
  isFirstMealReminderSettings,
  loadFirstMealReminders,
  markFirstMealPromptDismissed,
  reconcileFirstMealReminders,
  type FirstMealReminderScheduler,
} from "./first-meal-reminders";

const userId = "00000000-0000-4000-8000-000000000001";
const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
};

describe("First meal reminders", () => {
  describe("isFirstMealReminderSettings", () => {
    it("validates correct settings structure", () => {
      expect(isFirstMealReminderSettings(DEFAULT_FIRST_MEAL_REMINDERS)).toBe(
        true,
      );
      expect(
        isFirstMealReminderSettings({
          enabled: true,
          hour: 9,
          minute: 15,
          routineLabel: "Morning coffee",
          promptDismissed: true,
          notificationIds: ["id-1"],
        }),
      ).toBe(true);
    });

    it("rejects invalid structures", () => {
      expect(isFirstMealReminderSettings(null)).toBe(false);
      expect(isFirstMealReminderSettings({})).toBe(false);
      expect(
        isFirstMealReminderSettings({
          enabled: "true",
          hour: 9,
          minute: 0,
          notificationIds: [],
        }),
      ).toBe(false);
      expect(
        isFirstMealReminderSettings({
          enabled: true,
          hour: 25,
          minute: 0,
          notificationIds: [],
        }),
      ).toBe(false);
    });
  });

  describe("computeReminderScheduleDates", () => {
    it("includes today when today is unlogged and current time is before reminder", () => {
      const now = new Date(2026, 8, 23, 7, 0, 0); // 7:00 AM
      const dates = computeReminderScheduleDates(
        { hour: 8, minute: 30 },
        { todayLogged: false, now },
      );
      expect(dates).toHaveLength(7);
      expect(dates[0].getDate()).toBe(23);
      expect(dates[0].getHours()).toBe(8);
      expect(dates[0].getMinutes()).toBe(30);
    });

    it("suppresses today when today has already been logged", () => {
      const now = new Date(2026, 8, 23, 7, 0, 0); // 7:00 AM, meal already logged
      const dates = computeReminderScheduleDates(
        { hour: 8, minute: 30 },
        { todayLogged: true, now },
      );
      expect(dates).toHaveLength(6);
      expect(dates[0].getDate()).toBe(24); // starts tomorrow
    });

    it("suppresses today when current time is after reminder time today", () => {
      const now = new Date(2026, 8, 23, 9, 30, 0); // 9:30 AM
      const dates = computeReminderScheduleDates(
        { hour: 8, minute: 30 },
        { todayLogged: false, now },
      );
      expect(dates).toHaveLength(6);
      expect(dates[0].getDate()).toBe(24); // starts tomorrow
    });
  });

  describe("loadFirstMealReminders & markFirstMealPromptDismissed", () => {
    it("returns default when no stored settings exist", async () => {
      const store = memoryStore();
      const settings = await loadFirstMealReminders(userId, store);
      expect(settings).toEqual(DEFAULT_FIRST_MEAL_REMINDERS);
    });

    it("marks prompt dismissed in store", async () => {
      const store = memoryStore();
      const updated = await markFirstMealPromptDismissed(userId, store);
      expect(updated.promptDismissed).toBe(true);
      const reloaded = await loadFirstMealReminders(userId, store);
      expect(reloaded.promptDismissed).toBe(true);
    });
  });

  describe("applyFirstMealReminders", () => {
    it("fails with permission_denied when notification permission is rejected", async () => {
      const store = memoryStore();
      let scheduled = 0;
      const scheduler: FirstMealReminderScheduler = {
        ensureChannel: async () => undefined,
        getPermission: async () => "undetermined",
        requestPermission: async () => "denied",
        scheduleAtDate: async () => {
          scheduled += 1;
          return "id-x";
        },
        cancel: async () => undefined,
      };

      const result = await applyFirstMealReminders(
        userId,
        { enabled: true, hour: 8, minute: 30 },
        { todayLogged: false },
        scheduler,
        store,
      );

      expect(result).toEqual({ ok: false, reason: "permission_denied" });
      expect(scheduled).toBe(0);
      expect(store.values.size).toBe(0);
    });

    it("schedules notifications and stores ids when permission is granted", async () => {
      const store = memoryStore();
      const scheduledDates: Date[] = [];
      const scheduler: FirstMealReminderScheduler = {
        ensureChannel: async () => undefined,
        getPermission: async () => "granted",
        requestPermission: async () => "granted",
        scheduleAtDate: async (date) => {
          scheduledDates.push(date);
          return `notif-${scheduledDates.length}`;
        },
        cancel: async () => undefined,
      };

      const fixedNow = new Date(2026, 8, 23, 7, 0, 0);
      const result = await applyFirstMealReminders(
        userId,
        {
          enabled: true,
          hour: 8,
          minute: 30,
          routineLabel: "Morning coffee",
        },
        { todayLogged: false, now: () => fixedNow },
        scheduler,
        store,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.settings.enabled).toBe(true);
      expect(result.settings.notificationIds).toHaveLength(7);
      expect(result.settings.routineLabel).toBe("Morning coffee");
      expect(scheduledDates).toHaveLength(7);
    });

    it("cancels previous notifications when updating or disabling", async () => {
      const store = memoryStore();
      const cancelled: string[] = [];
      let count = 0;
      const scheduler: FirstMealReminderScheduler = {
        ensureChannel: async () => undefined,
        getPermission: async () => "granted",
        requestPermission: async () => "granted",
        scheduleAtDate: async () => `notif-${++count}`,
        cancel: async (id) => {
          cancelled.push(id);
        },
      };

      const fixedNow = new Date(2026, 8, 23, 7, 0, 0);
      await applyFirstMealReminders(
        userId,
        { enabled: true, hour: 8, minute: 30 },
        { todayLogged: false, now: () => fixedNow },
        scheduler,
        store,
      );

      expect(cancelled).toHaveLength(0);

      // Disable
      const disabled = await applyFirstMealReminders(
        userId,
        { enabled: false, hour: 8, minute: 30 },
        {},
        scheduler,
        store,
      );

      expect(disabled.ok).toBe(true);
      if (!disabled.ok) return;
      expect(disabled.settings.enabled).toBe(false);
      expect(disabled.settings.notificationIds).toHaveLength(0);
      expect(cancelled).toHaveLength(7);
    });
  });

  describe("reconcileFirstMealReminders", () => {
    it("cancels today notification when reconciled with todayLogged: true", async () => {
      const store = memoryStore();
      const cancelled: string[] = [];
      const scheduledDates: Date[] = [];
      const scheduler: FirstMealReminderScheduler = {
        ensureChannel: async () => undefined,
        getPermission: async () => "granted",
        requestPermission: async () => "granted",
        scheduleAtDate: async (date) => {
          scheduledDates.push(date);
          return `notif-${scheduledDates.length}`;
        },
        cancel: async (id) => {
          cancelled.push(id);
        },
      };

      const morningBeforeLog = new Date(2026, 8, 23, 7, 0, 0);
      // Initially scheduled before meal is logged (includes today)
      await applyFirstMealReminders(
        userId,
        { enabled: true, hour: 8, minute: 30 },
        { todayLogged: false, now: () => morningBeforeLog },
        scheduler,
        store,
      );

      expect(scheduledDates[0].getDate()).toBe(23);

      // Now user logs meal at 7:30 AM -> reconcile with todayLogged: true
      scheduledDates.length = 0;
      const reconciled = await reconcileFirstMealReminders(
        userId,
        { todayLogged: true, now: () => new Date(2026, 8, 23, 7, 30, 0) },
        scheduler,
        store,
      );

      expect(cancelled).toHaveLength(7); // cancelled all old IDs
      expect(reconciled.notificationIds).toHaveLength(6); // 6 days ahead, today excluded!
      expect(scheduledDates[0].getDate()).toBe(24); // starts tomorrow
    });
  });

  describe("clearFirstMealReminders", () => {
    it("cancels all notifications and deletes or resets store", async () => {
      const store = memoryStore();
      const cancelled: string[] = [];
      const scheduler: FirstMealReminderScheduler = {
        ensureChannel: async () => undefined,
        getPermission: async () => "granted",
        requestPermission: async () => "granted",
        scheduleAtDate: async () => "notif-1",
        cancel: async (id) => {
          cancelled.push(id);
        },
      };

      await applyFirstMealReminders(
        userId,
        { enabled: true, hour: 8, minute: 30 },
        { todayLogged: false },
        scheduler,
        store,
      );

      await clearFirstMealReminders(userId, scheduler, store);
      expect(cancelled.length).toBeGreaterThan(0);
      const after = await loadFirstMealReminders(userId, store);
      expect(after.enabled).toBe(false);
      expect(after.notificationIds).toHaveLength(0);
    });
  });
});
