/**
 * Per-plan-tier AI usage caps. Read-only map consumed by the Coach
 * route limiter (AI-OPS-001). Defaults follow ADR-0017 §3 and the
 * free-vs-paid decision: free users see very strict limits, paid users
 * keep the AI-MOB-001 defaults until re-evaluated. Lookup is O(1).
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
    requestsPerMinute: 3,
    draftRequestsPerMinute: 1,
    maxConcurrentRequests: 1,
  },
  paid: {
    tier: "paid",
    dailyTokenBudget: 100_000,
    coachDailyTokenBudget: 100_000,
    photoDraftDailyLimit: 100,
    requestsPerMinute: 6,
    draftRequestsPerMinute: 3,
    maxConcurrentRequests: 1,
  },
};

export const capsForTier = (tier: AiPlanTier): AiTierCaps => AI_TIER_CAPS[tier];

export const isAiPlanTier = (value: unknown): value is AiPlanTier =>
  value === "free" || value === "paid";
