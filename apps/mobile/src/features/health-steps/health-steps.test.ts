import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectHealthSteps,
  healthStepsPreferenceKey,
  loadHealthStepsEnabled,
  localDayBounds,
  readTodaySteps,
  setHealthStepsEnabled,
  type HealthStepsPreferenceStore,
} from "./health-steps";

const native = vi.hoisted(() => ({
  getHealthStepsAvailability: vi.fn(),
  requestHealthStepsReadPermission: vi.fn(),
  getHealthStepsTotal: vi.fn(),
}));

vi.mock("../../../modules/mizyun-health-steps", () => native);

const userId = "11111111-1111-4111-8111-111111111111";

function makeStore(): HealthStepsPreferenceStore {
  const values = new Map<string, string>();
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("optional health steps", () => {
  it("starts off and never reads native data before user opt-in", async () => {
    const store = makeStore();
    expect(await readTodaySteps(userId, new Date(), store)).toEqual({
      kind: "off",
    });
    expect(native.getHealthStepsAvailability).not.toHaveBeenCalled();
  });

  it("scopes the preference to the signed-in user and clears it on disconnect", async () => {
    const store = makeStore();
    await setHealthStepsEnabled(userId, true, store);
    expect(await loadHealthStepsEnabled(userId, store)).toBe(true);
    expect(await loadHealthStepsEnabled("another-user", store)).toBe(false);
    await setHealthStepsEnabled(userId, false, store);
    expect(
      await store.getItemAsync(healthStepsPreferenceKey(userId)),
    ).toBeNull();
  });

  it("uses consecutive local midnights so the range follows timezone changes", () => {
    const date = new Date(2026, 9, 25, 12);
    const { startEpochMs, endEpochMs } = localDayBounds(date);
    expect(new Date(startEpochMs).getDate()).toBe(25);
    expect(new Date(endEpochMs).getDate()).toBe(26);
    expect(new Date(startEpochMs).getHours()).toBe(0);
    expect(new Date(endEpochMs).getHours()).toBe(0);
  });

  it("does not claim zero steps when the platform returns no readable data", async () => {
    const store = makeStore();
    await setHealthStepsEnabled(userId, true, store);
    native.getHealthStepsAvailability.mockResolvedValue("available");
    native.getHealthStepsTotal.mockResolvedValue(null);
    expect(await readTodaySteps(userId, new Date(), store)).toEqual({
      kind: "no_data",
    });
  });

  it("reports unavailable and revoked states without changing other dashboard data", async () => {
    const store = makeStore();
    await setHealthStepsEnabled(userId, true, store);
    native.getHealthStepsAvailability.mockResolvedValue("install_required");
    expect(await readTodaySteps(userId, new Date(), store)).toEqual({
      kind: "install_required",
    });
    native.getHealthStepsAvailability.mockResolvedValue("available");
    native.getHealthStepsTotal.mockRejectedValue(new Error("revoked"));
    expect(await readTodaySteps(userId, new Date(), store)).toEqual({
      kind: "error",
    });
  });

  it("keeps Android denied access off", async () => {
    native.getHealthStepsAvailability.mockResolvedValue("available");
    native.requestHealthStepsReadPermission.mockResolvedValue(false);
    expect(await connectHealthSteps(userId)).toBe("permission_denied");
    expect(native.getHealthStepsTotal).not.toHaveBeenCalled();
  });
});
