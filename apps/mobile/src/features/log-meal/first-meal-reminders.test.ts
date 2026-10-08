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
  return { randomUUID: () => `reminder-${++sequence}` };
});
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import {
  activateFirstMealReminders,
  captureFirstMealReminderOwner,
  applyFirstMealReminders,
  clearFirstMealReminders,
  computeReminderScheduleDates,
  DEFAULT_FIRST_MEAL_REMINDERS,
  expoFirstMealReminderScheduler,
  isFirstMealReminderSettings,
  loadFirstMealReminders,
  markFirstMealPromptDismissed,
  reconcileFirstMealReminders,
  suspendFirstMealReminders,
  type FirstMealReminderScheduler,
} from "./first-meal-reminders";

const userId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => activateFirstMealReminders(userId));
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
  const pending = new Map<string, Date>();
  const scheduler: FirstMealReminderScheduler = {
    ensureChannel: vi.fn(async () => undefined),
    getPermission: vi.fn(async () => "granted" as const),
    requestPermission: vi.fn(async () => "granted" as const),
    scheduleAtDate: vi.fn(async (date, _payload, id) => {
      pending.set(id, date);
      return id;
    }),
    cancel: vi.fn(async (id) => {
      pending.delete(id);
    }),
  };
  return { scheduler, pending };
};

