import { describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: "daily", WEEKLY: "weekly" },
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
  applyCoachReminders,
  loadCoachReminders,
  type ReminderScheduler,
} from "./coach-reminders";

const userId = "00000000-0000-4000-8000-000000000001";
const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

describe("Coach reminders", () => {
  it("requires permission before persisting or scheduling opt-in", async () => {
    const store = memoryStore();
    let scheduled = 0;
    const scheduler: ReminderScheduler = {
      ensureChannel: async () => undefined,
      getPermission: async () => "undetermined",
      requestPermission: async () => "denied",
      schedule: async () => {
        scheduled += 1;
        return "unexpected";
      },
      cancel: async () => undefined,
    };
    expect(
      await applyCoachReminders(
        userId,
        {
          dailyEnabled: true,
          weeklyEnabled: false,
          hour: 19,
          weeklyWeekday: 1,
        },
        scheduler,
        store,
      ),
    ).toEqual({ ok: false, reason: "permission_denied" });
    expect(scheduled).toBe(0);
    expect(store.values.size).toBe(0);
  });

  it("schedules selected reminders and cancels them on opt-out", async () => {
    const store = memoryStore();
    const cancelled: string[] = [];
    let nextId = 0;
    const scheduler: ReminderScheduler = {
      ensureChannel: async () => undefined,
      getPermission: async () => "granted",
      requestPermission: async () => "granted",
      schedule: async () => `notification-${++nextId}`,
      cancel: async (id) => {
        cancelled.push(id);
      },
    };
    const enabled = await applyCoachReminders(
      userId,
      {
        dailyEnabled: true,
        weeklyEnabled: true,
        hour: 18,
        weeklyWeekday: 2,
      },
      scheduler,
      store,
    );
    expect(enabled).toMatchObject({
      ok: true,
      settings: { notificationIds: ["notification-1", "notification-2"] },
    });
    const disabled = await applyCoachReminders(
      userId,
      {
        dailyEnabled: false,
        weeklyEnabled: false,
        hour: 18,
        weeklyWeekday: 2,
      },
      scheduler,
      store,
    );
    expect(disabled).toMatchObject({
      ok: true,
      settings: { notificationIds: [] },
    });
    expect(cancelled).toEqual(["notification-1", "notification-2"]);
    expect(await loadCoachReminders(userId, store)).toMatchObject({
      dailyEnabled: false,
      weeklyEnabled: false,
    });
  });

  it("cancels newly scheduled reminders when secure persistence fails", async () => {
    const cancelled: string[] = [];
    const scheduler: ReminderScheduler = {
      ensureChannel: async () => undefined,
      getPermission: async () => "granted",
      requestPermission: async () => "granted",
      schedule: async () => "new-notification",
      cancel: async (id) => {
        cancelled.push(id);
      },
    };
    const failingStore = {
      getItemAsync: async () => null,
      setItemAsync: async () => {
        throw new Error("secure storage unavailable");
      },
    };
    expect(
      await applyCoachReminders(
        userId,
        {
          dailyEnabled: true,
          weeklyEnabled: false,
          hour: 19,
          weeklyWeekday: 1,
        },
        scheduler,
        failingStore,
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(cancelled).toEqual(["new-notification"]);
  });
});
