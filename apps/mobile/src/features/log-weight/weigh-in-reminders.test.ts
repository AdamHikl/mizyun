import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
}));
vi.mock("expo-crypto", () => {
  let sequence = 0;
  return { randomUUID: () => `weigh-in-${++sequence}` };
});
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import {
  activateWeighInReminders,
  applyWeighInReminders,
  clearWeighInReminders,
  computeWeighInScheduleDates,
  DEFAULT_WEIGH_IN_REMINDERS,
  expoWeighInReminderScheduler,
  isWeighInReminderSettings,
  loadWeighInReminders,
  markWeighInLoggedToday,
  reconcileWeighInReminders,
  suspendWeighInReminders,
  sweepUnownedWeighInNotifications,
  WEIGH_IN_NOTIFICATION,
  type WeighInReminderScheduler,
} from "./weigh-in-reminders";

const userId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => activateWeighInReminders(userId));

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
const trackedScheduler = () => {
  const pending = new Map<
    string,
    { date: Date; payload: Record<string, unknown> }
  >();
  const scheduler: WeighInReminderScheduler = {
    ensureChannel: vi.fn(async () => undefined),
    getPermission: vi.fn(async () => "granted" as const),
    requestPermission: vi.fn(async () => "granted" as const),
    scheduleAtDate: vi.fn(async (date, payload, id) => {
      pending.set(id, { date, payload });
      return id;
    }),
    cancel: vi.fn(async (id) => {
      pending.delete(id);
    }),
  };
  return { scheduler, pending };
};

// Thursday 2026-10-15, 06:00 local.
const thursdayMorning = () => new Date(2026, 9, 15, 6);
const monThu = { enabled: true, hour: 7, minute: 30, weekdays: [2, 5] };

describe("weigh-in schedule dates", () => {
  it("only schedules selected weekdays across the rolling window", () => {
    const dates = computeWeighInScheduleDates(monThu, {
      todayLogged: false,
      now: thursdayMorning(),
    });
    // Thu 15, Mon 19, Thu 22, Mon 26, Thu 29 (within 14 days of the 15th).
    expect(dates.map((date) => date.getDate())).toEqual([15, 19, 22, 26]);
    expect(dates.every((date) => date.getHours() === 7)).toBe(true);
    expect(dates.every((date) => date.getMinutes() === 30)).toBe(true);
  });
  it("skips today when a weight is already logged or the time has passed", () => {
    const base = { todayLogged: false, now: thursdayMorning() };
    expect(computeWeighInScheduleDates(monThu, base)[0]!.getDate()).toBe(15);
    expect(
      computeWeighInScheduleDates(monThu, {
        ...base,
        todayLogged: true,
      })[0]!.getDate(),
    ).toBe(19);
    expect(
      computeWeighInScheduleDates(monThu, {
        ...base,
        now: new Date(2026, 9, 15, 8),
      })[0]!.getDate(),
    ).toBe(19);
  });
  it("supports every day and schedules nothing for no days", () => {
    const daily = computeWeighInScheduleDates(
      { ...monThu, weekdays: [1, 2, 3, 4, 5, 6, 7] },
      { todayLogged: false, now: thursdayMorning() },
    );
    expect(daily).toHaveLength(14);
    expect(
      computeWeighInScheduleDates(
        { ...monThu, weekdays: [] },
        { todayLogged: false, now: thursdayMorning() },
      ),
    ).toEqual([]);
  });
});

