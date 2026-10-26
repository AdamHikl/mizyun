/**
 * Per-plan-tier AI usage caps. Read-only map consumed by the Coach
 * route limiter (AI-OPS-001). Defaults follow ADR-0017 §3 and the
 * free-vs-paid decision. ADR-0081 (#336) adds the cost allowance: every AI
 * call is charged its estimated cost (`ai-cost.ts`), and the daily and
 * monthly allowances keep a user's AI cost under the share of
 * subscription revenue set in docs/AI_UNIT_ECONOMICS_2026-10-26.md. The
 * count caps stay as burst limits. Lookup is O(1).
 *
 * The API resolver falls back to `free` if the profile value is
 * unrecognised, and the test override `AI_USER_TIER_OVERRIDE` is a
 * dev-only knob that overrides the profile value.
 */

export type AiPlanTier = "free" | "paid";

export interface AiTierCaps {
  readonly tier: AiPlanTier;
  /** Coach chat daily token budget. */
  readonly dailyTokenBudget: number;
  readonly coachDailyTokenBudget: number;
  /** Photo meal draft daily count limit (separated from Coach chat). */
  readonly photoDraftDailyLimit: number;
  /** Meal draft changes per day; outside the draft count (ADR-0081). */
  readonly refineDailyLimit: number;
  /** Estimated AI cost allowed per UTC day, micro-USD. */
  readonly dailyCostMicros: number;
  /** Estimated AI cost allowed per UTC calendar month, micro-USD. */
  readonly monthlyCostMicros: number;
  readonly requestsPerMinute: number;
  readonly draftRequestsPerMinute: number;
  readonly maxConcurrentRequests: number;
}

export const AI_TIER_CAPS: Readonly<Record<AiPlanTier, AiTierCaps>> = {
  free: {
    tier: "free",
    dailyTokenBudget: 10_000,
    coachDailyTokenBudget: 10_000,
    photoDraftDailyLimit: 5,
    refineDailyLimit: 10,
    dailyCostMicros: 50_000,
    monthlyCostMicros: 500_000,
    requestsPerMinute: 3,
    draftRequestsPerMinute: 1,
    maxConcurrentRequests: 1,
  },
  paid: {
    tier: "paid",
    dailyTokenBudget: 100_000,
    coachDailyTokenBudget: 100_000,
    photoDraftDailyLimit: 15,
    refineDailyLimit: 30,
    dailyCostMicros: 150_000,
    monthlyCostMicros: 1_000_000,
    requestsPerMinute: 6,
    draftRequestsPerMinute: 3,
    maxConcurrentRequests: 1,
  },
};

export const capsForTier = (tier: AiPlanTier): AiTierCaps => AI_TIER_CAPS[tier];

export const isAiPlanTier = (value: unknown): value is AiPlanTier =>
  value === "free" || value === "paid";
