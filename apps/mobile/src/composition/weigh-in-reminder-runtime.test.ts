import { expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));

import { WeighInReminderRuntime } from "./weigh-in-reminder-runtime";

function setup(owners: string[] = []) {
  const ports = {
    readOwners: vi.fn(async () => owners),
    writeOwners: vi.fn(async (next: readonly string[]) => {
      owners = [...next];
    }),
    activate: vi.fn(),
    suspend: vi.fn(async (_owner: string) => {}),
    sweep: vi.fn(async (_owner: string | null) => {}),
    readTodayLogged: vi.fn(
      async (_owner: string): Promise<boolean | null> => false,
    ),
    reconcile: vi.fn(async (_owner: string, _logged: boolean) => {}),
  };
  return { ports, runtime: new WeighInReminderRuntime(ports) };
}

it("cancels a previous owner's reminders on a signed-out cold start", async () => {
  const { ports, runtime } = setup(["a"]);
  await runtime.setOwner(null);
  expect(ports.suspend).toHaveBeenCalledWith("a");
  expect(ports.writeOwners).toHaveBeenCalledWith([]);
  expect(ports.activate).not.toHaveBeenCalled();
  expect(ports.reconcile).not.toHaveBeenCalled();
});

it("persists ownership before activating, then reconciles from the day's weight", async () => {
  const { ports, runtime } = setup();
  ports.activate.mockImplementation(() =>
    expect(ports.writeOwners).toHaveBeenCalledWith(["a"]),
  );
  ports.readTodayLogged.mockResolvedValue(true);
  await runtime.setOwner("a");
  expect(ports.reconcile).toHaveBeenCalledWith("a", true);
});

it("suspends the previous account on sign-out or switch before the next is refreshed", async () => {
  const { ports, runtime } = setup();
  await runtime.setOwner("a");
  const order: string[] = [];
  ports.suspend.mockImplementation(
    async (owner) => void order.push(`suspend:${owner}`),
  );
  ports.reconcile.mockImplementation(
    async (owner) => void order.push(`reconcile:${owner}`),
  );
  await runtime.setOwner("b");
  // The journaled owner is also re-suspended; cancelling is idempotent.
  expect(order[0]).toBe("suspend:a");
  expect(order.at(-1)).toBe("reconcile:b");
  expect(order.indexOf("reconcile:b")).toBeGreaterThan(
    order.lastIndexOf("suspend:a"),
  );
});

it("does not reconcile when the weight read is unknown", async () => {
  const { ports, runtime } = setup();
  ports.readTodayLogged.mockResolvedValue(null);
  await runtime.setOwner("a");
  expect(ports.reconcile).not.toHaveBeenCalled();
});

it("discards a late read for an account that has since been replaced", async () => {
  const { ports, runtime } = setup();
  let resolve!: (logged: boolean) => void;
  ports.readTodayLogged.mockImplementationOnce(
    () => new Promise((done) => (resolve = done)),
  );
  const first = runtime.setOwner("a");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const second = runtime.setOwner("b");
  resolve(true);
  await first;
  await second;
  expect(ports.reconcile).not.toHaveBeenCalledWith("a", true);
  expect(ports.reconcile).toHaveBeenCalledWith("b", false);
});

it("refresh reconciles only for the current owner", async () => {
  const { ports, runtime } = setup();
  await runtime.refresh();
  expect(ports.reconcile).not.toHaveBeenCalled();
  await runtime.setOwner("a");
  ports.reconcile.mockClear();
  await runtime.refresh();
  expect(ports.reconcile).toHaveBeenCalledWith("a", false);
});
