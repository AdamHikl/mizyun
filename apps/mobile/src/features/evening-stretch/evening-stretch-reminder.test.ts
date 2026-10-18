import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import {
  DEFAULT_EVENING_STRETCH,
  EVENING_STRETCH_SOURCE,
  ensureEveningStretchPermission,
  isEveningStretchDoneToday,
  loadEveningStretch,
  markEveningStretchDone,
  saveEveningStretchPreference,
  sweepEveningStretchNotifications,
  syncEveningStretch,
  type EveningStretchScheduler,
  type EveningStretchSettings,
} from "./evening-stretch-reminder";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const KEY = `mizyun.evening-stretch.${USER}`;
const evening = (hour: number, minute = 0) =>
  new Date(2026, 9, 18, hour, minute);

const memoryStore = (initial?: Partial<EveningStretchSettings>) => {
  const values = new Map<string, string>();
  if (initial) {
    values.set(KEY, JSON.stringify({ ...DEFAULT_EVENING_STRETCH, ...initial }));
  }
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

const fakeScheduler = (
  permission: "granted" | "denied" | "undetermined" = "granted",
  afterRequest: "granted" | "denied" = "granted",
) => {
  const pending = new Map<
    string,
    { date: Date; data: Record<string, unknown> }
  >();
  let next = 0;
  const scheduler: EveningStretchScheduler & {
    pending: typeof pending;
    requests: number;
    permission: string;
  } = {
    pending,
    requests: 0,
    permission,
    ensureChannel: async () => undefined,
    getPermission: async () =>
      scheduler.permission as "granted" | "denied" | "undetermined",
    requestPermission: async () => {
      scheduler.requests++;
      scheduler.permission = afterRequest;
      return afterRequest;
    },
    scheduleAtDate: async (date, payload) => {
      const id = `stretch-${++next}`;
      pending.set(id, { date, data: payload.data });
      return id;
    },
    cancel: async (id) => {
      pending.delete(id);
    },
    listScheduled: async () =>
      [...pending.entries()].map(([id, entry]) => ({ id, data: entry.data })),
  };
  return scheduler;
};

describe("evening stretch settings", () => {
  it("defaults to on at 9:00 PM and rejects malformed stored values", async () => {
    expect(await loadEveningStretch(USER, memoryStore())).toEqual(
      DEFAULT_EVENING_STRETCH,
    );
    expect(DEFAULT_EVENING_STRETCH).toMatchObject({
      enabled: true,
      hour: 21,
      minute: 0,
    });
    const store = memoryStore();
    store.values.set(KEY, JSON.stringify({ enabled: true, hour: 25 }));
    expect(await loadEveningStretch(USER, store)).toEqual(
      DEFAULT_EVENING_STRETCH,
    );
    store.values.set(KEY, "{not json");
    expect(await loadEveningStretch(USER, store)).toEqual(
      DEFAULT_EVENING_STRETCH,
    );
  });

  it("saves the switch and time without touching tonight's schedule state", async () => {
    const store = memoryStore({
      notificationId: "stretch-9",
      scheduledDate: "2026-10-18",
      scheduledTime: "21:00",
    });
    const saved = await saveEveningStretchPreference(
      USER,
      { enabled: true, hour: 22, minute: 15 },
      store,
    );
    expect(saved).toMatchObject({
      hour: 22,
      minute: 15,
      notificationId: "stretch-9",
    });
  });
});

describe("syncEveningStretch", () => {
  let scheduler: ReturnType<typeof fakeScheduler>;
  beforeEach(() => {
    scheduler = fakeScheduler();
  });

  it("schedules tonight's reminder on a training day, owned by the user", async () => {
    const store = memoryStore();
    const result = await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      store,
    );
    expect(result.status).toBe("scheduled");
    expect([...scheduler.pending.values()]).toEqual([
      {
        date: evening(21),
        data: {
          url: "/evening-stretch",
          source: EVENING_STRETCH_SOURCE,
          userId: USER,
        },
      },
    ]);
    expect(result.settings).toMatchObject({
      scheduledDate: "2026-10-18",
      scheduledTime: "21:00",
    });
  });

  it("keeps an up-to-date schedule instead of rescheduling", async () => {
    const store = memoryStore();
    const options = { trainedToday: true, now: evening(18) } as const;
    const first = await syncEveningStretch(USER, options, scheduler, store);
    const second = await syncEveningStretch(USER, options, scheduler, store);
    expect(second.settings.notificationId).toBe(first.settings.notificationId);
    expect(scheduler.pending.size).toBe(1);
  });

  it("moves tonight's reminder when the time changes", async () => {
    const store = memoryStore();
    await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      store,
    );
    await saveEveningStretchPreference(
      USER,
      { enabled: true, hour: 22, minute: 30 },
      store,
    );
    await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      store,
    );
    expect([...scheduler.pending.values()].map((entry) => entry.date)).toEqual([
      evening(22, 30),
    ]);
  });

  it("reschedules when the stored reminder is no longer pending", async () => {
    // A sign-out sweep or reinstall drops the OS request but not the record.
    const store = memoryStore();
    const options = { trainedToday: true, now: evening(18) } as const;
    await syncEveningStretch(USER, options, scheduler, store);
    await sweepEveningStretchNotifications(null, scheduler);
    expect(scheduler.pending.size).toBe(0);
    const result = await syncEveningStretch(USER, options, scheduler, store);
    expect(result.status).toBe("scheduled");
    expect(scheduler.pending.size).toBe(1);
  });

  it("does not prompt again after a prompt that failed", async () => {
    scheduler = fakeScheduler("undetermined");
    scheduler.requestPermission = async () => {
      scheduler.requests++;
      throw new Error("prompt failed");
    };
    const store = memoryStore();
    const options = {
      trainedToday: true,
      requestPermission: "once",
      now: evening(18),
    } as const;
    await syncEveningStretch(USER, options, scheduler, store);
    await syncEveningStretch(USER, options, scheduler, store);
    expect(scheduler.requests).toBe(1);
  });

  it("schedules once when two syncs overlap", async () => {
    const store = memoryStore();
    await Promise.all([
      syncEveningStretch(
        USER,
        { trainedToday: true, now: evening(18) },
        scheduler,
        store,
      ),
      syncEveningStretch(
        USER,
        { trainedToday: true, now: evening(18) },
        scheduler,
        store,
      ),
    ]);
    expect(scheduler.pending.size).toBe(1);
  });

  it.each([
    ["a rest day", { trainedToday: false, now: evening(18) }, {}],
    [
      "after the reminder time",
      { trainedToday: true, now: evening(21, 1) },
      {},
    ],
    [
      "once tonight's stretch is done",
      { trainedToday: true, now: evening(18) },
      { completedDate: "2026-10-18" },
    ],
  ])("cancels and skips on %s", async (_label, options, stored) => {
    scheduler.pending.set("stretch-old", {
      date: evening(21),
      data: { source: EVENING_STRETCH_SOURCE, userId: USER },
    });
    const store = memoryStore({ notificationId: "stretch-old", ...stored });
    const result = await syncEveningStretch(USER, options, scheduler, store);
    expect(result.status).toBe("not_needed");
    expect(scheduler.pending.size).toBe(0);
    expect(result.settings.notificationId).toBeNull();
  });

  it("cancels everything when turned off", async () => {
    const store = memoryStore();
    await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      store,
    );
    await saveEveningStretchPreference(
      USER,
      { enabled: false, hour: 21, minute: 0 },
      store,
    );
    const result = await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      store,
    );
    expect(result.status).toBe("disabled");
    expect(scheduler.pending.size).toBe(0);
  });

  it("leaves the schedule alone when today's training is unknown", async () => {
    const store = memoryStore();
    await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      store,
    );
    const result = await syncEveningStretch(
      USER,
      { trainedToday: null, now: evening(19) },
      scheduler,
      store,
    );
    expect(result.status).toBe("unknown");
    expect(scheduler.pending.size).toBe(1);
  });

  it("asks for permission at most once from automatic syncs", async () => {
    scheduler = fakeScheduler("undetermined", "denied");
    const store = memoryStore();
    const options = {
      trainedToday: true,
      requestPermission: "once",
      now: evening(18),
    } as const;
    const first = await syncEveningStretch(USER, options, scheduler, store);
    const second = await syncEveningStretch(USER, options, scheduler, store);
    expect(first.status).toBe("permission_denied");
    expect(second.status).toBe("permission_denied");
    expect(scheduler.requests).toBe(1);
    expect(scheduler.pending.size).toBe(0);
  });

  it("never prompts from a silent sync", async () => {
    scheduler = fakeScheduler("undetermined");
    const result = await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      memoryStore(),
    );
    expect(result.status).toBe("permission_denied");
    expect(scheduler.requests).toBe(0);
  });

  it("retires orphaned reminders of the same user only", async () => {
    scheduler.pending.set("orphan", {
      date: evening(21),
      data: { source: EVENING_STRETCH_SOURCE, userId: USER },
    });
    scheduler.pending.set("theirs", {
      date: evening(21),
      data: { source: EVENING_STRETCH_SOURCE, userId: OTHER },
    });
    scheduler.pending.set("unrelated", {
      date: evening(21),
      data: { source: "evening_catch_up_reminder", userId: USER },
    });
    await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      memoryStore(),
    );
    expect([...scheduler.pending.keys()].sort()).toEqual([
      "stretch-1",
      "theirs",
      "unrelated",
    ]);
  });

  it("reports unavailable instead of throwing when scheduling fails", async () => {
    scheduler.scheduleAtDate = async () => {
      throw new Error("native failure");
    };
    const result = await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      memoryStore(),
    );
    expect(result.status).toBe("unavailable");
  });
});

