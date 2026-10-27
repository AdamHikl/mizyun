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