describe("applying and cancelling", () => {
  it("is off by default and schedules nothing until saved", async () => {
    const store = memoryStore();
    const { scheduler } = trackedScheduler();
    expect(await loadWeighInReminders(userId, store)).toEqual(
      DEFAULT_WEIGH_IN_REMINDERS,
    );
    expect(DEFAULT_WEIGH_IN_REMINDERS.enabled).toBe(false);
    const settings = await reconcileWeighInReminders(
      userId,
      { todayLogged: false, now: thursdayMorning },
      scheduler,
      store,
    );
    expect(settings.enabled).toBe(false);
    expect(scheduler.scheduleAtDate).not.toHaveBeenCalled();
    expect(store.values.size).toBe(0);
  });

  it("schedules neutral, owner-tagged notifications that open log-weight", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    const result = await applyWeighInReminders(
      userId,
      monThu,
      { now: thursdayMorning },
      scheduler,
      store,
    );
    expect(result.ok).toBe(true);
    expect(pending.size).toBe(4);
    for (const { payload } of pending.values()) {
      expect(payload).toMatchObject({
        title: WEIGH_IN_NOTIFICATION.title,
        body: WEIGH_IN_NOTIFICATION.body,
        data: { url: "/log-weight", source: "weigh_in_reminder", userId },
      });
      expect(JSON.stringify(payload)).not.toMatch(/\d\s?(kg|lb)/i);
    }
    const stored = await loadWeighInReminders(userId, store);
    expect(stored.enabled).toBe(true);
    expect(stored.weekdays).toEqual([2, 5]);
    expect(stored.notificationIds).toHaveLength(4);
  });

  it("does not schedule today's reminder when saved after a weigh-in", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyWeighInReminders(
      userId,
      monThu,
      { todayLogged: true, now: thursdayMorning },
      scheduler,
      store,
    );
    expect([...pending.values()].map((v) => v.date.getDate())).toEqual([
      19, 22, 26,
    ]);
  });

  it("replaces the old schedule and cancels everything on disable", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyWeighInReminders(
      userId,
      monThu,
      { now: thursdayMorning },
      scheduler,
      store,
    );
    await applyWeighInReminders(
      userId,
      { ...monThu, weekdays: [3] },
      { now: thursdayMorning },
      scheduler,
      store,
    );
    expect([...pending.values()].map((v) => v.date.getDay())).toEqual([2, 2]);
    await applyWeighInReminders(
      userId,
      { ...monThu, enabled: false },
      { now: thursdayMorning },
      scheduler,
      store,
    );
    expect(pending.size).toBe(0);
    const stored = await loadWeighInReminders(userId, store);
    expect(stored).toMatchObject({ enabled: false, notificationIds: [] });
  });

  it("requires at least one day and never prompts without being asked", async () => {
    const store = memoryStore();
    const { scheduler } = trackedScheduler();
    expect(
      await applyWeighInReminders(
        userId,
        { ...monThu, weekdays: [] },
        {},
        scheduler,
        store,
      ),
    ).toEqual({ ok: false, reason: "no_days" });
    expect(scheduler.scheduleAtDate).not.toHaveBeenCalled();
  });

  it("reports denied permission and leaves nothing scheduled", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    vi.mocked(scheduler.getPermission).mockResolvedValue("denied");
    vi.mocked(scheduler.requestPermission).mockResolvedValue("denied");
    expect(
      await applyWeighInReminders(
        userId,
        monThu,
        { now: thursdayMorning },
        scheduler,
        store,
      ),
    ).toEqual({ ok: false, reason: "permission_denied" });
    expect(pending.size).toBe(0);
  });

  it("rolls back newly scheduled IDs when a native schedule fails", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    let calls = 0;
    const original = vi
      .mocked(scheduler.scheduleAtDate)
      .getMockImplementation()!;
    vi.mocked(scheduler.scheduleAtDate).mockImplementation(async (...args) => {
      if (++calls === 3) throw new Error("native failure");
      return original(...args);
    });
    expect(
      await applyWeighInReminders(
        userId,
        monThu,
        { now: thursdayMorning },
        scheduler,
        store,
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(pending.size).toBe(0);
    expect((await loadWeighInReminders(userId, store)).notificationIds).toEqual(
      [],
    );
  });
});

describe("reconciliation", () => {
  it("drops today's reminder once a weight is logged, and remembers it", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyWeighInReminders(
      userId,
      monThu,
      { now: thursdayMorning },
      scheduler,
      store,
    );
    expect(pending.size).toBe(4);
    await markWeighInLoggedToday(userId, scheduler, store, thursdayMorning);
    expect([...pending.values()].map((v) => v.date.getDate())).toEqual([
      19, 22, 26,
    ]);
    expect((await loadWeighInReminders(userId, store)).todayLoggedDate).toBe(
      "2026-10-15",
    );
    // A later passive refresh the same day keeps today suppressed.
    await reconcileWeighInReminders(
      userId,
      { todayLogged: false, now: thursdayMorning },
      scheduler,
      store,
    );
    expect([...pending.values()].map((v) => v.date.getDate())).toEqual([
      19, 22, 26,
    ]);
  });

  it("retires schedules after notification permission is revoked", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyWeighInReminders(
      userId,
      monThu,
      { now: thursdayMorning },
      scheduler,
      store,
    );
    vi.mocked(scheduler.getPermission).mockResolvedValue("denied");
    await reconcileWeighInReminders(
      userId,
      { todayLogged: false, now: thursdayMorning },
      scheduler,
      store,
    );
    expect(pending.size).toBe(0);
    expect(scheduler.requestPermission).not.toHaveBeenCalled(); // passive never prompts
    expect((await loadWeighInReminders(userId, store)).enabled).toBe(true);
  });
});

