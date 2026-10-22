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

/**
 * ADR-0069 / ADR-0077 — Anthropic (Claude) serves AI features routed to it
 * (see `ServerAiRouting`) once `ANTHROPIC_API_KEY` is set and the route is
 * acknowledged with `ANTHROPIC_ENABLED=true` (or the legacy Dev alias
 * `ANTHROPIC_DEV_TESTING=true`). The API serves a request with Anthropic
 * only when the user's stored consent disclosed Anthropic; other requests
 * use Gemini. Meal illustrations stay on Gemini because Claude does not
 * generate images.
 */
export interface ServerAnthropicConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly effort: "low" | "medium" | "high";
  readonly timeoutMs: number;
  readonly visionTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly webSearch: boolean;
}

/** AI vendors a routed feature can use. */
export type AiVendor = "gemini" | "anthropic";

/**
 * Effective AI vendor per feature. Each feature reads its own
 * `*_PROVIDER` key (see `AI_FEATURE_PROVIDER_ENV_KEYS`) and otherwise
 * inherits `AGENT_PROVIDER`, so an env without per-feature keys behaves
 * exactly as before:
 *
 * - `AGENT_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` routes to Claude;
 *   without the key it falls back to Gemini (legacy, logged at startup).
 * - `AGENT_PROVIDER=gemini` or `disabled` resolve to `gemini`, which means
 *   "Gemini when a Gemini key is configured, otherwise disabled".
 * - Coach chat is the exception: `AGENT_PROVIDER=disabled` switches it off
 *   whatever `COACH_PROVIDER` and the keys say (#317, composed in apps/api).
 *
 * An explicit per-feature key never falls back: config fails to load when
 * its vendor's key is missing. Meal illustrations are not routed; they
 * always use Gemini.
 */
export interface ServerAiRouting {
  /** Coach chat (agent + content moderator). */
  readonly coach: AiVendor;
  /** Typed meal estimates and draft refinement (incl. Coach text drafts). */
  readonly mealText: AiVendor;
  /** Every photo draft: meal and label photos, and the Coach photo route. */
  readonly mealPhoto: AiVendor;
  /** Log activity description drafts. */
  readonly activityDraft: AiVendor;
  /** Recipe idea generation. */
  readonly recipeIdeas: AiVendor;
  /** Ingredient photo recognition for recipes. */
  readonly ingredientPhotos: AiVendor;
  /** Recipe cooking assistant. */
  readonly cookingAssistant: AiVendor;
  /** Dev-only evening stretch refinement (ADR-0076). */
  readonly stretchPlan: AiVendor;
}

export type AiRoutedFeature = keyof ServerAiRouting;

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

