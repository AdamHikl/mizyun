import {
  RecurringMealRepositoryError,
  type RecurringMealRepository,
  type RecurringMealCreate,
  type RecurringMealPatch,
  type StoredRecurringMeal,
  type UserId,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface ScheduleRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  name: string;
  local_time: string;
  time_zone: string;
  weekdays: number[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
const fromRow = (row: ScheduleRow): StoredRecurringMeal => ({
  id: row.id,
  userId: row.user_id as UserId,
  name: row.name,
  localTime: row.local_time,
  timeZone: row.time_zone,
  weekdays: [...row.weekdays],
  enabled: row.enabled,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});
const throwError = (error: { code?: string; message: string }): never => {
  if (error.code === "P0002" || error.code === "42501")
    throw new RecurringMealRepositoryError("not_found");
  if (error.code === "23505")
    throw new RecurringMealRepositoryError("conflict");
  if (
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "22007" ||
    error.code === "22008"
  )
    throw new RecurringMealRepositoryError("invalid");
  // Do not surface meal/template data from a database error.
  throw new RepositoryError("Recurring meal persistence unavailable");
};
export class SupabaseRecurringMealRepository implements RecurringMealRepository {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}
  async list(
    userId: UserId,
    options: { accessToken: string },
  ): Promise<readonly StoredRecurringMeal[]> {
    const { data, error } = await this.clientFor(options.accessToken)
      .from<ScheduleRow>("recurring_meal_schedules")
      .select("*")
      .eq("user_id", userId)
      .is("stopped_at", null)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throwError(error);
    return data.map(fromRow);
  }
  async create(
    userId: UserId,
    input: RecurringMealCreate,
    options: { accessToken: string },
  ): Promise<StoredRecurringMeal> {
    const rows = await this.call<ScheduleRow>(
      options.accessToken,
      "recurring_meal_create",
      {
        p_id: input.id,
        p_source: input.sourceEntryId,
        p_time: input.localTime,
        p_zone: input.timeZone,
        p_days: [...input.weekdays],
      },
    );
    const row = rows[0];
    if (!row || row.user_id !== userId)
      throw new RecurringMealRepositoryError("not_found");
    return fromRow(row);
  }
  async update(
    userId: UserId,
    id: string,
    patch: RecurringMealPatch,
    options: { accessToken: string },
  ): Promise<StoredRecurringMeal | null> {
    const rows = await this.call<ScheduleRow>(
      options.accessToken,
      "recurring_meal_update",
      { p_id: id, p_patch: patch },
    );
    const row = rows[0];
    return row && row.user_id === userId ? fromRow(row) : null;
  }
  async stop(
    userId: UserId,
    id: string,
    options: { accessToken: string },
  ): Promise<boolean> {
    void userId;
    const rows = await this.call<{ ok: boolean }>(
      options.accessToken,
      "recurring_meal_stop",
      { p_id: id },
    );
    return rows[0]?.ok === true;
  }
  async skip(
    userId: UserId,
    id: string,
    localDate: string,
    options: { accessToken: string },
  ): Promise<boolean> {
    void userId;
    const rows = await this.call<{ ok: boolean }>(
      options.accessToken,
      "recurring_meal_skip",
      { p_id: id, p_date: localDate },
    );
    return rows[0]?.ok === true;
  }
  private async call<T extends Record<string, unknown>>(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<readonly T[]> {
    const { data, error } = await this.clientFor(token).rpc<T>(name, args);
    if (error) throwError(error);
    return data;
  }
}
