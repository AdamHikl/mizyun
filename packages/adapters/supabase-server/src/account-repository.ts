import type {
  MealIllustrationRepository,
  RecipeRequestLedger,
} from "@mizyun/core";
import crypto from "node:crypto";
import { exportCommunityAccount } from "./community-account-export.js";

import {
  isOwnedMealImagePath,
  type AccountDeletionError,
  type AccountDeletionCleanupContext,
  type AccountExport,
  type AccountRepository,
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
  type AiConsentRepository,
  type ProductAnalyticsRepository,
  type StoredAiConsent,
  type StoredProductAnalyticsConsent,
  type StoredProductAnalyticsEvent,
  type StoredBodyMeasurement,
  type StoredDeletionJob,
  type StoredExercise,
  type StoredFoodEntry,
  type StoredGoal,
  type StoredProfile,
  type StoredWorkout,
  type StoredWorkoutSet,
  type StoredConversationStub,
  type UserFeedback,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";
import type { MemoryStore } from "@mizyun/memory";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";
import { fetchAllExportPages as fetchAllPaged } from "./export-pagination.js";
import { goalFromRow } from "./goal-repository.js";
import { foodEntryFromRow } from "./food-entry-repository.js";
import { exerciseFromRow } from "./exercise-repository.js";
import { workoutFromRow } from "./workout-repository.js";
import { workoutSetFromRow } from "./workout-set-repository.js";
import { bodyMeasurementFromRow } from "./body-measurement-repository.js";
import { feedbackFromRow } from "./feedback-repository.js";
import { mediaAssetFromRow } from "./media-asset-repository.js";
import { conversationFromRow } from "./conversation-repository.js";
import {
  aiConsentFromRow,
  type AiConsentRow,
} from "./ai-consent-repository.js";
import {
  type ProductAnalyticsConsentRow,
  type ProductAnalyticsEventRow,
  productAnalyticsConsentFromRow,
  productAnalyticsEventFromRow,
} from "./product-analytics-repository.js";

export interface AccountMediaStorage {
  remove(
    bucketId: string,
    objectPath: string,
    options: { readonly accessToken: string },
  ): Promise<void>;
  signDownloadUrl?(
    bucketId: string,
    objectPath: string,
    options: {
      readonly ttlSeconds: number;
      readonly now: Date;
      readonly accessToken: string;
    },
  ): Promise<{ readonly url: string; readonly expiresAt: Date }>;
}

interface AccountDeletionJobRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly challenge_hash: string;
  readonly status: DeletionJobStatus;
  readonly stage: DeletionJobStage;
  readonly worker_id?: string | null;
  readonly lease_expires_at?: string | null;
  readonly expires_at: string;
  readonly completed_at: string | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export const DELETION_WORKER_LEASE_MS = 120_000; // 2 minutes

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

export interface SupabaseAccountRepositoryOptions {
  readonly communityLifecycleEnabled?: boolean;
  readonly mealIllustrationRepository?: MealIllustrationRepository;
  readonly recipeRequestLedger?: RecipeRequestLedger;
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
  /** Trusted account lifecycle only: owner-scoped export/erasure survives a downgrade. */
  readonly exportMediaStorage?: AccountMediaStorage | null | undefined;
  readonly memoryStore?: MemoryStore | null | undefined;
  readonly aiConsentRepository?: AiConsentRepository | null | undefined;
  readonly productAnalyticsRepository?:
    ProductAnalyticsRepository | null | undefined;
  readonly serviceRoleClient?: RepositorySupabaseClient | null | undefined;
  readonly clientFor?:
    ((accessToken: string) => RepositorySupabaseClient) | undefined;
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
  readonly #communityLifecycleEnabled: boolean;
  readonly #mealIllustrationRepository: MealIllustrationRepository | null;
  readonly #recipeRequestLedger: RecipeRequestLedger | null;
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
  readonly #exportMediaStorage: AccountMediaStorage | null;
  readonly #memoryStore: MemoryStore | null;
  readonly #aiConsentRepository: AiConsentRepository | null;
  readonly #productAnalyticsRepository: ProductAnalyticsRepository | null;
  readonly #serviceRoleClient: RepositorySupabaseClient | null;
  readonly #clientFor:
    ((accessToken: string) => RepositorySupabaseClient) | null;
  readonly #clock: { readonly now: () => Date };

  constructor(options: SupabaseAccountRepositoryOptions) {
    this.#communityLifecycleEnabled =
      options.communityLifecycleEnabled ?? false;
    this.#recipeRequestLedger = options.recipeRequestLedger ?? null;
    this.#mealIllustrationRepository =
      options.mealIllustrationRepository ?? null;
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
    this.#exportMediaStorage = options.exportMediaStorage ?? null;
    this.#memoryStore = options.memoryStore ?? null;
    this.#aiConsentRepository = options.aiConsentRepository ?? null;
    this.#productAnalyticsRepository =
      options.productAnalyticsRepository ?? null;
    this.#serviceRoleClient = options.serviceRoleClient ?? null;
    this.#clientFor = options.clientFor ?? null;
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

    if (this.#communityLifecycleEnabled && this.#clientFor === null) {
      throw new RepositoryError(
        "Community export requires a principal-scoped RPC client",
      );
    }
    const now = this.#clock.now();
    let profile: StoredProfile | null;
    let goals: ReadonlyArray<StoredGoal>;
    let foodEntries: ReadonlyArray<StoredFoodEntry>;
    let exercises: ReadonlyArray<StoredExercise>;
    let workouts: ReadonlyArray<StoredWorkout>;
    let workoutSets: ReadonlyArray<StoredWorkoutSet>;
    let bodyMeasurements: ReadonlyArray<StoredBodyMeasurement>;
    let conversations: ReadonlyArray<StoredConversationStub>;
    let feedback: ReadonlyArray<UserFeedback>;
    let privateMedia: ReadonlyArray<ExportedMediaAsset>;
    let aiConsent: StoredAiConsent | null = null;
    let productAnalyticsConsent: StoredProductAnalyticsConsent | null = null;
    let productAnalyticsEvents: ReadonlyArray<StoredProductAnalyticsEvent> = [];
    let memoryCount = 0;
    let community: AccountExport["community"];
    let recurringMeals: AccountExport["recurringMeals"];
    let runOperationReceipts: AccountExport["runOperationReceipts"];
    let mealImagePaths: AccountExport["mealImagePaths"];

    if (this.#clientFor !== null) {
      const client = this.#clientFor(token);
      mealImagePaths = (
        await fetchAllPaged(
          client,
          "food_media_paths",
          "user_id",
          userId,
          "path_key",
          true,
          "path_key",
        )
      ).map((row) => ({
        userId: String(row.user_id),
        pathKey: String(row.path_key),
        createdAt: new Date(String(row.created_at)).toISOString(),
      }));
      runOperationReceipts = await fetchAllPaged(
        client,
        "run_operation_receipts",
        "user_id",
        userId,
        "created_at",
        true,
        "operation_id",
      );
      recurringMeals = {
        schedules: await fetchAllPaged(
          client,
          "recurring_meal_schedules",
          "user_id",
          userId,
          "id",
        ),
        occurrences: await fetchAllPaged(
          client,
          "recurring_meal_occurrences",
          "user_id",
          userId,
          "id",
        ),
        suggestionStates: await fetchAllPaged(
          client,
          "recurring_meal_suggestion_states",
          "user_id",
          userId,
          "family_key",
          true,
          "family_key",
        ),
        suggestionPreferences: await fetchAllPaged(
          client,
          "recurring_meal_suggestion_preferences",
          "user_id",
          userId,
          "user_id",
          true,
          "user_id",
        ),
        suggestionReceipts: await fetchAllPaged(
          client,
          "recurring_meal_suggestion_receipts",
          "user_id",
          userId,
          "operation_id",
          true,
          "operation_id",
        ),
      };
      if (this.#communityLifecycleEnabled)
        community = await exportCommunityAccount(client);

      profile = await this.#profileRepository.getOrCreate(userId, {
        now,
        accessToken: token,
      });
      const goalRows = await fetchAllPaged(
        client,
        "goals",
        "user_id",
        userId,
        "updated_at",
        false,
      );
      goals = goalRows.map((r: any) => goalFromRow(r));

      const foodRows = await fetchAllPaged(
        client,
        "food_entries",
        "user_id",
        userId,
        "consumed_at",
        false,
      );
      foodEntries = foodRows.map((r: any) => foodEntryFromRow(r));

      const exerciseRows = await fetchAllPaged(
        client,
        "exercises",
        "user_id",
        userId,
        "created_at",
        true,
      );
      exercises = exerciseRows.map((r: any) => exerciseFromRow(r));

      const workoutRows = await fetchAllPaged(
        client,
        "workouts",
        "user_id",
        userId,
        "started_at",
        false,
      );
      workouts = workoutRows.map((r: any) => workoutFromRow(r));

      const workoutSetRows = await fetchAllPaged(
        client,
        "workout_sets",
        "user_id",
        userId,
        "sequence",
        true,
      );
      workoutSets = workoutSetRows.map((r: any) => workoutSetFromRow(r));

      const measurementRows = await fetchAllPaged(
        client,
        "body_measurements",
        "user_id",
        userId,
        "measured_at",
        false,
      );
      bodyMeasurements = measurementRows.map((r: any) =>
        bodyMeasurementFromRow(r),
      );

      const conversationRows = await fetchAllPaged(
        client,
        "conversations",
        "user_id",
        userId,
        "created_at",
        false,
      );
      conversations = await Promise.all(
        conversationRows.map(async (cRow) => {
          const c = conversationFromRow(cRow as any);
          const messageRows = await fetchAllPaged(
            client,
            "messages",
            "conversation_id",
            c.id,
            "created_at",
            true,
          );
          const messages = messageRows
            .filter((m: any) => m.role === "user" || m.role === "assistant")
            .map((m: any) => ({
              id: m.id as string,
              role: m.role as "user" | "assistant",
              text: (m.content?.text as string) ?? "",
              status: (m.status === "failed" ? "failed" : "complete") as
                "complete" | "failed",
              createdAt: new Date(m.created_at as string),
            }));
          return {
            id: c.id,
            title: c.title,
            status: c.status,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            messages,
          };
        }),
      );

      const feedbackRows = await fetchAllPaged(
        client,
        "user_feedback",
        "user_id",
        userId,
        "created_at",
        false,
      );
      feedback = feedbackRows.map((r: any) => feedbackFromRow(r));

      const memoryRows = await fetchAllPaged(
        client,
        "memory_items",
        "user_id",
        userId,
        "created_at",
        false,
      );
      memoryCount = memoryRows.length;

      const mediaRows = await fetchAllPaged(
        client,
        "media_assets",
        "user_id",
        userId,
        "created_at",
        false,
      );
      const activeMedia = mediaRows
        .map((r: any) => mediaAssetFromRow(r))
        .filter((a) => a.deletedAt === null);

      privateMedia = await Promise.all(
        activeMedia.map(async (asset) => {
          let downloadUrl: string | null = null;
          const exportStorage =
            asset.purpose === "food"
              ? asset.userId === userId &&
                isOwnedMealImagePath(userId, asset.bucketId, asset.objectPath)
                ? (this.#exportMediaStorage ?? this.#mediaStorage)
                : null
              : this.#mediaStorage;
          if (exportStorage?.signDownloadUrl) {
            const signed = await exportStorage
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

      const { data: consentRow, error: consentError } = await client
        .from<AiConsentRow>("user_ai_consents")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (consentError)
        throw new RepositoryError("Unable to export AI consent");
      if (consentRow) {
        aiConsent = aiConsentFromRow(consentRow);
      }

      const { data: paConsentRow, error: paConsentError } = await client
        .from<ProductAnalyticsConsentRow>("product_analytics_consents")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (paConsentError) {
        throw new RepositoryError("Unable to export analytics consent");
      }
      if (paConsentRow) {
        productAnalyticsConsent = productAnalyticsConsentFromRow(paConsentRow);
      }
      const paEventRows = await fetchAllPaged(
        client,
        "product_analytics_events",
        "user_id",
        userId,
        "recorded_at",
        false,
      );
      productAnalyticsEvents = paEventRows.map((r: any) =>
        productAnalyticsEventFromRow(r),
      );
    } else {
      profile = await this.#profileRepository.getOrCreate(userId, {
        now,
        accessToken: token,
      });
      goals = await this.#goalRepository.getHistory(userId, {
        accessToken: token,
      });
      foodEntries = await this.#foodEntryRepository.list(userId, {
        from: null,
        to: null,
        limit: 10_000,
        accessToken: token,
      });
      exercises = await this.#exerciseRepository.list(userId, {
        limit: 10_000,
        accessToken: token,
      });
      workouts = await this.#workoutRepository.list(userId, {
        from: null,
        to: null,
        limit: 10_000,
        accessToken: token,
      });
      const collectedSets: StoredWorkoutSet[] = [];
      for (const w of workouts) {
        const sets = await this.#workoutSetRepository.listForWorkout(w.id, {
          accessToken: token,
        });
        collectedSets.push(...sets);
      }
      workoutSets = collectedSets;
      bodyMeasurements = await this.#bodyMeasurementRepository.list(userId, {
        from: null,
        to: null,
        limit: 10_000,
        accessToken: token,
      });
      conversations =
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
      feedback =
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
      privateMedia = await Promise.all(
        mediaList.map(async (asset) => {
          let downloadUrl: string | null = null;
          const exportStorage =
            asset.purpose === "food"
              ? asset.userId === userId &&
                isOwnedMealImagePath(userId, asset.bucketId, asset.objectPath)
                ? (this.#exportMediaStorage ?? this.#mediaStorage)
                : null
              : this.#mediaStorage;
          if (exportStorage?.signDownloadUrl) {
            const signed = await exportStorage
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
      if (this.#memoryStore) {
        const mems = await this.#memoryStore.exportForUser(userId, {
          accessToken: token,
        });
        memoryCount = mems.length;
      }
      if (this.#aiConsentRepository) {
        aiConsent = await this.#aiConsentRepository.getConsent(userId, {
          accessToken: token,
        });
      }
      if (this.#productAnalyticsRepository) {
        productAnalyticsConsent =
          await this.#productAnalyticsRepository.getConsent(userId, {
            accessToken: token,
          });
        productAnalyticsEvents =
          await this.#productAnalyticsRepository.listRetainedEvents(userId, {
            limit: 10_000,
            accessToken: token,
          });
      }
    }

    const totalMessages = conversations.reduce(
      (sum, c) => sum + c.messages.length,
      0,
    );
    const manifest: ExportManifest = {
      schemaVersion: "2026-09-08",
      generatedAt: now,
      completeness:
        this.#clientFor === null || privateMedia.length > 0
          ? "partial"
          : "complete",
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
        memories: memoryCount,
        privateMedia: privateMedia.length,
        feedback: feedback.length,
        aiConsents: aiConsent ? 1 : 0,
        productAnalyticsEvents: productAnalyticsEvents.length,
      },
    };

    return {
      manifest,
      ...(mealImagePaths ? { mealImagePaths } : {}),
      ...(this.#recipeRequestLedger
        ? {
            recipeRequests:
              await this.#recipeRequestLedger.exportUsageForUser(userId),
          }
        : {}),
      ...(this.#mealIllustrationRepository
        ? {
            mealIllustrationUsage:
              await this.#mealIllustrationRepository.exportUsageForUser(
                userId,
                token,
              ),
            mealIllustrations:
              await this.#mealIllustrationRepository.exportForUser(
                userId,
                token,
              ),
          }
        : {}),
      ...(community ? { community } : {}),
      ...(recurringMeals ? { recurringMeals } : {}),
      ...(runOperationReceipts ? { runOperationReceipts } : {}),
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
      productAnalytics:
        productAnalyticsConsent || productAnalyticsEvents.length > 0
          ? {
              consent: productAnalyticsConsent,
              events: productAnalyticsEvents,
            }
          : null,
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
      workerId: row.worker_id ?? null,
      leaseExpiresAt: row.lease_expires_at
        ? new Date(row.lease_expires_at)
        : null,
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

    const { data: existingJobs, error: lookupError } =
      await this.#serviceRoleClient
        .from<AccountDeletionJobRow>("account_deletion_jobs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);

    if (lookupError) {
      throw new RepositoryError("Failed to read the active deletion operation");
    }

    const latest = existingJobs?.[0];
    if (latest && latest.status === "completed") {
      throw new RepositoryError("Account is already deleted");
    }
    if (
      latest &&
      (latest.status === "in_progress" || latest.status === "failed")
    ) {
      throw new RepositoryError(
        "Resume the accepted account deletion operation",
      );
    }

    const { error } = await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .insert({
        user_id: userId,
        challenge_hash: challengeHash,
        status: "challenge_issued",
        stage: "none",
        worker_id: null,
        lease_expires_at: null,
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

  async getLinkedAuthIdentities(
    userId: UserId,
  ): Promise<
    readonly { readonly provider: string; readonly subject: string }[]
  > {
    const admin = (
      this.#serviceRoleClient?.auth as unknown as
        | {
            admin?: {
              getUserById?: (id: string) => Promise<{
                data: {
                  user: {
                    id: string;
                    identities?: readonly {
                      provider: string;
                      identity_id?: string;
                      identity_data?: Record<string, unknown>;
                    }[];
                  } | null;
                };
                error: unknown;
              }>;
            };
          }
        | undefined
    )?.admin;
    if (!admin?.getUserById) {
      throw new RepositoryError(
        "Trusted account identity lookup is unavailable",
      );
    }
    const { data, error } = await admin.getUserById(userId);
    if (
      error ||
      data.user?.id !== userId ||
      !Array.isArray(data.user.identities)
    ) {
      throw new RepositoryError("Trusted account identity lookup failed");
    }
    return data.user.identities.map((identity) => {
      const subject =
        identity.provider === "apple"
          ? identity.identity_data?.sub
          : (identity.identity_data?.sub ?? identity.identity_id);
      if (
        typeof identity.provider !== "string" ||
        typeof subject !== "string" ||
        !subject
      ) {
        throw new RepositoryError("Trusted account identity is incomplete");
      }
      return { provider: identity.provider, subject };
    });
  }

  async deleteUser(
    userId: UserId,
    options: {
      readonly confirmationToken: string;
      readonly now: Date;
      readonly accessToken?: string;
      readonly beforeCleanup?: (
        context: AccountDeletionCleanupContext,
      ) => Promise<void>;
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

    let job = jobs?.[0];
    if (!job) {
      return { deleted: false, reason: { kind: "confirmation_token_missing" } };
    }

    if (job.challenge_hash !== tokenHash) {
      // A newer unaccepted challenge must not hide an already accepted receipt.
      const { data: accepted, error } = await this.#serviceRoleClient
        .from<AccountDeletionJobRow>("account_deletion_jobs")
        .select("*")
        .eq("user_id", userId)
        .eq("challenge_hash", tokenHash)
        .in("status", ["in_progress", "failed", "completed"])
        .limit(1);
      if (error)
        throw new RepositoryError(
          "Failed to read the accepted deletion operation",
        );
      if (!accepted?.[0]) {
        return {
          deleted: false,
          reason: { kind: "confirmation_token_mismatch" },
        };
      }
      job = accepted[0];
    }

    // 1. Lost final response recovery: return deleted: true if already completed
    if (job.status === "completed") {
      return { deleted: true };
    }

    const workerId = crypto.randomUUID();
    const leaseExpiresAt = new Date(
      options.now.getTime() + DELETION_WORKER_LEASE_MS,
    );

    let activeStage: DeletionJobStage = job.stage;

    if (job.status === "in_progress") {
      const currentLeaseExpiry = job.lease_expires_at
        ? new Date(job.lease_expires_at).getTime()
        : 0;
      const isLeaseActive = currentLeaseExpiry > options.now.getTime();
      if (isLeaseActive) {
        throw new RepositoryError("Account deletion is already in progress");
      }

      // Resume expired lease atomically, preserving existing stage
      let resumeBuilder = this.#serviceRoleClient
        .from<AccountDeletionJobRow>("account_deletion_jobs")
        .update({
          status: "in_progress",
          worker_id: workerId,
          lease_expires_at: leaseExpiresAt.toISOString(),
          updated_at: options.now.toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "in_progress");

      if (job.lease_expires_at) {
        resumeBuilder = resumeBuilder.eq(
          "lease_expires_at",
          job.lease_expires_at,
        );
      } else {
        resumeBuilder = resumeBuilder.is("lease_expires_at", null);
      }

      const { data: resumedRows, error: resumeError } =
        await resumeBuilder.select();
      if (resumeError) {
        throw new RepositoryError(
          `Failed to resume account deletion job: ${resumeError.message}`,
        );
      }

      if (!resumedRows || resumedRows.length === 0) {
        const { data: latestJobs } = await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .select("*")
          .eq("id", job.id)
          .limit(1);
        const current = latestJobs?.[0];
        if (current?.status === "completed") {
          return { deleted: true };
        }
        throw new RepositoryError("Account deletion is already in progress");
      }
      activeStage = resumedRows[0]!.stage;
    } else if (job.status === "challenge_issued") {
      const expiresAt = new Date(job.expires_at).getTime();
      if (expiresAt <= options.now.getTime()) {
        return {
          deleted: false,
          reason: { kind: "confirmation_token_expired" },
        };
      }

      // Transition to in_progress with atomic CAS on status = 'challenge_issued'
      const { data: updatedRows, error: transitionError } =
        await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .update({
            status: "in_progress",
            stage: "none",
            worker_id: workerId,
            lease_expires_at: leaseExpiresAt.toISOString(),
            updated_at: options.now.toISOString(),
          })
          .eq("id", job.id)
          .eq("status", "challenge_issued")
          .select();

      if (transitionError) {
        if (transitionError.code === "PT410") {
          return {
            deleted: false,
            reason: { kind: "confirmation_token_expired" },
          };
        }
        throw new RepositoryError(
          `Failed to transition account deletion job: ${transitionError.message}`,
        );
      }

      if (!updatedRows || updatedRows.length === 0) {
        const { data: latestJobs } = await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .select("*")
          .eq("id", job.id)
          .limit(1);
        const current = latestJobs?.[0];
        if (current?.status === "completed") {
          return { deleted: true };
        }
        if (current?.status === "in_progress") {
          throw new RepositoryError("Account deletion is already in progress");
        }
        return {
          deleted: false,
          reason: { kind: "confirmation_token_mismatch" },
        };
      }
      activeStage = updatedRows[0]!.stage;
    } else if (job.status === "failed") {
      // Confirmation has already been accepted; its original TTL no longer applies.
      const { data: retriedRows, error: retryError } =
        await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .update({
            status: "in_progress",
            worker_id: workerId,
            lease_expires_at: leaseExpiresAt.toISOString(),
            error_message: null,
            updated_at: options.now.toISOString(),
          })
          .eq("id", job.id)
          .eq("status", "failed")
          .select();

      if (retryError) {
        throw new RepositoryError(
          `Failed to retry account deletion job: ${retryError.message}`,
        );
      }

      if (!retriedRows || retriedRows.length === 0) {
        const { data: latestJobs } = await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .select("*")
          .eq("id", job.id)
          .limit(1);
        const current = latestJobs?.[0];
        if (current?.status === "completed") {
          return { deleted: true };
        }
        throw new RepositoryError("Account deletion is already in progress");
      }
      activeStage = retriedRows[0]!.stage;
    }

    if (options.beforeCleanup) {
      const acceptedJobId = job.id;
      try {
        const cleanupContext: AccountDeletionCleanupContext = {
          jobId: job.id,
          userId,
          workerId,
          stage: activeStage,
          assertLease: async () => {
            const now = this.#clock.now();
            const { data, error } =
              await this.#serviceRoleClient!.from<AccountDeletionJobRow>(
                "account_deletion_jobs",
              )
                .update({
                  lease_expires_at: new Date(
                    now.getTime() + DELETION_WORKER_LEASE_MS,
                  ).toISOString(),
                  updated_at: now.toISOString(),
                })
                .eq("id", acceptedJobId)
                .eq("user_id", userId)
                .eq("worker_id", workerId)
                .eq("status", "in_progress")
                .gt("lease_expires_at", now.toISOString())
                .select();
            if (error || !data?.[0])
              throw new RepositoryError("Deletion worker lease is unavailable");
          },
        };
        await cleanupContext.assertLease();
        await options.beforeCleanup(cleanupContext);
        await cleanupContext.assertLease();
      } catch {
        await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .update({
            status: "failed",
            error_message: "External authorization cleanup requires retry",
            lease_expires_at: null,
            updated_at: this.#clock.now().toISOString(),
          })
          .eq("id", job.id)
          .eq("worker_id", workerId);
        throw new RepositoryError(
          "External authorization cleanup requires retry",
        );
      }
    }

    const token = options.accessToken ?? "";
    const shouldRunStorage =
      activeStage === "none" || activeStage === "storage";
    const shouldRunMemory = shouldRunStorage || activeStage === "memory";

    const sweepUserMedia = async (sweepToken: string) => {
      if (
        this.#mediaAssetRepository !== null &&
        this.#mediaStorage !== null &&
        sweepToken
      ) {
        const assets = await this.#mediaAssetRepository.list(userId, {
          purpose: null,
          limit: 10_000,
          accessToken: sweepToken,
        });
        for (const asset of assets) {
          const erasureStorage =
            asset.purpose === "food"
              ? asset.userId === userId &&
                isOwnedMealImagePath(userId, asset.bucketId, asset.objectPath)
                ? (this.#exportMediaStorage ?? this.#mediaStorage)
                : null
              : this.#mediaStorage;
          if (erasureStorage)
            await erasureStorage.remove(asset.bucketId, asset.objectPath, {
              accessToken: sweepToken,
            });
        }
      }
    };

    // Stage 1: Storage
    if (shouldRunStorage) {
      const nowWallClock = new Date();
      const { data: stageRows } = await this.#serviceRoleClient
        .from<AccountDeletionJobRow>("account_deletion_jobs")
        .update({
          status: "in_progress",
          stage: "storage",
          worker_id: workerId,
          lease_expires_at: new Date(
            nowWallClock.getTime() + DELETION_WORKER_LEASE_MS,
          ).toISOString(),
          updated_at: nowWallClock.toISOString(),
        })
        .eq("id", job.id)
        .eq("worker_id", workerId)
        .select();

      if (!stageRows || stageRows.length === 0) {
        throw new RepositoryError(
          "Worker lease lost or taken over by another worker during storage cleanup",
        );
      }

      try {
        if (this.#recipeRequestLedger) {
          const assertRecipeCleanupLease = async () => {
            const now = this.#clock.now();
            const { data, error } =
              await this.#serviceRoleClient!.from<AccountDeletionJobRow>(
                "account_deletion_jobs",
              )
                .update({
                  lease_expires_at: new Date(
                    now.getTime() + DELETION_WORKER_LEASE_MS,
                  ).toISOString(),
                })
                .eq("id", job.id)
                .eq("user_id", userId)
                .eq("worker_id", workerId)
                .eq("status", "in_progress")
                .gt("lease_expires_at", now.toISOString())
                .select();
            if (error || !data?.[0])
              throw new RepositoryError("Deletion worker lease is unavailable");
          };
          await assertRecipeCleanupLease();
          await this.#recipeRequestLedger.deleteForUser(userId);
          await assertRecipeCleanupLease();
        }
        await this.#mealIllustrationRepository?.deleteForUser(userId);
        await sweepUserMedia(token);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .update({
            status: "failed",
            stage: "storage",
            error_message: msg,
            lease_expires_at: null,
            updated_at: options.now.toISOString(),
          })
          .eq("id", job.id)
          .eq("worker_id", workerId);
        throw new RepositoryError(
          `Account deletion failed during storage cleanup: ${msg}`,
        );
      }
    }

    // Stage 2: Memory
    if (shouldRunMemory) {
      const nowWallClock = new Date();
      const { data: stageRows } = await this.#serviceRoleClient
        .from<AccountDeletionJobRow>("account_deletion_jobs")
        .update({
          status: "in_progress",
          stage: "memory",
          worker_id: workerId,
          lease_expires_at: new Date(
            nowWallClock.getTime() + DELETION_WORKER_LEASE_MS,
          ).toISOString(),
          updated_at: nowWallClock.toISOString(),
        })
        .eq("id", job.id)
        .eq("worker_id", workerId)
        .select();

      if (!stageRows || stageRows.length === 0) {
        throw new RepositoryError(
          "Worker lease lost or taken over by another worker during memory cleanup",
        );
      }

      if (this.#memoryStore !== null && token) {
        try {
          const memories = await this.#memoryStore.list(userId, {
            accessToken: token,
            includeSuperseded: true,
            limit: 10_000,
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
              lease_expires_at: null,
              updated_at: options.now.toISOString(),
            })
            .eq("id", job.id)
            .eq("worker_id", workerId);
          throw new RepositoryError(
            `Account deletion failed during memory cleanup: ${msg}`,
          );
        }
      }
    }

    // Pre-Auth reconciliation: sweep any media uploaded or orphaned in-flight
    try {
      await sweepUserMedia(token);
    } catch {
      // Best-effort cleanup of any media before auth cascade
    }

    // Stage 3: Auth admin deletion (cascades database rows)
    const nowWallClock = new Date();
    const { data: stageRows } = await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .update({
        status: "in_progress",
        stage: "auth",
        worker_id: workerId,
        lease_expires_at: new Date(
          nowWallClock.getTime() + DELETION_WORKER_LEASE_MS,
        ).toISOString(),
        updated_at: nowWallClock.toISOString(),
      })
      .eq("id", job.id)
      .eq("worker_id", workerId)
      .select();

    if (!stageRows || stageRows.length === 0) {
      throw new RepositoryError(
        "Worker lease lost or taken over by another worker during auth deletion",
      );
    }

    if (this.#communityLifecycleEnabled) {
      let complete = false;
      for (let batch = 0; batch < 20; batch++) {
        const { data, error } = await this.#serviceRoleClient.rpc<{
          deleted_count: number;
          complete: boolean;
        }>("community_account_cleanup_batch", {
          p_user_id: userId,
          p_job_id: job.id,
          p_worker_id: workerId,
          p_limit: 500,
        });
        if (error || !data?.[0]) {
          throw new RepositoryError(
            "Community account cleanup failed; retry after lease expiry",
          );
        }
        if (data[0].complete) {
          complete = true;
          break;
        }
      }
      if (!complete) {
        throw new RepositoryError(
          "Community account cleanup requires another bounded retry",
        );
      }
    }

    const adminAuth = (
      this.#serviceRoleClient.auth as unknown as {
        admin?: {
          deleteUser?: (id: string) => Promise<{
            data?: unknown;
            error?: { message: string; status?: number } | null;
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
          lease_expires_at: null,
          updated_at: options.now.toISOString(),
        })
        .eq("id", job.id)
        .eq("worker_id", workerId);
      throw new RepositoryError(msg);
    }

    const { error: authError } = await adminAuth.deleteUser(userId);
    if (authError) {
      const errMsg = authError.message || "";
      const isAbsentUser =
        errMsg.toLowerCase().includes("not found") ||
        errMsg.toLowerCase().includes("does not exist") ||
        (authError as any).status === 404;

      if (!isAbsentUser) {
        await this.#serviceRoleClient
          .from<AccountDeletionJobRow>("account_deletion_jobs")
          .update({
            status: "failed",
            stage: "auth",
            error_message: authError.message,
            lease_expires_at: null,
            updated_at: options.now.toISOString(),
          })
          .eq("id", job.id)
          .eq("worker_id", workerId);
        throw new RepositoryError(
          `Account deletion failed during auth deletion: ${authError.message}`,
        );
      }
      // If user was already absent from Auth, auth deletion is idempotently fulfilled.
    }

    // Stage 4: Mark job completed (tombstone)
    const { data: completedRows, error: completeError } =
      await this.#serviceRoleClient
        .from<AccountDeletionJobRow>("account_deletion_jobs")
        .update({
          status: "completed",
          stage: "done",
          worker_id: null,
          lease_expires_at: null,
          completed_at: options.now.toISOString(),
          updated_at: options.now.toISOString(),
          error_message: null,
        })
        .eq("id", job.id)
        .eq("worker_id", workerId)
        .eq("status", "in_progress")
        .select();

    if (completeError || !completedRows?.[0]) {
      throw new RepositoryError(
        "Account deleted in auth, but completion tombstone requires recovery",
      );
    }

    return { deleted: true };
  }

  async getDeletionJobByToken(
    confirmationToken: string,
  ): Promise<StoredDeletionJob | null> {
    if (!this.#serviceRoleClient || !confirmationToken) {
      return null;
    }
    const challengeHash = hashToken(confirmationToken);
    const { data: jobs, error } = await this.#serviceRoleClient
      .from<AccountDeletionJobRow>("account_deletion_jobs")
      .select("*")
      .eq("challenge_hash", challengeHash)
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
      workerId: row.worker_id ?? null,
      leaseExpiresAt: row.lease_expires_at
        ? new Date(row.lease_expires_at)
        : null,
      expiresAt: new Date(row.expires_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