export interface ServerMealIllustrationConfiguration {
  readonly apiKey: string;
  readonly model: string;
}

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly env: NodeEnv;
  readonly supabase: AuthConfigurationStatus;
  readonly supabaseConfig: ServerSupabaseConfiguration | null;
  readonly agentProvider: "disabled" | "gemini" | "anthropic";
  /** Resolved per-feature vendor routing; see `ServerAiRouting`. */
  readonly aiRouting: ServerAiRouting;
  readonly visionProvider: "disabled" | "stub";
  readonly geminiConfig: ServerGeminiConfiguration | null;
  readonly geminiVisionConfig: ServerGeminiVisionConfiguration | null;
  /** Non-null only when a feature routes to Anthropic and its key is present. */
  readonly anthropicConfig?: ServerAnthropicConfiguration | null;
  readonly sesConfig: ServerSesConfiguration | null;
  readonly appleAuthConfig: ServerAppleAuthConfiguration | null;
  readonly appleRevocationEncryptionKey?: string | undefined;
  readonly aiExternalAccess: boolean;
  /**
   * Stored AI consent versions the server accepts, from
   * `AI_CONSENT_ACCEPTED_VERSIONS`. `null` when unset, meaning the API's
   * default set (every disclosure version still supported by installed
   * builds). Dev narrows it to the current version so testers confirm again.
   */
  readonly aiConsentAcceptedVersions?: readonly string[] | null;
  readonly mealIllustrationConfig?: ServerMealIllustrationConfiguration | null;
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
  mealIllustrationsEnabled: "MEAL_ILLUSTRATIONS_ENABLED",
  geminiImageModel: "GEMINI_IMAGE_MODEL",
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
  anthropicApiKey: "ANTHROPIC_API_KEY",
  anthropicModel: "ANTHROPIC_MODEL",
  anthropicEffort: "ANTHROPIC_EFFORT",
  anthropicTimeoutMs: "ANTHROPIC_TIMEOUT_MS",
  anthropicVisionTimeoutMs: "ANTHROPIC_VISION_TIMEOUT_MS",
  anthropicMaxOutputTokens: "ANTHROPIC_MAX_OUTPUT_TOKENS",
  anthropicWebSearch: "ANTHROPIC_WEB_SEARCH",
  anthropicEnabled: "ANTHROPIC_ENABLED",
  anthropicDevTesting: "ANTHROPIC_DEV_TESTING",
  coachProvider: "COACH_PROVIDER",
  mealTextProvider: "MEAL_TEXT_PROVIDER",
  mealPhotoProvider: "MEAL_PHOTO_PROVIDER",
  activityDraftProvider: "ACTIVITY_DRAFT_PROVIDER",
  recipeIdeasProvider: "RECIPE_IDEAS_PROVIDER",
  ingredientPhotoProvider: "INGREDIENT_PHOTO_PROVIDER",
  cookingAssistantProvider: "COOKING_ASSISTANT_PROVIDER",
  stretchPlanProvider: "STRETCH_PLAN_PROVIDER",
  sesRegion: "SES_REGION",
  sesAccessKeyId: "SES_ACCESS_KEY_ID",
  sesSecretAccessKey: "SES_SECRET_ACCESS_KEY",
  sesFromEmail: "SES_FROM_EMAIL",
  aiDailyUserTokenBudget: "AI_DAILY_USER_TOKEN_BUDGET",
  aiUserRequestsPerMinute: "AI_USER_REQUESTS_PER_MINUTE",
  aiUserMaxConcurrentRequests: "AI_USER_MAX_CONCURRENT_REQUESTS",
  aiExternalAccess: "AI_EXTERNAL_ACCESS",
  aiAllowedEmails: "AI_ALLOWED_EMAILS",
  aiConsentAcceptedVersions: "AI_CONSENT_ACCEPTED_VERSIONS",
  appleTeamId: "APPLE_TEAM_ID",
  appleKeyId: "APPLE_KEY_ID",
  applePrivateKey: "APPLE_PRIVATE_KEY",
  applePrivateKeyPath: "APPLE_PRIVATE_KEY_PATH",
  appleClientId: "APPLE_CLIENT_ID",
  appleRevocationEncryptionKey: "APPLE_REVOCATION_ENCRYPTION_KEY",
} as const;

/** Schema field holding each routed feature's optional override. */
const AI_FEATURE_FIELDS = {
  coach: "coachProvider",
  mealText: "mealTextProvider",
  mealPhoto: "mealPhotoProvider",
  activityDraft: "activityDraftProvider",
  recipeIdeas: "recipeIdeasProvider",
  ingredientPhotos: "ingredientPhotoProvider",
  cookingAssistant: "cookingAssistantProvider",
  stretchPlan: "stretchPlanProvider",
} as const satisfies Record<AiRoutedFeature, keyof typeof SERVER_ENV_KEYS>;

/** Environment key that overrides each routed feature's vendor. */
export const AI_FEATURE_PROVIDER_ENV_KEYS: Readonly<
  Record<AiRoutedFeature, string>
> = Object.fromEntries(
  Object.entries(AI_FEATURE_FIELDS).map(([feature, field]) => [
    feature,
    SERVER_ENV_KEYS[field],
  ]),
) as Record<AiRoutedFeature, string>;

