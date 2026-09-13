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
  /**
   * Public Supabase URL issued to mobile clients for signed upload
   * and download operations. When omitted, inferred from known ports (8100/8000)
   * or falls back to `url`.
   */
  readonly publicUrl?: string;
}

export interface ServerGeminiConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModel?: string | undefined;
  readonly thinkingBudget?: number | undefined;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly dailyUserTokenBudget: number;
  readonly userRequestsPerMinute: number;
  readonly userMaxConcurrentRequests: number;
}

export interface ServerGeminiVisionConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModel?: string | undefined;
  readonly thinkingBudget?: number | undefined;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly searchGrounding: boolean;
}

export interface ServerSesConfiguration {
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly fromEmail: string;
}

export interface ServerAppleAuthConfiguration {
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKey: string;
  readonly clientId: string;
}

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly env: NodeEnv;
  readonly supabase: AuthConfigurationStatus;
  readonly supabaseConfig: ServerSupabaseConfiguration | null;
  readonly agentProvider: "disabled" | "gemini";
  readonly visionProvider: "disabled" | "stub";
  readonly geminiConfig: ServerGeminiConfiguration | null;
  readonly geminiVisionConfig: ServerGeminiVisionConfiguration | null;
  readonly sesConfig: ServerSesConfiguration | null;
  readonly appleAuthConfig: ServerAppleAuthConfiguration | null;
  readonly aiExternalAccess: boolean;
  /** @deprecated Parsed only for configuration compatibility; never gates AI access. */
  readonly aiAllowedEmails: readonly string[];
}

export type ServerConfigResult = Result<ServerConfig, readonly ConfigIssue[]>;

