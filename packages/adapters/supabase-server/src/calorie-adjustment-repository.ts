import {
  assertProposalReview,
  CalorieAdjustmentRepositoryError,
  type CalorieAdjustmentDecisionKind,
  type CalorieAdjustmentRepository,
  type CalorieAdjustmentStatus,
  type CalorieReview,
  type GoalPace,
  type NewCalorieAdjustmentProposal,
  type StoredCalorieAdjustmentProposal,
  type UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

/** `public.calorie_adjustment_proposals` (migration 20261015090000). */
export interface CalorieAdjustmentProposalRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly goal_id: string;
  readonly week_start: string;
  readonly goal_pace: GoalPace;
  readonly status: CalorieAdjustmentStatus;
  readonly review: Record<string, unknown>;
  readonly current_target_kcal: number | null;
  readonly proposed_target_kcal: number;
  readonly delta_kcal: number;
  readonly calibration_before_kcal: number;
  readonly calibration_after_kcal: number;
  readonly created_at: string;
  readonly decided_at: string | null;
}

type Access = { readonly accessToken: string };

/** The frozen review is stored as its JSON wire form. */
const reviewToJson = (review: CalorieReview): Record<string, unknown> => ({
  ...review,
  reasons: [...review.reasons],
  goalMode: { ...review.goalMode },
  computedAt: review.computedAt.toISOString(),
});

const reviewFromJson = (raw: Record<string, unknown>): CalorieReview =>
  ({
    ...raw,
    computedAt: new Date(String(raw.computedAt)),
  }) as unknown as CalorieReview;

export const calorieAdjustmentFromRow = (
  row: CalorieAdjustmentProposalRow,
): StoredCalorieAdjustmentProposal => ({
  id: row.id,
  userId: row.user_id as UserId,
  goalId: row.goal_id,
  weekStart: row.week_start,
  goalPace: row.goal_pace,
  status: row.status,
  review: reviewFromJson(row.review),
  createdAt: new Date(row.created_at),
  decidedAt: row.decided_at === null ? null : new Date(row.decided_at),
});

const isUniqueViolation = (
  error: { readonly code?: string; readonly message: string } | null,
): boolean =>
  error !== null &&
  (error.code === "23505" || error.message.includes("duplicate key value"));

export interface SupabaseCalorieAdjustmentRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

/**
 * Proposals are read and inserted under the caller's RLS session; decisions
 * go through the owner-scoped SECURITY DEFINER `decide_calorie_adjustment`
 * function, which owns the goal calibration write.
 */
export class SupabaseCalorieAdjustmentRepository implements CalorieAdjustmentRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseCalorieAdjustmentRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async getForWeek(
    userId: UserId,
    goalId: string,
    weekStart: string,
    options: Access,
  ): Promise<StoredCalorieAdjustmentProposal | null> {
    const { data, error } = await this.#clientFor(options.accessToken)
      .from<CalorieAdjustmentProposalRow>("calorie_adjustment_proposals")
      .select("*")
      .eq("user_id", userId)
      .eq("goal_id", goalId)
      .eq("week_start", weekStart)
      .neq("status", "superseded")
      .maybeSingle();
    if (error) throw new RepositoryError(error.message);
    return data === null ? null : calorieAdjustmentFromRow(data);
  }

  async getLastAcceptedAt(
    userId: UserId,
    goalId: string,
    options: Access,
  ): Promise<Date | null> {
    const { data, error } = await this.#clientFor(options.accessToken)
      .from<CalorieAdjustmentProposalRow>("calorie_adjustment_proposals")
      .select("decided_at")
      .eq("user_id", userId)
      .eq("goal_id", goalId)
      .eq("status", "accepted")
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new RepositoryError(error.message);
    return data === null || data.decided_at === null
      ? null
      : new Date(data.decided_at);
  }

  async create(
    proposal: NewCalorieAdjustmentProposal,
    options: Access,
  ): Promise<StoredCalorieAdjustmentProposal> {
    assertProposalReview(proposal.review);
    const review = proposal.review;
    const { data, error } = await this.#clientFor(options.accessToken)
      .from<CalorieAdjustmentProposalRow>("calorie_adjustment_proposals")
      .insert({
        id: proposal.id,
        user_id: proposal.userId,
        goal_id: proposal.goalId,
        week_start: proposal.weekStart,
        goal_pace: proposal.goalPace,
        status: "pending",
        review: reviewToJson(review),
        current_target_kcal:
          review.currentTargetKcal === null
            ? null
            : Math.round(review.currentTargetKcal),
        proposed_target_kcal: review.proposedTargetKcal as number,
        delta_kcal: review.deltaKcal,
        calibration_before_kcal: review.calibrationBeforeKcal,
        calibration_after_kcal: review.calibrationAfterKcal,
      })
      .select("*")
      .single();
    if (isUniqueViolation(error)) {
      // A concurrent request won the live (goal_id, week_start) race; the
      // partial unique index ignores superseded rows.
      const existing = await this.getForWeek(
        proposal.userId,
        proposal.goalId,
        proposal.weekStart,
        options,
      );
      if (existing !== null) return existing;
    }
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "calorie adjustment insert returned no row",
      );
    }
    return calorieAdjustmentFromRow(data);
  }

  async decide(
    userId: UserId,
    proposalId: string,
    decision: CalorieAdjustmentDecisionKind,
    options: Access,
  ): Promise<StoredCalorieAdjustmentProposal> {
    const { data, error } = await this.#clientFor(
      options.accessToken,
    ).rpc<CalorieAdjustmentProposalRow>("decide_calorie_adjustment", {
      p_proposal_id: proposalId,
      p_decision: decision,
    });
    if (error) {
      if (error.message.includes("calorie_adjustment_not_found")) {
        throw new CalorieAdjustmentRepositoryError("not_found");
      }
      if (error.message.includes("calorie_adjustment_already_decided")) {
        throw new CalorieAdjustmentRepositoryError("already_decided");
      }
      if (error.message.includes("calorie_adjustment_invalid")) {
        throw new CalorieAdjustmentRepositoryError("invalid");
      }
      throw new RepositoryError(error.message);
    }
    const row = Array.isArray(data) ? data[0] : (data as unknown);
    if (row === undefined || row === null) {
      throw new RepositoryError("decide_calorie_adjustment returned no row");
    }
    const stored = calorieAdjustmentFromRow(
      row as CalorieAdjustmentProposalRow,
    );
    if (stored.userId !== userId) {
      throw new CalorieAdjustmentRepositoryError("not_found");
    }
    return stored;
  }
}
