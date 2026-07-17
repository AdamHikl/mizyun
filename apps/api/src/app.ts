import Fastify, { type FastifyInstance } from "fastify";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { createSupabaseAccessTokenVerifier } from "@mizyun/adapter-supabase-server";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_UNIT_SYSTEM,
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
import { loadServerConfig, type ServerConfig } from "@mizyun/config";
import {
  RejectingAccessTokenVerifier,
  type AccessTokenVerifier,
} from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { InMemoryAccountRepository } from "./account-repository.js";
import { InMemoryGoalRepository } from "./goal-repository.js";
import { loggerConfig } from "./logging.js";
import { accountRoutes } from "./modules/account/routes.js";
import { bodyMeasurementsRoutes } from "./modules/body-measurements/routes.js";
import { coachRoutes } from "./modules/coach/routes.js";
import { exercisesRoutes } from "./modules/exercises/routes.js";
import { foodEntriesRoutes } from "./modules/food-entries/routes.js";
import { goalsRoutes } from "./modules/goals/routes.js";
import { identityRoutes } from "./modules/identity/routes.js";
import { profileRoutes } from "./modules/profile/routes.js";
import { systemRoutes } from "./modules/system/routes.js";
import { workoutsRoutes } from "./modules/workouts/routes.js";
import { workoutSetsRoutes } from "./modules/workout-sets/routes.js";
import { authenticationPlugin } from "./plugins/authentication.js";
import { InMemoryBodyMeasurementRepository } from "./body-measurement-repository.js";
import { InMemoryExerciseRepository } from "./exercise-repository.js";
import { InMemoryFoodEntryRepository } from "./food-entry-repository.js";
import { InMemoryProfileRepository } from "./profile-repository.js";
import { InMemoryWorkoutRepository } from "./workout-repository.js";
import { InMemoryWorkoutSetRepository } from "./workout-set-repository.js";

export interface AppDependencies {
  readonly agent: AgentOrchestrator;
  readonly tokenVerifier: AccessTokenVerifier;
  /**
   * Optional. When omitted, `buildApp` falls back to the in-memory
   * implementation. Tests that need to exercise the route layer in
   * isolation may pass a stub; production wiring supplies the Supabase
   * adapter (landed in a follow-up segment).
   */
  readonly profileRepository?: ProfileRepository;
  readonly goalRepository?: GoalRepository;
  readonly foodEntryRepository?: FoodEntryRepository;
  readonly exerciseRepository?: ExerciseRepository;
  readonly workoutRepository?: WorkoutRepository;
  readonly workoutSetRepository?: WorkoutSetRepository;
  readonly bodyMeasurementRepository?: BodyMeasurementRepository;
  readonly accountRepository?: AccountRepository;
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
      };
  return {
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    tokenVerifier: tokenVerifierFromConfig(config),
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
  };
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
  const profileRepository =
    dependencies.profileRepository ??
    new InMemoryProfileRepository({
      defaultTimezone: DEFAULT_TIMEZONE,
      defaultUnitSystem: DEFAULT_UNIT_SYSTEM,
    });
  const goalRepository =
    dependencies.goalRepository ?? new InMemoryGoalRepository();
  const foodEntryRepository =
    dependencies.foodEntryRepository ?? new InMemoryFoodEntryRepository();
  const exerciseRepository =
    dependencies.exerciseRepository ?? new InMemoryExerciseRepository();
  const workoutRepository =
    dependencies.workoutRepository ?? new InMemoryWorkoutRepository();
  const workoutSetRepository =
    dependencies.workoutSetRepository ?? new InMemoryWorkoutSetRepository();
  const bodyMeasurementRepository =
    dependencies.bodyMeasurementRepository ??
    new InMemoryBodyMeasurementRepository();
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
    });

  void app.register(authenticationPlugin, {
    tokenVerifier: dependencies.tokenVerifier,
  });
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
  });
  void app.register(coachRoutes, {
    prefix: "/v1/coach",
    agent: dependencies.agent,
  });

  return app;
};
