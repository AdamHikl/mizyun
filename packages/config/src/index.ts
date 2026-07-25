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
  type ServerConfig,
  type ServerConfigResult,
  type ServerMistralConfiguration,
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