describe("sign-out and account deletion", () => {
  it("suspend cancels schedules but keeps the opt-in; reactivation reschedules", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyWeighInReminders(
      userId,
      monThu,
      { now: thursdayMorning },
      scheduler,
      store,
    );
    await suspendWeighInReminders(userId, scheduler, store);
    expect(pending.size).toBe(0);
    const kept = await loadWeighInReminders(userId, store);
    expect(kept).toMatchObject({ enabled: true, notificationIds: [] });
    // A retired account cannot be rescheduled by a late reconcile.
    await reconcileWeighInReminders(
      userId,
      { todayLogged: false, now: thursdayMorning },
      scheduler,
      store,
    );
    expect(pending.size).toBe(0);
    activateWeighInReminders(userId);
    await reconcileWeighInReminders(
      userId,
      { todayLogged: false, now: thursdayMorning },
      scheduler,
      store,
    );
    expect(pending.size).toBe(4);
  });

  it("an in-flight apply cannot reschedule after the account is suspended", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    let release!: () => void;
    vi.mocked(scheduler.getPermission).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve("granted");
        }),
    );
    const applying = applyWeighInReminders(
      userId,
      monThu,
      { now: thursdayMorning },
      scheduler,
      store,
    );
    for (let i = 0; i < 50 && !release; i++) await Promise.resolve();
    const suspended = suspendWeighInReminders(userId, scheduler, store);
    release();
    expect(await applying).toEqual({ ok: false, reason: "unavailable" });
    await suspended;
    expect(pending.size).toBe(0);
  });

  it("clear cancels everything and deletes the preference", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyWeighInReminders(
      userId,
      monThu,
      { now: thursdayMorning },
      scheduler,
      store,
    );
    await clearWeighInReminders(userId, scheduler, store);
    expect(pending.size).toBe(0);
    expect(store.values.size).toBe(0);
  });

  it("clear keeps the journal and rejects when a cancel fails", async () => {
    const store = memoryStore();
    const { scheduler } = trackedScheduler();
    await applyWeighInReminders(
      userId,
      monThu,
      { now: thursdayMorning },
      scheduler,
      store,
    );
    vi.mocked(scheduler.cancel).mockRejectedValueOnce(new Error("busy"));
    await expect(
      clearWeighInReminders(userId, scheduler, store),
    ).rejects.toThrow("cancellation incomplete");
    expect(
      (await loadWeighInReminders(userId, store)).notificationIds,
    ).toHaveLength(1);
  });

  it("sweeps weigh-in notifications that belong to another or no owner", async () => {
    const cancel = vi.fn(async () => {});
    const list = async () => [
      {
        identifier: "a",
        content: { data: { source: "weigh_in_reminder", userId: "a" } },
      },
      {
        identifier: "b",
        content: { data: { source: "weigh_in_reminder", userId: "b" } },
      },
      {
        identifier: "c",
        content: { data: { source: "first_meal_reminder", userId: "b" } },
      },
    ];
    await sweepUnownedWeighInNotifications("a", { list, cancel });
    expect(cancel.mock.calls).toEqual([["b"]]);
    cancel.mockClear();
    await sweepUnownedWeighInNotifications(null, { list, cancel });
    expect(cancel.mock.calls).toEqual([["a"], ["b"]]);
  });
});

describe("validation and native adapter", () => {
  it("rejects malformed journals", () => {
    expect(isWeighInReminderSettings(DEFAULT_WEIGH_IN_REMINDERS)).toBe(true);
    for (const bad of [
      { ...DEFAULT_WEIGH_IN_REMINDERS, weekdays: [0] },
      { ...DEFAULT_WEIGH_IN_REMINDERS, weekdays: [8] },
      { ...DEFAULT_WEIGH_IN_REMINDERS, weekdays: [2, 2] },
      { ...DEFAULT_WEIGH_IN_REMINDERS, hour: 24 },
      { ...DEFAULT_WEIGH_IN_REMINDERS, todayLoggedDate: "today" },
      null,
    ])
      expect(isWeighInReminderSettings(bad)).toBe(false);
  });

  it("uses a dated trigger on its own Android channel", async () => {
    const Notifications = await import("expo-notifications");
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue("x");
    const when = new Date(2026, 9, 19, 7, 30);
    await expoWeighInReminderScheduler.scheduleAtDate(
      when,
      { title: "t", body: "b", data: {} },
      "id-1",
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "id-1",
        trigger: {
          type: "date",
          date: when,
          channelId: "weigh-in-reminders",
        },
      }),
    );
  });
});
