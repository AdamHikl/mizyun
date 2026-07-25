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
  readonly dailyTokenBudget: number;
  readonly requestsPerMinute: number;
  readonly maxConcurrentRequests: number;
}

export const AI_TIER_CAPS: Readonly<Record<AiPlanTier, AiTierCaps>> = {
  free: {
    tier: "free",
    dailyTokenBudget: 5_000,
    requestsPerMinute: 3,
    maxConcurrentRequests: 1,
  },
  paid: {
    tier: "paid",
    dailyTokenBudget: 100_000,
    requestsPerMinute: 6,
    maxConcurrentRequests: 1,
  },
};

export const capsForTier = (tier: AiPlanTier): AiTierCaps => AI_TIER_CAPS[tier];

export const isAiPlanTier = (value: unknown): value is AiPlanTier =>
  value === "free" || value === "paid";