describe("reminder failure boundaries", () => {
  const morning = () => new Date(2026, 8, 23, 7);
  const request = { enabled: true, hour: 8, minute: 30 };
  it("keeps the first-meal opt-in offer available during passive reconciliation", async () => {
    const store = memoryStore();
    const { scheduler } = trackedScheduler();
    await reconcileFirstMealReminders(
      userId,
      { todayLogged: false, now: morning },
      scheduler,
      store,
    );
    expect((await loadFirstMealReminders(userId, store)).promptDismissed).toBe(
      false,
    );
    await reconcileFirstMealReminders(
      userId,
      { todayLogged: true, now: morning },
      scheduler,
      store,
    );
    const saved = await loadFirstMealReminders(userId, store);
    expect(saved.promptDismissed).toBe(false);
    expect(saved.todayLoggedDate).toBe("2026-09-23");
    expect(scheduler.requestPermission).not.toHaveBeenCalled();
  });

  it("serializes overlapping applies without orphaning the first batch", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await Promise.all([
      applyFirstMealReminders(
        userId,
        request,
        { now: morning },
        scheduler,
        store,
      ),
      applyFirstMealReminders(
        userId,
        { ...request, hour: 9 },
        { now: morning },
        scheduler,
        store,
      ),
    ]);
    const saved = await loadFirstMealReminders(userId, store);
    expect([...pending.keys()].sort()).toEqual(
      [...saved.notificationIds].sort(),
    );
    expect(pending.size).toBe(7);
  });

  it("preserves today's suppression when settings omit the logged flag", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyFirstMealReminders(
      userId,
      request,
      { now: morning, todayLogged: true },
      scheduler,
      store,
    );
    await applyFirstMealReminders(
      userId,
      { ...request, hour: 9 },
      { now: morning },
      scheduler,
      store,
    );
    expect([...pending.values()].some((date) => date.getDate() === 23)).toBe(
      false,
    );
    await applyFirstMealReminders(
      userId,
      request,
      { now: () => new Date(2026, 8, 24, 7) },
      scheduler,
      store,
    );
    expect([...pending.values()].some((date) => date.getDate() === 24)).toBe(
      true,
    );
  });

  it("never requests OS permission from foreground reconciliation", async () => {
    const store = memoryStore();
    const { scheduler } = trackedScheduler();
    await applyFirstMealReminders(
      userId,
      request,
      { now: morning },
      scheduler,
      store,
    );
    scheduler.getPermission = vi.fn(async () => "undetermined" as const);
    await reconcileFirstMealReminders(
      userId,
      { todayLogged: true, now: morning },
      scheduler,
      store,
    );
    expect(scheduler.requestPermission).not.toHaveBeenCalled();
  });

  it("keeps failed cancellation IDs so account cleanup can be retried", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyFirstMealReminders(
      userId,
      request,
      { now: morning },
      scheduler,
      store,
    );
    const failedId = [...pending.keys()][0];
    scheduler.cancel = vi.fn(async (id) => {
      if (id === failedId) throw new Error("native cancellation failed");
      pending.delete(id);
    });
    await expect(
      clearFirstMealReminders(userId, scheduler, store),
    ).rejects.toThrow();
    expect(
      (await loadFirstMealReminders(userId, store)).notificationIds,
    ).toEqual([failedId]);
  });

  it("does not put the custom routine label on the lock screen", async () => {
    const store = memoryStore();
    const { scheduler } = trackedScheduler();
    await applyFirstMealReminders(
      userId,
      { ...request, routineLabel: "Private treatment routine" },
      { now: morning },
      scheduler,
      store,
    );
    for (const [, payload] of vi.mocked(scheduler.scheduleAtDate).mock.calls)
      expect(JSON.stringify(payload)).not.toContain(
        "Private treatment routine",
      );
  });

  it("remembers a local log even before the user opts in and ignores stale empty-day reads", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await reconcileFirstMealReminders(
      userId,
      { todayLogged: true, now: morning },
      scheduler,
      store,
    );
    await reconcileFirstMealReminders(
      userId,
      { todayLogged: false, now: morning },
      scheduler,
      store,
    );
    await applyFirstMealReminders(
      userId,
      request,
      { now: morning },
      scheduler,
      store,
    );
    expect([...pending.values()].some((date) => date.getDate() === 23)).toBe(
      false,
    );
  });

  it("retires an in-flight apply and blocks late screen work until activated", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = scheduler.scheduleAtDate;
    scheduler.scheduleAtDate = vi.fn(async (date, payload, identifier) => {
      const id = await original(date, payload, identifier);
      entered();
      await blocked;
      return id;
    });
    const saving = applyFirstMealReminders(
      userId,
      request,
      { now: morning },
      scheduler,
      store,
    );
    await started;
    const suspending = suspendFirstMealReminders(userId, scheduler, store);
    release();
    expect((await saving).ok).toBe(false);
    await suspending;
    expect(pending.size).toBe(0);
    expect(
      (
        await applyFirstMealReminders(
          userId,
          request,
          { now: morning },
          scheduler,
          store,
        )
      ).ok,
    ).toBe(false);
    activateFirstMealReminders(userId);
    expect(
      (
        await applyFirstMealReminders(
          userId,
          request,
          { now: morning },
          scheduler,
          store,
        )
      ).ok,
    ).toBe(true);
  });

  it("preserves opt-in on suspend, retains failed IDs, and retries cancellation", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyFirstMealReminders(
      userId,
      request,
      { now: morning },
      scheduler,
      store,
    );
    const failedId = [...pending.keys()][0];
    const original = scheduler.cancel;
    scheduler.cancel = vi.fn(async (id) => {
      if (id === failedId) throw new Error("temporarily unavailable");
      await original(id);
    });
    await expect(
      suspendFirstMealReminders(userId, scheduler, store),
    ).rejects.toThrow();
    const saved = await loadFirstMealReminders(userId, store);
    expect(saved.enabled).toBe(true);
    expect(saved.notificationIds).toEqual([failedId]);
    scheduler.cancel = original;
    await suspendFirstMealReminders(userId, scheduler, store);
    expect(pending.size).toBe(0);
    expect((await loadFirstMealReminders(userId, store)).enabled).toBe(true);
  });

  it("does not duplicate schedules when cancellation during a time change fails", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    await applyFirstMealReminders(
      userId,
      request,
      { now: morning },
      scheduler,
      store,
    );
    const failedId = [...pending.keys()][0];
    scheduler.cancel = vi.fn(async (id) => {
      if (id === failedId) throw new Error("cancel failed");
      pending.delete(id);
    });
    expect(
      (
        await applyFirstMealReminders(
          userId,
          { ...request, hour: 9 },
          { now: morning },
          scheduler,
          store,
        )
      ).ok,
    ).toBe(false);
    expect([...pending.keys()]).toEqual([failedId]);
    expect(
      (await loadFirstMealReminders(userId, store)).notificationIds,
    ).toEqual([failedId]);
  });

  it("retains uncancelled new IDs when partial scheduling cleanup also fails", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    const original = scheduler.scheduleAtDate;
    let calls = 0;
    scheduler.scheduleAtDate = vi.fn(async (date, payload, identifier) => {
      if (++calls === 2) throw new Error("schedule failed");
      return original(date, payload, identifier);
    });
    scheduler.cancel = vi.fn(async () => {
      throw new Error("cancel failed");
    });
    expect(
      (
        await applyFirstMealReminders(
          userId,
          request,
          { now: morning },
          scheduler,
          store,
        )
      ).ok,
    ).toBe(false);
    expect(
      (await loadFirstMealReminders(userId, store)).notificationIds,
    ).toEqual(expect.arrayContaining([...pending.keys()]));
    expect(pending.size).toBe(1);
  });

  it("does not schedule or erase cancellation journals when storage cannot be read", async () => {
    const store = memoryStore();
    const { scheduler } = trackedScheduler();
    const unreadable = {
      ...store,
      getItemAsync: async () => {
        throw new Error("storage locked");
      },
    };
    expect(
      (
        await applyFirstMealReminders(
          userId,
          request,
          { now: morning },
          scheduler,
          unreadable,
        )
      ).ok,
    ).toBe(false);
    expect(scheduler.scheduleAtDate).not.toHaveBeenCalled();
    await expect(
      clearFirstMealReminders(userId, scheduler, unreadable),
    ).rejects.toThrow("storage locked");
    expect(store.values.size).toBe(0);
  });

  it("never starts native scheduling when its pre-journal write fails", async () => {
    const store = memoryStore();
    const { scheduler, pending } = trackedScheduler();
    const original = store.setItemAsync;
    let failed = false;
    store.setItemAsync = async (key, value) => {
      if (!failed && JSON.parse(value).notificationIds.length > 0) {
        failed = true;
        throw new Error("journal write interrupted");
      }
      await original(key, value);
    };
    scheduler.cancel = vi.fn(async () => {
      throw new Error("native locked");
    });
    expect(
      (
        await applyFirstMealReminders(
          userId,
          request,
          { now: morning },
          scheduler,
          store,
        )
      ).ok,
    ).toBe(false);
    expect(
      (await loadFirstMealReminders(userId, store)).notificationIds,
    ).toHaveLength(1);
    expect(pending.size).toBe(0);
    expect(scheduler.scheduleAtDate).not.toHaveBeenCalled();
  });

  it("constructs local calendar times across spring and autumn DST transitions", () => {
    // Run this suite with TZ=Europe/Bratislava to exercise 23/25-hour days.
    for (const start of [new Date(2026, 2, 28, 7), new Date(2026, 9, 24, 7)]) {
      const dates = computeReminderScheduleDates(request, {
        todayLogged: false,
        now: start,
      });
      expect(dates).toHaveLength(7);
      dates.forEach((date, index) => {
        expect(date.getDate()).toBe(
          start.getDate() + index > 31
            ? start.getDate() + index - 31
            : start.getDate() + index,
        );
        expect(date.getHours()).toBe(8);
        expect(date.getMinutes()).toBe(30);
      });
      if (
        Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Bratislava"
      ) {
        expect(dates[1].getTime() - dates[0].getTime()).toBe(
          start.getMonth() === 2 ? 23 * 3600000 : 25 * 3600000,
        );
      }
    }
  });

  it("requires activation and rejects captured owners after an A to B to A boundary", async () => {
    const store = memoryStore();
    const { scheduler } = trackedScheduler();
    const unknown = "never-active-owner";
    expect(
      (await applyFirstMealReminders(unknown, request, {}, scheduler, store))
        .ok,
    ).toBe(false);
    const isCurrent = captureFirstMealReminderOwner(userId);
    expect(isCurrent()).toBe(true);
    await suspendFirstMealReminders(userId, scheduler, store);
    activateFirstMealReminders(userId);
    expect(isCurrent()).toBe(false);
    expect(captureFirstMealReminderOwner(userId)()).toBe(true);
  });

  it("keeps the pre-journalled native ID recoverable when scheduling never returns", async () => {
    const store = memoryStore();
    const owner = "interrupted-native-owner";
    activateFirstMealReminders(owner);
    const { scheduler, pending } = trackedScheduler();
    let started!: () => void;
    const nativeEntered = new Promise<void>((resolve) => {
      started = resolve;
    });
    scheduler.scheduleAtDate = vi.fn(async (date, _payload, identifier) => {
      pending.set(identifier, date);
      started();
      // Simulate loss of the JS process after native success, before its response.
      return new Promise<string>(() => {});
    });
    void applyFirstMealReminders(
      owner,
      request,
      { now: morning },
      scheduler,
      store,
    );
    await nativeEntered;
    expect(
      (await loadFirstMealReminders(owner, store)).notificationIds,
    ).toEqual([...pending.keys()]);
    vi.resetModules();
    const restarted = await import("./first-meal-reminders");
    const freshScheduler = {
      ...scheduler,
      cancel: vi.fn(async (id: string) => {
        pending.delete(id);
      }),
    };
    await restarted.suspendFirstMealReminders(owner, freshScheduler, store);
    expect(pending.size).toBe(0);
    expect(
      (await restarted.loadFirstMealReminders(owner, store)).notificationIds,
    ).toEqual([]);
  });

  it("does not replace an unreadable journal when dismissing the prompt", async () => {
    const store = memoryStore();
    const raw = "corrupt journal with unknown native IDs";
    const key = `mizyun.first-meal-reminders.${userId}`;
    store.values.set(key, raw);
    await expect(markFirstMealPromptDismissed(userId, store)).rejects.toThrow();
    expect(store.values.get(key)).toBe(raw);
  });

  it("does not recreate a deleted account's record when later session suspension runs", async () => {
    const store = memoryStore();
    const { scheduler } = trackedScheduler();
    await applyFirstMealReminders(
      userId,
      request,
      { now: morning },
      scheduler,
      store,
    );
    await clearFirstMealReminders(userId, scheduler, store);
    await suspendFirstMealReminders(userId, scheduler, store);
    expect(store.values.size).toBe(0);
  });

  it("passes the pre-journalled identifier to the native Expo request", async () => {
    const Notifications = await import("expo-notifications");
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue(
      "owned-id",
    );
    await expoFirstMealReminderScheduler.scheduleAtDate(
      morning(),
      {
        title: "Mizyun reminder",
        body: "Open Mizyun to review your next step.",
        data: {},
      },
      "owned-id",
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: "owned-id" }),
    );
  });
});

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
