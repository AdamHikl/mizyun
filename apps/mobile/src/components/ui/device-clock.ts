import { requireOptionalNativeModule } from "expo";
import type { Calendar } from "expo-localization";

import { formatPickerTime, uses24HourClock } from "./native-date-time-values";

interface LocalizationNativeModule {
  getCalendars(): Calendar[];
}

/**
 * The expo-localization native module, read optionally: its JS entry calls
 * `requireNativeModule` at import, which would crash Home and Settings on a
 * binary built before the module was added. Null on web and old binaries.
 */
const localization = (): LocalizationNativeModule | null =>
  requireOptionalNativeModule<LocalizationNativeModule>("ExpoLocalization");

/**
 * Whether the device shows times on a 24-hour clock: Android's "Use
 * 24-hour format" toggle (`DateFormat.is24HourFormat`) or iOS's 24-Hour
 * Time setting, through `expo-localization`. Read on every call because
 * Android does not report a toggle change to the running app. Falls back
 * to the locale's hour cycle when the native value is unavailable.
 */
export function deviceUses24HourClock(): boolean {
  try {
    const setting = localization()?.getCalendars()[0]?.uses24hourClock;
    if (typeof setting === "boolean") return setting;
  } catch {
    // Use the locale below if the native call fails.
  }
  return uses24HourClock();
}

/** A time on the device's clock, matching the native time picker. */
export function formatDeviceTime(hour: number, minute: number): string {
  return formatPickerTime(hour, minute, {
    uses24Hour: deviceUses24HourClock(),
  });
}

/** An instant's local time on the device's clock; empty for an invalid date. */
export function formatDeviceInstant(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return formatDeviceTime(date.getHours(), date.getMinutes());
}
