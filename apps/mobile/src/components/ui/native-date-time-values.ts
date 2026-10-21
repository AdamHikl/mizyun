/**
 * Value conversions for the platform date and time pickers in
 * `native-date-time-picker.tsx`. Kept free of React Native imports so
 * they can be unit-tested directly.
 *
 * iOS (SwiftUI `DatePicker`) and the Android time dialog both work in
 * local wall-clock time. The Android Material 3 date dialog selects a
 * calendar day as UTC-midnight milliseconds: its initial selection is
 * read that way and its result is reported that way, while its
 * minimum/maximum bounds are converted from local time natively.
 */

export interface PickerLocalDate {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  readonly day: number;
}

export type PickerPlatform = "ios" | "android" | "web";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(value)));

/**
 * A fixed day with no DST change in any zone, so a time inside today's
 * spring-forward gap is not moved an hour by the picker.
 */
const TIME_BASE = new Date(2000, 0, 1);

/** `base`'s date at the given local hour and minute. */
export function timeToPickerDate(
  hour: number,
  minute: number,
  base: Date = TIME_BASE,
): Date {
  const date = new Date(base.getTime());
  date.setHours(clamp(hour, 0, 23), clamp(minute, 0, 59), 0, 0);
  return date;
}

/** The local hour and minute a time picker reported. */
export function pickerDateToTime(date: Date): {
  readonly hour: number;
  readonly minute: number;
} {
  return { hour: date.getHours(), minute: date.getMinutes() };
}

/**
 * The value to hand the picker for a calendar day. Local noon keeps the
 * day stable across DST changes; Android's date dialog needs UTC
 * midnight of the same day.
 */
export function localDateToPickerDate(
  value: PickerLocalDate,
  platform: PickerPlatform,
): Date {
  if (platform === "android") {
    return new Date(Date.UTC(value.year, value.month - 1, value.day));
  }
  return new Date(value.year, value.month - 1, value.day, 12, 0, 0, 0);
}

/**
 * A minimum (`"start"`) or maximum (`"end"`) bound covering the whole
 * calendar day, in local time on every platform.
 */
export function localDateToPickerBound(
  value: PickerLocalDate,
  edge: "start" | "end",
): Date {
  return edge === "start"
    ? new Date(value.year, value.month - 1, value.day, 0, 0, 0, 0)
    : new Date(value.year, value.month - 1, value.day, 23, 59, 59, 999);
}

/**
 * The iOS picker's selectable range. SwiftUI traps on a range whose start
 * is after its end, so an inverted pair of bounds is dropped.
 */
export function pickerDateRange(
  minimumDate?: PickerLocalDate,
  maximumDate?: PickerLocalDate,
): { start?: Date; end?: Date } | undefined {
  if (!minimumDate && !maximumDate) return undefined;
  const start = minimumDate && localDateToPickerBound(minimumDate, "start");
  const end = maximumDate && localDateToPickerBound(maximumDate, "end");
  if (start && end && start > end) return undefined;
  return { start, end };
}

/** The calendar day a date picker reported. */
export function pickerDateToLocalDate(
  date: Date,
  platform: PickerPlatform,
): PickerLocalDate {
  if (platform === "android") {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

/**
 * Whether the locale writes times on a 24-hour clock. This is only the
 * locale's default: the device's own 12/24-hour setting comes from
 * `deviceUses24HourClock()` in `device-clock.ts`, which falls back here.
 */
export function uses24HourClock(locale?: string): boolean {
  try {
    const options = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions();
    if (options.hourCycle) {
      return options.hourCycle === "h23" || options.hourCycle === "h24";
    }
    return options.hour12 === false;
  } catch {
    return false;
  }
}

export interface FormatPickerTimeOptions {
  readonly locale?: string;
  /** The clock to use; the locale's default when omitted. */
  readonly uses24Hour?: boolean;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/**
 * A time in the locale's style on the chosen clock, e.g. "7:30 PM" or
 * "19:30". An explicit `hourCycle` overrides the locale's own cycle; if
 * the JS engine ignores it, a plain "19:30" / "7:30 PM" keeps the text on
 * the chosen clock.
 */
export function formatPickerTime(
  hour: number,
  minute: number,
  { locale, uses24Hour }: FormatPickerTimeOptions = {},
): string {
  const h = clamp(hour, 0, 23);
  const m = clamp(minute, 0, 59);
  const twentyFour = uses24Hour ?? uses24HourClock(locale);
  const requested = twentyFour ? "h23" : "h12";
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      hourCycle: requested,
    });
    // An h11 or h24 locale default would show "0:30 PM" or "24:05".
    if (formatter.resolvedOptions().hourCycle === requested) {
      return formatter.format(timeToPickerDate(h, m));
    }
  } catch {
    // Fall through to the plain format below.
  }
  if (twentyFour) return `${pad2(h)}:${pad2(m)}`;
  const period = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(m)} ${period}`;
}

/** A calendar day as the device locale writes it, e.g. "19 Oct 2026". */
export function formatPickerDate(
  value: PickerLocalDate,
  locale?: string,
): string {
  return localDateToPickerDate(value, "ios").toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const dayKey = (value: PickerLocalDate): number =>
  value.year * 10_000 + value.month * 100 + value.day;

/** Whether `value` falls within the optional inclusive bounds. */
export function withinLocalDateRange(
  value: PickerLocalDate,
  minimumDate?: PickerLocalDate,
  maximumDate?: PickerLocalDate,
): boolean {
  if (minimumDate && dayKey(value) < dayKey(minimumDate)) return false;
  if (maximumDate && dayKey(value) > dayKey(maximumDate)) return false;
  return true;
}

/** `HH:MM` for a web `<input type="time">`. */
export function toTimeInputValue(hour: number, minute: number): string {
  return `${String(clamp(hour, 0, 23)).padStart(2, "0")}:${String(
    clamp(minute, 0, 59),
  ).padStart(2, "0")}`;
}

/**
 * Parses a stored or web `<input type="time">` value: "HH:MM" or "H:MM",
 * optionally with seconds.
 */
export function fromTimeInputValue(
  value: string,
): { readonly hour: number; readonly minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Today's local calendar day. */
export function todayLocalDate(now: Date = new Date()): PickerLocalDate {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

/** `YYYY-MM-DD` for a web `<input type="date">`. */
export function toDateInputValue(value: PickerLocalDate): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(
    2,
    "0",
  )}-${String(value.day).padStart(2, "0")}`;
}

/** Parses a web `<input type="date">` value. */
export function fromDateInputValue(value: string): PickerLocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(year, month - 1, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export interface NativeTimePickerProps {
  /** Visible row label, also the accessibility label. */
  readonly label: string;
  /** 0–23. */
  readonly hour: number;
  /** 0–59. */
  readonly minute: number;
  readonly onChange: (hour: number, minute: number) => void;
  readonly disabled?: boolean;
}

export interface NativeDatePickerProps {
  /** Visible row label, also the accessibility label. */
  readonly label: string;
  readonly value: PickerLocalDate;
  readonly onChange: (value: PickerLocalDate) => void;
  readonly minimumDate?: PickerLocalDate;
  readonly maximumDate?: PickerLocalDate;
  readonly disabled?: boolean;
}
