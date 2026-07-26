import type {
  CoachingPreferences,
  PlanTier,
  ProfileRepository,
  StoredProfile,
  UnitSystem,
  UserId,
} from "@mizyun/core";
import type { Clock } from "@mizyun/core";

interface InMemoryProfileRepositoryOptions {
  readonly defaultTimezone: string;
  readonly defaultUnitSystem: UnitSystem;
  readonly defaultPlanTier?: PlanTier;
  readonly clock?: Clock;
}

/**
 * In-memory implementation of the `ProfileRepository` port.
 *
 * Used by `apps/api` until the Supabase adapter lands in a follow-up
 * segment. Behaviour matches the contract defined in `@mizyun/core`:
 *   - `getOrCreate` is idempotent — first call inserts with the
 *     default profile values; subsequent calls return the stored row.
 *   - `update` writes the exact shape the caller provides (the
 *     domain `applyProfilePatch` is responsible for advancing
 *     `updatedAt`).
 *
 * The repository deliberately does not enforce cross-user isolation:
 * the SQL RLS policies on `public.profiles` are the source of truth.
 * Tests that exercise isolation should use the e2e suite against a
 * real Supabase stack, not this in-memory implementation.
 */
export class InMemoryProfileRepository implements ProfileRepository {
  readonly #byUser = new Map<UserId, StoredProfile>();
  readonly #defaultTimezone: string;
  readonly #defaultUnitSystem: UnitSystem;
  readonly #defaultPlanTier: PlanTier;
  readonly #clock: Clock;

  constructor(options: InMemoryProfileRepositoryOptions) {
    this.#defaultTimezone = options.defaultTimezone;
    this.#defaultUnitSystem = options.defaultUnitSystem;
    this.#defaultPlanTier = options.defaultPlanTier ?? "free";
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async getOrCreate(
    userId: UserId,
    options: { readonly now: Date; readonly accessToken: string },
  ): Promise<StoredProfile> {
    void options.accessToken;
    const existing = this.#byUser.get(userId);
    if (existing) return existing;
    const now = options.now;
    const profile: StoredProfile = {
      userId,
      displayName: null,
      unitSystem: this.#defaultUnitSystem,
      timezone: this.#defaultTimezone,
      birthYear: null,
      heightCm: null,
      activityLevel: null,
      sexAtBirth: null,
      coachingPreferences: {
        experienceLevel: null,
        trainingDaysPerWeek: null,
        sessionDurationMinutes: null,
        trainingFocus: null,
        availableEquipment: [],
        dietaryPreferences: [],
        trainingLimitations: [],
      } satisfies CoachingPreferences,
      planTier: this.#defaultPlanTier,
      createdAt: now,
      updatedAt: now,
    };
    this.#byUser.set(userId, profile);
    return profile;
  }

  async update(
    userId: UserId,
    next: StoredProfile,
    options: { readonly accessToken: string },
  ): Promise<StoredProfile> {
    void options.accessToken;
    if (next.userId !== userId) {
      // Defensive: the route layer should already match the URL
      // principal to the storage key. If a future bug ever produces
      // a mismatch, fail closed.
      throw new Error("profile update userId mismatch");
    }
    const stored = this.#byUser.get(userId) ?? null;
    if (stored === null) {
      throw new Error(`update called for missing user ${userId}`);
    }
    this.#byUser.set(userId, next);
    return next;
  }

  /**
   * Test-only helper that pre-seeds a profile for a user without
   * driving the create path. Production code must always call
   * `getOrCreate`.
   */
  __seedForTest(profile: StoredProfile): void {
    this.#byUser.set(profile.userId, profile);
  }

  /**
   * Test-only helper that drops a profile by user id. Used by the
   * DATA-001 account deletion path. Production uses the SQL FK
   * cascade (`auth.users` delete) instead.
   */
  async deleteForTest(userId: UserId): Promise<void> {
    this.#byUser.delete(userId);
  }

  /** Test-only helper: current clock snapshot. */
  __now(): Date {
    return this.#clock.now();
  }
}
