import type { RunRepository } from "@mizyun/core";
import { SupabaseRunRepository } from "@mizyun/adapter-supabase-server";
import { InMemoryRunRepository } from "./run-repository.js";
import { runsRoutes } from "./modules/runs/routes.js";
import { SupabaseRecurringMealRepository } from "@mizyun/adapter-supabase-server";
import type { RecurringMealRepository } from "@mizyun/core";
import { InMemoryRecurringMealRepository } from "./recurring-meal-repository.js";
import { recurringMealsRoutes } from "./modules/recurring-meals/routes.js";
import { createRecurringMealWorker } from "./modules/recurring-meals/worker.js";
import { communityMediaRoutes } from "./modules/community/media-routes.js";
import {
  SupabaseCommunityMediaService,
  createSupabaseCommunityMediaStorage,
} from "@mizyun/adapter-supabase-server";
import { communityFeatureRoutes } from "./modules/community/feature-routes.js";
import { SupabaseCommunityFeatureStatus } from "@mizyun/adapter-supabase-server";
import { communityChallengeRoutes } from "./modules/community/challenge-routes.js";
import { communityGroupRoutes } from "./modules/community/group-routes.js";
import { communityCommentRoutes } from "./modules/community/comment-routes.js";
import { communityRoutineRoutes } from "./modules/community/routine-routes.js";
import {
  SupabaseCommunityChallengesRepository,
  SupabaseCommunityGroupsRepository,
  SupabaseCommunityCommentsRepository,
  SupabaseCommunityRoutineRepository,
} from "@mizyun/adapter-supabase-server";
import { communityMessagingRoutes } from "./modules/community/messaging-routes.js";
import { communityBroaderDiscoveryRoutes } from "./modules/community/broader-discovery-routes.js";
import {
  SupabaseCommunityMessagingRepository,
  SupabaseCommunityBroaderDiscoveryRepository,
} from "@mizyun/adapter-supabase-server";
import { sendApiError } from "./errors.js";
import fs from "node:fs";
import path from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
  DisabledVisionProvider,
  StubVisionProvider,
  type AgentToolRegistry,
  type ContentModerator,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";
import {
  createSupabaseAccessTokenVerifier,
  createSupabaseRepositoryClient,
  createSupabaseStorageClient,
  SupabaseProductAnalyticsRepository,
  SupabaseCommunityNotificationRepository,
} from "@mizyun/adapter-supabase-server";
import { SesEmailSender } from "@mizyun/adapter-ses";
import {
  type AppleAuthClient,
  createAppleAuthClient,
} from "@mizyun/adapter-apple-auth";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_UNIT_SYSTEM,
  InMemoryEmailSender,
  type AccountRepository,
  type AiConsentRepository,
  type BodyMeasurementRepository,
  type CommunityRepository,
  type CommunityNotificationRepository,
  type ConversationRepository,
  type EmailSender,
  type ExerciseRepository,
  type FeedbackRepository,
  type FoodEntryRepository,
  type GoalRepository,
  type MediaAssetRepository,
  type PlanTier,
  type ProductAnalyticsRepository,
  type ProfileRepository,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";
import {
  loadServerConfig,
  loadCommunityOperations,
  type CommunityOperationsConfig,
  type ServerAppleAuthConfiguration,
  type ServerConfig,
} from "@mizyun/config";
import {
  RejectingAccessTokenVerifier,
  type AccessTokenVerifier,
} from "@mizyun/identity";
import {
  GeminiAgentProvider,
  GeminiContentModerator,
  GeminiVisionProvider,
} from "@mizyun/provider-gemini";
import type { AiProvider } from "@mizyun/contracts";

import { InMemoryAccountRepository } from "./account-repository.js";
import { InMemoryAiConsentRepository } from "./ai-consent-repository.js";
import { InMemoryGoalRepository } from "./goal-repository.js";
import { loggerConfig } from "./logging.js";
import { InMemoryMediaStorage, type MediaStorage } from "./media-storage.js";
import { SupabaseMemoryStore } from "@mizyun/adapter-supabase-server";
import { accountRoutes } from "./modules/account/routes.js";
import {
  analyticsRoutes,
  createAnalyticsRetentionWorker,
} from "./modules/analytics/index.js";
import { betaProRoutes } from "./modules/account/beta-pro-routes.js";
import { InMemoryProductAnalyticsRepository } from "./product-analytics-repository.js";
import { bodyMeasurementsRoutes } from "./modules/body-measurements/routes.js";
import { aiUsageRoutes } from "./modules/coach/ai-usage-routes.js";
import { coachMemoryRoutes } from "./modules/coach/memory-routes.js";
import { coachNutritionPhotoRoutes } from "./modules/coach/nutrition-photo-routes.js";
import { coachRoutes } from "./modules/coach/routes.js";
import {
  InMemoryCoachLimitService,
  SupabaseCoachLimitService,
  type CoachLimitService,
} from "./modules/coach/limits.js";
import { buildCoachToolRegistry } from "./modules/coach/tools.js";
import { energyRoutes } from "./modules/energy/routes.js";
import { InMemoryMemoryStore, type MemoryStore } from "@mizyun/memory";
import { exercisesRoutes } from "./modules/exercises/routes.js";
import { feedbackRoutes } from "./modules/feedback/routes.js";
import { foodEntriesRoutes } from "./modules/food-entries/routes.js";
import { foodDraftRoutes } from "./modules/food-entries/draft-route.js";
import { FoodDraftRateLimiter } from "./modules/food-entries/draft-rate-limit.js";
import { goalsRoutes } from "./modules/goals/routes.js";
import { identityRoutes } from "./modules/identity/routes.js";
import { legalRoutes } from "./modules/legal/routes.js";
import { mediaRoutes } from "./modules/media/routes.js";
import { profileRoutes } from "./modules/profile/routes.js";
import { systemRoutes } from "./modules/system/routes.js";
import { workoutsRoutes } from "./modules/workouts/routes.js";
import { workoutSetsRoutes } from "./modules/workout-sets/routes.js";
import { authenticationPlugin } from "./plugins/authentication.js";
import {
  InMemoryBetaProRepository,
  type BetaProRepository,
} from "./beta-pro-repository.js";
import { SupabaseBetaProRepository } from "./supabase-beta-pro-repository.js";
import { InMemoryBodyMeasurementRepository } from "./body-measurement-repository.js";
import { InMemoryConversationRepository } from "./conversation-repository.js";
import { InMemoryExerciseRepository } from "./exercise-repository.js";
import { InMemoryFeedbackRepository } from "./feedback-repository.js";
import { InMemoryFoodEntryRepository } from "./food-entry-repository.js";
import { InMemoryMediaAssetRepository } from "./media-asset-repository.js";
import { InMemoryProfileRepository } from "./profile-repository.js";
import { InMemoryWorkoutRepository } from "./workout-repository.js";
import { InMemoryWorkoutSetRepository } from "./workout-set-repository.js";
import { communityNotificationRoutes } from "./modules/community/notification-routes.js";
import {
  communityOperationGate,
  communityExpansionOperationGate,
} from "./modules/community/operations.js";
import { InMemoryCommunityNotificationRepository } from "./community-notification-repository.js";
import { InMemoryCommunityRepository } from "./community-repository.js";
import { communityProfileRoutes } from "./modules/community/profile-routes.js";
import { communityRelationshipRoutes } from "./modules/community/relationship-routes.js";
import {
  communityDiscoveryRoutes,
  CommunityDiscoveryRateLimiter,
} from "./modules/community/discovery-routes.js";
import { communityInvitationRoutes } from "./modules/community/invitation-routes.js";
import { communityPublicationRoutes } from "./modules/community/publication-routes.js";
import { communityFeedRoutes } from "./modules/community/feed-routes.js";
import { communityReactionRoutes } from "./modules/community/reaction-routes.js";
import { reportRoutes as communityReportRoutes } from "./modules/community/report-routes.js";
import { moderationRoutes as communityModerationRoutes } from "./modules/community/moderation-routes.js";

