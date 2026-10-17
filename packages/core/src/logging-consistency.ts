/**
 * Forgiving weekly logging goal (HABIT-01).
 *
 * A day counts as logged when it has at least one meal entry on the user's
 * local date. There is deliberately no streak: the week simply restarts on
 * Monday (the ISO week used by the weekly calorie review) and nothing is lost
 * by skipping a day. All arithmetic uses local `YYYY-MM-DD` strings through
 * UTC calendar math, so it is independent of DST and the device offset.
 */
import { isoWeekStart } from "./calorie-review";

export const WEEKLY_LOG_GOAL_MIN = 3;
export const WEEKLY_LOG_GOAL_MAX = 7;
export const WEEKLY_LOG_GOAL_DEFAULT = 5;
/** Whole days since the last log at which the welcome-back state starts. */
export const WELCOME_BACK_AFTER_DAYS = 2;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const parseLocalDate = (value: string): number | null => {
  if (!LOCAL_DATE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  // Reject rolled-over dates such as 2026-02-31.
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
};

const DAY_MS = 86_400_000;

/** Add whole calendar days to a local date string (UTC math, no DST). */
export const addLocalDays = (localDate: string, days: number): string => {
  const ms = parseLocalDate(localDate);
  if (ms === null) throw new RangeError("Invalid local date");
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
};

/** Clamp an arbitrary stored value to an integer weekly goal of 3 to 7. */
export const clampWeeklyLogGoal = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value))
    return WEEKLY_LOG_GOAL_DEFAULT;
  return Math.min(
    WEEKLY_LOG_GOAL_MAX,
    Math.max(WEEKLY_LOG_GOAL_MIN, Math.round(value)),
  );
};

export interface LoggingConsistencyDay {
  readonly date: string;
  readonly logged: boolean;
  readonly isToday: boolean;
  readonly isFuture: boolean;
}

export interface LoggingConsistency {
  readonly weekStart: string;
  readonly weeklyGoal: number;
  readonly daysLoggedThisWeek: number;
  readonly goalMet: boolean;
  readonly loggedToday: boolean;
  /** Null when there is no logged day on or before today. */
  readonly daysSinceLastLog: number | null;
  readonly showWelcomeBack: boolean;
  /** Monday to Sunday of the current week. */
  readonly weekDays: readonly LoggingConsistencyDay[];
}

/**
 * `loggedDates` are local dates with at least one meal entry. Duplicates,
 * malformed values and dates after `today` are ignored. Returns null when
 * `today` is not a valid local date.
 */
export const computeLoggingConsistency = (input: {
  readonly loggedDates: readonly string[];
  readonly today: string;
  readonly weeklyGoal: unknown;
}): LoggingConsistency | null => {
  const todayMs = parseLocalDate(input.today);
  if (todayMs === null) return null;
  const weeklyGoal = clampWeeklyLogGoal(input.weeklyGoal);

  const logged = new Set<string>();
  for (const date of input.loggedDates) {
    const ms = parseLocalDate(date);
    if (ms !== null && ms <= todayMs) logged.add(date);
  }

  const weekStart = isoWeekStart(input.today);
  const weekDays: LoggingConsistencyDay[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = addLocalDays(weekStart, offset);
    weekDays.push({
      date,
      logged: logged.has(date),
      isToday: date === input.today,
      isFuture: date > input.today,
    });
  }
  const daysLoggedThisWeek = weekDays.filter((day) => day.logged).length;

  let lastLog: number | null = null;
  for (const date of logged) {
    const ms = Date.parse(`${date}T00:00:00Z`);
    if (lastLog === null || ms > lastLog) lastLog = ms;
  }
  const daysSinceLastLog =
    lastLog === null ? null : Math.round((todayMs - lastLog) / DAY_MS);
  const loggedToday = logged.has(input.today);

  return {
    weekStart,
    weeklyGoal,
    daysLoggedThisWeek,
    goalMet: daysLoggedThisWeek >= weeklyGoal,
    loggedToday,
    daysSinceLastLog,
    showWelcomeBack:
      !loggedToday &&
      daysSinceLastLog !== null &&
      daysSinceLastLog >= WELCOME_BACK_AFTER_DAYS,
    weekDays,
  };
};