describe("finishing and account changes", () => {
  it("marks tonight done and cancels the reminder", async () => {
    const scheduler = fakeScheduler();
    const store = memoryStore();
    await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(18) },
      scheduler,
      store,
    );
    const settings = await markEveningStretchDone(
      USER,
      evening(19),
      scheduler,
      store,
    );
    expect(scheduler.pending.size).toBe(0);
    expect(isEveningStretchDoneToday(settings, evening(23))).toBe(true);
    expect(isEveningStretchDoneToday(settings, new Date(2026, 9, 19, 8))).toBe(
      false,
    );
    const later = await syncEveningStretch(
      USER,
      { trainedToday: true, now: evening(20) },
      scheduler,
      store,
    );
    expect(later.status).toBe("not_needed");
  });

  it("sweeps reminders that belong to anyone but the signed-in user", async () => {
    const scheduler = fakeScheduler();
    scheduler.pending.set("mine", {
      date: evening(21),
      data: { source: EVENING_STRETCH_SOURCE, userId: USER },
    });
    scheduler.pending.set("theirs", {
      date: evening(21),
      data: { source: EVENING_STRETCH_SOURCE, userId: OTHER },
    });
    await sweepEveningStretchNotifications(USER, scheduler);
    expect([...scheduler.pending.keys()]).toEqual(["mine"]);
    await sweepEveningStretchNotifications(null, scheduler);
    expect(scheduler.pending.size).toBe(0);
  });

  it("requests permission from an explicit settings save", async () => {
    const scheduler = fakeScheduler("undetermined", "granted");
    const store = memoryStore();
    expect(await ensureEveningStretchPermission(USER, scheduler, store)).toBe(
      "granted",
    );
    expect(scheduler.requests).toBe(1);
    expect((await loadEveningStretch(USER, store)).permissionRequested).toBe(
      true,
    );
  });
});
