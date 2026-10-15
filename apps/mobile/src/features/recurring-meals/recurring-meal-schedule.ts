import type { RecurringMeal } from "@mizyun/contracts";

export const SPOKEN_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ScheduleShape = Pick<
  RecurringMeal,
  "localTime" | "timeZone" | "weekdays" | "enabled"
>;

interface ZoneNow {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minutes: number;
}

// Wall-clock fields of `now` in `timeZone`; null for an unknown zone.
function zoneNow(timeZone: string, now: Date): ZoneNow | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const num = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);
    const year = num("year");
    const month = num("month");
    const day = num("day");
    const hour = num("hour");
    const minute = num("minute");
    if (
      [year, month, day, hour, minute].some((value) => !Number.isFinite(value))
    )
      return null;
    return {
      year,
      month,
      day,
      // Calendar arithmetic on the zone's local date; no DST involved.
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
      minutes: hour * 60 + minute,
    };
  } catch {
    return null;
  }
}

/** Local weekday (0 = Sunday) of `now` in `timeZone`, or null if the zone is unknown. */
export function weekdayInZone(
  timeZone: string,
  now = new Date(),
): number | null {
  return zoneNow(timeZone, now)?.weekday ?? null;
}

/** Skip today applies only to an active schedule that runs on today's weekday in its own zone. */
export function canSkipToday(
  schedule: ScheduleShape,
  now = new Date(),
): boolean {
  if (!schedule.enabled) return false;
  const weekday = weekdayInZone(schedule.timeZone, now);
  return weekday !== null && schedule.weekdays.includes(weekday);
}

export interface NextOccurrence {
  /** Whole local calendar days from today in the schedule's zone. */
  dayOffset: number;
  weekday: number;
  /** Local date in the schedule's zone, YYYY-MM-DD. */
  localDate: string;
  localTime: string;
}

const toMinutes = (time: string): number | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * Next scheduled local wall time strictly after `now`, compared as wall-clock
 * strings in the schedule's zone so DST changes never shift it. Null when
 * paused, empty or unreadable. The client cannot know whether today's
 * occurrence was already logged or skipped.
 */
export function nextRecurringOccurrence(
  schedule: ScheduleShape,
  now = new Date(),
): NextOccurrence | null {
  if (!schedule.enabled || schedule.weekdays.length === 0) return null;
  const at = toMinutes(schedule.localTime);
  const current = zoneNow(schedule.timeZone, now);
  if (at === null || !current) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(
      Date.UTC(current.year, current.month - 1, current.day + offset),
    );
    const weekday = date.getUTCDay();
    if (!schedule.weekdays.includes(weekday)) continue;
    if (offset === 0 && at <= current.minutes) continue;
    return {
      dayOffset: offset,
      weekday,
      localDate: date.toISOString().slice(0, 10),
      localTime: schedule.localTime,
    };
  }
  return null;
}

/** "Next: Today 08:00", "Next: Tomorrow 08:00", "Next: Thu 08:00" or "Next: Next Thu 08:00". */
export function describeNextOccurrence(
  schedule: ScheduleShape,
  now = new Date(),
): string | null {
  const next = nextRecurringOccurrence(schedule, now);
  if (!next) return null;
  const day =
    next.dayOffset === 0
      ? "Today"
      : next.dayOffset === 1
        ? "Tomorrow"
        : next.dayOffset >= 7
          ? `Next ${SHORT_WEEKDAYS[next.weekday]}`
          : SHORT_WEEKDAYS[next.weekday];
  return `Next: ${day} ${next.localTime}`;
}

/** Note shown when the schedule's zone is not the device's zone. */
export function timeZoneNote(
  scheduleZone: string,
  deviceZone: string,
): string | null {
  return scheduleZone === deviceZone
    ? null
    : `Schedule time zone: ${scheduleZone}`;
}
