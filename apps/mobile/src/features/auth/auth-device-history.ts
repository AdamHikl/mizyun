import * as SecureStore from "expo-secure-store";

/**
 * Device-local marker that a session has ever existed here. It holds no
 * account data: it only lets a device that never had one open on sign-up
 * instead of "Welcome back".
 */
export const DEVICE_HAD_SESSION_KEY = "mizyun.auth.device-had-session.v1";

export interface DeviceHistoryStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
}

export type AuthEntryMode = "sign-in" | "sign-up";

/** Unknown history is treated as returning, so signing in stays the safe default. */
export const authEntryMode = (deviceHadSession: boolean): AuthEntryMode =>
  deviceHadSession ? "sign-in" : "sign-up";

export const loadDeviceHadSession = async (
  store: DeviceHistoryStore = SecureStore,
): Promise<boolean> => {
  try {
    return (await store.getItemAsync(DEVICE_HAD_SESSION_KEY)) !== null;
  } catch {
    return true;
  }
};

export const markDeviceHadSession = async (
  store: DeviceHistoryStore = SecureStore,
): Promise<void> => {
  try {
    await store.setItemAsync(DEVICE_HAD_SESSION_KEY, "1");
  } catch {
    // Best effort: a missed marker only means sign-up opens once more.
  }
};
