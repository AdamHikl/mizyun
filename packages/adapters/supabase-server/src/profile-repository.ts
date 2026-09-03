import type {
  AiProvider,
  CoachingPreferences,
  PlanTier,
  ProfileActivityLevel,
  ProfileRepository,
  ProfileSexAtBirth,
  StoredProfile,
  UnitSystem,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

/**
 * SQL row shape as Supabase returns it. Snake_case columns are
 * the SQL convention; the adapter converts to camelCase
 * `StoredProfile` in `fromRow`.
 *
 * The row is typed with `Record<string, unknown>` index so the
 * adapter-supplied chainable builder accepts the row as the
 * generic parameter without requiring a TypeScript index
 * signature. The `fromRow` cast localizes the trust boundary.
 */
interface ProfileRow extends Record<string, unknown> {
  readonly id: string;
  readonly display_name: string | null;
  readonly unit_system: UnitSystem;
  readonly timezone: string;
  readonly birth_year: number | null;
  readonly height_cm: number | null;
  readonly activity_level: ProfileActivityLevel | null;
  readonly sex_at_birth: ProfileSexAtBirth | null;
  readonly coaching_preferences: CoachingPreferences | null;
  readonly plan_tier: PlanTier | null;
  readonly ai_provider: AiProvider | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const fromRow = (row: ProfileRow): StoredProfile => ({
  userId: row.id as UserId,
  displayName: row.display_name,
  unitSystem: row.unit_system,
  timezone: row.timezone,
  birthYear: row.birth_year,
  heightCm: row.height_cm,
  activityLevel: row.activity_level,
  sexAtBirth: row.sex_at_birth,
  coachingPreferences: row.coaching_preferences ?? {
    experienceLevel: null,
    trainingDaysPerWeek: null,
    sessionDurationMinutes: null,
    trainingFocus: null,
    availableEquipment: [],
    dietaryPreferences: [],
    trainingLimitations: [],
  },
  planTier: (row.plan_tier ?? "free") as PlanTier,
  aiProvider: (row.ai_provider ?? "gemini") as AiProvider,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export interface SupabaseProfileRepositoryOptions {
  /**
   * Factory that produces a Supabase client bound to the verified
   * user's access token. Each call returns a fresh client; the
   * adapter never holds on to a client across requests.
   */
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseProfileRepository implements ProfileRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseProfileRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async getOrCreate(
    userId: UserId,
    options: { readonly now: Date; readonly accessToken: string },
  ): Promise<StoredProfile> {
    const client = this.#clientFor(options.accessToken);
    // RLS scopes `select` and `insert` to auth.uid(); the explicit
    // `eq('id', userId)` is a belt-and-suspenders anchor.
    const existing = await client
      .from<ProfileRow>("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (existing.error) {
      throw new RepositoryError(existing.error.message);
    }
    if (existing.data !== null) {
      return fromRow(existing.data);
    }
    // Profile doesn't exist yet. Insert with the SQL defaults
    // (unit_system='metric', timezone='UTC'); the row's id is the
    // auth.users id, so the FK satisfies automatically.
    const inserted = await client
      .from<ProfileRow>("profiles")
      .insert({ id: userId })
      .select("*")
      .single();
    if (inserted.error || inserted.data === null) {
      throw new RepositoryError(
        inserted.error?.message ?? "profile insert returned no row",
      );
    }
    return fromRow(inserted.data);
  }

  async update(
    userId: UserId,
    next: StoredProfile,
    options: { readonly accessToken: string },
  ): Promise<StoredProfile> {
    const client = this.#clientFor(options.accessToken);
    const updated = await client
      .from<ProfileRow>("profiles")
      .update({
        display_name: next.displayName,
        unit_system: next.unitSystem,
        timezone: next.timezone,
        birth_year: next.birthYear,
        height_cm: next.heightCm,
        activity_level: next.activityLevel,
        sex_at_birth: next.sexAtBirth,
        coaching_preferences: next.coachingPreferences,
        ai_provider: next.aiProvider,
      })
      .eq("id", userId)
      .select("*")
      .single();
    if (updated.error || updated.data === null) {
      throw new RepositoryError(
        updated.error?.message ?? "profile update returned no row",
      );
    }
    return fromRow(updated.data);
  }
}
