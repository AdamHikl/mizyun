import { requireOptionalNativeModule } from "expo";

export type HealthStepsAvailability =
  "available" | "install_required" | "unavailable";

interface HealthStepsNativeModule {
  getAvailability(): Promise<HealthStepsAvailability>;
  requestReadPermission(): Promise<boolean>;
  getDailySteps(
    startEpochMs: number,
    endEpochMs: number,
  ): Promise<number | null>;
}

const nativeModule =
  requireOptionalNativeModule<HealthStepsNativeModule>("MizyunHealthSteps");

export async function getHealthStepsAvailability(): Promise<HealthStepsAvailability> {
  if (nativeModule === null) return "unavailable";
  return nativeModule.getAvailability();
}

export async function requestHealthStepsReadPermission(): Promise<boolean> {
  if (nativeModule === null) return false;
  return nativeModule.requestReadPermission();
}

export async function getHealthStepsTotal(
  startEpochMs: number,
  endEpochMs: number,
): Promise<number | null> {
  if (nativeModule === null) return null;
  const count = await nativeModule.getDailySteps(startEpochMs, endEpochMs);
  if (count === null) return null;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Health steps returned an invalid count.");
  }
  return count;
}
