import type { Result } from "@mizyun/core";
import { err, ok } from "@mizyun/core";
import type { AuthConfigurationStatus } from "@mizyun/identity";
import { z } from "zod";

import { type ConfigIssue, formatConfigIssue } from "./errors";
import { type EnvSnapshot, envSnapshotFrom } from "./env";

export type NodeEnv = "development" | "test" | "production";

export interface ServerSupabaseConfiguration {
  readonly url: string;
  readonly publishableKey: string;
  /**
   * Service-role key. Optional: when omitted, the durable AI limiter
   * (AI-OPS-001) cannot run against a real Supabase project and the
   * composition root falls back to the in-memory limiter. Only the
   * limits service consumes this key; per-feature adapters stay on the
   * publishable key + RLS. The key lives only in the ignored root
   * `.env` and never in the mobile bundle.
   */
  readonly serviceRoleKey?: string;
}

export interface ServerMistralConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly moderationModel: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly dailyUserTokenBudget: number;
  readonly userRequestsPerMinute: number;
  readonly userMaxConcurrentRequests: number;
}

export interface ServerMistralVisionConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
}

export interface ServerGeminiConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly dailyUserTokenBudget: number;
  readonly userRequestsPerMinute: number;
  readonly userMaxConcurrentRequests: number;
}

export interface ServerGeminiVisionConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
}

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly env: NodeEnv;
  readonly supabase: AuthConfigurationStatus;
  readonly supabaseConfig: ServerSupabaseConfiguration | null;
  readonly agentProvider: "disabled" | "mistral" | "gemini" | "multi";
  readonly visionProvider: "disabled" | "stub";
  readonly mistralConfig: ServerMistralConfiguration | null;
  readonly mistralVisionConfig: ServerMistralVisionConfiguration | null;
  readonly geminiConfig: ServerGeminiConfiguration | null;
  readonly geminiVisionConfig: ServerGeminiVisionConfiguration | null;
  readonly aiExternalAccess: boolean;
}

export type ServerConfigResult = Result<ServerConfig, readonly ConfigIssue[]>;

export const SERVER_ENV_KEYS = {
  host: "API_HOST",
  port: "API_PORT",
  env: "NODE_ENV",
  supabaseUrl: "SUPABASE_URL",
  supabasePublishableKey: "SUPABASE_PUBLISHABLE_KEY",
  supabaseServiceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
  agentProvider: "AGENT_PROVIDER",
  visionProvider: "VISION_PROVIDER",
  mistralApiKey: "MISTRAL_API_KEY",
  mistralModel: "MISTRAL_MODEL",
  mistralModerationModel: "MISTRAL_MODERATION_MODEL",
  mistralTimeoutMs: "MISTRAL_TIMEOUT_MS",
  mistralMaxOutputTokens: "MISTRAL_MAX_OUTPUT_TOKENS",
  mistralVisionApiKey: "MISTRAL_VISION_API_KEY",
  mistralVisionModel: "MISTRAL_VISION_MODEL",
  mistralVisionTimeoutMs: "MISTRAL_VISION_TIMEOUT_MS",
  mistralVisionMaxOutputTokens: "MISTRAL_VISION_MAX_OUTPUT_TOKENS",
  geminiApiKey: "GEMINI_API_KEY",
  geminiModel: "GEMINI_MODEL",
  geminiTimeoutMs: "GEMINI_TIMEOUT_MS",
  geminiMaxOutputTokens: "GEMINI_MAX_OUTPUT_TOKENS",
  geminiVisionApiKey: "GEMINI_VISION_API_KEY",
  geminiVisionModel: "GEMINI_VISION_MODEL",
  geminiVisionTimeoutMs: "GEMINI_VISION_TIMEOUT_MS",
  geminiVisionMaxOutputTokens: "GEMINI_VISION_MAX_OUTPUT_TOKENS",
  aiDailyUserTokenBudget: "AI_DAILY_USER_TOKEN_BUDGET",
  aiUserRequestsPerMinute: "AI_USER_REQUESTS_PER_MINUTE",
  aiUserMaxConcurrentRequests: "AI_USER_MAX_CONCURRENT_REQUESTS",
  aiExternalAccess: "AI_EXTERNAL_ACCESS",
} as const;

const DISABLED_REASON = "Supabase server configuration has not been provided.";

