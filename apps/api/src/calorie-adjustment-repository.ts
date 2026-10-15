import {
  assertProposalReview,
  CalorieAdjustmentRepositoryError,
  type CalorieAdjustmentDecisionKind,
  type CalorieAdjustmentRepository,
  type GoalRepository,
  type NewCalorieAdjustmentProposal,
  type StoredCalorieAdjustmentProposal,
  type UserId,
} from "@mizyun/core";

type Access = { readonly accessToken: string };

const COOLDOWN_MS = 14 * 86_400_000;

const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** ISO Monday of the UTC date `offsetDays` after `instant`. */
const mondayOf = (instant: Date, offsetDays: number): string => {
  const day = new Date(instant.getTime() + offsetDays * 86_400_000);
  const weekday = (day.getUTCDay() + 6) % 7;
  return addDays(day.toISOString().slice(0, 10), -weekday);
};

/**
 * In-memory `CalorieAdjustmentRepository` for tests and local runs without
 * Supabase. Mirrors `public.decide_calorie_adjustment`: owner-scoped
 * lookups, one proposal per goal and week, pending-only decisions and an
 * optimistic calibration check that supersedes stale proposals. Decisions
 * are serialized per instance so concurrent requests cannot both apply.
 * RLS isolation itself is proven by the SQL tests, not here.
 */
export class InMemoryCalorieAdjustmentRepository implements CalorieAdjustmentRepository {
  readonly #rows = new Map<string, StoredCalorieAdjustmentProposal>();
  readonly #goals: GoalRepository;
  readonly #now: () => Date;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(goals: GoalRepository, now: () => Date = () => new Date()) {
    this.#goals = goals;
    this.#now = now;
  }

  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async getForWeek(
    userId: UserId,
    goalId: string,
    weekStart: string,
    _options: Access,
  ): Promise<StoredCalorieAdjustmentProposal | null> {
    for (const row of this.#rows.values()) {
      if (
        row.userId === userId &&
        row.goalId === goalId &&
        row.weekStart === weekStart &&
        row.status !== "superseded"
      ) {
        return row;
      }
    }
    return null;
  }

  async getLastAcceptedAt(
    userId: UserId,
    goalId: string,
    _options: Access,
  ): Promise<Date | null> {
    let latest: Date | null = null;
    for (const row of this.#rows.values()) {
      if (
        row.userId === userId &&
        row.goalId === goalId &&
        row.status === "accepted" &&
        row.decidedAt !== null &&
        (latest === null || row.decidedAt > latest)
      ) {
        latest = row.decidedAt;
      }
    }
    return latest;
  }

  create(
    proposal: NewCalorieAdjustmentProposal,
    options: Access,
  ): Promise<StoredCalorieAdjustmentProposal> {
    return this.#serialize(async () => {
      assertProposalReview(proposal.review);
      const existing = await this.getForWeek(
        proposal.userId,
        proposal.goalId,
        proposal.weekStart,
        options,
      );
      if (existing !== null) return existing;
      const goal = await this.#goals.getActive(proposal.userId, options);
      if (goal === null || goal.id !== proposal.goalId) {
        throw new CalorieAdjustmentRepositoryError("invalid");
      }
      const stored: StoredCalorieAdjustmentProposal = {
        ...proposal,
        status: "pending",
        createdAt: this.#now(),
        decidedAt: null,
      };
      this.#rows.set(stored.id, stored);
      return stored;
    });
  }

  decide(
    userId: UserId,
    proposalId: string,
    decision: CalorieAdjustmentDecisionKind,
    options: Access,
  ): Promise<StoredCalorieAdjustmentProposal> {
    return this.#serialize(async () => {
      const row = this.#rows.get(proposalId);
      if (row === undefined || row.userId !== userId) {
        throw new CalorieAdjustmentRepositoryError("not_found");
      }
      if (row.status !== "pending") {
        throw new CalorieAdjustmentRepositoryError("already_decided");
      }
      const decidedAt = this.#now();
      const settle = (
        status: StoredCalorieAdjustmentProposal["status"],
      ): StoredCalorieAdjustmentProposal => {
        const next = { ...row, status, decidedAt };
        this.#rows.set(row.id, next);
        return next;
      };
      if (decision === "decline") return settle("declined");
      const goal = (await this.#goals.getHistory(userId, options)).find(
        (candidate) => candidate.id === row.goalId,
      );
      // Mirrors the SQL cadence guards: current/previous ISO week (one day
      // of timezone slack) and no other acceptance within 14 days.
      const currentMonday = mondayOf(decidedAt, 0);
      const lastAccepted = [...this.#rows.values()].some(
        (other) =>
          other.id !== row.id &&
          other.goalId === row.goalId &&
          other.status === "accepted" &&
          other.decidedAt !== null &&
          decidedAt.getTime() - other.decidedAt.getTime() < COOLDOWN_MS,
      );
      if (
        goal === undefined ||
        goal.status !== "active" ||
        (goal.calorieCalibrationKcal ?? 0) !==
          row.review.calibrationBeforeKcal ||
        goal.pace !== row.goalPace ||
        row.weekStart < addDays(currentMonday, -7) ||
        row.weekStart > mondayOf(decidedAt, 1) ||
        lastAccepted
      ) {
        return settle("superseded");
      }
      await this.#goals.update(
        userId,
        {
          ...goal,
          calorieCalibrationKcal: row.review.calibrationAfterKcal,
          updatedAt: decidedAt,
        },
        options,
      );
      return settle("accepted");
    });
  }
}
