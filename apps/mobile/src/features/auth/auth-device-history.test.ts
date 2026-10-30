import { describe, expect, it, vi } from "vitest";

import {
  DEVICE_HAD_SESSION_KEY,
  authEntryMode,
  loadDeviceHadSession,
  markDeviceHadSession,
  type DeviceHistoryStore,
} from "./auth-device-history";

const memoryStore = (): DeviceHistoryStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => {
      data.set(key, value);
    },
  };
};

describe("auth device history", () => {
  it("opens a never-used device on sign-up and a returning one on sign-in", () => {
    expect(authEntryMode(false)).toBe("sign-up");
    expect(authEntryMode(true)).toBe("sign-in");
  });

  it("reports a fresh device as having no session until one is marked", async () => {
    const store = memoryStore();
    expect(await loadDeviceHadSession(store)).toBe(false);
    await markDeviceHadSession(store);
    expect(store.data.get(DEVICE_HAD_SESSION_KEY)).toBe("1");
    expect(await loadDeviceHadSession(store)).toBe(true);
  });

  it("falls back to sign-in when the store cannot be read", async () => {
    const store: DeviceHistoryStore = {
      getItemAsync: vi.fn().mockRejectedValue(new Error("locked")),
      setItemAsync: vi.fn(),
    };
    expect(await loadDeviceHadSession(store)).toBe(true);
  });

  it("never throws when the marker cannot be written", async () => {
    const store: DeviceHistoryStore = {
      getItemAsync: vi.fn(),
      setItemAsync: vi.fn().mockRejectedValue(new Error("full")),
    };
    await expect(markDeviceHadSession(store)).resolves.toBeUndefined();
  });
});
