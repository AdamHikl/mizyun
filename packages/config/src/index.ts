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
  type AiRoutedFeature,
  type AiVendor,
  AI_FEATURE_PROVIDER_ENV_KEYS,
  type NodeEnv,
  type ServerAiRouting,
  type ServerAppleAuthConfiguration,
  type ServerConfig,
  type ServerConfigResult,
  type ServerAnthropicConfiguration,
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
  AI_COST_OUTPUT_SHARE,
  AI_COST_RESERVATION_MICROS,
  AI_PRICES_CHECKED_ON,
  ANTHROPIC_WEB_SEARCH_MICROS,
  GEMINI_GROUNDING_MICROS,
  GEMINI_PRICE_2026,
  GEMINI_PRICE_2027,
  HAIKU_PRICE,
  ILLUSTRATION_MICROS,
  type AiCallUsage,
  type AiCostKind,
  aiAllowanceMessage,
  estimateAiCallCostMicros,
  nextMonthlyAllowanceReset,
  pricedProvider,
} from "./ai-cost";

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
export { stretchAiEnabled } from "./stretch-ai";
