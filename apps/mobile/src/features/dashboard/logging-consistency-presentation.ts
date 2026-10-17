import type { LoggingConsistency } from "@mizyun/core";

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export interface LoggingConsistencyDot {
  readonly date: string;
  readonly letter: string;
  readonly logged: boolean;
  readonly isToday: boolean;
  readonly accessibilityLabel: string;
}

export interface LoggingConsistencyPresentation {
  readonly kind: "progress" | "goal-met" | "welcome-back";
  readonly title: string;
  readonly message: string | null;
  readonly accessibilityLabel: string;
  readonly dots: readonly LoggingConsistencyDot[];
}

const dayWord = (count: number) => (count === 1 ? "day" : "days");

/**
 * Copy and day dots for the weekly logging card. Wording stays gentle: no
 * streaks, no resets and no language about missed or failed days.
 */
export const presentLoggingConsistency = (
  state: LoggingConsistency,
): LoggingConsistencyPresentation => {
  const dots = state.weekDays.map((day, index): LoggingConsistencyDot => {
    const name = WEEKDAY_NAMES[index];
    const status = day.logged
      ? "logged"
      : day.isFuture
        ? "upcoming"
        : day.isToday
          ? "not logged yet"
          : "no log";
    return {
      date: day.date,
      letter: name.slice(0, 1),
      logged: day.logged,
      isToday: day.isToday,
      accessibilityLabel: `${name}, ${status}`,
    };
  });
  const progress = `Logged ${state.daysLoggedThisWeek} of ${state.weeklyGoal} ${dayWord(state.weeklyGoal)} this week`;

  if (state.showWelcomeBack) {
    return {
      kind: "welcome-back",
      title: "Welcome back",
      message:
        "Pick up where you left off. Today's first meal is a good place to start.",
      accessibilityLabel: `Welcome back. ${progress}.`,
      dots,
    };
  }
  if (state.goalMet) {
    return {
      kind: "goal-met",
      title: progress,
      message: "Goal reached for the week. Nicely done.",
      accessibilityLabel: `${progress}. Goal reached.`,
      dots,
    };
  }
  return {
    kind: "progress",
    title: progress,
    message: null,
    accessibilityLabel: `${progress}.`,
    dots,
  };
};
