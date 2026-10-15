import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  calorieAdjustmentDecisionResponseSchema,
  energySummaryResponseSchema,
  weeklyCalorieReviewResponseSchema,
  type CalorieAdjustmentDecision,
  type CalorieAdjustmentProposal,
  type CalorieReviewWire,
} from "@mizyun/contracts";

/**
 * API access for the weekly calorie review. `GET` lazily computes this
 * week's review and stores a pending proposal when the review says
 * "adjust"; `POST .../decision` accepts or declines it.
 */

export type WeeklyReviewSnapshot = {
  readonly review: CalorieReviewWire | null;
  readonly proposal: CalorieAdjustmentProposal | null;
};

export type FetchWeeklyReviewResult =
  | { readonly kind: "ok"; readonly snapshot: WeeklyReviewSnapshot }
  | { readonly kind: "error"; readonly error: ApiError };

export interface WeeklyReviewRequestOptions {
  readonly expectedUserId?: string;
  readonly isCurrent?: () => boolean;
}

export const fetchWeeklyReview = async (
  client: ApiClient,
  utcOffsetMinutes: number,
  options: WeeklyReviewRequestOptions = {},
): Promise<FetchWeeklyReviewResult> => {
  const result = await client.request({
    method: "GET",
    path: `/v1/energy/weekly-review?utcOffsetMinutes=${encodeURIComponent(utcOffsetMinutes)}`,
    schema: weeklyCalorieReviewResponseSchema,
    ...(options.expectedUserId
      ? { expectedUserId: options.expectedUserId }
      : {}),
    ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
  });
  if (!result.ok) return { kind: "error", error: result.error };
  const parsed = weeklyCalorieReviewResponseSchema.safeParse(result.value);
  if (!parsed.success) {
    return {
      kind: "error",
      error: { kind: "validation_error", issues: parsed.error.issues },
    };
  }
  return {
    kind: "ok",
    snapshot: { review: parsed.data.review, proposal: parsed.data.proposal },
  };
};

export type DecideWeeklyReviewResult =
  | { readonly kind: "decided"; readonly proposal: CalorieAdjustmentProposal }
  /** 409: already decided elsewhere or the calibration changed. Refetch. */
  | { readonly kind: "stale" }
  | { readonly kind: "offline" }
  | { readonly kind: "error" };

const isOffline = (error: ApiError): boolean =>
  error.kind === "network_error" ||
  (error.kind === "context_changed" && error.cause?.kind === "network_error");

export const decideWeeklyReview = async (
  client: ApiClient,
  proposalId: string,
  decision: CalorieAdjustmentDecision["decision"],
  options: WeeklyReviewRequestOptions = {},
): Promise<DecideWeeklyReviewResult> => {
  const result = await client.request({
    method: "POST",
    path: `/v1/energy/weekly-review/${encodeURIComponent(proposalId)}/decision`,
    body: { decision },
    schema: calorieAdjustmentDecisionResponseSchema,
    ...(options.expectedUserId
      ? { expectedUserId: options.expectedUserId }
      : {}),
    ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
  });
  if (result.ok) {
    const parsed = calorieAdjustmentDecisionResponseSchema.safeParse(
      result.value,
    );
    return parsed.success
      ? { kind: "decided", proposal: parsed.data.proposal }
      : { kind: "error" };
  }
  if (result.error.kind === "http_error" && result.error.status === 409) {
    return { kind: "stale" };
  }
  return isOffline(result.error) ? { kind: "offline" } : { kind: "error" };
};

export const isPendingProposal = (
  proposal: CalorieAdjustmentProposal | null | undefined,
): proposal is CalorieAdjustmentProposal => proposal?.status === "pending";

/** Live daily target (includes any calibration since the review). Best effort. */
export const fetchLiveTargetKcal = async (
  client: ApiClient,
  utcOffsetMinutes: number,
  options: WeeklyReviewRequestOptions = {},
): Promise<number | null> => {
  try {
    const result = await client.request({
      method: "GET",
      path: `/v1/energy/summary?utcOffsetMinutes=${encodeURIComponent(utcOffsetMinutes)}`,
      schema: energySummaryResponseSchema,
      ...(options.expectedUserId
        ? { expectedUserId: options.expectedUserId }
        : {}),
      ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
    });
    if (!result.ok) return null;
    const parsed = energySummaryResponseSchema.safeParse(result.value);
    const target = parsed.success ? parsed.data.summary.dailyTargetKcal : null;
    return typeof target === "number" && target > 0 ? target : null;
  } catch {
    return null;
  }
};
