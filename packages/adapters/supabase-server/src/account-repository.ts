import crypto from "node:crypto";

import {
  type AccountDeletionError,
  type AccountExport,
  type AccountRepository,
  type BodyMeasurementRepository,
  type ConversationRepository,
  type DeletionJobStage,
  type DeletionJobStatus,
  type ExerciseRepository,
  type FeedbackRepository,
  type FoodEntryRepository,
  type GoalRepository,
  type MediaAssetRepository,
  type ProfileRepository,
  type StoredDeletionJob,
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

interface AccountDeletionJobRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly challenge_hash: string;
  readonly status: DeletionJobStatus;
  readonly stage: DeletionJobStage;
  readonly expires_at: string;
  readonly completed_at: string | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

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
 * Supabase-backed implementation of the AccountRepository port (REL-AUD-001, ADR-0021).
 *
 * Gather: queries every per-feature repository with the verified user's
 * access token, ensuring full RLS enforcement and exhaustive data export
 * (including private media metadata and conversations).
 *
 * Delete:
 *   1. Persists deletion jobs and SHA-256 hashed challenges in `public.account_deletion_jobs`.
 *   2. Enforces atomic confirmation and bounded challenge TTL before accepting.
 *   3. Multi-stage cleanup pipeline:
 *      - Stage 1 (storage): removes physical media objects from Supabase Storage. Missing (404) objects are idempotent.
 *      - Stage 2 (memory): deletes durable learned memories from MemoryStore.
 *      - Stage 3 (auth): invokes `auth.admin.deleteUser(userId)` via the service role client.
 *        PostgreSQL `ON DELETE CASCADE` foreign keys automatically and atomically delete all database
 *        rows across all user tables while purging the auth identity.
 *      - Stage 4 (tombstone): marks the job `completed` in `public.account_deletion_jobs`.
 *        Because the job table intentionally lacks an ON DELETE CASCADE foreign key to auth.users,
 *        the tombstone survives as an immutable audit record and provides idempotent recovery
 *        for dropped client connections.
 *   4. Failure in any cleanup stage halts execution and marks the job `failed` (resumable/retryable).
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

  async getDeletionJob(userId: UserId): Promise<StoredDeletionJob | null> {
    if (!this.#serviceRoleClient) {
      return null;
    }
    const { data: jobs, error } = await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !jobs || jobs.length === 0) {
      return null;
    }
    const row = jobs[0]!;
    return {
      id: row.id,
      userId: row.user_id as UserId,
      challengeHash: row.challenge_hash,
      status: row.status,
      stage: row.stage,
      expiresAt: new Date(row.expires_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async issueDeletionChallenge(
    userId: UserId,
    options: { readonly ttlSeconds: number; readonly now: Date },
  ): Promise<string> {
    if (!this.#serviceRoleClient) {
      throw new RepositoryError(
        "SupabaseAccountRepository requires serviceRoleClient to issue deletion challenges",
      );
    }
    const token = crypto.randomUUID();
    const challengeHash = hashToken(token);
    const expiresAt = new Date(
      options.now.getTime() + options.ttlSeconds * 1000,
    );

    const { data: existingJobs } = await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    const latest = existingJobs?.[0];
    if (latest && latest.status === "completed") {
      throw new RepositoryError("Account is already deleted");
    }
    if (latest && latest.status === "in_progress") {
      throw new RepositoryError("Account deletion is already in progress");
    }

    const { error } = await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .insert({
        user_id: userId,
        challenge_hash: challengeHash,
        status: "challenge_issued",
        stage: "none",
        expires_at: expiresAt.toISOString(),
        completed_at: null,
        error_message: null,
        created_at: options.now.toISOString(),
        updated_at: options.now.toISOString(),
      });

    if (error) {
      throw new RepositoryError(
        `Failed to persist account deletion challenge: ${error.message}`,
      );
    }

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
    if (!this.#serviceRoleClient) {
      throw new RepositoryError(
        "SupabaseAccountRepository requires serviceRoleClient to delete users",
      );
    }
    if (!options.confirmationToken) {
      return { deleted: false, reason: { kind: "confirmation_token_missing" } };
    }

    const tokenHash = hashToken(options.confirmationToken);

    const { data: jobs, error: lookupError } = await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (lookupError) {
      throw new RepositoryError(
        `Failed to lookup account deletion job: ${lookupError.message}`,
      );
    }

    const job = jobs?.[0];
    if (!job) {
      return { deleted: false, reason: { kind: "confirmation_token_missing" } };
    }

    if (job.challenge_hash !== tokenHash) {
      return {
        deleted: false,
        reason: { kind: "confirmation_token_mismatch" },
      };
    }

    // 1. Lost final response recovery: return deleted: true if already completed
    if (job.status === "completed") {
      return { deleted: true };
    }

    // 2. If status is challenge_issued, check expiry before accepting
    if (job.status === "challenge_issued") {
      const expiresAt = new Date(job.expires_at).getTime();
      if (expiresAt < options.now.getTime()) {
        return {
          deleted: false,
          reason: { kind: "confirmation_token_expired" },
        };
      }

      // Transition to in_progress. Once accepted, expiry no longer applies.
      const { error: transitionError } = await this.#serviceRoleClient
        .from<AccountDeletionJobRow>("account_deletion_jobs")
        .update({
          status: "in_progress",
          stage: "none",
          updated_at: options.now.toISOString(),
        })
        .eq("id", job.id);

      if (transitionError) {
        throw new RepositoryError(
          `Failed to transition account deletion job: ${transitionError.message}`,
        );
      }
    }

    const token = options.accessToken ?? "";

    // Stage 1: Storage
    await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .update({
        status: "in_progress",
        stage: "storage",
        updated_at: options.now.toISOString(),
      })
      .eq("id", job.id);

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
          await this.#mediaStorage.remove(asset.bucketId, asset.objectPath, {
            accessToken: token,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .update({
            status: "failed",
            stage: "storage",
            error_message: msg,
            updated_at: options.now.toISOString(),
          })
          .eq("id", job.id);
        throw new RepositoryError(
          `Account deletion failed during storage cleanup: ${msg}`,
        );
      }
    }

    // Stage 2: Memory
    await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .update({
        status: "in_progress",
        stage: "memory",
        updated_at: options.now.toISOString(),
      })
      .eq("id", job.id);

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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .update({
            status: "failed",
            stage: "memory",
            error_message: msg,
            updated_at: options.now.toISOString(),
          })
          .eq("id", job.id);
        throw new RepositoryError(
          `Account deletion failed during memory cleanup: ${msg}`,
        );
      }
    }

    // Stage 3: Auth admin deletion (cascades database rows)
    await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .update({
        status: "in_progress",
        stage: "auth",
        updated_at: options.now.toISOString(),
      })
      .eq("id", job.id);

    const adminAuth = (
      this.#serviceRoleClient.auth as unknown as {
        admin?: {
          deleteUser?: (id: string) => Promise<{
            data?: unknown;
            error?: { message: string } | null;
          }>;
        };
      }
    )?.admin;

    if (typeof adminAuth?.deleteUser !== "function") {
      const msg =
        "SupabaseAccountRepository requires auth.admin.deleteUser capability on serviceRoleClient";
      await this.#serviceRoleClient
        .from<AccountDeletionJobRow>("account_deletion_jobs")
        .update({
          status: "failed",
          stage: "auth",
          error_message: msg,
          updated_at: options.now.toISOString(),
        })
        .eq("id", job.id);
      throw new RepositoryError(msg);
    }

    const { error: authError } = await adminAuth.deleteUser(userId);
    if (authError) {
      await this.#serviceRoleClient
        .from<AccountDeletionJobRow>("account_deletion_jobs")
        .update({
          status: "failed",
          stage: "auth",
          error_message: authError.message,
          updated_at: options.now.toISOString(),
        })
        .eq("id", job.id);
      throw new RepositoryError(
        `Account deletion failed during auth deletion: ${authError.message}`,
      );
    }

    // Stage 4: Mark job completed (tombstone)
    const { error: completeError } = await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .update({
        status: "completed",
        stage: "done",
        completed_at: options.now.toISOString(),
        updated_at: options.now.toISOString(),
        error_message: null,
      })
      .eq("id", job.id);

    if (completeError) {
      throw new RepositoryError(
        `Account deleted in auth, but failed to record completion tombstone: ${completeError.message}`,
      );
    }

    return { deleted: true };
  }
}