const aiVendorOverride = (key: string) =>
  z
    .enum(["gemini", "anthropic"], {
      errorMap: () => ({ message: `${key} must be gemini or anthropic` }),
    })
    .optional();

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
  agentProvider: z
    .enum(["disabled", "gemini", "anthropic"])
    .default("disabled"),
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
  anthropicApiKey: z
    .string()
    .min(10, "ANTHROPIC_API_KEY must not be empty")
    .optional(),
  // Only Haiku 5.5 accepts the disabled-thinking/low-effort controls the
  // providers send; other Claude models would change cost and 400.
  anthropicModel: z.enum(["claude-haiku-5-5"]).default("claude-haiku-5-5"),
  anthropicEffort: z.enum(["low", "medium", "high"]).default("low"),
  anthropicTimeoutMs: z.coerce
    .number()
    .int("ANTHROPIC_TIMEOUT_MS must be an integer")
    .min(1_000, "ANTHROPIC_TIMEOUT_MS must be >= 1000")
    .max(120_000, "ANTHROPIC_TIMEOUT_MS must be <= 120000")
    .default(30_000),
  anthropicVisionTimeoutMs: z.coerce
    .number()
    .int("ANTHROPIC_VISION_TIMEOUT_MS must be an integer")
    .min(1_000, "ANTHROPIC_VISION_TIMEOUT_MS must be >= 1000")
    .max(120_000, "ANTHROPIC_VISION_TIMEOUT_MS must be <= 120000")
    .default(45_000),
  anthropicMaxOutputTokens: z.coerce
    .number()
    .int("ANTHROPIC_MAX_OUTPUT_TOKENS must be an integer")
    .min(128, "ANTHROPIC_MAX_OUTPUT_TOKENS must be >= 128")
    .max(32_768, "ANTHROPIC_MAX_OUTPUT_TOKENS must be <= 32768")
    .default(8_192),
  anthropicWebSearch: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /**
   * Explicit acknowledgement that AI features may route to Anthropic, valid
   * in any environment (Adam, 2026-10-21: Production routes per ADR-0077).
   */
  anthropicEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Legacy Dev alias of `ANTHROPIC_ENABLED` (ADR-0069); still accepted. */
  anthropicDevTesting: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  coachProvider: aiVendorOverride(SERVER_ENV_KEYS.coachProvider),
  mealTextProvider: aiVendorOverride(SERVER_ENV_KEYS.mealTextProvider),
  mealPhotoProvider: aiVendorOverride(SERVER_ENV_KEYS.mealPhotoProvider),
  activityDraftProvider: aiVendorOverride(
    SERVER_ENV_KEYS.activityDraftProvider,
  ),
  recipeIdeasProvider: aiVendorOverride(SERVER_ENV_KEYS.recipeIdeasProvider),
  ingredientPhotoProvider: aiVendorOverride(
    SERVER_ENV_KEYS.ingredientPhotoProvider,
  ),
  cookingAssistantProvider: aiVendorOverride(
    SERVER_ENV_KEYS.cookingAssistantProvider,
  ),
  stretchPlanProvider: aiVendorOverride(SERVER_ENV_KEYS.stretchPlanProvider),
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
  mealIllustrationsEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  geminiImageModel: z
    .enum(["gemini-3.1-flash-lite-image"])
    .default("gemini-3.1-flash-lite-image"),
  aiExternalAccess: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  aiConsentAcceptedVersions: z
    .string()
    .optional()
    .transform((val) =>
      val === undefined
        ? null
        : [
            ...new Set(
              val
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            ),
          ],
    )
    .refine((versions) => versions === null || versions.length > 0, {
      message:
        "AI_CONSENT_ACCEPTED_VERSIONS must list at least one consent version",
    })
    .refine(
      (versions) =>
        versions === null ||
        versions.every((version) => /^\d{4}-\d{2}-\d{2}$/.test(version)),
      {
        message:
          "AI_CONSENT_ACCEPTED_VERSIONS must be comma-separated YYYY-MM-DD consent versions",
      },
    ),
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
  appleRevocationEncryptionKey: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/)
    .optional(),
});

type BaseServerShape = Record<keyof typeof SERVER_ENV_KEYS, string | undefined>;

type ParsedServerInput = z.infer<typeof baseServerSchema>;

