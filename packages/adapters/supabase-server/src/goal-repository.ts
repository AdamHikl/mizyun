import type {
  GoalKind,
  GoalPace,
  GoalRepository,
  GoalStatus,
  GoalTarget,
  StoredGoal,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

/**
 * SQL row shape. `pace` and `review_date` are nullable (added in
 * PERSIST-001 migration 20260718100000); existing rows have NULL
 * and the wire serializer treats null as "ask me later".
 */
interface GoalRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly kind: GoalKind;
  readonly status: GoalStatus;
  /**
   * `pace` is nullable in the schema (forward-only migration)
   * but the domain layer treats it as required. The adapter
   * throws on a NULL row — pre-migration legacy rows are a
   * known gap (PERSIST-001 follow-up) and surface as 500s.
   */
  readonly pace: GoalPace | null;
  readonly target: GoalTarget;
  readonly starts_on: string | null;
  readonly target_date: string | null;
  readonly review_date: string | null;
  /**
   * Accepted weekly calorie-review calibration (ENG-08, migration
   * 20261015090000). Read-only here: only the
   * `decide_calorie_adjustment` function writes it, so `toInsertRow`
   * never includes it.
   */
  readonly calorie_calibration_kcal?: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * GoalTarget lives in the SQL `target` jsonb column as
 * `{ weightKg: number, bodyFatPercent?: number }`. We trust
 * the SQL column to hold a valid shape (the route inserts via
 * `validateGoalCreate`); for defensive reads we fall back to
 * a permissive weight-only shape.
 */
const parseTarget = (raw: unknown): GoalTarget => {
  if (raw !== null && typeof raw === "object" && "weightKg" in raw) {
    return raw as GoalTarget;
  }
  return { weightKg: 0 };
};

export const goalFromRow = (row: GoalRow): StoredGoal => {
  if (row.pace === null) {
    throw new RepositoryError(
      `goal ${row.id} has null pace; pre-migration row needs backfill`,
    );
  }
  return {
    id: row.id,
    userId: row.user_id as UserId,
    kind: row.kind,
    status: row.status,
    pace: row.pace,
    target: parseTarget(row.target),
    startsOn: row.starts_on ?? "",
    targetDate: row.target_date,
    ...(row.review_date !== null ? { reviewDate: row.review_date } : {}),
    calorieCalibrationKcal: row.calorie_calibration_kcal ?? 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
};

const fromRow = goalFromRow;

const toInsertRow = (userId: UserId, goal: StoredGoal): Partial<GoalRow> => ({
  id: goal.id,
  user_id: userId,
  kind: goal.kind,
  status: goal.status,
  pace: goal.pace,
  target: goal.target,
  starts_on: goal.startsOn,
  target_date: goal.targetDate,
  // Always written: a cleared review date has no `reviewDate`, and
  // omitting the column on update would keep the old value (#315).
  review_date: goal.reviewDate ?? null,
});

export interface SupabaseGoalRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseGoalRepository implements GoalRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseGoalRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async getActive(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredGoal | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<GoalRow>("goals")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(error.message);
    }
    return data === null ? null : fromRow(data);
  }

  async getHistory(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<ReadonlyArray<StoredGoal>> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<GoalRow>("goals")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) {
      throw new RepositoryError(error.message);
    }
    return (data ?? []).map(fromRow);
  }

  async create(
    userId: UserId,
    goal: StoredGoal,
    options: { readonly accessToken: string },
  ): Promise<StoredGoal> {
    const client = this.#clientFor(options.accessToken);
    try {
      const { data, error } = await client
        .from<GoalRow>("goals")
        .insert(toInsertRow(userId, goal))
        .select("*")
        .single();
      if (error || data === null) {
        throw new RepositoryError(
          error?.message ?? "goal insert returned no row",
        );
      }
      return fromRow(data);
    } catch (cause) {
      // Supabase returns a `23505 unique_violation` with
      // `goals_one_active_per_user` when an active goal already
      // exists. The in-memory repo throws a typed error; we
      // surface the same shape so the route's existing 409
      // mapping still fires.
      const message = cause instanceof Error ? cause.message : "unknown";
      if (
        message.includes("goals_one_active_per_user") ||
        message.includes("duplicate key value")
      ) {
        throw new RepositoryError("user already has an active goal");
      }
      throw cause;
    }
  }

  async update(
    userId: UserId,
    goal: StoredGoal,
    options: { readonly accessToken: string },
  ): Promise<StoredGoal> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<GoalRow>("goals")
      .update(toInsertRow(userId, goal))
      .eq("id", goal.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "goal update returned no row",
      );
    }
    return fromRow(data);
  }
}
