import * as SecureStore from "expo-secure-store";

import {
  getHealthStepsAvailability,
  getHealthStepsTotal,
  requestHealthStepsReadPermission,
  type HealthStepsAvailability,
} from "../../../modules/mizyun-health-steps";
import { healthStepsPreferenceKey } from "./health-steps-key";

export { healthStepsPreferenceKey } from "./health-steps-key";

export interface HealthStepsPreferenceStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

export async function loadHealthStepsEnabled(
  userId: string,
  store: HealthStepsPreferenceStore = SecureStore,
): Promise<boolean> {
  try {
    return (await store.getItemAsync(healthStepsPreferenceKey(userId))) === "1";
  } catch {
    return false;
  }
}

export async function setHealthStepsEnabled(
  userId: string,
  enabled: boolean,
  store: HealthStepsPreferenceStore = SecureStore,
): Promise<void> {
  if (enabled) {
    await store.setItemAsync(healthStepsPreferenceKey(userId), "1");
  } else {
    await store.deleteItemAsync(healthStepsPreferenceKey(userId));
  }
}

export function localDayBounds(now: Date): {
  readonly startEpochMs: number;
  readonly endEpochMs: number;
} {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  return {
    startEpochMs: new Date(year, month, day).getTime(),
    endEpochMs: new Date(year, month, day + 1).getTime(),
  };
}

export type DailyStepsResult =
  | { readonly kind: "loading" }
  | { readonly kind: "off" }
  | { readonly kind: "unavailable" | "install_required" | "no_data" | "error" }
  | { readonly kind: "ready"; readonly count: number };

export interface HealthStepsReader {
  getAvailability(): Promise<HealthStepsAvailability>;
  getDailySteps(
    startEpochMs: number,
    endEpochMs: number,
  ): Promise<number | null>;
}

const nativeReader: HealthStepsReader = {
  getAvailability: getHealthStepsAvailability,
  getDailySteps: getHealthStepsTotal,
};

export async function readTodaySteps(
  userId: string,
  now = new Date(),
  store: HealthStepsPreferenceStore = SecureStore,
  reader: HealthStepsReader = nativeReader,
): Promise<DailyStepsResult> {
  if (!(await loadHealthStepsEnabled(userId, store))) return { kind: "off" };
  try {
    const availability = await reader.getAvailability();
    if (availability !== "available") return { kind: availability };
    const { startEpochMs, endEpochMs } = localDayBounds(now);
    const count = await reader.getDailySteps(startEpochMs, endEpochMs);
    return count === null ? { kind: "no_data" } : { kind: "ready", count };
  } catch {
    return { kind: "error" };
  }
}

export async function connectHealthSteps(
  userId: string,
): Promise<
  | "connected"
  | "install_required"
  | "unavailable"
  | "permission_denied"
  | "error"
> {
  try {
    const availability = await getHealthStepsAvailability();
    if (availability !== "available") return availability;
    const completed = await requestHealthStepsReadPermission();
    if (!completed) return "permission_denied";
    await setHealthStepsEnabled(userId, true);
    return "connected";
  } catch {
    return "error";
  }
}