import {
  SupabaseProfileRepository,
  SupabaseGoalRepository,
  SupabaseFoodEntryRepository,
  SupabaseExerciseRepository,
  SupabaseFeedbackRepository,
  SupabaseWorkoutRepository,
  SupabaseWorkoutSetRepository,
  SupabaseBodyMeasurementRepository,
  SupabaseConversationRepository,
  SupabaseMediaAssetRepository,
  SupabaseAccountRepository,
  SupabaseAiConsentRepository,
  SupabaseCommunityRepository,
  SupabaseMediaStorage,
  createSupabaseServiceRoleClient,
  type RepositorySupabaseClient,
  type StorageSupabaseClient,
} from "@mizyun/adapter-supabase-server";

export interface SupabasePersistenceOptions {
  /**
   * Factory producing a per-request Supabase client bound to the
   * verified user's access token. Each call returns a fresh client
   * (no cross-request state). PERSIST-001 keeps the factory at the
   * composition-root boundary; the per-feature adapters consume it.
   */
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
  readonly storageClientFor: (accessToken: string) => StorageSupabaseClient;
  readonly serviceRoleClient?: RepositorySupabaseClient | null;
  readonly publicUrl?: string;
}

export interface CoachControlOptions {
  readonly dailyUserTokenBudget?: number;
  readonly userRequestsPerMinute?: number;
  readonly userMaxConcurrentRequests?: number;
  readonly now?: () => Date;
  /**
   * Optional test/dev override for the per-user plan tier.
   * Production leaves this undefined; the route reads the tier
   * from the profile. Set via `AI_USER_TIER_OVERRIDE` in dev.
   */
  readonly planTierOverride?: PlanTier;
  /**
   * Optional injection of the limiter service. When omitted, the
   * composition root builds one from `supabasePersistence` (or an
   * in-memory fallback when Supabase is not configured).
   */
  readonly limits?: CoachLimitService;
  /**
   * Optional injection of the read-only agent tool registry
   * (AI-002). When omitted, the composition root builds the
   * default Coach tool registry against the resolved
   * repositories. Tests may pass an empty registry to bypass
   * the loop.
   */
  readonly agentTools?: AgentToolRegistry;
  /**
   * Optional injection of the long-lived memory store used by
   * both the orchestrator (to populate the prompt) and the
   * `/v1/coach/memories/...` routes (the user-facing controls
   * API). When omitted, the composition root builds an
   * in-memory store; the Supabase-backed store is wired when
   * `supabasePersistence` is configured.
   */
  readonly memoryStore?: MemoryStore;
  /**
   * Optional injection of the photo-draft vision provider
   * (VISION-001). When omitted, the composition root builds a
   * `GeminiVisionProvider` (if `GEMINI_VISION_API_KEY` or
   * `GEMINI_API_KEY` is configured) or a `DisabledVisionProvider`
   * otherwise. Tests pass a `StubVisionProvider` to drive deterministic drafts.
   */
  readonly visionProvider?: VisionDraftProvider;
  /**
   * Optional injection of the food-draft rate limiter
   * (VISION-001). When omitted, the composition root builds a
   * fresh in-memory sliding window. Tests share a single
   * instance to assert ordering between consecutive calls.
   */
  readonly draftRateLimiter?: FoodDraftRateLimiter;
  /**
   * Optional resolver for the principal's plan tier. Production
   * reads `profiles.plan_tier`; tests inject a stub.
   */
  readonly resolvePlanTier?: (userId: UserId) => PlanTier;
}

