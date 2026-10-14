import {
  detectRecurringMealSuggestion,
  recurringMealLocalDateAt,
  validateRecurringMealSchedule,
  RecurringMealSuggestionRepositoryError,
  type RecurringMealSuggestionRepository,
  type RecurringMealSuggestionEntry,
  type RecurringMealSuggestionDecision,
  type RecurringMealSuggestionExistingSchedule,
  type UserId,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";

type Access = { readonly accessToken: string };
type AcceptInput = Parameters<RecurringMealSuggestionRepository["accept"]>[1];
interface FoodRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  name: string;
  consumed_at: string;
  created_at: string;
  updated_at: string;
  confirmed_by_user: boolean;
  calories_kcal: number | null;
  protein_g: number | null;
  carbohydrate_g: number | null;
  fat_g: number | null;
  details: Record<string, unknown>;
}
interface StateRow extends Record<string, unknown> {
  user_id: string;
  family_key: string;
  never: boolean;
  accepted_schedule_id: string | null;
  cooldown_until: string | null;
  first_shown_at: string | null;
  expires_at: string | null;
}
interface ContextRow extends Record<string, unknown> {
  context: {
    userId: string;
    enabled: boolean;
    states: StateRow[];
    generatedEntryIds: string[];
    schedules: RecurringMealSuggestionExistingSchedule[];
  };
}
interface PreferenceRow extends Record<string, unknown> {
  enabled: boolean;
}
interface AcceptRow extends Record<string, unknown> {
  result: {
    schedule: {
      id: string;
      user_id: string;
      name: string;
      local_time: string;
      time_zone: string;
      weekdays: number[];
      enabled: boolean;
      created_at: string;
      updated_at: string;
    };
    created: boolean;
    startLocalDate: string;
  };
}
const normalizeInstant = (value: string): string => {
  // Preserve PostgreSQL microsecond revisions; Date truncates them to milliseconds.
  const normalized = value.replace(/\+00:00$/, "Z");
  if (/\.\d+Z$/.test(normalized)) {
    return normalized.replace(
      /\.(\d+)Z$/,
      (_match, digits: string) =>
        `.${digits.length > 3 ? digits.replace(/0+$/, "").padEnd(3, "0") : digits.padEnd(3, "0")}Z`,
    );
  }
  return normalized.replace(/Z$/, ".000Z");
};
const fromFood = (row: FoodRow): RecurringMealSuggestionEntry => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  consumedAt: normalizeInstant(row.consumed_at),
  createdAt: normalizeInstant(row.created_at),
  updatedAt: normalizeInstant(row.updated_at),
  confirmedByUser: row.confirmed_by_user,
  caloriesKcal: row.calories_kcal,
  proteinG: row.protein_g,
  carbohydrateG: row.carbohydrate_g,
  fatG: row.fat_g,
  details: row.details,
});
const throwError = (error: { code?: string; message: string }): never => {
  if (error.code === "P0002" || error.code === "42501")
    throw new RecurringMealSuggestionRepositoryError("not_found");
  if (error.code === "23505")
    throw new RecurringMealSuggestionRepositoryError("conflict");
  if (["22023", "22P02", "22007", "22008"].includes(error.code ?? ""))
    throw new RecurringMealSuggestionRepositoryError("invalid");
  throw new RecurringMealSuggestionRepositoryError("unavailable");
};
export class SupabaseRecurringMealSuggestionRepository implements RecurringMealSuggestionRepository {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}
  private async call<T extends Record<string, unknown>>(
    options: Access,
    name: string,
    args: Record<string, unknown>,
  ): Promise<readonly T[]> {
    const { data, error } = await this.clientFor(options.accessToken).rpc<T>(
      name,
      args,
    );
    if (error) throwError(error);
    return data;
  }
  async getForUser(
    userId: UserId,
    input: { timeZone: string },
    options: Access,
  ) {
    if (
      !validateRecurringMealSchedule({
        localTime: "12:00",
        timeZone: input.timeZone,
        weekdays: [0],
      })
    )
      throw new RecurringMealSuggestionRepositoryError("invalid");
    const referenceAt = new Date();
    const today = recurringMealLocalDateAt(referenceAt, input.timeZone);
    const firstLocalDate = new Date(
      Date.parse(`${today}T12:00:00Z`) - 6 * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    // Widen the instant interval for all named offsets and DST; filter local dates
    // after the COMPLETE cursor traversal rather than trusting a first page.
    const from = new Date(
      Date.parse(`${firstLocalDate}T00:00:00Z`) - 26 * 3600000,
    ).toISOString();
    const client = this.clientFor(options.accessToken);
    const entries: RecurringMealSuggestionEntry[] = [];
    const seen = new Set<string>();
    let cursor: { at: string; id: string } | null = null;
    let complete = false;
    for (let page = 0; page < 11; page++) {
      let query = client
        .from<FoodRow>("food_entries")
        .select(
          "id,user_id,name,consumed_at,created_at,updated_at,confirmed_by_user,calories_kcal,protein_g,carbohydrate_g,fat_g,details",
        )
        .eq("user_id", userId)
        .gte("consumed_at", from)
        .lte("consumed_at", referenceAt.toISOString())
        .order("consumed_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(500);
      if (cursor)
        query = query.or(
          `consumed_at.lt.${cursor.at},and(consumed_at.eq.${cursor.at},id.lt.${cursor.id})`,
        );
      const { data, error } = await query;
      if (error) throwError(error);
      if (data.some((row) => row.user_id !== userId))
        throw new RecurringMealSuggestionRepositoryError("not_found");
      if (
        new Set(data.map((row) => row.id)).size !== data.length ||
        data.some((row) => seen.has(row.id))
      )
        break;
      for (const row of data) {
        seen.add(row.id);
        entries.push(fromFood(row));
      }
      if (entries.length > 5000) break;
      // PostgREST may cap responses below our requested limit. Only an empty
      // cursor page proves exhaustion; a short page can still have successors.
      if (data.length === 0) {
        complete = true;
        break;
      }
      const last = data.at(-1)!;
      const next = { at: last.consumed_at, id: last.id };
      if (cursor && next.at === cursor.at && next.id === cursor.id) break;
      cursor = next;
    }
    const rows = await this.call<ContextRow>(
      options,
      "recurring_suggestion_context",
      { p_entry_ids: complete ? entries.map((e) => e.id) : [] },
    );
    const context = rows[0]?.context;
    if (!context || context.userId !== userId)
      throw new RecurringMealSuggestionRepositoryError("not_found");
    const now = referenceAt.getTime();
    const decisions: RecurringMealSuggestionDecision[] = context.states.map(
      (s) => {
        if (s.user_id !== userId)
          throw new RecurringMealSuggestionRepositoryError("not_found");
        const agedOut =
          (s.cooldown_until !== null && Date.parse(s.cooldown_until) <= now) ||
          (s.expires_at !== null &&
            Date.parse(s.expires_at) + 30 * 86400000 <= now);
        return {
          familyKey: s.family_key,
          never: s.never,
          accepted: s.accepted_schedule_id !== null,
          cooldownUntil: s.cooldown_until
            ? normalizeInstant(s.cooldown_until)
            : null,
          firstShownAt:
            agedOut || !s.first_shown_at
              ? null
              : normalizeInstant(s.first_shown_at),
          expiresAt:
            agedOut || !s.expires_at ? null : normalizeInstant(s.expires_at),
        };
      },
    );
    const suggestion = detectRecurringMealSuggestion({
      userId,
      entries: entries.filter(
        (e) =>
          recurringMealLocalDateAt(new Date(e.consumedAt), input.timeZone) >=
          firstLocalDate,
      ),
      generatedEntryIds: context.generatedEntryIds,
      historyComplete: complete,
      referenceAt,
      timeZone: input.timeZone,
      enabled: context.enabled,
      decisions,
      existingSchedules: context.schedules,
    });
    return { suggestion, enabled: context.enabled };
  }
  async decide(
    userId: UserId,
    input: Parameters<RecurringMealSuggestionRepository["decide"]>[1],
    options: Access,
  ): Promise<void> {
    void userId;
    await this.call(options, "recurring_suggestion_decide", {
      p_proposal: input.proposal,
      p_decision: input.decision,
    });
  }
  async accept(userId: UserId, input: AcceptInput, options: Access) {
    const rows = await this.call<AcceptRow>(
      options,
      "recurring_suggestion_accept",
      { p_request: input },
    );
    const value = rows[0]?.result;
    if (!value || value.schedule.user_id !== userId)
      throw new RecurringMealSuggestionRepositoryError("not_found");
    const row = value.schedule;
    return {
      recurringMeal: {
        id: row.id,
        userId,
        name: row.name,
        localTime: row.local_time,
        timeZone: row.time_zone,
        weekdays: [...row.weekdays],
        enabled: row.enabled,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      },
      created: value.created,
      startLocalDate: value.startLocalDate,
    };
  }
  async getPreferences(userId: UserId, options: Access) {
    void userId;
    const rows = await this.call<PreferenceRow>(
      options,
      "recurring_suggestion_preferences",
      {},
    );
    if (!rows[0])
      throw new RecurringMealSuggestionRepositoryError("unavailable");
    return { enabled: rows[0].enabled };
  }
  async setPreferences(
    userId: UserId,
    input: { enabled: boolean },
    options: Access,
  ) {
    void userId;
    const rows = await this.call<PreferenceRow>(
      options,
      "recurring_suggestion_preferences",
      { p_enabled: input.enabled },
    );
    if (!rows[0])
      throw new RecurringMealSuggestionRepositoryError("unavailable");
    return { enabled: rows[0].enabled };
  }
  async resetDecisions(userId: UserId, options: Access): Promise<void> {
    void userId;
    await this.call(options, "recurring_suggestion_preferences", {
      p_reset: true,
    });
  }
  async exportForUser(userId: UserId, options: Access) {
    const read = async (table: string, order: string) => {
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await this.clientFor(options.accessToken)
          .from<Record<string, unknown>>(table)
          .select("*")
          .eq("user_id", userId)
          .order(order)
          .range(offset, offset + 499);
        if (error) throwError(error);
        if (data.some((row) => row.user_id !== userId))
          throw new RecurringMealSuggestionRepositoryError("not_found");
        rows.push(...data);
        if (data.length < 500) return rows;
      }
    };
    const [states, preferences, receipts] = await Promise.all([
      read("recurring_meal_suggestion_states", "family_key"),
      read("recurring_meal_suggestion_preferences", "user_id"),
      read("recurring_meal_suggestion_receipts", "operation_id"),
    ]);
    return { states, preferences, receipts };
  }
  async clearForUser(userId: UserId, options: Access): Promise<void> {
    void userId;
    await this.call(options, "recurring_suggestion_clear", {});
  }
}
