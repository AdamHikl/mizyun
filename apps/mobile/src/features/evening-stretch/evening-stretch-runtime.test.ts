import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date" },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { status: vi.fn(), request: vi.fn() },
  invalidateSessionReads: vi.fn(),
}));
vi.mock("@/features/running/public-data", () => ({ listRuns: vi.fn() }));
vi.mock("./today-training-data", () => ({
  fetchTodayTraining: vi.fn().mockResolvedValue(null),
}));
vi.mock("./evening-stretch-reminder", () => ({
  syncEveningStretch: vi.fn().mockResolvedValue({ status: "scheduled" }),
  sweepEveningStretchNotifications: vi.fn().mockResolvedValue(undefined),
  loadEveningStretch: vi.fn().mockResolvedValue({ enabled: false }),
  isoLocalDate: () => "2026-10-22",
}));
vi.mock("@/composition/app-variant", () => ({
  isStretchAiEnabled: () => false,
}));
vi.mock("@/features/coach/ai-consent", () => ({
  loadAiConsent: vi.fn(),
}));
vi.mock("./stretch-ai-refine", () => ({
  loadTailoredStretchPlan: vi.fn(),
}));

import { invalidateSessionReads } from "@/composition/api-client";
import {
  EveningStretchRuntime,
  eveningStretchRuntime,
  type EveningStretchRuntimePorts,
} from "./evening-stretch-runtime";
import { syncEveningStretch } from "./evening-stretch-reminder";
import { fetchTodayTraining } from "./today-training-data";
import { noteTrainingSaved } from "./training-saved-signal";
import type { TodayTraining } from "./today-training-data";

type SyncStatus = Awaited<ReturnType<EveningStretchRuntimePorts["sync"]>>;
const SCHEDULED = "scheduled" as SyncStatus;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const training = (trained: boolean | null): TodayTraining | null =>
  trained === null
    ? null
    : { trained, input: { exercises: [], activities: [] } };

const makePorts = (trained: boolean | null = true) => {
  const readTraining = vi.fn<EveningStretchRuntimePorts["readTraining"]>(
    async () => training(trained),
  );
  const sync = vi.fn<EveningStretchRuntimePorts["sync"]>(async () => SCHEDULED);
  const sweep = vi.fn<EveningStretchRuntimePorts["sweep"]>(async () => {});
  const reminderAt = vi.fn<EveningStretchRuntimePorts["reminderAt"]>(
    async () => null,
  );
  const prepare = vi.fn<EveningStretchRuntimePorts["prepare"]>(async () => {});
  return {
    ports: { readTraining, sync, sweep, reminderAt, prepare },
    readTraining,
    sync,
    sweep,
    reminderAt,
    prepare,
  };
};

const at = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute);