export interface AppDependencies {
  readonly communityOperations?: CommunityOperationsConfig;
  /**
   * Pre-constructed orchestrator. When supplied, `buildApp`
   * uses it as-is. When omitted, `buildApp` constructs one
   * with the default tool registry wired against the
   * resolved repositories (AI-002).
   */
  readonly agent?: AgentOrchestrator;
  /**
   * Provider + memory store used when `agent` is not
   * supplied. `defaultDependencies` exposes these so
   * `buildApp` can wire the tool registry after the repos
   * are resolved.
   */
  readonly provider?: import("@mizyun/agent-runtime").AgentProvider;
  readonly memories?: import("@mizyun/memory").MemoryStore;
  /**
   * Optional provider-neutral input/output moderator used only when
   * `agent` is not supplied. The default composition wires Gemini
   * moderation alongside a configured Gemini text provider.
   */
  readonly moderator?: ContentModerator;
  /**
   * Optional pre-constructed vision provider (VISION-001).
   * Production wires `GeminiVisionProvider` (when `GEMINI_VISION_API_KEY`
   * or `GEMINI_API_KEY` is configured) or a `DisabledVisionProvider` (otherwise).
   */
  readonly visionProvider?: import("@mizyun/agent-runtime").VisionDraftProvider;
  readonly tokenVerifier: AccessTokenVerifier;
  /**
   * Optional. When omitted, `buildApp` falls back to the in-memory
   * implementation. Tests that need to exercise the route layer in
   * isolation may pass a stub; production wiring supplies the Supabase
   * adapter (PERSIST-001 for profile/goal/food; PERSIST-002 for the
   * rest in a follow-up segment).
   */
  readonly profileRepository?: ProfileRepository;
  readonly goalRepository?: GoalRepository;
  readonly foodEntryRepository?: FoodEntryRepository;
  readonly recurringMealRepository?: RecurringMealRepository;
  readonly exerciseRepository?: ExerciseRepository;
  readonly workoutRepository?: WorkoutRepository;
  readonly runRepository?: RunRepository;
  readonly workoutSetRepository?: WorkoutSetRepository;
  readonly bodyMeasurementRepository?: BodyMeasurementRepository;
  readonly conversationRepository?: ConversationRepository;
  readonly feedbackRepository?: FeedbackRepository;
  readonly accountRepository?: AccountRepository;
  readonly betaProRepository?: BetaProRepository;
  readonly communityRepository?: CommunityRepository;
  readonly communityNotifications?: CommunityNotificationRepository;
  readonly aiConsentRepository?: AiConsentRepository;
  readonly productAnalyticsRepository?: ProductAnalyticsRepository;
  readonly mediaAssetRepository?: MediaAssetRepository;
  readonly mediaStorage?: MediaStorage;
  readonly emailSender?: EmailSender;
  readonly appleAuthConfig?: ServerAppleAuthConfiguration | undefined;
  readonly appleAuthClient?: AppleAuthClient | undefined;
  readonly coachControls?: CoachControlOptions;
  readonly aiAllowedEmails?: readonly string[];
  /**
   * When provided, the per-feature adapters swap to the Supabase
   * implementations. In-memory remains the default so the standard
   * `pnpm check` gate is green without Docker. PERSIST-001.
   */
  readonly supabasePersistence?: SupabasePersistenceOptions;
}

const tokenVerifierFromConfig = (config: ServerConfig): AccessTokenVerifier => {
  if (config.supabase.configured && config.supabaseConfig) {
    return createSupabaseAccessTokenVerifier(config.supabaseConfig);
  }
  return new RejectingAccessTokenVerifier();
};

const defaultDependencies = (): AppDependencies => {
  const result = loadServerConfig();
  // `server.ts` already exits if this fails, but we re-read here so the
  // composition root can be exercised by tests with an injected env.
  const config: ServerConfig = result.ok
    ? result.value
    : {
        host: "127.0.0.1",
        port: 4000,
        env: "development",
        supabase: { configured: false, provider: "supabase", reason: "" },
        supabaseConfig: null,
        agentProvider: "disabled",
        visionProvider: "disabled",
        geminiConfig: null,
        geminiVisionConfig: null,
        sesConfig: null,
        appleAuthConfig: null,
        aiExternalAccess: false,
        aiAllowedEmails: [],
      };
  const geminiConfig = config.geminiConfig;
  const emailSender: EmailSender =
    config.sesConfig !== null
      ? new SesEmailSender({
          region: config.sesConfig.region,
          defaultFromEmail: config.sesConfig.fromEmail,
          credentials: {
            accessKeyId: config.sesConfig.accessKeyId,
            secretAccessKey: config.sesConfig.secretAccessKey,
          },
        })
      : new InMemoryEmailSender();
  const provider =
    geminiConfig !== null && config.agentProvider === "gemini"
      ? new GeminiAgentProvider({
          apiKey: geminiConfig.apiKey,
          model: geminiConfig.model,
          ...(geminiConfig.fallbackModel
            ? { fallbackModel: geminiConfig.fallbackModel }
            : {}),
          thinkingBudget: geminiConfig.thinkingBudget,
          timeoutMs: geminiConfig.timeoutMs,
          maxOutputTokens: geminiConfig.maxOutputTokens,
          externalAccess: config.aiExternalAccess,
        })
      : new DisabledAgentProvider();
  // The default memory store is in-memory. When Supabase is
  // configured, the buildApp step swaps it for a Supabase-backed
  // store below; we leave the in-memory default here so dev/test
  // paths stay zero-config.
  const base = {
    provider,
    emailSender,
    memories: new InMemoryMemoryStore() as MemoryStore,
    tokenVerifier: tokenVerifierFromConfig(config),
    ...(geminiConfig !== null && config.agentProvider === "gemini"
      ? {
          moderator: new GeminiContentModerator({
            externalAccess: config.aiExternalAccess,
          }),
        }
      : {}),
  };
  // VISION-001 — default vision provider for the dev/test path.
  // When `VISION_PROVIDER=stub` is set we wire the deterministic
  // StubVisionProvider so the smoke can hit the
  // /v1/food-entries/draft endpoint without an external Gemini
  // key. Production wires GeminiVisionProvider via `coachControls`
  // (see buildApp).
  if (config.visionProvider === "stub") {
    Object.assign(base, {
      visionProvider: new StubVisionProvider(),
    });
  }
  if (config.supabase.configured && config.supabaseConfig) {
    const supabaseConfig = config.supabaseConfig;
    const serviceRoleClient =
      supabaseConfig.serviceRoleKey !== undefined
        ? createSupabaseServiceRoleClient({
            url: supabaseConfig.url,
            publishableKey: supabaseConfig.publishableKey,
            serviceRoleKey: supabaseConfig.serviceRoleKey,
          })
        : null;
    return {
      ...base,
      memories: new SupabaseMemoryStore({
        clientFor: (accessToken: string) =>
          createSupabaseRepositoryClient(supabaseConfig, accessToken),
      }),
      supabasePersistence: {
        clientFor: (accessToken: string) =>
          createSupabaseRepositoryClient(supabaseConfig, accessToken),
        storageClientFor: (accessToken: string) =>
          createSupabaseStorageClient(supabaseConfig, accessToken),
        serviceRoleClient,
        ...(supabaseConfig.publicUrl
          ? { publicUrl: supabaseConfig.publicUrl }
          : {}),
      },
    };
  }
  return {
    ...base,
    // Default profile repository: in-memory. The Supabase adapter lands
    // in a follow-up segment once we have a verified RLS story for the
    // profile row.
    profileRepository: new InMemoryProfileRepository({
      defaultTimezone: DEFAULT_TIMEZONE,
      defaultUnitSystem: DEFAULT_UNIT_SYSTEM,
      defaultBirthYear: 1990,
    }),
    goalRepository: new InMemoryGoalRepository(),
    foodEntryRepository: new InMemoryFoodEntryRepository(),
    exerciseRepository: new InMemoryExerciseRepository(),
    workoutRepository: new InMemoryWorkoutRepository(),
    workoutSetRepository: new InMemoryWorkoutSetRepository(),
    bodyMeasurementRepository: new InMemoryBodyMeasurementRepository(),
    feedbackRepository: new InMemoryFeedbackRepository(),
  };
};

