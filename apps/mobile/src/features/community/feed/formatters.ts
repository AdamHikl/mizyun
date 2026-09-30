const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Format the author-selected calendar day strictly from the YYYY-MM-DD string
 * without converting across timezones, preserving the author's chosen day.
 */
export function formatSharedDay(sharedDay: string): string {
  const parts = sharedDay.split("-");
  if (parts.length !== 3) return sharedDay;
  const monthIdx = parseInt(parts[1]!, 10) - 1;
  const day = parseInt(parts[2]!, 10);
  const year = parts[0];
  const month = MONTH_NAMES[monthIdx] ?? parts[1];
  return `${month} ${day}, ${year}`;
}

/**
 * Render the publication instant in the viewer's local timezone.
 */
export function formatPublishedAt(publishedAtIso: string): string {
  try {
    const date = new Date(publishedAtIso);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
}

/**
 * Format duration units accessibly with both compact text and accessible voiceover text.
 */
export function formatDuration(
  durationSeconds: number | null,
): { text: string; accessible: string } | null {
  if (durationSeconds === null || durationSeconds < 0) return null;
  const totalMinutes = Math.round(durationSeconds / 60);
  if (totalMinutes === 0) {
    return { text: "< 1m", accessible: "less than one minute" };
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) {
    return {
      text: `${mins}m`,
      accessible: `${mins} minute${mins === 1 ? "" : "s"}`,
    };
  }
  if (mins === 0) {
    return {
      text: `${hours}h`,
      accessible: `${hours} hour${hours === 1 ? "" : "s"}`,
    };
  }
  return {
    text: `${hours}h ${mins}m`,
    accessible: `${hours} hour${hours === 1 ? "" : "s"} and ${mins} minute${mins === 1 ? "" : "s"}`,
  };
}

export function formatCategory(category: string): string {
  switch (category) {
    case "strength":
      return "Strength workout";
    case "running":
      return "Running";
    case "cycling":
      return "Cycling";
    case "hiit":
      return "HIIT";
    case "mobility":
      return "Mobility";
    case "walking":
      return "Walking";
    default:
      return "Workout";
  }
}
