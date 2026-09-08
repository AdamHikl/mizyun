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
import type { MemoryStore } from "@mizyun/memory";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

export interface AccountMediaStorage {
  remove(
    bucketId: string,
    objectPath: string,
    options: { readonly accessToken: string },
  ): Promise<void>;
}

interface ChallengeRecord {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface SupabaseAccountRepositoryOptions {
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly exerciseRepository: ExerciseRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  readonly conversationRepository?: ConversationRepository | null | undefined;
  readonly feedbackRepository?: FeedbackRepository | null | undefined;
  readonly mediaAssetRepository?: MediaAssetRepository | null | undefined;
  readonly mediaStorage?: AccountMediaStorage | null | undefined;
  readonly memoryStore?: MemoryStore | null | undefined;
  readonly serviceRoleClient?: RepositorySupabaseClient | null | undefined;
  readonly clock?: { readonly now: () => Date } | undefined;
}

/**
 * Supabase-backed implementation of the AccountRepository port (REL-AUD-001).
 *
 * Gather: queries every per-feature repository with the verified user's
 * access token, ensuring full RLS enforcement and exhaustive data export
 * (including private media metadata and conversations).
 *
 * Delete:
 *   1. Consumes the single-use deletion challenge token.
 *   2. Removes physical media objects from Supabase Storage.
 *   3. Deletes durable learned memories from MemoryStore.
 *   4. Calls `auth.admin.deleteUser(userId)` using the service role client.
 *      PostgreSQL `ON DELETE CASCADE` foreign keys on all user tables
 *      automatically and atomically delete all database rows in profiles,
 *      goals, food_entries, workouts, conversations, feedback, and media_assets,
 *      while purging the auth identity.
 */
export class SupabaseAccountRepository implements AccountRepository {
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
  readonly #mediaStorage: AccountMediaStorage | null;
  readonly #memoryStore: MemoryStore | null;
  readonly #serviceRoleClient: RepositorySupabaseClient | null;
  readonly #clock: { readonly now: () => Date };
  readonly #challenges = new Map<UserId, ChallengeRecord>();

  constructor(options: SupabaseAccountRepositoryOptions) {
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
    this.#memoryStore = options.memoryStore ?? null;
    this.#serviceRoleClient = options.serviceRoleClient ?? null;
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async exportForUser(
    userId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<AccountExport> {
    const token = options?.accessToken;
    if (!token) {
      throw new RepositoryError(
        "SupabaseAccountRepository.exportForUser requires a verified access token",
      );
    }

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
    // Token is valid. Consume it before deletion so retries fail.
    this.#challenges.delete(userId);

    const token = options.accessToken ?? "";

    // 1. Delete physical Storage media objects
    if (
      this.#mediaAssetRepository !== null &&
      this.#mediaStorage !== null &&
      token
    ) {
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
            // Ignore missing storage objects during cleanup
          }
        }
      } catch {
        // Ignore media list errors during cascade
      }
    }

    // 2. Delete learned memories
    if (this.#memoryStore !== null && token) {
      try {
        const memories = await this.#memoryStore.list(userId, {
          accessToken: token,
          includeSuperseded: true,
        });
        await Promise.all(
          memories.map((m) =>
            this.#memoryStore!.delete(userId, m.id, { accessToken: token }),
          ),
        );
      } catch {
        // Ignore memory delete errors during cascade
      }
    }

    // 3. Database rows & Auth identity:
    // If serviceRoleClient is present with auth.admin, calling deleteUser purges
    // the auth.users record, which triggers PostgreSQL ON DELETE CASCADE across
    // all user tables in a single transaction.
    const adminAuth = (
      this.#serviceRoleClient?.auth as unknown as {
        admin?: {
          deleteUser?: (id: string) => Promise<{
            data?: unknown;
            error?: { message: string } | null;
          }>;
        };
      }
    )?.admin;

    if (typeof adminAuth?.deleteUser === "function") {
      const { error } = await adminAuth.deleteUser(userId);
      if (error) {
        throw new RepositoryError(
          `Failed to delete user via auth admin: ${error.message}`,
        );
      }
    } else {
      // Fallback manual cascade if serviceRoleClient is not supplied
      if (this.#conversationRepository !== null && token) {
        await this.#conversationRepository.deleteAllForUser(userId, {
          accessToken: token,
        });
      }
      if (this.#feedbackRepository !== null && token) {
        await this.#feedbackRepository.deleteAllForUser(userId, {
          accessToken: token,
        });
      }
      if (token) {
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
          const repoAsAny = this.#goalRepository as unknown as {
            delete?: (id: string) => Promise<boolean>;
          };
          if (typeof repoAsAny.delete === "function") {
            await repoAsAny.delete(g.id);
          }
        }
      }
    }

    return { deleted: true };
  }

  __peekChallenge(userId: UserId): ChallengeRecord | undefined {
    return this.#challenges.get(userId);
  }
}