const resolveAiRouting = (value: ParsedServerInput): ServerAiRouting => {
  const inherited: AiVendor =
    value.agentProvider === "anthropic" && value.anthropicApiKey !== undefined
      ? "anthropic"
      : "gemini";
  const routing = {} as Record<AiRoutedFeature, AiVendor>;
  for (const [feature, field] of Object.entries(AI_FEATURE_FIELDS)) {
    routing[feature as AiRoutedFeature] = value[field] ?? inherited;
  }
  return routing;
};

/**
 * Validate per-feature overrides: an explicit vendor must have its key, so
 * a feature never silently falls back to another vendor.
 */
const aiRoutingIssues = (value: ParsedServerInput): ConfigIssue[] => {
  const issues: ConfigIssue[] = [];
  const geminiKeyPresent =
    value.geminiApiKey !== undefined || value.geminiVisionApiKey !== undefined;
  for (const field of Object.values(AI_FEATURE_FIELDS)) {
    const key = SERVER_ENV_KEYS[field];
    const explicit = value[field];
    if (explicit === "anthropic" && value.anthropicApiKey === undefined) {
      issues.push({
        kind: "malformed",
        key,
        reason: `${key}=anthropic requires ${SERVER_ENV_KEYS.anthropicApiKey}.`,
      });
    }
    if (explicit === "gemini" && !geminiKeyPresent) {
      issues.push({
        kind: "malformed",
        key,
        reason: `${key}=gemini requires ${SERVER_ENV_KEYS.geminiApiKey}.`,
      });
    }
  }
  return issues;
};

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
    (parsed.data.agentProvider === "gemini" ||
      parsed.data.mealIllustrationsEnabled) &&
    parsed.data.geminiApiKey === undefined
  ) {
    issues.push({ kind: "missing", keys: [SERVER_ENV_KEYS.geminiApiKey] });
  }
  if (parsed.success) {
    issues.push(...aiRoutingIssues(parsed.data));
  }
  if (
    parsed.success &&
    Object.values(resolveAiRouting(parsed.data)).includes("anthropic") &&
    !parsed.data.anthropicEnabled &&
    !parsed.data.anthropicDevTesting
  ) {
    // ADR-0069 / ADR-0077 — routing to Anthropic is a deliberate decision,
    // so an env that names Anthropic without the acknowledgement fails to
    // load instead of silently sending data to a new processor.
    issues.push({
      kind: "malformed",
      key: SERVER_ENV_KEYS.anthropicEnabled,
      reason:
        "Routing an AI feature to Anthropic (AGENT_PROVIDER or a per-feature *_PROVIDER key) must be acknowledged; set ANTHROPIC_ENABLED=true (ANTHROPIC_DEV_TESTING=true is accepted as a legacy alias).",
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
  const aiRouting = resolveAiRouting(value);
  const anthropicConfig: ServerAnthropicConfiguration | null =
    Object.values(aiRouting).includes("anthropic") &&
    value.anthropicApiKey !== undefined
      ? {
          apiKey: value.anthropicApiKey,
          model: value.anthropicModel,
          effort: value.anthropicEffort,
          timeoutMs: value.anthropicTimeoutMs,
          visionTimeoutMs: value.anthropicVisionTimeoutMs,
          maxOutputTokens: value.anthropicMaxOutputTokens,
          webSearch: value.anthropicWebSearch,
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
    aiRouting,
    visionProvider: value.visionProvider,
    geminiConfig,
    geminiVisionConfig,
    anthropicConfig,
    sesConfig,
    appleAuthConfig,
    ...(value.appleRevocationEncryptionKey !== undefined
      ? { appleRevocationEncryptionKey: value.appleRevocationEncryptionKey }
      : {}),
    mealIllustrationConfig:
      value.mealIllustrationsEnabled && value.geminiApiKey
        ? { apiKey: value.geminiApiKey, model: value.geminiImageModel }
        : null,
    aiExternalAccess: value.aiExternalAccess,
    aiConsentAcceptedVersions: value.aiConsentAcceptedVersions,
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
