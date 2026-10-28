import type {
  AiProvider,
  CoachingPreferences,
  PlanTier,
  ProfileActivityLevel,
  ProfilePatchField,
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

const COLUMN_BY_FIELD: Record<ProfilePatchField, keyof ProfileRow> = {
  displayName: "display_name",
  unitSystem: "unit_system",
  timezone: "timezone",
  birthYear: "birth_year",
  heightCm: "height_cm",
  activityLevel: "activity_level",
  sexAtBirth: "sex_at_birth",
  coachingPreferences: "coaching_preferences",
  aiProvider: "ai_provider",
};

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
    options: {
      readonly accessToken: string;
      readonly fields?: ReadonlyArray<ProfilePatchField>;
    },
  ): Promise<StoredProfile> {
    const client = this.#clientFor(options.accessToken);
    const columns: Record<ProfilePatchField, unknown> = {
      displayName: next.displayName,
      unitSystem: next.unitSystem,
      timezone: next.timezone,
      birthYear: next.birthYear,
      heightCm: next.heightCm,
      activityLevel: next.activityLevel,
      sexAtBirth: next.sexAtBirth,
      coachingPreferences: next.coachingPreferences,
      aiProvider: next.aiProvider,
    };
    const fields =
      options.fields ?? (Object.keys(columns) as ProfilePatchField[]);
    if (fields.length === 0) {
      throw new RepositoryError("profile update named no fields");
    }
    const row: Record<string, unknown> = {};
    for (const field of fields) row[COLUMN_BY_FIELD[field]] = columns[field];
    const updated = await client
      .from<ProfileRow>("profiles")
      .update(row as Partial<ProfileRow>)
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
