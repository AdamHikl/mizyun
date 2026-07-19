import {
  type AccountDeletionError,
  type AccountExport,
  type AccountRepository,
  type BodyMeasurementRepository,
  type ExerciseRepository,
  type FoodEntryRepository,
  type GoalRepository,
  type ProfileRepository,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";

/**
 * In-memory implementation of the `AccountRepository` port.
 *
 * Used by `apps/api` until the Supabase adapter lands. The
 * implementation orchestrates the per-feature in-memory
 * repositories: export pulls a snapshot of every user-owned
 * record; delete drops every record for the user.
 *
 * Deletion order is children-before-parents (workout_sets →
 * workouts → exercises → …) so a future migration that adds a
 * reverse-FK constraint doesn't break the cascade. In SQL this
 * is the `ON DELETE CASCADE` FKs we already declared in the
 * foundation migration.
 *
 * The challenge token is stored in a Map keyed by userId with a
 * TTL; expired tokens are lazily cleaned up at lookup time so
 * the implementation doesn't need a background sweeper.
 */

interface ChallengeRecord {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface InMemoryAccountRepositoryOptions {
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly exerciseRepository: ExerciseRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  /**
   * Clock; defaults to `() => new Date()`. Production callers
   * should not need this; tests inject a fixed clock so they
   * can advance time without sleeping.
   */
  readonly clock?: { readonly now: () => Date };
}

export class InMemoryAccountRepository implements AccountRepository {
  readonly #profileRepository: ProfileRepository;
  readonly #goalRepository: GoalRepository;
  readonly #foodEntryRepository: FoodEntryRepository;
  readonly #exerciseRepository: ExerciseRepository;
  readonly #workoutRepository: WorkoutRepository;
  readonly #workoutSetRepository: WorkoutSetRepository;
  readonly #bodyMeasurementRepository: BodyMeasurementRepository;
  readonly #clock: { readonly now: () => Date };
  readonly #challenges = new Map<UserId, ChallengeRecord>();

  constructor(options: InMemoryAccountRepositoryOptions) {
    this.#profileRepository = options.profileRepository;
    this.#goalRepository = options.goalRepository;
    this.#foodEntryRepository = options.foodEntryRepository;
    this.#exerciseRepository = options.exerciseRepository;
    this.#workoutRepository = options.workoutRepository;
    this.#workoutSetRepository = options.workoutSetRepository;
    this.#bodyMeasurementRepository = options.bodyMeasurementRepository;
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async exportForUser(userId: UserId): Promise<AccountExport> {
    const profile = await this.#profileRepository.getOrCreate(userId, {
      now: this.#clock.now(),
      // The account-export path doesn't carry an end-user
      // access token; the in-memory adapter ignores it. The
      // Supabase adapter would need the service-role key at
      // this layer (DATA-001+PERSIST-002 follow-up).
      accessToken: "",
    });
    const goals = await this.#goalRepository.getHistory(userId, {
      accessToken: "",
    });
    const foodEntries = await this.#foodEntryRepository.list(userId, {
      from: null,
      to: null,
      limit: 10_000,
      accessToken: "",
    });
    const exercises = await this.#exerciseRepository.list(userId, {
      limit: 10_000,
    });
    const workouts = await this.#workoutRepository.list(userId, {
      from: null,
      to: null,
      limit: 10_000,
    });
    const workoutSets: import("@mizyun/core").StoredWorkoutSet[] = [];
    for (const w of workouts) {
      const sets = await this.#workoutSetRepository.listForWorkout(w.id);
      workoutSets.push(...sets);
    }
    const bodyMeasurements = await this.#bodyMeasurementRepository.list(
      userId,
      {
        from: null,
        to: null,
        limit: 10_000,
      },
    );
    return {
      userId,
      generatedAt: this.#clock.now(),
      profile,
      goals,
      foodEntries,
      exercises,
      workouts,
      workoutSets,
      bodyMeasurements,
      // Reserved for the CONV-* / MEM-* segments. Empty arrays
      // so the envelope is exhaustive.
      conversations: [],
      privateMedia: [],
    };
  }

  async issueDeletionChallenge(
    userId: UserId,
    options: { readonly ttlSeconds: number; readonly now: Date },
  ): Promise<string> {
    const token = crypto.randomUUID();
    const expiresAtMs = options.now.getTime() + options.ttlSeconds * 1000;
    this.#challenges.set(userId, { token, expiresAtMs });
    return token;
  }

  async deleteUser(
    userId: UserId,
    options: {
      readonly confirmationToken: string;
      readonly now: Date;
    },
  ): Promise<
    | { readonly deleted: true }
    | { readonly deleted: false; readonly reason: AccountDeletionError }
  > {
    const challenge = this.#challenges.get(userId);
    if (challenge === undefined) {
      return { deleted: false, reason: { kind: "confirmation_token_missing" } };
    }
    if (challenge.expiresAtMs < options.now.getTime()) {
      this.#challenges.delete(userId);
      return {
        deleted: false,
        reason: { kind: "confirmation_token_expired" },
      };
    }
    if (challenge.token !== options.confirmationToken) {
      return {
        deleted: false,
        reason: { kind: "confirmation_token_mismatch" },
      };
    }
    // Token is valid. Consume it before deletion so a retry
    // returns `confirmation_token_missing` rather than silently
    // running the cascade again.
    this.#challenges.delete(userId);

    // Children before parents:
    //   1. workout_sets (FK to workouts + exercises)
    //   2. workouts (FK to profile)
    //   3. exercises (FK to profile)
    //   4. food_entries (FK to profile)
    //   5. body_measurements (FK to profile)
    //   6. goals (FK to profile)
    //   7. profile (last; the row lives in `public.profiles` which
    //      is the user's primary identifier at the storage layer)
    //
    // The per-feature repositories in v1 are in-memory; we walk
    // the user's partitions and delete every record. SQL cascades
    // through the migration's `ON DELETE CASCADE` clauses; the
    // Supabase adapter (future segment) will simply remove the
    // `auth.users` row and let the FKs do the work.
    const workouts = await this.#workoutRepository.list(userId, {
      from: null,
      to: null,
      limit: 10_000,
    });
    for (const w of workouts) {
      await this.#workoutSetRepository.deleteAllForWorkout(w.id);
    }
    for (const w of workouts) {
      await this.#workoutRepository.delete(w.id);
    }
    const exercises = await this.#exerciseRepository.list(userId, {
      limit: 10_000,
    });
    for (const e of exercises) {
      await this.#exerciseRepository.delete(e.id);
    }
    const foodEntries = await this.#foodEntryRepository.list(userId, {
      from: null,
      to: null,
      limit: 10_000,
      accessToken: "",
    });
    for (const f of foodEntries) {
      await this.#foodEntryRepository.delete(f.id, { accessToken: "" });
    }
    const bodyMeasurements = await this.#bodyMeasurementRepository.list(
      userId,
      { from: null, to: null, limit: 10_000 },
    );
    for (const m of bodyMeasurements) {
      await this.#bodyMeasurementRepository.delete(m.id);
    }
    const goals = await this.#goalRepository.getHistory(userId, {
      accessToken: "",
    });
    for (const g of goals) {
      // The GoalRepository does not expose `delete` on its public
      // port (v1 has no per-row delete endpoint); the in-memory
      // implementation supports it for this orchestration path. A
      // future segment promotes it to the port.
      const repoAsAny = this.#goalRepository as unknown as {
        delete: (id: string) => Promise<boolean>;
      };
      if (typeof repoAsAny.delete === "function") {
        await repoAsAny.delete(g.id);
      }
    }
    // Profile: the in-memory implementation supports
    // `deleteForTest`. The SQL adapter will own the
    // Supabase-side delete when it lands.
    const profileRepoAsAny = this.#profileRepository as unknown as {
      deleteForTest?: (userId: UserId) => Promise<void>;
    };
    if (typeof profileRepoAsAny.deleteForTest === "function") {
      await profileRepoAsAny.deleteForTest(userId);
    }

    return { deleted: true };
  }

  /** Test-only helper to inspect the active challenge (if any). */
  __peekChallenge(userId: UserId): ChallengeRecord | undefined {
    return this.#challenges.get(userId);
  }
}
