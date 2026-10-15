import { describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { WEEKLY: "weekly" },
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

import * as Notifications from "expo-notifications";
import {
  applyWeeklyReviewReminder,
  clearWeeklyReviewReminder,
  DEFAULT_WEEKLY_REVIEW_REMINDER,
  expoWeeklyReviewScheduler,
  loadWeeklyReviewReminder,
  NOTIFICATION_PAYLOAD,
  reconcileWeeklyReviewReminder,
  WEEKLY_REVIEW_ROUTE,
  WEEKLY_REVIEW_TRIGGER,
  weeklyReviewReminderKey,
  type WeeklyReviewReminderScheduler,
  type WeeklyReviewReminderStore,
} from "./weekly-review-notification";

const userId = "00000000-0000-4000-8000-000000000001";

const memoryStore = (): WeeklyReviewReminderStore & {
  data: Map<string, string>;
} => {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => void data.set(key, value),
    deleteItemAsync: async (key) => void data.delete(key),
  };
};

const scheduler = (
  permission: "granted" | "denied" | "undetermined" = "granted",
) => {
  let n = 0;
  const fake: WeeklyReviewReminderScheduler & {
    scheduleWeekly: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    requestPermission: ReturnType<typeof vi.fn>;
  } = {
    ensureChannel: vi.fn().mockResolvedValue(undefined),
    getPermission: vi.fn().mockResolvedValue(permission),
    requestPermission: vi.fn().mockResolvedValue(permission),
    scheduleWeekly: vi.fn().mockImplementation(async () => `n${++n}`),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
  return fake;
};

describe("weekly review reminder", () => {
  it("defaults to off, like the other opt-in reminders", async () => {
    expect(DEFAULT_WEEKLY_REVIEW_REMINDER.enabled).toBe(false);
    expect(await loadWeeklyReviewReminder(userId, memoryStore())).toEqual(
      DEFAULT_WEEKLY_REVIEW_REMINDER,
    );
  });

  it("schedules Monday 09:00 with the review route when enabled with a goal", async () => {
    const s = scheduler();
    const store = memoryStore();
    const result = await applyWeeklyReviewReminder(
      userId,
      { enabled: true },
      { hasActiveGoal: true },
      s,
      store,
    );
    expect(result).toEqual({
      ok: true,
      settings: { enabled: true, notificationId: "n1" },
    });
    expect(WEEKLY_REVIEW_TRIGGER).toEqual({ weekday: 2, hour: 9, minute: 0 });
    expect(s.scheduleWeekly).toHaveBeenCalledWith({
      ...NOTIFICATION_PAYLOAD,
      data: expect.objectContaining({ url: WEEKLY_REVIEW_ROUTE, userId }),
      trigger: WEEKLY_REVIEW_TRIGGER,
    });
    expect(NOTIFICATION_PAYLOAD.title).toBe(
      "Your weekly calorie check-in is ready",
    );
    expect(
      JSON.parse(store.data.get(weeklyReviewReminderKey(userId))!),
    ).toEqual({ enabled: true, notificationId: "n1" });
  });

  it("replaces the previous notification instead of stacking", async () => {
    const s = scheduler();
    const store = memoryStore();
    await applyWeeklyReviewReminder(
      userId,
      { enabled: true },
      { hasActiveGoal: true },
      s,
      store,
    );
    await applyWeeklyReviewReminder(
      userId,
      { enabled: true },
      { hasActiveGoal: true },
      s,
      store,
    );
    expect(s.cancel).toHaveBeenCalledWith("n1");
    expect((await loadWeeklyReviewReminder(userId, store)).notificationId).toBe(
      "n2",
    );
  });

  it("does not schedule without an active goal but keeps the preference", async () => {
    const s = scheduler();
    const result = await applyWeeklyReviewReminder(
      userId,
      { enabled: true },
      { hasActiveGoal: false },
      s,
      memoryStore(),
    );
    expect(result).toEqual({
      ok: true,
      settings: { enabled: true, notificationId: null },
    });
    expect(s.scheduleWeekly).not.toHaveBeenCalled();
  });

  it("reports a denied permission without changing stored state", async () => {
    const s = scheduler("denied");
    const store = memoryStore();
    const result = await applyWeeklyReviewReminder(
      userId,
      { enabled: true },
      { hasActiveGoal: true },
      s,
      store,
    );
    expect(result).toEqual({ ok: false, reason: "permission_denied" });
    expect(s.scheduleWeekly).not.toHaveBeenCalled();
    expect(store.data.size).toBe(0);
  });

  it("cancels when turned off and cleans up on failure", async () => {
    const s = scheduler();
    const store = memoryStore();
    await applyWeeklyReviewReminder(
      userId,
      { enabled: true },
      { hasActiveGoal: true },
      s,
      store,
    );
    const off = await applyWeeklyReviewReminder(
      userId,
      { enabled: false },
      { hasActiveGoal: true },
      s,
      store,
    );
    expect(off).toEqual({
      ok: true,
      settings: { enabled: false, notificationId: null },
    });
    expect(s.cancel).toHaveBeenCalledWith("n1");

    const broken = scheduler();
    broken.scheduleWeekly.mockRejectedValueOnce(new Error("boom"));
    expect(
      await applyWeeklyReviewReminder(
        userId,
        { enabled: true },
        { hasActiveGoal: true },
        broken,
        memoryStore(),
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reconcile schedules, cancels when the goal disappears, never prompts", async () => {
    const s = scheduler();
    const store = memoryStore();
    store.data.set(
      weeklyReviewReminderKey(userId),
      JSON.stringify({ enabled: true, notificationId: null }),
    );
    const scheduled = await reconcileWeeklyReviewReminder(
      userId,
      { hasActiveGoal: true },
      s,
      store,
    );
    expect(scheduled.notificationId).toBe("n1");

    const noGoal = await reconcileWeeklyReviewReminder(
      userId,
      { hasActiveGoal: false },
      s,
      store,
    );
    expect(noGoal).toEqual({ enabled: true, notificationId: null });
    expect(s.cancel).toHaveBeenCalledWith("n1");

    const denied = scheduler("denied");
    const again = await reconcileWeeklyReviewReminder(
      userId,
      { hasActiveGoal: true },
      denied,
      store,
    );
    expect(again.notificationId).toBeNull();
    expect(denied.requestPermission).not.toHaveBeenCalled();
    expect(denied.scheduleWeekly).not.toHaveBeenCalled();
  });

  it("clears on account removal", async () => {
    const s = scheduler();
    const store = memoryStore();
    await applyWeeklyReviewReminder(
      userId,
      { enabled: true },
      { hasActiveGoal: true },
      s,
      store,
    );
    await clearWeeklyReviewReminder(userId, s, store);
    expect(s.cancel).toHaveBeenCalledWith("n1");
    expect(store.data.has(weeklyReviewReminderKey(userId))).toBe(false);
  });

  it("maps to a native weekly trigger", async () => {
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue(
      "native-1",
    );
    const id = await expoWeeklyReviewScheduler.scheduleWeekly({
      ...NOTIFICATION_PAYLOAD,
      data: { url: WEEKLY_REVIEW_ROUTE },
      trigger: WEEKLY_REVIEW_TRIGGER,
    });
    expect(id).toBe("native-1");
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: {
          type: "weekly",
          weekday: 2,
          hour: 9,
          minute: 0,
          channelId: "weekly-review",
        },
      }),
    );
  });
});