const makeClock = (now: Date) => {
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  const clock = {
    current: now,
    now: () => clock.current,
    setTimeout: (callback: () => void, ms: number) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  return { clock, timers };
};

describe("EveningStretchRuntime", () => {
  it("sweeps for the owner, then syncs with the training state and no prompt", async () => {
    const { ports, sweep, sync } = makePorts(true);
    const runtime = new EveningStretchRuntime(ports);

    await runtime.setOwner("user-a");

    expect(sweep).toHaveBeenCalledExactlyOnceWith("user-a");
    expect(sync).toHaveBeenCalledExactlyOnceWith("user-a", true, "never");
    expect(sweep.mock.invocationCallOrder[0]).toBeLessThan(
      sync.mock.invocationCallOrder[0] as number,
    );
  });

  it("passes an unknown training state through as null", async () => {
    const { ports, sync } = makePorts(null);
    const runtime = new EveningStretchRuntime(ports);

    await runtime.setOwner("user-a");

    expect(sync).toHaveBeenCalledExactlyOnceWith("user-a", null, "never");
  });

  it("passes the permission request mode and returns the sync status", async () => {
    const { ports, sync } = makePorts(true);
    const runtime = new EveningStretchRuntime(ports);
    await runtime.setOwner("user-a");
    sync.mockClear();

    await expect(runtime.refresh("once")).resolves.toBe(SCHEDULED);

    expect(sync).toHaveBeenCalledExactlyOnceWith("user-a", true, "once");
  });

  it("does nothing on refresh without an owner", async () => {
    const { ports, readTraining, sync } = makePorts();
    const runtime = new EveningStretchRuntime(ports);

    await expect(runtime.refresh("once")).resolves.toBeNull();

    expect(readTraining).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("sweeps without syncing when the owner is cleared", async () => {
    const { ports, sweep, sync } = makePorts();
    const runtime = new EveningStretchRuntime(ports);
    await runtime.setOwner("user-a");
    sync.mockClear();

    await runtime.setOwner(null);

    expect(sweep).toHaveBeenLastCalledWith(null);
    expect(sync).not.toHaveBeenCalled();
  });

  it("ignores setOwner with the same owner", async () => {
    const { ports, sweep, sync } = makePorts();
    const runtime = new EveningStretchRuntime(ports);
    await runtime.setOwner("user-a");

    await runtime.setOwner("user-a");

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("drops a stale sync when the owner changes while training is being read", async () => {
    const pending = deferred<TodayTraining | null>();
    const { ports, readTraining, sync } = makePorts();
    readTraining.mockReturnValueOnce(pending.promise);
    const runtime = new EveningStretchRuntime(ports);

    const first = runtime.setOwner("user-a");
    await vi.waitFor(() => expect(readTraining).toHaveBeenCalledTimes(1));
    const second = runtime.setOwner("user-b");
    pending.resolve(training(true));
    await Promise.all([first, second]);

    expect(sync).toHaveBeenCalledExactlyOnceWith("user-b", true, "never");
  });

  it("drops a stale sync when the owner is cleared during the read", async () => {
    const pending = deferred<TodayTraining | null>();
    const { ports, readTraining, sync } = makePorts();
    readTraining.mockReturnValueOnce(pending.promise);
    const runtime = new EveningStretchRuntime(ports);

    const first = runtime.setOwner("user-a");
    await vi.waitFor(() => expect(readTraining).toHaveBeenCalledTimes(1));
    await runtime.setOwner(null);
    pending.resolve(training(true));
    await first;

    expect(sync).not.toHaveBeenCalled();
  });

  it("drops a stale sync when the same account signs out and back in", async () => {
    const pending = deferred<TodayTraining | null>();
    const { ports, readTraining, sync } = makePorts(false);
    readTraining.mockReturnValueOnce(pending.promise);
    const runtime = new EveningStretchRuntime(ports);

    const first = runtime.setOwner("user-a");
    await vi.waitFor(() => expect(readTraining).toHaveBeenCalledTimes(1));
    await runtime.setOwner(null);
    await runtime.setOwner("user-a");
    pending.resolve(training(true));
    await first;

    // Only the fresh read (false) reaches sync, never the stale true.
    expect(sync).toHaveBeenCalledExactlyOnceWith("user-a", false, "never");
  });

  it("syncs with null when reading training rejects", async () => {
    const { ports, readTraining, sync } = makePorts();
    readTraining.mockRejectedValue(new Error("offline"));
    const runtime = new EveningStretchRuntime(ports);

    await runtime.setOwner("user-a");

    expect(sync).toHaveBeenCalledExactlyOnceWith("user-a", null, "never");
  });
});

describe("EveningStretchRuntime tonight's plan", () => {
  it("prepares the plan once the reminder time has passed", async () => {
    const { ports, reminderAt, prepare } = makePorts(true);
    reminderAt.mockResolvedValue(at(21));
    const { clock, timers } = makeClock(at(21, 5));
    const runtime = new EveningStretchRuntime(ports, clock);

    await runtime.setOwner("user-a");

    await vi.waitFor(() =>
      expect(prepare).toHaveBeenCalledExactlyOnceWith(
        "user-a",
        training(true),
        at(21, 5),
        expect.any(Function),
      ),
    );
    expect(timers).toHaveLength(0);
  });

  it("returns the sync status without waiting for the plan", async () => {
    const { ports, reminderAt, prepare } = makePorts(true);
    reminderAt.mockResolvedValue(at(21));
    const pending = deferred<void>();
    prepare.mockReturnValue(pending.promise);
    const runtime = new EveningStretchRuntime(ports, makeClock(at(22)).clock);
    await runtime.setOwner("user-a");
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());

    await expect(runtime.refresh()).resolves.toBe(SCHEDULED);
    pending.resolve();
  });

  it("tells an in-progress preparation when the account changed", async () => {
    const { ports, reminderAt, prepare } = makePorts(true);
    reminderAt.mockResolvedValue(at(21));
    const runtime = new EveningStretchRuntime(ports, makeClock(at(22)).clock);
    await runtime.setOwner("user-a");
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    const isCurrent = prepare.mock.calls[0]![3];

    expect(isCurrent()).toBe(true);
    await runtime.setOwner("user-b");
    expect(isCurrent()).toBe(false);
  });

  it("arms one timer when two refreshes overlap", async () => {
    const { ports, reminderAt } = makePorts(true);
    const first = deferred<Date | null>();
    const second = deferred<Date | null>();
    reminderAt
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { clock, timers } = makeClock(at(18));
    const runtime = new EveningStretchRuntime(ports, clock);
    await runtime.setOwner("user-a");
    await runtime.refresh();
    await vi.waitFor(() => expect(reminderAt).toHaveBeenCalledTimes(2));

    first.resolve(at(21));
    second.resolve(at(21));
    await vi.waitFor(() => expect(timers).toHaveLength(2));

    expect(timers.filter((timer) => !timer.cleared)).toHaveLength(1);
  });

  it("waits for the reminder time, then prepares while the app runs", async () => {
    const { ports, reminderAt, prepare, readTraining } = makePorts(true);
    reminderAt.mockResolvedValue(at(21));
    const { clock, timers } = makeClock(at(18));
    const runtime = new EveningStretchRuntime(ports, clock);

    await runtime.setOwner("user-a");

    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(prepare).not.toHaveBeenCalled();
    expect(timers[0]!.ms).toBe(3 * 60 * 60 * 1000);

    clock.current = at(21);
    timers[0]!.callback();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(readTraining).toHaveBeenCalledTimes(2);
  });

  it("keeps a single pending timer across refreshes", async () => {
    const { ports, reminderAt } = makePorts(true);
    reminderAt.mockResolvedValue(at(21));
    const { clock, timers } = makeClock(at(18));
    const runtime = new EveningStretchRuntime(ports, clock);

    await runtime.setOwner("user-a");
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    await runtime.refresh();
    await vi.waitFor(() => expect(timers).toHaveLength(2));

    expect(timers.filter((timer) => !timer.cleared)).toHaveLength(1);
  });

  it("drops the pending timer when the account changes", async () => {
    const { ports, reminderAt, prepare } = makePorts(true);
    reminderAt.mockResolvedValue(at(21));
    const { clock, timers } = makeClock(at(18));
    const runtime = new EveningStretchRuntime(ports, clock);

    await runtime.setOwner("user-a");
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    await runtime.setOwner(null);

    expect(timers[0]!.cleared).toBe(true);
    clock.current = at(21);
    timers[0]!.callback();
    await Promise.resolve();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("prepares nothing without finished training or a due reminder", async () => {
    const rest = makePorts(false);
    rest.reminderAt.mockResolvedValue(at(21));
    await new EveningStretchRuntime(
      rest.ports,
      makeClock(at(22)).clock,
    ).setOwner("user-a");
    expect(rest.prepare).not.toHaveBeenCalled();

    const off = makePorts(true);
    const { clock, timers } = makeClock(at(22));
    await new EveningStretchRuntime(off.ports, clock).setOwner("user-a");
    expect(off.prepare).not.toHaveBeenCalled();
    expect(timers).toHaveLength(0);
  });

  it("still returns the sync status when preparing fails", async () => {
    const { ports, reminderAt, prepare } = makePorts(true);
    reminderAt.mockResolvedValue(at(21));
    prepare.mockRejectedValue(new Error("offline"));
    const runtime = new EveningStretchRuntime(ports, makeClock(at(22)).clock);
    await runtime.setOwner("user-a");

    await expect(runtime.refresh()).resolves.toBe(SCHEDULED);
  });
});

describe("module wiring", () => {
  beforeEach(() => {
    vi.mocked(invalidateSessionReads).mockClear();
    vi.mocked(syncEveningStretch).mockClear();
    vi.mocked(fetchTodayTraining).mockClear();
  });

  it("invalidates cached reads when training is saved", () => {
    noteTrainingSaved();

    expect(invalidateSessionReads).toHaveBeenCalledTimes(1);
  });

  it("re-syncs with a permission prompt once for the signed-in owner", async () => {
    vi.mocked(fetchTodayTraining).mockResolvedValue({
      trained: true,
      input: { exercises: [], activities: [] },
    });
    await eveningStretchRuntime.setOwner("wired-owner");
    vi.mocked(syncEveningStretch).mockClear();

    noteTrainingSaved();

    await vi.waitFor(() =>
      expect(syncEveningStretch).toHaveBeenCalledExactlyOnceWith(
        "wired-owner",
        { trainedToday: true, requestPermission: "once" },
      ),
    );
    await eveningStretchRuntime.setOwner(null);
  });

  it("does not throw when the save signal arrives without an owner", async () => {
    await eveningStretchRuntime.setOwner(null);

    expect(() => noteTrainingSaved()).not.toThrow();
    await Promise.resolve();
    expect(syncEveningStretch).not.toHaveBeenCalled();
  });
});