/**
 * Resolve the plan tier override from the dev-only env knob.
 * Production never sets this; the dev container may.
 */
const readPlanTierOverride = (): PlanTier | undefined => {
  const raw = process.env.AI_USER_TIER_OVERRIDE;
  if (raw === "free" || raw === "paid") return raw;
  return undefined;
};

/**
 * Resolve the long-lived memory store used by the orchestrator
 * (prompt recall) and the `/v1/coach/memories` routes. Tests may
 * inject a custom store via `coachControls.memoryStore`;
 * otherwise the orchestrator's `dependencies.memories` is the
 * default, falling back to a fresh in-memory store.
 */
const resolveMemoryStore = (dependencies: AppDependencies): MemoryStore =>
  dependencies.coachControls?.memoryStore ??
  dependencies.memories ??
  new InMemoryMemoryStore();

/**
 * Pick the orchestrator for the request. When `dependencies.agent`
 * is supplied, use it as-is (tests). Otherwise build a fresh
 * orchestrator around the default provider + memory store and
 * the supplied tool registry. The orchestrator only sees tools
 * when the registry has at least one definition; empty
 * registries skip the tool-loop entirely (cheaper for tests).
 */
const COACH_MAX_TOOL_ROUND_TRIPS = 5;

const createAgentOrchestrator = (
  dependencies: AppDependencies,
  defaultToolSet: AgentToolRegistry,
): AgentOrchestrator => {
  if (dependencies.agent !== undefined) {
    return dependencies.agent;
  }
  const provider = dependencies.provider ?? new DisabledAgentProvider();
  const memories = dependencies.memories ?? new InMemoryMemoryStore();
  const tools = defaultToolSet.list().length === 0 ? undefined : defaultToolSet;
  return new AgentOrchestrator({
    provider,
    memories,
    maxToolCalls: COACH_MAX_TOOL_ROUND_TRIPS,
    ...(dependencies.moderator ? { moderator: dependencies.moderator } : {}),
    ...(tools ? { tools } : {}),
  });
};

/**
 * Re-export `UserId` so app composition root callers can cast string
 * principals without importing the upstream type.
 */
export type { UserId };

