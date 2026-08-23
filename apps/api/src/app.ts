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
  createSupabaseServiceRoleClient,
  createSupabaseStorageClient,
} from "@mizyun/adapter-supabase-server";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_UNIT_SYSTEM,
  type AccountRepository,
  type BodyMeasurementRepository,
  type ConversationRepository,
  type ExerciseRepository,
  type FeedbackRepository,
  type FoodEntryRepository,
  type GoalRepository,
  type MediaAssetRepository,
  type PlanTier,
  type ProfileRepository,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";
import { loadServerConfig, type ServerConfig } from "@mizyun/config";
import {
  RejectingAccessTokenVerifier,
  type AccessTokenVerifier,
} from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";
import {
  MistralAgentProvider,
  MistralContentModerator,
  MistralVisionProvider,
} from "@mizyun/provider-mistral";

import { InMemoryAccountRepository } from "./account-repository.js";
import { InMemoryGoalRepository } from "./goal-repository.js";
import { loggerConfig } from "./logging.js";
import { InMemoryMediaStorage, type MediaStorage } from "./media-storage.js";
import { SupabaseMemoryStore } from "@mizyun/adapter-supabase-server";
import { accountRoutes } from "./modules/account/routes.js";
import { bodyMeasurementsRoutes } from "./modules/body-measurements/routes.js";
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
import type { MemoryStore } from "@mizyun/memory";
import { exercisesRoutes } from "./modules/exercises/routes.js";
import { feedbackRoutes } from "./modules/feedback/routes.js";
import { foodEntriesRoutes } from "./modules/food-entries/routes.js";
import { foodDraftRoutes } from "./modules/food-entries/draft-route.js";
import { FoodDraftRateLimiter } from "./modules/food-entries/draft-rate-limit.js";
import { goalsRoutes } from "./modules/goals/routes.js";
import { identityRoutes } from "./modules/identity/routes.js";
import { mediaRoutes } from "./modules/media/routes.js";
import { profileRoutes } from "./modules/profile/routes.js";
import { systemRoutes } from "./modules/system/routes.js";
import { workoutsRoutes } from "./modules/workouts/routes.js";
import { workoutSetsRoutes } from "./modules/workout-sets/routes.js";
import { authenticationPlugin } from "./plugins/authentication.js";
import { InMemoryBodyMeasurementRepository } from "./body-measurement-repository.js";
import { InMemoryConversationRepository } from "./conversation-repository.js";
import { InMemoryExerciseRepository } from "./exercise-repository.js";
import { InMemoryFeedbackRepository } from "./feedback-repository.js";
import { InMemoryFoodEntryRepository } from "./food-entry-repository.js";
import { InMemoryMediaAssetRepository } from "./media-asset-repository.js";
import { InMemoryProfileRepository } from "./profile-repository.js";
import { InMemoryWorkoutRepository } from "./workout-repository.js";
import { InMemoryWorkoutSetRepository } from "./workout-set-repository.js";
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
  SupabaseMediaStorage,
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
   * `MistralVisionProvider` (if `MISTRAL_VISION_API_KEY` is
   * configured) or a `DisabledVisionProvider` otherwise. Tests
   * pass a `StubVisionProvider` to drive deterministic drafts.
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
   * `agent` is not supplied. The default composition wires Mistral
   * moderation only alongside a configured Mistral text provider.
   */
  readonly moderator?: ContentModerator;
  /**
   * Optional pre-constructed vision provider (VISION-001).
   * `defaultDependencies` sets this to a `StubVisionProvider`
   * when `AGENT_PROVIDER=vision-dev`; production wires
   * `MistralVisionProvider` (when `MISTRAL_VISION_API_KEY` is
   * configured) or a `DisabledVisionProvider` (otherwise).
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
  readonly exerciseRepository?: ExerciseRepository;
  readonly workoutRepository?: WorkoutRepository;
  readonly workoutSetRepository?: WorkoutSetRepository;
  readonly bodyMeasurementRepository?: BodyMeasurementRepository;
  readonly conversationRepository?: ConversationRepository;
  readonly feedbackRepository?: FeedbackRepository;
  readonly accountRepository?: AccountRepository;
  readonly mediaAssetRepository?: MediaAssetRepository;
  readonly mediaStorage?: MediaStorage;
  readonly coachControls?: CoachControlOptions;
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
        mistralConfig: null,
        mistralVisionConfig: null,
        aiExternalAccess: false,
      };
  const mistralConfig =
    config.agentProvider === "mistral" ? config.mistralConfig : null;
  const provider =
    mistralConfig !== null
      ? new MistralAgentProvider({
          apiKey: mistralConfig.apiKey,
          model: mistralConfig.model,
          timeoutMs: mistralConfig.timeoutMs,
          maxOutputTokens: mistralConfig.maxOutputTokens,
          externalAccess: config.aiExternalAccess,
        })
      : new DisabledAgentProvider();
  // The default memory store is in-memory. When Supabase is
  // configured, the buildApp step swaps it for a Supabase-backed
  // store below; we leave the in-memory default here so dev/test
  // paths stay zero-config.
  const base = {
    provider,
    memories: new InMemoryMemoryStore() as MemoryStore,
    tokenVerifier: tokenVerifierFromConfig(config),
    ...(mistralConfig !== null
      ? {
          moderator: new MistralContentModerator({
            apiKey: mistralConfig.apiKey,
            model: mistralConfig.moderationModel,
            timeoutMs: mistralConfig.timeoutMs,
            externalAccess: config.aiExternalAccess,
          }),
        }
      : {}),
  };
  // VISION-001 — default vision provider for the dev/test path.
  // When `VISION_PROVIDER=stub` is set we wire the deterministic
  // StubVisionProvider so the smoke can hit the
  // /v1/food-entries/draft endpoint without a Mistral vision
  // key. Production wires MistralVisionProvider via `coachControls`
  // (see buildApp).
  if (config.visionProvider === "stub") {
    Object.assign(base, {
      visionProvider: new StubVisionProvider(),
    });
  }
  if (config.supabase.configured && config.supabaseConfig) {
    const supabaseConfig = config.supabaseConfig;
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
const resolveAgent = (
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
  const accountRepository =
    dependencies.accountRepository ??
    new InMemoryAccountRepository({
      profileRepository,
      goalRepository,
      foodEntryRepository,
      exerciseRepository,
      workoutRepository,
      workoutSetRepository,
      bodyMeasurementRepository,
      conversationRepository,
      feedbackRepository,
    });
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
      ? new SupabaseMediaStorage({ clientFor: sp.storageClientFor })
      : new InMemoryMediaStorage());
  const MEDIA_BUCKET_ID = "private-media";

  // AI-002: build the read-only Coach tool registry against
  // the resolved repositories. When `dependencies.agent` is
  // supplied (tests injecting a fully custom orchestrator),
  // the registry is unused. Otherwise build the default
  // registry against the wired repos and pass it into a
  // freshly-constructed orchestrator that owns the default
  // provider + memory store.
  const defaultToolSet = buildCoachToolRegistry({
    profileRepository,
    goalRepository,
    workoutRepository,
    workoutSetRepository,
    foodEntryRepository,
    bodyMeasurementRepository,
  });
  const agent = resolveAgent(dependencies, defaultToolSet);

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
  // stub returns a deterministic candidate. MistralVisionProvider
  // is wired when MISTRAL_VISION_API_KEY is configured.
  const visionProvider: VisionDraftProvider = dependencies.coachControls
    ?.visionProvider
    ? dependencies.coachControls.visionProvider
    : dependencies.visionProvider
      ? dependencies.visionProvider
      : (() => {
          const mistralVisionConfig = configResult.ok
            ? configResult.value.mistralVisionConfig
            : null;
          if (mistralVisionConfig !== null) {
            return new MistralVisionProvider({
              apiKey: mistralVisionConfig.apiKey,
              model: mistralVisionConfig.model,
              timeoutMs: mistralVisionConfig.timeoutMs,
              maxOutputTokens: mistralVisionConfig.maxOutputTokens,
              externalAccess: configResult.ok
                ? configResult.value.aiExternalAccess
                : false,
            });
          }
          return new DisabledVisionProvider();
        })();
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

  void app.register(systemRoutes, { prefix: "/v1" });
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
  });
  void app.register(foodDraftRoutes, {
    prefix: "/v1/food-entries",
    visionProvider,
    rateLimiter: draftRateLimiter,
    resolvePlanTier,
  });
  void app.register(exercisesRoutes, {
    prefix: "/v1/exercises",
    exerciseRepository,
  });
  void app.register(workoutsRoutes, {
    prefix: "/v1/workouts",
    workoutRepository,
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
  void app.register(accountRoutes, {
    prefix: "/v1",
    accountRepository,
    memoryStore,
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

  // MEM-001 — the long-lived memory store used by both the
  // orchestrator (prompt recall) and the user-facing
  // /v1/coach/memories routes. Resolve once so both surfaces
  // share the same backing store. The orchestrator's
  // `dependencies.memories` is the default; tests may inject a
  // custom store via `coachControls.memoryStore`.
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
      dependencies.coachControls?.userMaxConcurrentRequests !== undefined
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
            },
          }
        : {}),
    });
  };

  void app.register(coachRoutes, {
    prefix: "/v1/coach",
    agent,
    conversationRepository,
    profileRepository,
    goalRepository,
    foodEntryRepository,
    workoutRepository,
    workoutSetRepository,
    bodyMeasurementRepository,
    limits: buildLimits(),
    nutritionDraftProvider: visionProvider,
    nutritionDraftRateLimiter: draftRateLimiter,
    memoryStore,
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
    nutritionDraftProvider: visionProvider,
    nutritionDraftRateLimiter: draftRateLimiter,
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
