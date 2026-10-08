import { expect, it, vi } from "vitest";
import {
  FirstMealReminderLifecycle,
  sweepUnownedFirstMealNotifications,
} from "./first-meal-reminder-lifecycle";
function setup(owners: string[] = []) {
  const ports = {
    readOwners: vi.fn(async () => owners),
    writeOwners: vi.fn(async (next: readonly string[]) => {
      owners = [...next];
    }),
    activate: vi.fn(),
    suspend: vi.fn(async (_owner: string) => {}),
    readToday: vi.fn(async (_day: string): Promise<boolean | null> => false),
    reconcile: vi.fn(async (_owner: string, _logged: boolean) => {}),
    now: () => new Date(2026, 9, 8, 7),
  };
  return { ports, lifecycle: new FirstMealReminderLifecycle(ports) };
}
it("cancels a prior owner's scheduled reminders on a signed-out cold start", async () => {
  const { ports, lifecycle } = setup(["a"]);
  await lifecycle.setOwner(null);
  expect(ports.suspend).toHaveBeenCalledWith("a");
  expect(ports.writeOwners).toHaveBeenCalledWith([]);
  expect(ports.reconcile).not.toHaveBeenCalled();
});
it("persists ownership before activation and reads meals before scheduling", async () => {
  const { ports, lifecycle } = setup();
  ports.activate.mockImplementation(() =>
    expect(ports.writeOwners).toHaveBeenCalledWith(["a"]),
  );
  ports.readToday.mockResolvedValue(true);
  await lifecycle.setOwner("a");
  expect(ports.reconcile).toHaveBeenCalledWith("a", true);
});
it("retires synchronously and discards a late old-account meal read", async () => {
  const { ports, lifecycle } = setup();
  let resolve!: (logged: boolean) => void;
  ports.readToday.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = lifecycle.setOwner("a");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const second = lifecycle.setOwner("b");
  expect(ports.suspend).toHaveBeenCalledWith("a");
  resolve(true);
  await first;
  await second;
  expect(ports.reconcile).not.toHaveBeenCalledWith("a", true);
  expect(ports.reconcile).toHaveBeenCalledWith("b", false);
});
it("retains the cleanup journal on failure and retries before activating the new account", async () => {
  const { ports, lifecycle } = setup(["a"]);
  ports.suspend.mockRejectedValueOnce(new Error("OS unavailable"));
  await expect(lifecycle.setOwner("b")).rejects.toThrow();
  expect(ports.writeOwners).not.toHaveBeenCalled();
  expect(ports.activate).not.toHaveBeenCalled();
  await lifecycle.refresh();
  expect(ports.suspend).toHaveBeenCalledTimes(2);
  expect(ports.activate).toHaveBeenCalledWith("b");
});
it("does not unsuppress reminders from an unavailable daily summary", async () => {
  const { ports, lifecycle } = setup();
  ports.readToday.mockResolvedValue(null);
  await lifecycle.setOwner("a");
  expect(ports.reconcile).not.toHaveBeenCalled();
});
it("rechecks meals on foreground and does not reactivate an already current owner", async () => {
  const { ports, lifecycle } = setup();
  await lifecycle.setOwner("a");
  ports.readToday.mockResolvedValue(true);
  await lifecycle.refresh();
  expect(ports.activate).toHaveBeenCalledTimes(1);
  expect(ports.reconcile).toHaveBeenLastCalledWith("a", true);
});
it("migrates legacy and other-account first-meal schedules on signed-out restart only", async () => {
  const ports = {
    list: vi.fn(async () => [
      {
        identifier: "legacy",
        content: { data: { source: "first_meal_reminder" } },
      },
      {
        identifier: "old",
        content: { data: { source: "first_meal_reminder", userId: "a" } },
      },
      { identifier: "coach", content: { data: { source: "coach_reminder" } } },
    ]),
    cancel: vi.fn(async (_id: string) => {}),
  };
  await sweepUnownedFirstMealNotifications(null, ports);
  expect(ports.cancel.mock.calls).toEqual([["legacy"], ["old"]]);
});
it("preserves the signed-in owner's tagged schedule and surfaces failed legacy cancellation", async () => {
  const ports = {
    list: vi.fn(async () => [
      {
        identifier: "current",
        content: { data: { source: "first_meal_reminder", userId: "a" } },
      },
      {
        identifier: "legacy",
        content: { data: { source: "first_meal_reminder" } },
      },
    ]),
    cancel: vi.fn(async (_id: string) => {
      throw new Error("OS unavailable");
    }),
  };
  await expect(sweepUnownedFirstMealNotifications("a", ports)).rejects.toThrow(
    "migration incomplete",
  );
  expect(ports.cancel).toHaveBeenCalledWith("legacy");
  expect(ports.cancel).not.toHaveBeenCalledWith("current");
});
