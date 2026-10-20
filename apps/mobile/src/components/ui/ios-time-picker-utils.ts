/**
 * Converts 24-hour hour (0..23) to 12-hour hour (1..12) and AM/PM period.
 */
export function to12Hour(hour24: number): {
  hour12: number;
  period: "AM" | "PM";
} {
  const normalized = Math.max(0, Math.min(23, Math.floor(hour24)));
  const period: "AM" | "PM" = normalized < 12 ? "AM" : "PM";
  const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return { hour12, period };
}

/**
 * Formats 24-hour hour and minute into "8:00 AM" / "11:30 PM".
 */
export function formatTime12(hour24: number, minute: number): string {
  const { hour12, period } = to12Hour(hour24);
  const safeMinute = Math.max(0, Math.min(59, Math.floor(minute)));
  return `${hour12}:${String(safeMinute).padStart(2, "0")} ${period}`;
}

export const WEEKDAYS = [
  { id: 1, shortLabel: "Sun", fullLabel: "Sunday" },
  { id: 2, shortLabel: "Mon", fullLabel: "Monday" },
  { id: 3, shortLabel: "Tue", fullLabel: "Tuesday" },
  { id: 4, shortLabel: "Wed", fullLabel: "Wednesday" },
  { id: 5, shortLabel: "Thu", fullLabel: "Thursday" },
  { id: 6, shortLabel: "Fri", fullLabel: "Friday" },
  { id: 7, shortLabel: "Sat", fullLabel: "Saturday" },
] as const;

export function getWeekdayLabel(
  weekdayId: number,
  format: "short" | "full" = "full",
): string {
  const match = WEEKDAYS.find((w) => w.id === weekdayId);
  if (!match) return format === "short" ? "Sun" : "Sunday";
  return format === "short" ? match.shortLabel : match.fullLabel;
}
