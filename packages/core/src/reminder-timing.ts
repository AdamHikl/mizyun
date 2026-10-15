/**
 * Pure helpers that learn a person's usual meal-logging times so the app can
 * *suggest* (never silently apply) a better reminder time. Inputs are meal
 * instants and an IANA time zone; no clocks or storage are read here.
 */

export const REMINDER_LEARNING_WINDOW_DAYS = 14;
export const REMINDER_LEARNING_MIN_DAYS = 5;
export const REMINDER_ROUNDING_MINUTES = 15;
export const FIRST_MEAL_LEAD_MINUTES = 15;
export const EVENING_AFTER_LAST_MEAL_MINUTES = 60;
/** Entries before 04:00 count as late-night logs, not a morning first meal. */
export const FIRST_MEAL_DAY_START_MINUTES = 4 * 60;
/** A usual first meal later than this is not a morning pattern; no suggestion. */
export const FIRST_MEAL_LATEST_USUAL_MINUTES = 13 * 60;
export const EVENING_REMINDER_EARLIEST_MINUTES = 18 * 60;
export const EVENING_REMINDER_LATEST_MINUTES = 22 * 60 + 30;
/** Differences smaller than this are not worth interrupting the user for. */
export const REMINDER_SUGGESTION_MIN_DIFFERENCE_MINUTES = 30;

export type MealInstant = Date | string | number;

export interface LearnedReminderTime {
  /** Local reminder time, 0..23 / 0..59 on the 15-minute grid. */
  readonly hour: number;
  readonly minute: number;
  /** The rounded usual meal time the suggestion is based on. */
  readonly usualHour: number;
  readonly usualMinute: number;
  /** Number of distinct local days that contributed. */
  readonly sampleDays: number;
}

export interface LearnReminderOptions {
  readonly now?: Date | number;
  readonly windowDays?: number;
  readonly minDays?: number;
}

interface LocalParts {
  readonly day: string;
  readonly minutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

const localParts = (instant: number, timeZone: string): LocalParts => {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
};

/** Calendar-day arithmetic on `YYYY-MM-DD` without involving a time zone. */
const shiftDay = (day: string, delta: number): string => {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, date! + delta));
  return shifted.toISOString().slice(0, 10);
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const roundToGrid = (minutes: number): number =>
  Math.round(minutes / REMINDER_ROUNDING_MINUTES) * REMINDER_ROUNDING_MINUTES;

/** Group valid instants by local day within the window ending today. */
const groupByLocalDay = (
  instants: readonly MealInstant[],
  timeZone: string,
  options: LearnReminderOptions,
  includeToday: boolean,
): Map<string, number[]> | null => {
  const nowMs = options.now === undefined ? Date.now() : +options.now;
  if (!Number.isFinite(nowMs)) return null;
  let today: string;
  try {
    today = localParts(nowMs, timeZone).day;
  } catch {
    return null; // Unknown time zone: never guess.
  }
  const windowDays = options.windowDays ?? REMINDER_LEARNING_WINDOW_DAYS;
  const oldest = shiftDay(today, -(windowDays - 1));
  const days = new Map<string, number[]>();
  for (const instant of instants) {
    const ms = +new Date(instant);
    if (!Number.isFinite(ms) || ms > nowMs) continue;
    const { day, minutes } = localParts(ms, timeZone);
    if (day < oldest || day > today) continue;
    if (day === today && !includeToday) continue;
    const list = days.get(day);
    if (list) list.push(minutes);
    else days.set(day, [minutes]);
  }
  return days;
};

const toTime = (
  reminderMinutes: number,
  usualMinutes: number,
  sampleDays: number,
): LearnedReminderTime => ({
  hour: Math.floor(reminderMinutes / 60),
  minute: reminderMinutes % 60,
  usualHour: Math.floor(usualMinutes / 60),
  usualMinute: usualMinutes % 60,
  sampleDays,
});

/**
 * The usual first-meal time: median of each local day's earliest meal over the
 * last 14 days (needs at least 5 days), rounded to 15 minutes, with the
 * reminder placed 15 minutes earlier. Returns null with sparse data, an
 * unknown time zone, or a usual first meal that is not a morning pattern.
 */
export const learnFirstMealReminderTime = (
  mealInstants: readonly MealInstant[],
  timeZone: string,
  options: LearnReminderOptions = {},
): LearnedReminderTime | null => {
  const days = groupByLocalDay(mealInstants, timeZone, options, true);
  if (days === null) return null;
  const firsts: number[] = [];
  for (const minutes of days.values()) {
    const daytime = minutes.filter(
      (value) => value >= FIRST_MEAL_DAY_START_MINUTES,
    );
    if (daytime.length > 0) firsts.push(Math.min(...daytime));
  }
  if (firsts.length < (options.minDays ?? REMINDER_LEARNING_MIN_DAYS))
    return null;
  const usual = roundToGrid(median(firsts));
  if (usual > FIRST_MEAL_LATEST_USUAL_MINUTES) return null;
  const reminder = Math.max(0, usual - FIRST_MEAL_LEAD_MINUTES);
  return toTime(reminder, usual, firsts.length);
};

/**
 * The usual evening catch-up time: median of each completed local day's latest
 * meal (today is excluded because it may still be in progress) plus 60
 * minutes, rounded to 15 minutes and clamped to 18:00-22:30.
 */
export const learnEveningReminderTime = (
  mealInstants: readonly MealInstant[],
  timeZone: string,
  options: LearnReminderOptions = {},
): LearnedReminderTime | null => {
  const days = groupByLocalDay(mealInstants, timeZone, options, false);
  if (days === null) return null;
  const lasts: number[] = [];
  for (const minutes of days.values()) lasts.push(Math.max(...minutes));
  if (lasts.length < (options.minDays ?? REMINDER_LEARNING_MIN_DAYS))
    return null;
  const usual = roundToGrid(median(lasts));
  const reminder = Math.min(
    EVENING_REMINDER_LATEST_MINUTES,
    Math.max(
      EVENING_REMINDER_EARLIEST_MINUTES,
      roundToGrid(usual + EVENING_AFTER_LAST_MEAL_MINUTES),
    ),
  );
  return toTime(reminder, Math.min(usual, 23 * 60 + 45), lasts.length);
};

/** True when a learned time is far enough from the current setting to suggest. */
export const shouldSuggestReminderTime = (
  current: { readonly hour: number; readonly minute: number },
  learned: { readonly hour: number; readonly minute: number },
): boolean =>
  Math.abs(
    current.hour * 60 + current.minute - (learned.hour * 60 + learned.minute),
  ) >= REMINDER_SUGGESTION_MIN_DIFFERENCE_MINUTES;
