/**
 * Weekly calorie-adjustment proposals (ENG-08): repository port.
 *
 * A proposal freezes one week's deterministic `CalorieReview` with status
 * "adjust". It changes nothing until the owner accepts it; acceptance moves
 * the active goal's `calorieCalibrationKcal` from `calibrationBeforeKcal` to
 * `calibrationAfterKcal` atomically, or supersedes the proposal when the
 * goal changed since the review (optimistic concurrency).
 */

import type { CalorieReview } from "./calorie-review";
import type { GoalPace } from "./goal";
import type { UserId } from "./index";

export type CalorieAdjustmentStatus =
  "pending" | "accepted" | "declined" | "superseded";

export type CalorieAdjustmentDecisionKind = "accept" | "decline";

export interface StoredCalorieAdjustmentProposal {
  readonly id: string;
  readonly userId: UserId;
  readonly goalId: string;
  /** ISO week start (Monday) in the user's local calendar. */
  readonly weekStart: string;
  /** Goal pace the review was computed for; a pace edit supersedes it. */
  readonly goalPace: GoalPace;
  readonly status: CalorieAdjustmentStatus;
  readonly review: CalorieReview;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
}

export interface NewCalorieAdjustmentProposal {
  readonly id: string;
  readonly userId: UserId;
  readonly goalId: string;
  readonly weekStart: string;
  readonly goalPace: GoalPace;
  /** Must be an "adjust" review with a non-zero delta. */
  readonly review: CalorieReview;
}

export type CalorieAdjustmentRepositoryErrorKind =
  "not_found" | "already_decided" | "invalid" | "unavailable";

export class CalorieAdjustmentRepositoryError extends Error {
  constructor(readonly kind: CalorieAdjustmentRepositoryErrorKind) {
    super(`Calorie adjustment ${kind}`);
    this.name = "CalorieAdjustmentRepositoryError";
  }
}

type Access = { readonly accessToken: string };

export interface CalorieAdjustmentRepository {
  /**
   * This week's live proposal for the goal (pending, accepted or
   * declined), or null. Superseded proposals do not occupy the week.
   */
  getForWeek(
    userId: UserId,
    goalId: string,
    weekStart: string,
    options: Access,
  ): Promise<StoredCalorieAdjustmentProposal | null>;
  /** When the goal's most recent accepted proposal was decided, or null. */
  getLastAcceptedAt(
    userId: UserId,
    goalId: string,
    options: Access,
  ): Promise<Date | null>;
  /**
   * Store a pending proposal. Idempotent under `(goalId, weekStart)`: when
   * a concurrent request already created this week's proposal, return the
   * existing row instead.
   */
  create(
    proposal: NewCalorieAdjustmentProposal,
    options: Access,
  ): Promise<StoredCalorieAdjustmentProposal>;
  /**
   * Decide a pending proposal owned by `userId`. Returns the decided row:
   * "accepted", "declined", or "superseded" when an accept found the goal
   * inactive, its calibration or pace changed, the week outside the
   * current/previous ISO week, or another acceptance within 14 days. Throws
   * `CalorieAdjustmentRepositoryError` with `not_found` (missing or foreign)
   * or `already_decided` (not pending).
   */
  decide(
    userId: UserId,
    proposalId: string,
    decision: CalorieAdjustmentDecisionKind,
    options: Access,
  ): Promise<StoredCalorieAdjustmentProposal>;
}

/** Validate the frozen review before it becomes a proposal row. */
export const assertProposalReview = (review: CalorieReview): void => {
  if (
    review.status !== "adjust" ||
    review.deltaKcal === 0 ||
    review.proposedTargetKcal === null ||
    review.calibrationAfterKcal !==
      review.calibrationBeforeKcal + review.deltaKcal
  ) {
    throw new CalorieAdjustmentRepositoryError("invalid");
  }
};
