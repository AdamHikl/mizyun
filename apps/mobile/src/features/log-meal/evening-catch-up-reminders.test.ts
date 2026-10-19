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
  applyEveningReminders,
  clearEveningReminders,
  computeEveningReminderScheduleDates,
  DEFAULT_EVENING_REMINDERS,
  expoEveningReminderScheduler,
  isEveningReminderSettings,
  loadEveningReminders,
  reconcileEveningReminders,
  type EveningReminderScheduler,
} from "./evening-catch-up-reminders";

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

describe("Evening catch-up reminders", () => {
  describe("isEveningReminderSettings", () => {
    it("validates correct settings structure", () => {
      expect(isEveningReminderSettings(DEFAULT_EVENING_REMINDERS)).toBe(true);
      expect(
        isEveningReminderSettings({
          enabled: true,
          hour: 20,
          minute: 30,
          notificationIds: ["id-1"],
        }),
      ).toBe(true);
    });

    it("rejects invalid structures", () => {
      expect(isEveningReminderSettings(null)).toBe(false);
      expect(isEveningReminderSettings({})).toBe(false);
      expect(
        isEveningReminderSettings({
          enabled: "true",
          hour: 20,
          minute: 0,
          notificationIds: [],
        }),
      ).toBe(false);
      expect(
        isEveningReminderSettings({
          enabled: true,
          hour: 25,
          minute: 0,
          notificationIds: [],
        }),
      ).toBe(false);
    });
  });

  describe("computeEveningReminderScheduleDates", () => {
    it("includes today when today is incomplete and current time is before reminder", () => {
      const now = new Date(2026, 8, 23, 18, 0, 0); // 6:00 PM
      const dates = computeEveningReminderScheduleDates(
        { hour: 20, minute: 30 },
        { todayCompleted: false, now },
      );
      expect(dates).toHaveLength(7);
      expect(dates[0].getDate()).toBe(23);
      expect(dates[0].getHours()).toBe(20);
      expect(dates[0].getMinutes()).toBe(30);
    });

    it("suppresses today when user explicitly confirmed day completion", () => {
      const now = new Date(2026, 8, 23, 18, 0, 0); // 6:00 PM, day completed
      const dates = computeEveningReminderScheduleDates(
        { hour: 20, minute: 30 },
        { todayCompleted: true, now },
      );
      expect(dates).toHaveLength(6);
      expect(dates[0].getDate()).toBe(24); // Tomorrow
    });

    it("suppresses today when meal has been logged after 6:00 PM", () => {
      const now = new Date(2026, 8, 23, 18, 15, 0);
      const dates = computeEveningReminderScheduleDates(
        { hour: 20, minute: 30 },
        { hasMealAfter6Pm: true, now },
      );
      expect(dates).toHaveLength(6);
      expect(dates[0].getDate()).toBe(24); // Tomorrow
    });

    it("suppresses today when daily calorie target has been reached", () => {
      const now = new Date(2026, 8, 23, 14, 0, 0);
      const dates = computeEveningReminderScheduleDates(
        { hour: 20, minute: 30 },
        { calorieTargetReached: true, now },
      );
      expect(dates).toHaveLength(6);
      expect(dates[0].getDate()).toBe(24); // Tomorrow
    });

    it("suppresses today when reminder time has already passed today", () => {
      const now = new Date(2026, 8, 23, 21, 0, 0); // 9:00 PM (past 8:30 PM)
      const dates = computeEveningReminderScheduleDates(
        { hour: 20, minute: 30 },
        { todayCompleted: false, now },
      );
      expect(dates).toHaveLength(6);
      expect(dates[0].getDate()).toBe(24); // Tomorrow
    });
  });

  describe("applyEveningReminders & reconcileEveningReminders", () => {
    it("returns permission_denied if permission is denied", async () => {
      const store = memoryStore();
      const mockScheduler: EveningReminderScheduler = {
        ensureChannel: vi.fn().mockResolvedValue(undefined),
        getPermission: vi.fn().mockResolvedValue("denied"),
        requestPermission: vi.fn().mockResolvedValue("denied"),
        scheduleAtDate: vi.fn(),
        cancel: vi.fn(),
        listScheduled: vi.fn().mockResolvedValue([]),
      };

      const result = await applyEveningReminders(
        userId,
        { enabled: true, hour: 20, minute: 30 },
        {},
        mockScheduler,
        store,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("permission_denied");
      }
    });

    it("schedules rolling notifications when enabled and cancels old ones", async () => {
      const store = memoryStore();
      const scheduledDates: Date[] = [];
      const cancelledIds: string[] = [];
      let nextId = 1;

      const mockScheduler: EveningReminderScheduler = {
        ensureChannel: vi.fn().mockResolvedValue(undefined),
        getPermission: vi.fn().mockResolvedValue("granted"),
        requestPermission: vi.fn().mockResolvedValue("granted"),
        scheduleAtDate: vi.fn().mockImplementation((date: Date) => {
          scheduledDates.push(date);
          return Promise.resolve(`notif-${nextId++}`);
        }),
        cancel: vi.fn().mockImplementation((id: string) => {
          cancelledIds.push(id);
          return Promise.resolve();
        }),
        listScheduled: vi.fn().mockResolvedValue([]),
      };

      const now = new Date(2026, 8, 23, 17, 0, 0);
      const result = await applyEveningReminders(
        userId,
        { enabled: true, hour: 20, minute: 30 },
        { todayCompleted: false, now: () => now },
        mockScheduler,
        store,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.enabled).toBe(true);
        expect(result.settings.notificationIds).toHaveLength(7);
        expect(scheduledDates).toHaveLength(7);
      }

      // Now reconcile with todayCompleted = true -> cancels previous and reschedules 6
      const reconciled = await reconcileEveningReminders(
        userId,
        { todayCompleted: true, now: () => now },
        mockScheduler,
        store,
      );

      expect(reconciled.notificationIds).toHaveLength(6);
      expect(cancelledIds).toHaveLength(7); // Old 7 notifications cancelled
    });

    it("auto-suppresses today upon reconcile when meal is logged after 6 PM or calorie target is reached", async () => {
      const store = memoryStore();
      let nextId = 1;

      const mockScheduler: EveningReminderScheduler = {
        ensureChannel: vi.fn().mockResolvedValue(undefined),
        getPermission: vi.fn().mockResolvedValue("granted"),
        requestPermission: vi.fn().mockResolvedValue("granted"),
        scheduleAtDate: vi
          .fn()
          .mockImplementation(() => Promise.resolve(`notif-${nextId++}`)),
        cancel: vi.fn().mockResolvedValue(undefined),
        listScheduled: vi.fn().mockResolvedValue([]),
      };

      const now = new Date(2026, 8, 23, 17, 0, 0);
      await applyEveningReminders(
        userId,
        { enabled: true, hour: 20, minute: 30 },
        { now: () => now },
        mockScheduler,
        store,
      );

      // Reconcile with hasMealAfter6Pm: true
      const reconciledMeal = await reconcileEveningReminders(
        userId,
        { hasMealAfter6Pm: true, now: () => now },
        mockScheduler,
        store,
      );
      expect(reconciledMeal.notificationIds).toHaveLength(6);

      // Reconcile with calorieTargetReached: true
      const reconciledCalories = await reconcileEveningReminders(
        userId,
        { calorieTargetReached: true, now: () => now },
        mockScheduler,
        store,
      );
      expect(reconciledCalories.notificationIds).toHaveLength(6);
    });

    it("clears notifications when disabled", async () => {
      const store = memoryStore();
      const cancelledIds: string[] = [];

      const mockScheduler: EveningReminderScheduler = {
        ensureChannel: vi.fn().mockResolvedValue(undefined),
        getPermission: vi.fn().mockResolvedValue("granted"),
        requestPermission: vi.fn().mockResolvedValue("granted"),
        scheduleAtDate: vi.fn().mockResolvedValue("notif-1"),
        cancel: vi.fn().mockImplementation((id: string) => {
          cancelledIds.push(id);
          return Promise.resolve();
        }),
        listScheduled: vi.fn().mockResolvedValue([]),
      };

      await applyEveningReminders(
        userId,
        { enabled: true, hour: 20, minute: 30 },
        {},
        mockScheduler,
        store,
      );

      const disabledResult = await applyEveningReminders(
        userId,
        { enabled: false, hour: 20, minute: 30 },
        {},
        mockScheduler,
        store,
      );

      expect(disabledResult.ok).toBe(true);
      if (disabledResult.ok) {
        expect(disabledResult.settings.enabled).toBe(false);
        expect(disabledResult.settings.notificationIds).toHaveLength(0);
      }
    });

    it("clears all evening reminders during data wipe", async () => {
      const store = memoryStore();
      const cancelledIds: string[] = [];
      const mockScheduler: EveningReminderScheduler = {
        ensureChannel: vi.fn(),
        getPermission: vi.fn().mockResolvedValue("granted"),
        requestPermission: vi.fn(),
        scheduleAtDate: vi.fn().mockResolvedValue("notif-1"),
        cancel: vi.fn().mockImplementation((id: string) => {
          cancelledIds.push(id);
          return Promise.resolve();
        }),
        listScheduled: vi.fn().mockResolvedValue([]),
      };

      await applyEveningReminders(
        userId,
        { enabled: true, hour: 20, minute: 30 },
        {},
        mockScheduler,
        store,
      );

      await clearEveningReminders(userId, mockScheduler, store);
      const loaded = await loadEveningReminders(userId, store);
      expect(loaded.enabled).toBe(false);
      expect(loaded.notificationIds).toHaveLength(0);
      expect(cancelledIds.length).toBeGreaterThan(0);
    });
  });

  describe("OS schedule integrity", () => {
    // Models the OS pending-notification queue so leaked requests stay visible.
    const osScheduler = () => {
      const pending = new Map<string, Record<string, unknown>>();
      let nextId = 1;
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
      const scheduler: EveningReminderScheduler = {
        ensureChannel: async () => undefined,
        getPermission: async () => "granted",
        requestPermission: async () => "granted",
        scheduleAtDate: async (_date, payload) => {
          await tick();
          const id = `os-${nextId++}`;
          pending.set(id, payload.data);
          return id;
        },
        cancel: async (id) => {
          await tick();
          pending.delete(id);
        },
        listScheduled: async () => {
          await tick();
          return [...pending].map(([id, data]) => ({ id, data }));
        },
      };
      const catchUpFor = (owner: string | undefined) =>
        [...pending.values()].filter(
          (data) =>
            data.source === "evening_catch_up_reminder" &&
            data.userId === owner,
        );
      return { pending, scheduler, catchUpFor };
    };
    const now = new Date(2026, 8, 23, 17, 0, 0);

    it("keeps one reminder per day when screens reconcile concurrently", async () => {
      const store = memoryStore();
      const os = osScheduler();
      await applyEveningReminders(
        userId,
        { enabled: true, hour: 20, minute: 30 },
        { now },
        os.scheduler,
        store,
      );

      // Dashboard refresh, meal list load and meal save can all land together.
      await Promise.all([
        reconcileEveningReminders(userId, { now }, os.scheduler, store),
        reconcileEveningReminders(userId, { now }, os.scheduler, store),
        reconcileEveningReminders(userId, { now }, os.scheduler, store),
      ]);

      const stored = await loadEveningReminders(userId, store);
      expect(os.pending.size).toBe(7);
      expect([...os.pending.keys()].sort()).toEqual(
        [...stored.notificationIds].sort(),
      );
    });

    it("sweeps leaked and untracked reminders but keeps other accounts and sources", async () => {
      const store = memoryStore();
      const os = osScheduler();
      const otherUser = "00000000-0000-4000-8000-000000000002";
      os.pending.set("legacy-1", { source: "evening_catch_up_reminder" });
      os.pending.set("legacy-2", { source: "evening_catch_up_reminder" });
      os.pending.set("leaked-own", {
        source: "evening_catch_up_reminder",
        userId,
      });
      os.pending.set("other-account", {
        source: "evening_catch_up_reminder",
        userId: otherUser,
      });
      os.pending.set("stretch", { source: "evening_stretch_reminder" });
      await store.setItemAsync(
        `mizyun.evening-catchup-reminders.${userId}`,
        JSON.stringify({
          enabled: true,
          hour: 20,
          minute: 30,
          notificationIds: [],
        }),
      );

      await reconcileEveningReminders(userId, { now }, os.scheduler, store);

      expect(os.catchUpFor(userId)).toHaveLength(7);
      expect(os.catchUpFor(undefined)).toHaveLength(0);
      expect(os.pending.has("leaked-own")).toBe(false);
      expect(os.pending.has("other-account")).toBe(true);
      expect(os.pending.has("stretch")).toBe(true);
    });

    it("still schedules when the OS queue cannot be listed", async () => {
      const store = memoryStore();
      const os = osScheduler();
      const scheduler: EveningReminderScheduler = {
        ...os.scheduler,
        listScheduled: () => Promise.reject(new Error("unavailable")),
      };

      const result = await applyEveningReminders(
        userId,
        { enabled: true, hour: 20, minute: 30 },
        { now },
        scheduler,
        store,
      );

      expect(result.ok).toBe(true);
      expect(os.catchUpFor(userId)).toHaveLength(7);
    });

    it("sweeps leaked reminders when disabled and on account clear", async () => {
      const store = memoryStore();
      const os = osScheduler();
      os.pending.set("leaked-own", {
        source: "evening_catch_up_reminder",
        userId,
      });

      await reconcileEveningReminders(userId, { now }, os.scheduler, store);
      expect(os.catchUpFor(userId)).toHaveLength(0);

      await applyEveningReminders(
        userId,
        { enabled: true, hour: 20, minute: 30 },
        { now },
        os.scheduler,
        store,
      );
      os.pending.set("leaked-again", {
        source: "evening_catch_up_reminder",
        userId,
      });
      await clearEveningReminders(userId, os.scheduler, store);
      expect(os.catchUpFor(userId)).toHaveLength(0);
    });
  });
});
