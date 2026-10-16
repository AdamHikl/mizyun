export {
  type AllowedMobilePublicKey,
  ALLOWED_MOBILE_PUBLIC_KEYS,
  type MobileConfig,
  type MobileConfigResult,
  type MobileSupabaseConfiguration,
  loadMobileConfig,
  loadMobileConfigOrLog,
} from "./mobile";

export {
  type NodeEnv,
  type ServerAppleAuthConfiguration,
  type ServerConfig,
  type ServerConfigResult,
  type ServerGeminiConfiguration,
  type ServerGeminiVisionConfiguration,
  type ServerSupabaseConfiguration,
  SERVER_ENV_KEYS,
  loadServerConfig,
  loadServerConfigOrLog,
} from "./server";

export {
  type ConfigIssue,
  type ConfigIssueCode,
  configIssueCode,
  formatConfigIssue,
} from "./errors";

export {
  PUBLIC_ENV_PREFIX,
  type EnvSnapshot,
  envSnapshotFrom,
  isPublicEnvKey,
  readProcessEnv,
} from "./env";

export {
  type AiPlanTier,
  type AiTierCaps,
  AI_TIER_CAPS,
  capsForTier,
  isAiPlanTier,
} from "./ai-tier";

export {
  type BuildMatrixValidationInput,
  type MizyunAppVariant,
  type MizyunBuildProfile,
  type MobileBuildIdentity,
  BUILD_IDENTITIES,
  validateBuildMatrix,
} from "./build-matrix";

export * from "./community";

export { loadMealPhotosEnabled } from "./meal-photos";
export { runHealthImportsEnabled } from "./run-health-imports";
export { boulderingEnabled } from "./bouldering";