export const buildApp = (
  dependencies: AppDependencies = defaultDependencies(),
): FastifyInstance => {
  // Logger is configured from the validated NODE_ENV rather than reading
  // `process.env` directly. The composition root is responsible for exiting
  // the process on invalid configuration before `buildApp` runs; tests
  // pass an explicit `dependencies` so the env is never read here.
  const configResult = loadServerConfig();
  const env = configResult.ok ? configResult.value.env : "development";
  const aiAllowedEmails =
    dependencies.aiAllowedEmails ??
    (configResult.ok ? configResult.value.aiAllowedEmails : []);
  const logger = loggerConfig(env);

  const app = Fastify({
    ...logger,
    requestIdHeader: "x-request-id",
  });

  app.setErrorHandler((error, request, reply) => {
    // The redaction-stripping serializer in `./logging.ts` already
    // strips `cause` chains before the line reaches stdout. We log a
    // structured entry with just the safe fields and surface the
    // generic INTERNAL_ERROR body to the caller.
    request.log.error({ error }, "request failed");
    void reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: request.id,
      },
    });
  });

  // Resolve every per-feature repository once so the
  // account-deletion orchestrator can see the same instances the
  // per-feature routes use. Tests that pass a custom dependency
  // for any single repo see it reflected here.
  //
  // PERSIST-001: when `dependencies.supabasePersistence` is set, the
  // per-feature adapters swap to the Supabase implementations. An
  // explicit `dependencies.profileRepository` (etc.) still wins so
  // a test can override a single repo without flipping the others.
  const sp = dependencies.supabasePersistence;
  const profileRepository =
    dependencies.profileRepository ??
    (sp
      ? new SupabaseProfileRepository({ clientFor: sp.clientFor })
      : new InMemoryProfileRepository({
          defaultTimezone: DEFAULT_TIMEZONE,
          defaultUnitSystem: DEFAULT_UNIT_SYSTEM,
          defaultBirthYear: 1990,
        }));
  const goalRepository =
    dependencies.goalRepository ??
    (sp
      ? new SupabaseGoalRepository({ clientFor: sp.clientFor })
      : new InMemoryGoalRepository());
  const foodEntryRepository =
    dependencies.foodEntryRepository ??
    (sp
      ? new SupabaseFoodEntryRepository({ clientFor: sp.clientFor })
      : new InMemoryFoodEntryRepository());
  const recurringMealRepository =
    dependencies.recurringMealRepository ??
    (sp
      ? new SupabaseRecurringMealRepository(sp.clientFor)
      : new InMemoryRecurringMealRepository(foodEntryRepository));
  if (sp?.serviceRoleClient) {
    const serviceClient = sp.serviceRoleClient;
    const worker = createRecurringMealWorker(
      async () => {
        const result = await serviceClient.rpc("recurring_meal_tick", {});
        if (result.error) throw new Error("Recurring meal tick failed");
      },
      () =>
        app.log.error("Recurring meal scheduler failed; retrying next minute"),
    );
    app.addHook("onListen", async () => {
      worker.start();
    });
    app.addHook("onClose", async () => {
      await worker.close();
    });
  }
  const exerciseRepository =
    dependencies.exerciseRepository ??
    (sp
      ? new SupabaseExerciseRepository({ clientFor: sp.clientFor })
      : new InMemoryExerciseRepository());
  const workoutRepository =
    dependencies.workoutRepository ??
    (sp
      ? new SupabaseWorkoutRepository({ clientFor: sp.clientFor })
      : new InMemoryWorkoutRepository());
  const runRepository =
    dependencies.runRepository ??
    (sp
      ? new SupabaseRunRepository(sp.clientFor)
      : new InMemoryRunRepository(workoutRepository));
  const workoutSetRepository =
    dependencies.workoutSetRepository ??
    (sp
      ? new SupabaseWorkoutSetRepository({ clientFor: sp.clientFor })
      : new InMemoryWorkoutSetRepository());
  const bodyMeasurementRepository =
    dependencies.bodyMeasurementRepository ??
    (sp
      ? new SupabaseBodyMeasurementRepository({ clientFor: sp.clientFor })
      : new InMemoryBodyMeasurementRepository());
  const conversationRepository =
    dependencies.conversationRepository ??
    (sp
      ? new SupabaseConversationRepository({ clientFor: sp.clientFor })
      : new InMemoryConversationRepository());
  const feedbackRepository =
    dependencies.feedbackRepository ??
    (sp
      ? new SupabaseFeedbackRepository({ clientFor: sp.clientFor })
      : new InMemoryFeedbackRepository());
  const mediaAssetRepository =
    dependencies.mediaAssetRepository ??
    (sp
      ? new SupabaseMediaAssetRepository({ clientFor: sp.clientFor })
      : new InMemoryMediaAssetRepository());
  // The bucket id matches the SQL migration; a Supabase swap
  // reads the same id from `storage.buckets`. The local
  // composition root hard-codes it for now.
  const mediaStorage =
    dependencies.mediaStorage ??
    (sp
      ? new SupabaseMediaStorage({
          clientFor: sp.storageClientFor,
          ...(sp.publicUrl ? { publicUrl: sp.publicUrl } : {}),
        })
      : new InMemoryMediaStorage());
  const MEDIA_BUCKET_ID = "private-media";

  const aiConsentRepository =
    dependencies.aiConsentRepository ??
    (sp
      ? new SupabaseAiConsentRepository({
          clientFor: sp.clientFor,
          ...(sp.serviceRoleClient ? { client: sp.serviceRoleClient } : {}),
        })
      : new InMemoryAiConsentRepository({ defaultGranted: true }));

  const betaProRepository: BetaProRepository =
    dependencies.betaProRepository ??
    (sp
      ? new SupabaseBetaProRepository({
          clientFor: sp.clientFor,
          ...(sp.serviceRoleClient
            ? { serviceClient: sp.serviceRoleClient }
            : {}),
        })
      : new InMemoryBetaProRepository());

  const communityRepository: CommunityRepository =
    dependencies.communityRepository ??
    (sp
      ? new SupabaseCommunityRepository({ clientFor: sp.clientFor })
      : new InMemoryCommunityRepository());

  const communityNotifications =
    dependencies.communityNotifications ??
    (sp
      ? new SupabaseCommunityNotificationRepository(sp.clientFor)
      : new InMemoryCommunityNotificationRepository());

  const productAnalyticsRepository: ProductAnalyticsRepository =
    dependencies.productAnalyticsRepository ??
    (sp
      ? new SupabaseProductAnalyticsRepository({
          clientFor: sp.clientFor,
          ...(sp.serviceRoleClient ? { client: sp.serviceRoleClient } : {}),
        })
      : new InMemoryProductAnalyticsRepository());

  if (sp?.serviceRoleClient) {
    const analyticsRetention = createAnalyticsRetentionWorker(
      productAnalyticsRepository,
      () =>
        app.log.error("Analytics retention cleanup failed; retrying next hour"),
    );
    app.addHook("onListen", async () => {
      analyticsRetention.start();
    });
    app.addHook("onClose", async () => {
      await analyticsRetention.close();
    });
  }

  const accountRepository =
    dependencies.accountRepository ??
    (sp
      ? new SupabaseAccountRepository({
          communityLifecycleEnabled: true,
          profileRepository,
          goalRepository,
          foodEntryRepository,
          exerciseRepository,
          workoutRepository,
          workoutSetRepository,
          bodyMeasurementRepository,
          conversationRepository,
          feedbackRepository,
          mediaAssetRepository,
          mediaStorage,
          memoryStore: resolveMemoryStore(dependencies),
          aiConsentRepository,
          productAnalyticsRepository,
          serviceRoleClient: sp.serviceRoleClient ?? null,
          clientFor: sp.clientFor,
        })
      : new InMemoryAccountRepository({
          recurringMealRepository,
          runRepository,
          profileRepository,
          goalRepository,
          foodEntryRepository,
          exerciseRepository,
          workoutRepository,
          workoutSetRepository,
          bodyMeasurementRepository,
          conversationRepository,
          feedbackRepository,
          mediaAssetRepository,
          mediaStorage,
          memoryStore: resolveMemoryStore(dependencies),
          aiConsentRepository,
          productAnalyticsRepository,
        }));

  const emailSender =
    dependencies.emailSender ??
    (configResult.ok && configResult.value.sesConfig !== null
      ? new SesEmailSender({
          region: configResult.value.sesConfig.region,
          defaultFromEmail: configResult.value.sesConfig.fromEmail,
          credentials: {
            accessKeyId: configResult.value.sesConfig.accessKeyId,
            secretAccessKey: configResult.value.sesConfig.secretAccessKey,
          },
        })
      : new InMemoryEmailSender());

  // AI-002: build the read-only Coach tool registry against
  // the resolved repositories. When `dependencies.agent` is
  // supplied (tests injecting a fully custom orchestrator),
  // the registry is unused. Otherwise build the default
  // registry against the wired repos and pass it into a
  // freshly-constructed orchestrator that owns the default
  // provider + memory store.
  const defaultToolSet = buildCoachToolRegistry({
    runRepository,
    profileRepository,
    goalRepository,
    workoutRepository,
    workoutSetRepository,
    foodEntryRepository,
    bodyMeasurementRepository,
  });
  const agent = createAgentOrchestrator(dependencies, defaultToolSet);

  void app.register(authenticationPlugin, {
    tokenVerifier: dependencies.tokenVerifier,
  });

  // VISION-001 — multipart support for the photo-draft endpoint.
  // 15 MiB per file (matches the private-media bucket policy);
  // the route rejects anything larger.
  void app.register(fastifyMultipart, {
    limits: {
      fileSize: 15 * 1024 * 1024,
      files: 1,
      fields: 4,
    },
  });

  // VISION-001 — build the vision provider. Default is the
  // disabled provider (returns VisionProviderError("not_configured")
  // so the route returns 503 AI_CONFIGURATION_ERROR). The dev
  // stub returns a deterministic candidate. GeminiVisionProvider
  // is wired when GEMINI_VISION_API_KEY or GEMINI_API_KEY is configured.
  const geminiVisionProvider =
    configResult.ok && configResult.value.geminiVisionConfig !== null
      ? new GeminiVisionProvider({
          apiKey: configResult.value.geminiVisionConfig.apiKey,
          model: configResult.value.geminiVisionConfig.model,
          fallbackModel: configResult.value.geminiVisionConfig.fallbackModel,
          thinkingBudget: configResult.value.geminiVisionConfig.thinkingBudget,
          timeoutMs: configResult.value.geminiVisionConfig.timeoutMs,
          maxOutputTokens:
            configResult.value.geminiVisionConfig.maxOutputTokens,
          externalAccess: configResult.value.aiExternalAccess,
          enableSearchGrounding:
            configResult.value.geminiVisionConfig.searchGrounding,
        })
      : null;

  const visionProvider: VisionDraftProvider = dependencies.coachControls
    ?.visionProvider
    ? dependencies.coachControls.visionProvider
    : dependencies.visionProvider
      ? dependencies.visionProvider
      : (geminiVisionProvider ?? new DisabledVisionProvider());

  const resolveVisionProvider = (
    _providerKind?: AiProvider,
  ): VisionDraftProvider => {
    if (dependencies.coachControls?.visionProvider) {
      return dependencies.coachControls.visionProvider;
    }
    if (dependencies.visionProvider) {
      return dependencies.visionProvider;
    }
    if (geminiVisionProvider !== null) {
      return geminiVisionProvider;
    }
    return visionProvider;
  };

  const geminiAgent =
    configResult.ok && configResult.value.geminiConfig !== null
      ? new AgentOrchestrator({
          provider: new GeminiAgentProvider({
            apiKey: configResult.value.geminiConfig.apiKey,
            model: configResult.value.geminiConfig.model,
            ...(configResult.value.geminiConfig.fallbackModel
              ? {
                  fallbackModel: configResult.value.geminiConfig.fallbackModel,
                }
              : {}),
            thinkingBudget: configResult.value.geminiConfig.thinkingBudget,
            timeoutMs: configResult.value.geminiConfig.timeoutMs,
            maxOutputTokens: configResult.value.geminiConfig.maxOutputTokens,
            externalAccess: configResult.value.aiExternalAccess,
          }),
          memories: resolveMemoryStore(dependencies),
          maxToolCalls: COACH_MAX_TOOL_ROUND_TRIPS,
          moderator: new GeminiContentModerator({
            externalAccess: configResult.value.aiExternalAccess,
          }),
          ...(defaultToolSet.list().length > 0
            ? { tools: defaultToolSet }
            : {}),
        })
      : null;

  const resolveAgent = (_providerKind?: AiProvider): AgentOrchestrator => {
    if (dependencies.agent !== undefined) {
      return dependencies.agent;
    }
    if (geminiAgent !== null) {
      return geminiAgent;
    }
    return agent;
  };

  const draftRateLimiter =
    dependencies.coachControls?.draftRateLimiter ?? new FoodDraftRateLimiter();
  const resolvePlanTier =
    dependencies.coachControls?.resolvePlanTier ??
    ((userId) => {
      void userId;
      const override = process.env.AI_USER_TIER_OVERRIDE;
      if (override === "free" || override === "paid") return override;
      return "free";
    });

  // Resolve once so account export/deletion and Coach recall/control
  // operate on the exact same memory backing store.
  const memoryStore: MemoryStore = resolveMemoryStore(dependencies);

  // Build the limiter service. Production wires the Supabase
  // implementation against the service-role client; tests fall back
  // to the in-memory implementation unless they pass an override.
  const buildLimits = (): CoachLimitService => {
    if (dependencies.coachControls?.limits) {
      return dependencies.coachControls.limits;
    }
    const clock = dependencies.coachControls?.now ?? (() => new Date());
    const supabaseConfig =
      configResult.ok && configResult.value.supabaseConfig
        ? configResult.value.supabaseConfig
        : null;
    if (sp && supabaseConfig && supabaseConfig.serviceRoleKey) {
      return new SupabaseCoachLimitService({
        serviceClient: createSupabaseServiceRoleClient({
          url: supabaseConfig.url,
          publishableKey: supabaseConfig.publishableKey,
          serviceRoleKey: supabaseConfig.serviceRoleKey,
        }),
        clock,
      });
    }
    return new InMemoryCoachLimitService({
      clock,
      ...(dependencies.coachControls?.dailyUserTokenBudget !== undefined ||
      dependencies.coachControls?.userRequestsPerMinute !== undefined ||
      dependencies.coachControls?.userMaxConcurrentRequests !== undefined ||
      dependencies.coachControls?.draftRateLimiter !== undefined
        ? {
            capOverrides: {
              ...(dependencies.coachControls?.dailyUserTokenBudget !== undefined
                ? {
                    dailyTokenBudget:
                      dependencies.coachControls.dailyUserTokenBudget,
                  }
                : {}),
              ...(dependencies.coachControls?.userRequestsPerMinute !==
              undefined
                ? {
                    requestsPerMinute:
                      dependencies.coachControls.userRequestsPerMinute,
                  }
                : {}),
              ...(dependencies.coachControls?.userMaxConcurrentRequests !==
              undefined
                ? {
                    maxConcurrentRequests:
                      dependencies.coachControls.userMaxConcurrentRequests,
                  }
                : {}),
              ...(dependencies.coachControls?.draftRateLimiter !== undefined
                ? {
                    photoDraftDailyLimit:
                      dependencies.coachControls.draftRateLimiter.dailyLimit(
                        "free",
                      ),
                  }
                : {}),
            },
          }
        : {}),
    });
  };

  const coachLimits = buildLimits();

  void app.register(systemRoutes, { prefix: "/v1" });
  void app.register(legalRoutes, { prefix: "/legal" });
  void app.register(identityRoutes, { prefix: "/v1" });
  void app.register(profileRoutes, {
    prefix: "/v1/profile",
    profileRepository,
  });
  void app.register(goalsRoutes, {
    prefix: "/v1/goals",
    goalRepository,
  });
  void app.register(foodEntriesRoutes, {
    prefix: "/v1/food-entries",
    foodEntryRepository,
    betaProRepository,
    profileRepository,
  });
  void app.register(recurringMealsRoutes, {
    prefix: "/v1/recurring-meals",
    recurringMealRepository,
    available:
      !!sp?.serviceRoleClient ||
      (!!dependencies.recurringMealRepository && !sp),
  });
  void app.register(foodDraftRoutes, {
    prefix: "/v1/food-entries",
    visionProvider,
    resolveVisionProvider,
    profileRepository,
    betaProRepository,
    aiConsentRepository,
    rateLimiter: draftRateLimiter,
    limits: coachLimits,
    resolvePlanTier,
    allowedEmails: aiAllowedEmails,
  });
  void app.register(exercisesRoutes, {
    prefix: "/v1/exercises",
    exerciseRepository,
  });
  void app.register(runsRoutes, { prefix: "/v1/runs", runRepository });
  void app.register(workoutsRoutes, {
    prefix: "/v1/workouts",
    workoutRepository,
    communityRepository,
  });

  void app.register(bodyMeasurementsRoutes, {
    prefix: "/v1/body-measurements",
    bodyMeasurementRepository,
  });
  void app.register(workoutSetsRoutes, {
    prefix: "/v1",
    workoutSetRepository,
    workoutRepository,
    exerciseRepository,
  });
  const rawAppleConfig =
    dependencies.appleAuthConfig ??
    (configResult.ok ? configResult.value.appleAuthConfig : null);
  const resolveAppleConfig = (
    configured: ServerAppleAuthConfiguration | null,
  ): ServerAppleAuthConfiguration | null => {
    if (configured) return configured;
    const teamId = process.env.APPLE_TEAM_ID;
    const keyId = process.env.APPLE_KEY_ID;
    if (!teamId || !keyId) return null;
    const clientId =
      process.env.APPLE_CLIENT_ID ||
      (configResult.ok && configResult.value.env === "production"
        ? "com.mizyun.app"
        : "com.mizyun.development");
    const candidates = [
      process.env.APPLE_PRIVATE_KEY_PATH,
      path.resolve(process.cwd(), `certs/AuthKey_${keyId}.p8`),
    ].filter((p): p is string => Boolean(p));

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const privateKey = fs.readFileSync(candidate, "utf-8");
          if (privateKey.length >= 20) {
            return { teamId, keyId, privateKey, clientId };
          }
        }
      } catch {
        // Ignored
      }
    }
    return null;
  };
  const effectiveAppleAuthConfig = resolveAppleConfig(rawAppleConfig);
  const appleAuth =
    effectiveAppleAuthConfig !== null
      ? {
          config: effectiveAppleAuthConfig,
          client: dependencies.appleAuthClient ?? createAppleAuthClient(),
        }
      : undefined;

  void app.register(accountRoutes, {
    prefix: "/v1",
    accountRepository,
    memoryStore,
    aiConsentRepository,
    profileRepository,
    appleAuth,
  });
  void app.register(energyRoutes, {
    prefix: "/v1",
    profileRepository,
    goalRepository,
    bodyMeasurementRepository,
    workoutRepository,
    workoutSetRepository,
    foodEntryRepository,
  });
  void app.register(mediaRoutes, {
    prefix: "/v1",
    mediaAssetRepository,
    mediaStorage,
    bucketId: MEDIA_BUCKET_ID,
  });
  void app.register(feedbackRoutes, {
    prefix: "/v1/feedback",
    feedbackRepository,
  });
  void app.register(aiUsageRoutes, {
    prefix: "/v1",
    coachLimits: coachLimits,
    profileRepository,
    ...(dependencies.coachControls?.planTierOverride
      ? { planTierOverride: dependencies.coachControls.planTierOverride }
      : readPlanTierOverride()
        ? { planTierOverride: readPlanTierOverride() }
        : {}),
    ...(dependencies.coachControls?.now
      ? { now: dependencies.coachControls.now }
      : {}),
  });
  void app.register(betaProRoutes, {
    prefix: "/v1",
    repository: betaProRepository,
  });
  void app.register(analyticsRoutes, {
    prefix: "/v1/analytics",
    productAnalyticsRepository,
  });
  const communityOperations =
    dependencies.communityOperations ?? loadCommunityOperations(process.env);
  app.addHook("preValidation", async (request, reply) => {
    const removingReaction =
      /\/reaction(?:s)?$/.test(request.url.split("?")[0] ?? "") &&
      request.body !== null &&
      typeof request.body === "object" &&
      (request.body as { reaction?: unknown }).reaction === null;
    const gate = removingReaction
      ? null
      : (communityExpansionOperationGate(
          request.method,
          request.url,
          request.body,
        ) ?? communityOperationGate(request.method, request.url));
    if (gate && !communityOperations[gate])
      return sendApiError(
        reply,
        request,
        503,
        "SERVICE_UNAVAILABLE",
        "Community action is temporarily unavailable.",
      );
  });
  void app.register(communityFeatureRoutes, {
    prefix: "/v1/community",
    read: sp
      ? (token) => new SupabaseCommunityFeatureStatus(sp.clientFor).read(token)
      : async () => [],
  });
  const mediaConfig = configResult.ok
    ? configResult.value.supabaseConfig
    : null;
  if (sp?.serviceRoleClient && mediaConfig?.serviceRoleKey) {
    void app.register(communityMediaRoutes, {
      prefix: "/v1/community",
      media: new SupabaseCommunityMediaService({
        clientFor: sp.clientFor,
        serviceClient: sp.serviceRoleClient,
        storage: createSupabaseCommunityMediaStorage({
          url: mediaConfig.url,
          serviceRoleKey: mediaConfig.serviceRoleKey,
        }),
      }),
    });
  }
  if (sp) {
    void app.register(communityGroupRoutes, {
      prefix: "/v1/community",
      groups: new SupabaseCommunityGroupsRepository(sp.clientFor),
    });
    void app.register(communityCommentRoutes, {
      prefix: "/v1/community",
      comments: new SupabaseCommunityCommentsRepository(sp.clientFor),
    });
    void app.register(communityRoutineRoutes, {
      prefix: "/v1/community",
      routines: new SupabaseCommunityRoutineRepository(sp.clientFor),
    });
  }
  void app.register(communityChallengeRoutes, {
    prefix: "/v1/community",
    repository: sp
      ? new SupabaseCommunityChallengesRepository(sp.clientFor)
      : null,
  });
  void app.register(communityMessagingRoutes, {
    prefix: "/v1/community",
    repository: sp
      ? new SupabaseCommunityMessagingRepository(sp.clientFor)
      : null,
  });
  void app.register(communityBroaderDiscoveryRoutes, {
    prefix: "/v1/community",
    repository: sp
      ? new SupabaseCommunityBroaderDiscoveryRepository(sp.clientFor)
      : null,
  });
  void app.register(communityNotificationRoutes, {
    prefix: "/v1/community",
    notifications: communityNotifications,
  });
  void app.register(communityProfileRoutes, {
    prefix: "/v1/community",
    communityRepository,
    profileRepository,
  });
  void app.register(communityRelationshipRoutes, {
    prefix: "/v1/community",
    communityRepository,
  });
  const discoveryRateLimiter = new CommunityDiscoveryRateLimiter();
  void app.register(communityDiscoveryRoutes, {
    prefix: "/v1/community",
    communityRepository,
    discoveryRateLimiter,
  });
  void app.register(communityInvitationRoutes, {
    prefix: "/v1/community",
    communityRepository,
    discoveryRateLimiter,
    invitationScheme:
      configResult.ok &&
      new URL(
        configResult.value.supabaseConfig?.publicUrl ?? "https://invalid.local",
      ).hostname === "mizyun-supabase-dev.phiskel.com"
        ? "mizyun-dev"
        : "mizyun",
  });
  void app.register(communityPublicationRoutes, {
    workoutSetRepository,
    exerciseRepository,
    prefix: "/v1/community",
    communityRepository,
    profileRepository,
    workoutRepository,
  });
  void app.register(communityFeedRoutes, {
    prefix: "/v1/community",
    communityRepository,
  });
  void app.register(communityReactionRoutes, {
    prefix: "/v1/community",
    communityRepository,
  });
  void app.register(communityReportRoutes, {
    prefix: "/v1/community",
    communityRepository,
  });
  void app.register(communityModerationRoutes, {
    prefix: "/v1/community",
    communityRepository,
  });

  // MEM-001 — the long-lived memory store used by both the
  // orchestrator (prompt recall) and the user-facing
  // /v1/coach/memories routes. Resolve once so both surfaces
  // share the same backing store. The orchestrator's
  // `dependencies.memories` is the default; tests may inject a
  // custom store via `coachControls.memoryStore`.
  void app.register(coachRoutes, {
    runRepository,
    prefix: "/v1/coach",
    agent,
    resolveAgent,
    conversationRepository,
    profileRepository,
    betaProRepository,
    aiConsentRepository,
    goalRepository,
    foodEntryRepository,
    workoutRepository,
    workoutSetRepository,
    bodyMeasurementRepository,
    limits: coachLimits,
    nutritionDraftProvider: visionProvider,
    resolveNutritionDraftProvider: resolveVisionProvider,
    nutritionDraftRateLimiter: draftRateLimiter,
    memoryStore,
    allowedEmails: aiAllowedEmails,
    ...(dependencies.coachControls?.planTierOverride
      ? { planTierOverride: dependencies.coachControls.planTierOverride }
      : readPlanTierOverride()
        ? { planTierOverride: readPlanTierOverride() }
        : {}),
    ...(dependencies.coachControls?.now
      ? { now: dependencies.coachControls.now }
      : {}),
  });
  void app.register(coachNutritionPhotoRoutes, {
    prefix: "/v1/coach",
    conversationRepository,
    profileRepository,
    betaProRepository,
    aiConsentRepository,
    limits: coachLimits,
    nutritionDraftProvider: visionProvider,
    resolveNutritionDraftProvider: resolveVisionProvider,
    nutritionDraftRateLimiter: draftRateLimiter,
    allowedEmails: aiAllowedEmails,
    ...(dependencies.coachControls?.planTierOverride
      ? { planTierOverride: dependencies.coachControls.planTierOverride }
      : readPlanTierOverride()
        ? { planTierOverride: readPlanTierOverride() }
        : {}),
    ...(dependencies.coachControls?.now
      ? { now: dependencies.coachControls.now }
      : {}),
  });

  // The user-facing /v1/coach/memories routes share the same
  // backing store as the orchestrator's prompt recall.
  void app.register(coachMemoryRoutes, {
    prefix: "/v1/coach",
    memoryStore,
  });

  return app;
};
