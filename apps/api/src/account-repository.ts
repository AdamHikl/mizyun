import crypto from "node:crypto";

import {
  type AccountDeletionError,
  type AccountExport,
  type AccountRepository,
  type AiConsentRepository,
  type BodyMeasurementRepository,
  type ConversationRepository,
  type DeletionJobStage,
  type DeletionJobStatus,
  type ExerciseRepository,
  type ExportManifest,
  type ExportedMediaAsset,
  type FeedbackRepository,
  type FoodEntryRepository,
  type GoalRepository,
  type MediaAssetRepository,
  type ProfileRepository,
  type StoredAiConsent,
  type StoredDeletionJob,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";
import type { MemoryStore } from "@mizyun/memory";
import type { MediaStorage } from "./media-storage.js";

/**
 * In-memory implementation of the `AccountRepository` port.
 *
 * Used by `apps/api` for unit tests and local runs without a database.
 * The implementation orchestrates the per-feature in-memory
 * repositories and implements the durable deletion state machine
 * and tombstone semantics (ADR-0021).
 */

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

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
  readonly memoryStore?: MemoryStore;
  readonly aiConsentRepository?: AiConsentRepository;
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
  readonly #memoryStore: MemoryStore | null;
  readonly #aiConsentRepository: AiConsentRepository | null;
  readonly #clock: { readonly now: () => Date };
  readonly #jobs: StoredDeletionJob[] = [];

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
    this.#memoryStore = options.memoryStore ?? null;
    this.#aiConsentRepository = options.aiConsentRepository ?? null;
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
    const mediaList =
      this.#mediaAssetRepository === null
        ? []
        : await this.#mediaAssetRepository.list(userId, {
            purpose: null,
            limit: 10_000,
            accessToken: token,
          });
    const now = this.#clock.now();
    const privateMedia: ExportedMediaAsset[] = await Promise.all(
      mediaList.map(async (asset) => {
        let downloadUrl: string | null = null;
        if (this.#mediaStorage?.signDownloadUrl) {
          const signed = await this.#mediaStorage
            .signDownloadUrl(asset.bucketId, asset.objectPath, {
              ttlSeconds: 86400,
              now,
              accessToken: token,
            })
            .catch(() => null);
          downloadUrl = signed?.url ?? null;
        }
        return {
          id: asset.id,
          objectPath: asset.objectPath,
          purpose: asset.purpose,
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          downloadUrl,
          createdAt: asset.createdAt,
        };
      }),
    );

    const totalMessages = conversations.reduce(
      (sum, c) => sum + c.messages.length,
      0,
    );
    const aiConsent =
      this.#aiConsentRepository === null
        ? null
        : await this.#aiConsentRepository.getConsent(userId, {
            accessToken: token,
          });

    const manifest: ExportManifest = {
      schemaVersion: "2026-09-08",
      generatedAt: now,
      completeness: "complete",
      counts: {
        profiles: profile ? 1 : 0,
        goals: goals.length,
        foodEntries: foodEntries.length,
        exercises: exercises.length,
        workouts: workouts.length,
        workoutSets: workoutSets.length,
        bodyMeasurements: bodyMeasurements.length,
        conversations: conversations.length,
        messages: totalMessages,
        memories: 0,
        privateMedia: privateMedia.length,
        feedback: feedback.length,
        aiConsents: aiConsent ? 1 : 0,
      },
    };

    return {
      manifest,
      userId,
      generatedAt: now,
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
      aiConsent,
    };
  }

  async getDeletionJob(userId: UserId): Promise<StoredDeletionJob | null> {
    const userJobs = this.#jobs.filter((j) => j.userId === userId);
    return userJobs.length > 0 ? userJobs[userJobs.length - 1]! : null;
  }

  async issueDeletionChallenge(
    userId: UserId,
    options: { readonly ttlSeconds: number; readonly now: Date },
  ): Promise<string> {
    const latest = await this.getDeletionJob(userId);
    if (latest && latest.status === "completed") {
      throw new Error("Account is already deleted");
    }
    if (latest && latest.status === "in_progress") {
      throw new Error("Account deletion is already in progress");
    }

    const token = crypto.randomUUID();
    const challengeHash = hashToken(token);
    const expiresAt = new Date(
      options.now.getTime() + options.ttlSeconds * 1000,
    );

    const job: StoredDeletionJob = {
      id: crypto.randomUUID(),
      userId,
      challengeHash,
      status: "challenge_issued",
      stage: "none",
      expiresAt,
      completedAt: null,
      errorMessage: null,
      createdAt: options.now,
      updatedAt: options.now,
    };
    this.#jobs.push(job);
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
    if (!options.confirmationToken) {
      return { deleted: false, reason: { kind: "confirmation_token_missing" } };
    }

    const latest = await this.getDeletionJob(userId);
    if (!latest) {
      return { deleted: false, reason: { kind: "confirmation_token_missing" } };
    }

    const tokenHash = hashToken(options.confirmationToken);
    if (latest.challengeHash !== tokenHash) {
      return {
        deleted: false,
        reason: { kind: "confirmation_token_mismatch" },
      };
    }

    // 1. Idempotent recovery for lost final response
    if (latest.status === "completed") {
      return { deleted: true };
    }

    // 2. Check challenge expiry if challenge_issued
    if (latest.status === "challenge_issued") {
      if (latest.expiresAt.getTime() < options.now.getTime()) {
        return {
          deleted: false,
          reason: { kind: "confirmation_token_expired" },
        };
      }
    }

    // Mutate job state
    const jobIndex = this.#jobs.findIndex((j) => j.id === latest.id);
    this.#jobs[jobIndex] = {
      ...latest,
      status: "in_progress",
      stage: "storage",
      updatedAt: options.now,
    };

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
            // Silently ignore missing objects in storage during test
          }
        }
      } catch {
        // Silently ignore media list errors during test
      }
    }

    this.#jobs[jobIndex] = {
      ...this.#jobs[jobIndex]!,
      stage: "memory",
      updatedAt: options.now,
    };

    if (this.#memoryStore !== null && token) {
      const memories = await this.#memoryStore.list(userId, {
        accessToken: token,
        includeSuperseded: true,
      });
      await Promise.all(
        memories.map((m) =>
          this.#memoryStore!.delete(userId, m.id, { accessToken: token }),
        ),
      );
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

    this.#jobs[jobIndex] = {
      ...this.#jobs[jobIndex]!,
      stage: "auth",
      updatedAt: options.now,
    };

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
        delete: (id: string) => Promise<boolean>;
      };
      if (typeof repoAsAny.delete === "function") {
        await repoAsAny.delete(g.id);
      }
    }
    const profileRepoAsAny = this.#profileRepository as unknown as {
      deleteForTest?: (userId: UserId) => Promise<void>;
    };
    if (typeof profileRepoAsAny.deleteForTest === "function") {
      await profileRepoAsAny.deleteForTest(userId);
    }

    this.#jobs[jobIndex] = {
      ...this.#jobs[jobIndex]!,
      status: "completed",
      stage: "done",
      completedAt: options.now,
      updatedAt: options.now,
    };

    return { deleted: true };
  }

  async getDeletionJobByToken(
    confirmationToken: string,
  ): Promise<StoredDeletionJob | null> {
    const hash = hashToken(confirmationToken);
    for (let i = this.#jobs.length - 1; i >= 0; i--) {
      if (this.#jobs[i]!.challengeHash === hash) {
        return this.#jobs[i]!;
      }
    }
    return null;
  }
}
