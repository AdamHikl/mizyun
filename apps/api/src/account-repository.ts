import {
  type AccountDeletionError,
  type AccountExport,
  type AccountRepository,
  type BodyMeasurementRepository,
  type ConversationRepository,
  type ExerciseRepository,
  type FeedbackRepository,
  type FoodEntryRepository,
  type GoalRepository,
  type MediaAssetRepository,
  type ProfileRepository,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";
import type { MediaStorage } from "./media-storage.js";

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
  readonly conversationRepository?: ConversationRepository;
  readonly feedbackRepository?: FeedbackRepository;
  readonly mediaAssetRepository?: MediaAssetRepository;
  readonly mediaStorage?: MediaStorage;
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
  readonly #conversationRepository: ConversationRepository | null;
  readonly #feedbackRepository: FeedbackRepository | null;
  readonly #mediaAssetRepository: MediaAssetRepository | null;
  readonly #mediaStorage: MediaStorage | null;
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
    this.#conversationRepository = options.conversationRepository ?? null;
    this.#feedbackRepository = options.feedbackRepository ?? null;
    this.#mediaAssetRepository = options.mediaAssetRepository ?? null;
    this.#mediaStorage = options.mediaStorage ?? null;
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async exportForUser(
    userId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<AccountExport> {
    const token = options?.accessToken ?? "";
    const profile = await this.#profileRepository.getOrCreate(userId, {
      now: this.#clock.now(),
      accessToken: token,
    });
    const goals = await this.#goalRepository.getHistory(userId, {
      accessToken: token,
    });
    const foodEntries = await this.#foodEntryRepository.list(userId, {
      from: null,
      to: null,
      limit: 10_000,
      accessToken: token,
    });
    const exercises = await this.#exerciseRepository.list(userId, {
      limit: 10_000,
      accessToken: token,
    });
    const workouts = await this.#workoutRepository.list(userId, {
      from: null,
      to: null,
      limit: 10_000,
      accessToken: token,
    });
    const workoutSets: import("@mizyun/core").StoredWorkoutSet[] = [];
    for (const w of workouts) {
      const sets = await this.#workoutSetRepository.listForWorkout(w.id, {
        accessToken: token,
      });
      workoutSets.push(...sets);
    }
    const bodyMeasurements = await this.#bodyMeasurementRepository.list(
      userId,
      {
        from: null,
        to: null,
        limit: 10_000,
        accessToken: token,
      },
    );
    const conversations =
      this.#conversationRepository === null
        ? []
        : await Promise.all(
            (
              await this.#conversationRepository.list(userId, {
                accessToken: token,
                limit: 10_000,
              })
            ).map(async (conversation) => ({
              id: conversation.id,
              title: conversation.title,
              status: conversation.status,
              createdAt: conversation.createdAt,
              updatedAt: conversation.updatedAt,
              messages: (
                await this.#conversationRepository!.listMessages(
                  userId,
                  conversation.id,
                  { accessToken: token, limit: 10_000 },
                )
              ).map((message) => ({
                id: message.id,
                role: message.role,
                text: message.text,
                status: message.status,
                createdAt: message.createdAt,
              })),
            })),
          );
    const feedback =
      this.#feedbackRepository === null
        ? []
        : await this.#feedbackRepository.listForUser(userId, {
            accessToken: token,
            limit: 10_000,
          });
    const privateMedia =
      this.#mediaAssetRepository === null
        ? []
        : (
            await this.#mediaAssetRepository.list(userId, {
              purpose: null,
              limit: 10_000,
              accessToken: token,
            })
          ).map((asset) => ({
            id: asset.id,
            createdAt: asset.createdAt,
          }));
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
      conversations,
      privateMedia,
      feedback,
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
      readonly accessToken?: string;
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

    const token = options.accessToken ?? "";

    if (this.#mediaAssetRepository !== null && this.#mediaStorage !== null) {
      try {
        const assets = await this.#mediaAssetRepository.list(userId, {
          purpose: null,
          limit: 10_000,
          accessToken: token,
        });
        for (const asset of assets) {
          try {
            await this.#mediaStorage.remove(asset.bucketId, asset.objectPath, {
              accessToken: token,
            });
          } catch {
            // Silently ignore individual missing objects in storage
          }
        }
      } catch {
        // Silently ignore media list errors during cascade
      }
    }

    if (this.#conversationRepository !== null) {
      await this.#conversationRepository.deleteAllForUser(userId, {
        accessToken: token,
      });
    }
    if (this.#feedbackRepository !== null) {
      await this.#feedbackRepository.deleteAllForUser(userId, {
        accessToken: token,
      });
    }

    // Children before parents:
    //   1. workout_sets (FK to workouts + exercises)
    //   2. workouts (FK to profile)
    //   3. exercises (FK to profile)
    //   4. food_entries (FK to profile)
    //   5. body_measurements (FK to profile)
    //   6. goals (FK to profile)
    //   7. profile (last; the row lives in `public.profiles` which
    //      is the user's primary identifier at the storage layer)
    const workouts = await this.#workoutRepository.list(userId, {
      from: null,
      to: null,
      limit: 10_000,
      accessToken: token,
    });
    for (const w of workouts) {
      await this.#workoutSetRepository.deleteAllForWorkout(w.id, {
        accessToken: token,
      });
    }
    for (const w of workouts) {
      await this.#workoutRepository.delete(w.id, { accessToken: token });
    }
    const exercises = await this.#exerciseRepository.list(userId, {
      limit: 10_000,
      accessToken: token,
    });
    for (const e of exercises) {
      await this.#exerciseRepository.delete(e.id, { accessToken: token });
    }
    const foodEntries = await this.#foodEntryRepository.list(userId, {
      from: null,
      to: null,
      limit: 10_000,
      accessToken: token,
    });
    for (const f of foodEntries) {
      await this.#foodEntryRepository.delete(f.id, { accessToken: token });
    }
    const bodyMeasurements = await this.#bodyMeasurementRepository.list(
      userId,
      { from: null, to: null, limit: 10_000, accessToken: token },
    );
    for (const m of bodyMeasurements) {
      await this.#bodyMeasurementRepository.delete(m.id, {
        accessToken: token,
      });
    }
    const goals = await this.#goalRepository.getHistory(userId, {
      accessToken: token,
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
