import type {
  FoodSource,
  FoodEntryRepository,
  StoredFoodEntry,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

/**
 * SQL row shape. `confidence`, `calories_low_kcal`,
 * `calories_high_kcal` are nullable; v1 manual entries leave
 * them null. `details` is jsonb — typed as `Record<string, unknown>`.
 */
interface FoodEntryRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly consumed_at: string;
  readonly name: string;
  readonly calories_kcal: number | null;
  readonly calories_low_kcal: number | null;
  readonly calories_high_kcal: number | null;
  readonly protein_g: number | null;
  readonly carbohydrate_g: number | null;
  readonly fat_g: number | null;
  readonly source: FoodSource;
  readonly confidence: number | null;
  readonly confirmed_by_user: boolean;
  readonly details: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
}

const fromRow = (row: FoodEntryRow): StoredFoodEntry => ({
  id: row.id,
  userId: row.user_id as UserId,
  consumedAt: new Date(row.consumed_at),
  name: row.name,
  caloriesKcal: row.calories_kcal,
  proteinG: row.protein_g,
  carbohydrateG: row.carbohydrate_g,
  fatG: row.fat_g,
  details: { ...row.details },
  source: row.source,
  confidence: row.confidence,
  confirmedByUser: row.confirmed_by_user,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const toInsertRow = (
  userId: UserId,
  entry: StoredFoodEntry,
): Partial<FoodEntryRow> => ({
  id: entry.id,
  user_id: userId,
  consumed_at: entry.consumedAt.toISOString(),
  name: entry.name,
  calories_kcal: entry.caloriesKcal,
  protein_g: entry.proteinG,
  carbohydrate_g: entry.carbohydrateG,
  fat_g: entry.fatG,
  source: entry.source,
  confidence: entry.confidence,
  confirmed_by_user: entry.confirmedByUser,
  details: { ...entry.details },
});

export interface SupabaseFoodEntryRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseFoodEntryRepository implements FoodEntryRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseFoodEntryRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async create(
    userId: UserId,
    entry: StoredFoodEntry,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<FoodEntryRow>("food_entries")
      .insert(toInsertRow(userId, entry))
      .select("*")
      .single();
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "food entry insert returned no row",
      );
    }
    return fromRow(data);
  }

  async list(
    userId: UserId,
    options: {
      readonly from: Date | null;
      readonly to: Date | null;
      readonly limit: number;
      readonly accessToken: string;
    },
  ): Promise<ReadonlyArray<StoredFoodEntry>> {
    const client = this.#clientFor(options.accessToken);
    let builder = client
      .from<FoodEntryRow>("food_entries")
      .select("*")
      .eq("user_id", userId)
      .order("consumed_at", { ascending: false })
      .limit(options.limit);
    if (options.from !== null) {
      builder = builder.gte("consumed_at", options.from.toISOString());
    }
    if (options.to !== null) {
      builder = builder.lte("consumed_at", options.to.toISOString());
    }
    const { data, error } = await builder;
    if (error) {
      throw new RepositoryError(error.message);
    }
    return (data ?? []).map(fromRow);
  }

  async getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<FoodEntryRow>("food_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(error.message);
    }
    return data === null ? null : fromRow(data);
  }

  async update(
    entry: StoredFoodEntry,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<FoodEntryRow>("food_entries")
      .update(toInsertRow(entry.userId, entry))
      .eq("id", entry.id)
      .select("*")
      .single();
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "food entry update returned no row",
      );
    }
    return fromRow(data);
  }

  async delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<FoodEntryRow>("food_entries")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      throw new RepositoryError(error.message);
    }
    return Array.isArray(data) && data.length > 0;
  }
}