const baseServerSchema = z.object({
  env: z.enum(["development", "test", "production"]).default("development"),
  host: z.string().min(1, "API_HOST must not be empty").default("127.0.0.1"),
  port: z.coerce
    .number()
    .int("API_PORT must be an integer")
    .min(1, "API_PORT must be >= 1")
    .max(65_535, "API_PORT must be <= 65535")
    .default(4_000),
  supabaseUrl: z.string().url("SUPABASE_URL must be a valid URL").nullish(),
  supabasePublishableKey: z
    .string()
    .min(1, "SUPABASE_PUBLISHABLE_KEY must not be empty")
    .nullish(),
  supabaseServiceRoleKey: z
    .string()
    .min(20, "SUPABASE_SERVICE_ROLE_KEY must be at least 20 characters")
    .nullish(),
  agentProvider: z
    .enum(["disabled", "mistral", "gemini", "multi"])
    .default("disabled"),
  /**
   * VISION-001 — overrides the photo-draft vision provider.
   * `disabled` (default) returns 503 AI_CONFIGURATION_ERROR on
   * the /v1/food-entries/draft endpoint. `stub` wires the
   * deterministic StubVisionProvider for local dev + smoke. The
   * vision provider is selected by setting `MISTRAL_VISION_API_KEY`
   * or `GEMINI_VISION_API_KEY`/`GEMINI_API_KEY`.
   */
  visionProvider: z.enum(["disabled", "stub"]).default("disabled"),
  mistralApiKey: z
    .string()
    .min(20, "MISTRAL_API_KEY must not be empty")
    .optional(),
  mistralModel: z
    .string()
    .min(1, "MISTRAL_MODEL must not be empty")
    .default("mistral-medium-latest"),
  mistralModerationModel: z
    .string()
    .min(1, "MISTRAL_MODERATION_MODEL must not be empty")
    .default("mistral-moderation-2603"),
  mistralTimeoutMs: z.coerce
    .number()
    .int("MISTRAL_TIMEOUT_MS must be an integer")
    .min(1_000, "MISTRAL_TIMEOUT_MS must be >= 1000")
    .max(120_000, "MISTRAL_TIMEOUT_MS must be <= 120000")
    .default(30_000),
  mistralMaxOutputTokens: z.coerce
    .number()
    .int("MISTRAL_MAX_OUTPUT_TOKENS must be an integer")
    .min(128, "MISTRAL_MAX_OUTPUT_TOKENS must be >= 128")
    .max(8_192, "MISTRAL_MAX_OUTPUT_TOKENS must be <= 8192")
    .default(1_200),
  mistralVisionApiKey: z
    .string()
    .min(20, "MISTRAL_VISION_API_KEY must not be empty")
    .optional(),
  mistralVisionModel: z
    .string()
    .min(1, "MISTRAL_VISION_MODEL must not be empty")
    .default("mistral-medium-2508"),
  mistralVisionTimeoutMs: z.coerce
    .number()
    .int("MISTRAL_VISION_TIMEOUT_MS must be an integer")
    .min(1_000, "MISTRAL_VISION_TIMEOUT_MS must be >= 1000")
    .max(120_000, "MISTRAL_VISION_TIMEOUT_MS must be <= 120000")
    .default(45_000),
  mistralVisionMaxOutputTokens: z.coerce
    .number()
    .int("MISTRAL_VISION_MAX_OUTPUT_TOKENS must be an integer")
    .min(128, "MISTRAL_VISION_MAX_OUTPUT_TOKENS must be >= 128")
    .max(8_192, "MISTRAL_VISION_MAX_OUTPUT_TOKENS must be <= 8192")
    .default(1_200),
  geminiApiKey: z
    .string()
    .min(10, "GEMINI_API_KEY must not be empty")
    .optional(),
  geminiModel: z
    .string()
    .min(1, "GEMINI_MODEL must not be empty")
    .default("gemini-3.7-flash"),
  geminiTimeoutMs: z.coerce
    .number()
    .int("GEMINI_TIMEOUT_MS must be an integer")
    .min(1_000, "GEMINI_TIMEOUT_MS must be >= 1000")
    .max(120_000, "GEMINI_TIMEOUT_MS must be <= 120000")
    .default(30_000),
  geminiMaxOutputTokens: z.coerce
    .number()
    .int("GEMINI_MAX_OUTPUT_TOKENS must be an integer")
    .min(128, "GEMINI_MAX_OUTPUT_TOKENS must be >= 128")
    .max(32_768, "GEMINI_MAX_OUTPUT_TOKENS must be <= 32768")
    .default(8_192),
  geminiVisionApiKey: z
    .string()
    .min(10, "GEMINI_VISION_API_KEY must not be empty")
    .optional(),
  geminiVisionModel: z
    .string()
    .min(1, "GEMINI_VISION_MODEL must not be empty")
    .default("gemini-3.6-flash"),
  geminiVisionTimeoutMs: z.coerce
    .number()
    .int("GEMINI_VISION_TIMEOUT_MS must be an integer")
    .min(1_000, "GEMINI_VISION_TIMEOUT_MS must be >= 1000")
    .max(120_000, "GEMINI_VISION_TIMEOUT_MS must be <= 120000")
    .default(45_000),
  geminiVisionMaxOutputTokens: z.coerce
    .number()
    .int("GEMINI_VISION_MAX_OUTPUT_TOKENS must be an integer")
    .min(128, "GEMINI_VISION_MAX_OUTPUT_TOKENS must be >= 128")
    .max(32_768, "GEMINI_VISION_MAX_OUTPUT_TOKENS must be <= 32768")
    .default(8_192),
  aiDailyUserTokenBudget: z.coerce
    .number()
    .int("AI_DAILY_USER_TOKEN_BUDGET must be an integer")
    .min(1_000, "AI_DAILY_USER_TOKEN_BUDGET must be >= 1000")
    .max(2_000_000, "AI_DAILY_USER_TOKEN_BUDGET must be <= 2000000")
    .default(100_000),
  aiUserRequestsPerMinute: z.coerce
    .number()
    .int("AI_USER_REQUESTS_PER_MINUTE must be an integer")
    .min(1, "AI_USER_REQUESTS_PER_MINUTE must be >= 1")
    .max(60, "AI_USER_REQUESTS_PER_MINUTE must be <= 60")
    .default(6),
  aiUserMaxConcurrentRequests: z.coerce
    .number()
    .int("AI_USER_MAX_CONCURRENT_REQUESTS must be an integer")
    .min(1, "AI_USER_MAX_CONCURRENT_REQUESTS must be >= 1")
    .max(1, "AI_USER_MAX_CONCURRENT_REQUESTS must be <= 1")
    .default(1),
  aiExternalAccess: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

type BaseServerShape = Record<keyof typeof SERVER_ENV_KEYS, string | undefined>;

const readString = (snapshot: EnvSnapshot, key: string): string | undefined => {
  const value = snapshot[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const collectRawServerInput = (snapshot: EnvSnapshot): BaseServerShape => {
  const input = {} as BaseServerShape;
  for (const [field, envKey] of Object.entries(SERVER_ENV_KEYS)) {
    input[field as keyof BaseServerShape] = readString(snapshot, envKey);
  }
  return input;
};

const schemaFieldToEnvKey = (field: string): string =>
  SERVER_ENV_KEYS[field as keyof typeof SERVER_ENV_KEYS] ?? field;

const zodIssuesToConfigIssues = (
  issues: z.ZodIssue[],
): readonly ConfigIssue[] =>
  issues.map((issue): ConfigIssue => {
    const rawField = issue.path.length > 0 ? String(issue.path[0]) : "<root>";
    const key = schemaFieldToEnvKey(rawField);
    const isRange =
      issue.code === z.ZodIssueCode.too_small ||
      issue.code === z.ZodIssueCode.too_big ||
      (issue.code === z.ZodIssueCode.invalid_type &&
        "expected" in issue &&
        (issue.expected === "integer" || issue.expected === "number"));
    return isRange
      ? { kind: "out_of_range", key, reason: issue.message }
      : { kind: "malformed", key, reason: issue.message };
  });

export const loadServerConfig = (
  input: { env?: EnvSnapshot } = {},
): ServerConfigResult => {
  const snapshot = input.env ?? envSnapshotFrom(process.env);
  const raw = collectRawServerInput(snapshot);
  const supabaseUrlRaw = readString(snapshot, SERVER_ENV_KEYS.supabaseUrl);
  const supabaseKeyRaw = readString(
    snapshot,
    SERVER_ENV_KEYS.supabasePublishableKey,
  );
  const bothPresent =
    supabaseUrlRaw !== undefined && supabaseKeyRaw !== undefined;
  const bothAbsent =
    supabaseUrlRaw === undefined && supabaseKeyRaw === undefined;

  const parsed = baseServerSchema.safeParse(raw);
  const zodIssues = parsed.success
    ? []
    : zodIssuesToConfigIssues(parsed.error.issues);
  const issues: ConfigIssue[] = [...zodIssues];
  if (!bothPresent && !bothAbsent) {
    issues.push({
      kind: "malformed",
      key: SERVER_ENV_KEYS.supabaseUrl,
      reason:
        "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set together or both omitted.",
    });
  }
  if (
    parsed.success &&
    parsed.data.agentProvider === "mistral" &&
    parsed.data.mistralApiKey === undefined
  ) {
    issues.push({ kind: "missing", keys: [SERVER_ENV_KEYS.mistralApiKey] });
  }
  if (
    parsed.success &&
    parsed.data.agentProvider === "gemini" &&
    parsed.data.geminiApiKey === undefined
  ) {
    issues.push({ kind: "missing", keys: [SERVER_ENV_KEYS.geminiApiKey] });
  }
  if (
    parsed.success &&
    parsed.data.agentProvider === "multi" &&
    parsed.data.mistralApiKey === undefined &&
    parsed.data.geminiApiKey === undefined
  ) {
    issues.push({
      kind: "missing",
      keys: [SERVER_ENV_KEYS.mistralApiKey, SERVER_ENV_KEYS.geminiApiKey],
    });
  }
  if (parsed.success && parsed.data.env === "production") {
    if (!bothPresent) {
      issues.push({
        kind: "missing",
        keys: [
          SERVER_ENV_KEYS.supabaseUrl,
          SERVER_ENV_KEYS.supabasePublishableKey,
        ],
      });
    }
    if (parsed.data.supabaseServiceRoleKey === undefined) {
      issues.push({
        kind: "missing",
        keys: [SERVER_ENV_KEYS.supabaseServiceRoleKey],
      });
    }
    if (parsed.data.visionProvider === "stub") {
      issues.push({
        kind: "malformed",
        key: SERVER_ENV_KEYS.visionProvider,
        reason: "VISION_PROVIDER=stub is forbidden when NODE_ENV=production.",
      });
    }
  }
  if (issues.length > 0 || !parsed.success) return err(issues);

  const value = parsed.data;
  const url = value.supabaseUrl ?? null;
  const publishableKey = value.supabasePublishableKey ?? null;
  const serviceRoleKey = value.supabaseServiceRoleKey ?? null;
  const supabase: AuthConfigurationStatus =
    url !== null && publishableKey !== null
      ? { configured: true, provider: "supabase" }
      : { configured: false, provider: "supabase", reason: DISABLED_REASON };
  const supabaseConfig: ServerSupabaseConfiguration | null =
    url !== null && publishableKey !== null
      ? { url, publishableKey, ...(serviceRoleKey ? { serviceRoleKey } : {}) }
      : null;
  const mistralConfig: ServerMistralConfiguration | null =
    value.mistralApiKey !== undefined
      ? {
          apiKey: value.mistralApiKey,
          model: value.mistralModel,
          moderationModel: value.mistralModerationModel,
          timeoutMs: value.mistralTimeoutMs,
          maxOutputTokens: value.mistralMaxOutputTokens,
          dailyUserTokenBudget: value.aiDailyUserTokenBudget,
          userRequestsPerMinute: value.aiUserRequestsPerMinute,
          userMaxConcurrentRequests: value.aiUserMaxConcurrentRequests,
        }
      : null;
  const mistralVisionConfig: ServerMistralVisionConfiguration | null =
    value.mistralVisionApiKey !== undefined
      ? {
          apiKey: value.mistralVisionApiKey,
          model: value.mistralVisionModel,
          timeoutMs: value.mistralVisionTimeoutMs,
          maxOutputTokens: value.mistralVisionMaxOutputTokens,
        }
      : null;
  const geminiConfig: ServerGeminiConfiguration | null =
    value.geminiApiKey !== undefined
      ? {
          apiKey: value.geminiApiKey,
          model: value.geminiModel,
          timeoutMs: value.geminiTimeoutMs,
          maxOutputTokens: value.geminiMaxOutputTokens,
          dailyUserTokenBudget: value.aiDailyUserTokenBudget,
          userRequestsPerMinute: value.aiUserRequestsPerMinute,
          userMaxConcurrentRequests: value.aiUserMaxConcurrentRequests,
        }
      : null;
  const geminiVisionApiKeyResolved =
    value.geminiVisionApiKey ?? value.geminiApiKey;
  const geminiVisionConfig: ServerGeminiVisionConfiguration | null =
    geminiVisionApiKeyResolved !== undefined
      ? {
          apiKey: geminiVisionApiKeyResolved,
          model: value.geminiVisionModel,
          timeoutMs: value.geminiVisionTimeoutMs,
          maxOutputTokens: value.geminiVisionMaxOutputTokens,
        }
      : null;

  return ok({
    env: value.env,
    host: value.host,
    port: value.port,
    supabase,
    supabaseConfig,
    agentProvider: value.agentProvider,
    visionProvider: value.visionProvider,
    mistralConfig,
    mistralVisionConfig,
    geminiConfig,
    geminiVisionConfig,
    aiExternalAccess: value.aiExternalAccess,
  });
};

export const loadServerConfigOrLog = (
  input: { env?: EnvSnapshot } = {},
): ServerConfigResult => {
  const result = loadServerConfig(input);
  if (!result.ok) {
    for (const issue of result.error) {
      // eslint-disable-next-line no-console
      console.error(`[config] ${formatConfigIssue(issue)}`);
    }
  }
  return result;
};