export const SERVER_ENV_KEYS = {
  host: "API_HOST",
  port: "API_PORT",
  env: "NODE_ENV",
  supabaseUrl: "SUPABASE_URL",
  supabasePublicUrl: "SUPABASE_PUBLIC_URL",
  supabasePublishableKey: "SUPABASE_PUBLISHABLE_KEY",
  supabaseServiceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
  agentProvider: "AGENT_PROVIDER",
  visionProvider: "VISION_PROVIDER",
  geminiApiKey: "GEMINI_API_KEY",
  geminiModel: "GEMINI_MODEL",
  geminiFallbackModel: "GEMINI_FALLBACK_MODEL",
  geminiThinkingBudget: "GEMINI_THINKING_BUDGET",
  geminiTimeoutMs: "GEMINI_TIMEOUT_MS",
  geminiMaxOutputTokens: "GEMINI_MAX_OUTPUT_TOKENS",
  geminiVisionApiKey: "GEMINI_VISION_API_KEY",
  geminiVisionModel: "GEMINI_VISION_MODEL",
  geminiVisionFallbackModel: "GEMINI_VISION_FALLBACK_MODEL",
  geminiVisionThinkingBudget: "GEMINI_VISION_THINKING_BUDGET",
  geminiVisionTimeoutMs: "GEMINI_VISION_TIMEOUT_MS",
  geminiVisionMaxOutputTokens: "GEMINI_VISION_MAX_OUTPUT_TOKENS",
  geminiVisionSearchGrounding: "GEMINI_VISION_SEARCH_GROUNDING",
  sesRegion: "SES_REGION",
  sesAccessKeyId: "SES_ACCESS_KEY_ID",
  sesSecretAccessKey: "SES_SECRET_ACCESS_KEY",
  sesFromEmail: "SES_FROM_EMAIL",
  aiDailyUserTokenBudget: "AI_DAILY_USER_TOKEN_BUDGET",
  aiUserRequestsPerMinute: "AI_USER_REQUESTS_PER_MINUTE",
  aiUserMaxConcurrentRequests: "AI_USER_MAX_CONCURRENT_REQUESTS",
  aiExternalAccess: "AI_EXTERNAL_ACCESS",
  aiAllowedEmails: "AI_ALLOWED_EMAILS",
  appleTeamId: "APPLE_TEAM_ID",
  appleKeyId: "APPLE_KEY_ID",
  applePrivateKey: "APPLE_PRIVATE_KEY",
  applePrivateKeyPath: "APPLE_PRIVATE_KEY_PATH",
  appleClientId: "APPLE_CLIENT_ID",
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
  supabasePublicUrl: z
    .string()
    .url("SUPABASE_PUBLIC_URL must be a valid URL")
    .nullish(),
  supabasePublishableKey: z
    .string()
    .min(1, "SUPABASE_PUBLISHABLE_KEY must not be empty")
    .nullish(),
  supabaseServiceRoleKey: z
    .string()
    .min(20, "SUPABASE_SERVICE_ROLE_KEY must be at least 20 characters")
    .nullish(),
  agentProvider: z.enum(["disabled", "gemini"]).default("disabled"),
  /**
   * VISION-001 — overrides the photo-draft vision provider.
   * `disabled` (default) returns 503 AI_CONFIGURATION_ERROR on
   * the /v1/food-entries/draft endpoint. `stub` wires the
   * deterministic StubVisionProvider for local dev + smoke. The
   * vision provider is selected by setting `GEMINI_VISION_API_KEY`
   * or `GEMINI_API_KEY`.
   */
  visionProvider: z.enum(["disabled", "stub"]).default("disabled"),
  geminiApiKey: z
    .string()
    .min(10, "GEMINI_API_KEY must not be empty")
    .optional(),
  geminiModel: z
    .string()
    .min(1, "GEMINI_MODEL must not be empty")
    .default("gemini-3.8-flash"),
  geminiFallbackModel: z
    .string()
    .min(1, "GEMINI_FALLBACK_MODEL must not be empty")
    .default("gemini-3.6-flash"),
  geminiThinkingBudget: z.coerce
    .number()
    .int("GEMINI_THINKING_BUDGET must be an integer")
    .min(0, "GEMINI_THINKING_BUDGET must be >= 0")
    .max(32_768, "GEMINI_THINKING_BUDGET must be <= 32768")
    .default(0),
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
    .default("gemini-3.8-flash"),
  geminiVisionFallbackModel: z
    .string()
    .min(1, "GEMINI_VISION_FALLBACK_MODEL must not be empty")
    .default("gemini-3.6-flash"),
  geminiVisionThinkingBudget: z.coerce
    .number()
    .int("GEMINI_VISION_THINKING_BUDGET must be an integer")
    .min(0, "GEMINI_VISION_THINKING_BUDGET must be >= 0")
    .max(32_768, "GEMINI_VISION_THINKING_BUDGET must be <= 32768")
    .default(0),
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
  geminiVisionSearchGrounding: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  sesRegion: z
    .string()
    .min(1, "SES_REGION must not be empty")
    .default("eu-west-1"),
  sesAccessKeyId: z
    .string()
    .min(10, "SES_ACCESS_KEY_ID must be at least 10 characters")
    .optional(),
  sesSecretAccessKey: z
    .string()
    .min(20, "SES_SECRET_ACCESS_KEY must be at least 20 characters")
    .optional(),
  sesFromEmail: z
    .string()
    .min(3, "SES_FROM_EMAIL must not be empty")
    .default("no-reply@mizyun.phiskel.com"),
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
  aiAllowedEmails: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0)
        : [],
    ),
  appleTeamId: z.string().optional(),
  appleKeyId: z.string().optional(),
  applePrivateKey: z.string().optional(),
  applePrivateKeyPath: z.string().optional(),
  appleClientId: z.string().optional(),
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

  // Support alias environment variables for SES
  input.sesRegion =
    readString(snapshot, "SES_REGION") ??
    readString(snapshot, "AWS_REGION") ??
    undefined;
  input.sesAccessKeyId =
    readString(snapshot, "SES_ACCESS_KEY_ID") ??
    readString(snapshot, "PHISKEL_SES_AWS_ACCESS_KEY_ID") ??
    readString(snapshot, "AWS_ACCESS_KEY_ID") ??
    undefined;
  input.sesSecretAccessKey =
    readString(snapshot, "SES_SECRET_ACCESS_KEY") ??
    readString(snapshot, "PHISKEL_SES_AWS_SECRET_ACCESS_KEY") ??
    readString(snapshot, "AWS_SECRET_ACCESS_KEY") ??
    undefined;
  input.sesFromEmail = readString(snapshot, "SES_FROM_EMAIL") ?? undefined;

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
    parsed.data.agentProvider === "gemini" &&
    parsed.data.geminiApiKey === undefined
  ) {
    issues.push({ kind: "missing", keys: [SERVER_ENV_KEYS.geminiApiKey] });
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
  if (parsed.success) {
    const hasSesKey = parsed.data.sesAccessKeyId !== undefined;
    const hasSesSecret = parsed.data.sesSecretAccessKey !== undefined;
    if (hasSesKey !== hasSesSecret) {
      issues.push({
        kind: "malformed",
        key: SERVER_ENV_KEYS.sesAccessKeyId,
        reason:
          "SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY must be set together or both omitted.",
      });
    }
  }
  if (issues.length > 0 || !parsed.success) return err(issues);

  const value = parsed.data;
  const url = value.supabaseUrl ?? null;
  const publishableKey = value.supabasePublishableKey ?? null;
  const serviceRoleKey = value.supabaseServiceRoleKey ?? null;

  const rawPublicUrl = value.supabasePublicUrl ?? null;
  let inferredPublicUrl: string | undefined = rawPublicUrl ?? undefined;
  if (!inferredPublicUrl && url !== null) {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.port === "8100") {
        inferredPublicUrl = "https://mizyun-supabase-dev.phiskel.com";
      } else if (parsedUrl.port === "8000") {
        inferredPublicUrl = "https://mizyun-supabase.phiskel.com";
      }
    } catch {
      // Ignore URL parsing errors for inference
    }
  }

  const supabase: AuthConfigurationStatus =
    url !== null && publishableKey !== null
      ? { configured: true, provider: "supabase" }
      : { configured: false, provider: "supabase", reason: DISABLED_REASON };
  const supabaseConfig: ServerSupabaseConfiguration | null =
    url !== null && publishableKey !== null
      ? {
          url,
          publishableKey,
          ...(serviceRoleKey ? { serviceRoleKey } : {}),
          ...(inferredPublicUrl ? { publicUrl: inferredPublicUrl } : {}),
        }
      : null;
  const geminiApiKeyResolved = value.geminiApiKey ?? value.geminiVisionApiKey;
  const geminiConfig: ServerGeminiConfiguration | null =
    geminiApiKeyResolved !== undefined
      ? {
          apiKey: geminiApiKeyResolved,
          model: value.geminiModel,
          ...(value.geminiFallbackModel
            ? { fallbackModel: value.geminiFallbackModel }
            : {}),
          thinkingBudget: value.geminiThinkingBudget,
          timeoutMs: value.geminiTimeoutMs,
          maxOutputTokens: value.geminiMaxOutputTokens,
          dailyUserTokenBudget: value.aiDailyUserTokenBudget,
          userRequestsPerMinute: value.aiUserRequestsPerMinute,
          userMaxConcurrentRequests: value.aiUserMaxConcurrentRequests,
        }
      : null;
  const geminiVisionConfig: ServerGeminiVisionConfiguration | null =
    geminiApiKeyResolved !== undefined
      ? {
          apiKey: geminiApiKeyResolved,
          model: value.geminiVisionModel,
          ...(value.geminiVisionFallbackModel
            ? { fallbackModel: value.geminiVisionFallbackModel }
            : {}),
          thinkingBudget: value.geminiVisionThinkingBudget,
          timeoutMs: value.geminiVisionTimeoutMs,
          maxOutputTokens: value.geminiVisionMaxOutputTokens,
          searchGrounding: value.geminiVisionSearchGrounding,
        }
      : null;
  const sesConfig: ServerSesConfiguration | null =
    value.sesAccessKeyId !== undefined && value.sesSecretAccessKey !== undefined
      ? {
          region: value.sesRegion,
          accessKeyId: value.sesAccessKeyId,
          secretAccessKey: value.sesSecretAccessKey,
          fromEmail: value.sesFromEmail,
        }
      : null;

  const defaultAppleClientId =
    value.env === "production" ? "com.mizyun.app" : "com.mizyun.development";
  const appleClientId = value.appleClientId || defaultAppleClientId;

  const rawKey = value.applePrivateKey;
  const normalizedKey =
    typeof rawKey === "string" ? rawKey.replace(/\\n/g, "\n") : undefined;

  const appleAuthConfig: ServerAppleAuthConfiguration | null =
    value.appleTeamId &&
    value.appleKeyId &&
    normalizedKey &&
    normalizedKey.length >= 20
      ? {
          teamId: value.appleTeamId,
          keyId: value.appleKeyId,
          privateKey: normalizedKey,
          clientId: appleClientId,
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
    geminiConfig,
    geminiVisionConfig,
    sesConfig,
    appleAuthConfig,
    aiExternalAccess: value.aiExternalAccess,
    aiAllowedEmails: value.aiAllowedEmails ?? [],
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
