/**
 * Copy for a 429 `daily_budget_exhausted` whose `resetAt` is more than a day
 * away: the monthly AI cost allowance is used up (ADR-0081). Returns null for
 * a daily reset so callers keep their own daily wording.
 */
export const monthlyAllowanceMessage = (
  resetAt: string | undefined,
  now: number = Date.now(),
): string | null => {
  if (!resetAt) return null;
  const reset = Date.parse(resetAt);
  if (!Number.isFinite(reset) || reset - now <= 24 * 3_600_000) return null;
  const date = new Date(reset).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return `You've used this month's AI allowance. It renews on ${date}.`;
};

/**
 * The device's local clock time of a daily reset, e.g. "01:00" or "1:00 AM".
 * Counts renew at midnight UTC (ADR-0087); users see their own time.
 */
export const localResetTime = (
  resetAt: string,
  timeZone?: string,
): string | null => {
  const reset = Date.parse(resetAt);
  if (!Number.isFinite(reset)) return null;
  return new Date(reset).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone !== undefined ? { timeZone } : {}),
  });
};

/** Coach copy for a 429 daily denial: messages, cost or the hidden ceiling. */
export const coachDailyLimitMessage = (
  resetAt: string | undefined,
  timeZone?: string,
): string => {
  const time = resetAt ? localResetTime(resetAt, timeZone) : null;
  return time
    ? `You've reached today's Coach limit. More messages from ${time}.`
    : "You've reached today's Coach limit. More messages tomorrow.";
};

/**
 * "Messages left today" line for Coach, shown once few are left so the
 * composer stays quiet for most of the day. Null while more are left.
 */
export const coachMessagesLeftLabel = (
  usage: {
    readonly messagesRemaining: number;
    readonly resetsAt: string;
  },
  timeZone?: string,
  showAtOrBelow = 3,
): string | null => {
  const left = usage.messagesRemaining;
  if (left > showAtOrBelow) return null;
  if (left <= 0) {
    const time = localResetTime(usage.resetsAt, timeZone);
    return time
      ? `No Coach messages left today. More from ${time}.`
      : "No Coach messages left today.";
  }
  return `${left} Coach ${left === 1 ? "message" : "messages"} left today`;
};
