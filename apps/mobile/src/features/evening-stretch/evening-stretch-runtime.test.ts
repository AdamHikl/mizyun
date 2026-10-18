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

const makePorts = (trained: boolean | null = true) => {
  const readTraining = vi.fn<EveningStretchRuntimePorts["readTraining"]>(
    async () => trained,
  );
  const sync = vi.fn<EveningStretchRuntimePorts["sync"]>(async () => SCHEDULED);
  const sweep = vi.fn<EveningStretchRuntimePorts["sweep"]>(async () => {});
  return { ports: { readTraining, sync, sweep }, readTraining, sync, sweep };
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
    const pending = deferred<boolean | null>();
    const { ports, readTraining, sync } = makePorts();
    readTraining.mockReturnValueOnce(pending.promise);
    const runtime = new EveningStretchRuntime(ports);

    const first = runtime.setOwner("user-a");
    await vi.waitFor(() => expect(readTraining).toHaveBeenCalledTimes(1));
    const second = runtime.setOwner("user-b");
    pending.resolve(true);
    await Promise.all([first, second]);

    expect(sync).toHaveBeenCalledExactlyOnceWith("user-b", true, "never");
  });

  it("drops a stale sync when the owner is cleared during the read", async () => {
    const pending = deferred<boolean | null>();
    const { ports, readTraining, sync } = makePorts();
    readTraining.mockReturnValueOnce(pending.promise);
    const runtime = new EveningStretchRuntime(ports);

    const first = runtime.setOwner("user-a");
    await vi.waitFor(() => expect(readTraining).toHaveBeenCalledTimes(1));
    await runtime.setOwner(null);
    pending.resolve(true);
    await first;

    expect(sync).not.toHaveBeenCalled();
  });

  it("drops a stale sync when the same account signs out and back in", async () => {
    const pending = deferred<boolean | null>();
    const { ports, readTraining, sync } = makePorts(false);
    readTraining.mockReturnValueOnce(pending.promise);
    const runtime = new EveningStretchRuntime(ports);

    const first = runtime.setOwner("user-a");
    await vi.waitFor(() => expect(readTraining).toHaveBeenCalledTimes(1));
    await runtime.setOwner(null);
    await runtime.setOwner("user-a");
    pending.resolve(true);
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
