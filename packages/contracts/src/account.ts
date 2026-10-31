/**
 * Account export + deletion wire schemas (DATA-001).
 *
 * The export envelope mirrors `AccountExport` in `@mizyun/core`.
 * The deletion flow is two-step:
 *   1. `POST /v1/account/delete/request` returns a
 *      `confirmationToken` (short-lived, opaque).
 *   2. `DELETE /v1/account` with `{ confirmationToken }` in the
 *      body confirms the deletion. A misclick without a valid
 *      token returns a 409 with the typed `AccountDeletionError`.
 *
 * The two-step pattern is the documented safety mechanism for
 * AUTH-04. The challenge token TTL is fixed at 5 minutes; the
 * client must surface it explicitly so the user understands
 * "yes, delete everything".
 */
import { z } from "zod";
import {
  exportedMealIllustrationSchema,
  exportedMealIllustrationUsageSchema,
} from "./meal-illustration";
import {
  analyticsConsentResponseSchema,
  analyticsEventV2Schema,
  ANALYTICS_DASHBOARD_CATALOG,
  ANALYTICS_DASHBOARD_V1_CATALOG,
  ANALYTICS_ACTIVATION_V1_CATALOG,
  legacyAnalyticsEventV2Schema,
} from "./analytics";

/** A `YYYY-MM-DD` date for the day-filter query params. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD form");

/**
 * Conversation stub: only `id`, `title`, `createdAt`. The full
 * conversation history is reserved for the CONV-* segment; the
 * export envelope carries just enough for the UI to render a
 * "your past conversations" list.
 */
export const conversationStubSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(
    z.object({
      id: z.string().uuid(),
      role: z.enum(["user", "assistant"]),
      text: z.string(),
      status: z.enum(["complete", "failed"]),
      createdAt: z.string().datetime(),
    }),
  ),
});

/** Export manifest containing version, timestamp, completeness, and item counts. */
export const exportManifestSchema = z.object({
  schemaVersion: z.literal("2026-09-08"),
  generatedAt: z.string().datetime(),
  completeness: z.enum(["complete", "partial"]),
  counts: z.object({
    profiles: z.number().int().nonnegative(),
    goals: z.number().int().nonnegative(),
    foodEntries: z.number().int().nonnegative(),
    exercises: z.number().int().nonnegative(),
    workouts: z.number().int().nonnegative(),
    workoutSets: z.number().int().nonnegative(),
    bodyMeasurements: z.number().int().nonnegative(),
    conversations: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative(),
    privateMedia: z.number().int().nonnegative(),
    feedback: z.number().int().nonnegative(),
    aiConsents: z.number().int().nonnegative().optional(),
    healthDataConsents: z.number().int().nonnegative().optional(),
    productAnalyticsEvents: z.number().int().nonnegative().optional(),
  }),
});

export type ExportManifest = z.infer<typeof exportManifestSchema>;

/** Private media asset with download URL for offline export retrieval. */
export const exportedMediaAssetSchema = z.object({
  id: z.string().uuid(),
  objectPath: z.string().default(""),
  purpose: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  byteSize: z.number().int().nonnegative().nullable().optional(),
  downloadUrl: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type ExportedMediaAsset = z.infer<typeof exportedMediaAssetSchema>;

/** Private media stub backwards compatibility alias. */
export const privateMediaStubSchema = exportedMediaAssetSchema;

/**
 * Exhaustive user export envelope. Every Phase 2 feature is
 * represented; reserved fields default to empty arrays until the
 * per-feature list endpoints land.
 */
/**
 * Community section of the account export. Installed Store builds up to
 * 1.0.9 (9) accept only "2026-09-30" and "2026-10-01" in a strict object, so
 * the server labels the (additive) "2026-10-11" categories as "2026-10-01"
 * for requests without the client compatibility header.
 */
export const LEGACY_COMMUNITY_EXPORT_SCHEMA_VERSION = "2026-10-01";

export const communityAccountExportSchema = z
  .object({
    schemaVersion: z.enum(["2026-09-30", "2026-10-01", "2026-10-11"]),
    consistency: z.literal("live_keyset"),
    completeness: z.literal("complete"),
    counts: z.record(z.number().int().nonnegative()),
    categories: z.record(z.array(z.record(z.unknown()))),
  })
  .strict();

/** Content-free operational accounting; never prompts, images or generated recipes. */
const exportedRecipeRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.enum(["suggest", "recognize"]),
    status: z.enum(["attempting", "succeeded", "failed", "expired"]),
    createdAt: z.string().datetime(),
    budgetDay: isoDateSchema.refine((value) => {
      const timestamp = Date.parse(`${value}T00:00:00.000Z`);
      return (
        Number.isFinite(timestamp) &&
        new Date(timestamp).toISOString().slice(0, 10) === value
      );
    }, "budget day must be a valid date"),
    tokensCharged: z.number().int().min(0).max(2_000_000),
  })
  .strict();

export const accountExportSchema = z.object({
  recipeRequests: z.array(exportedRecipeRequestSchema).optional(),
  mealIllustrations: z.array(exportedMealIllustrationSchema).optional(),
  mealImagePaths: z
    .array(
      z
        .object({
          userId: z.string().uuid(),
          pathKey: z.string().regex(/^[a-f0-9]{64}$/),
          createdAt: z.string().datetime(),
        })
        .strict(),
    )
    .optional(),
  mealIllustrationUsage: z
    .array(exportedMealIllustrationUsageSchema)
    .optional(),
  manifest: exportManifestSchema.optional(),
  userId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  profile: z.unknown().nullable(),
  goals: z.array(z.unknown()),
  foodEntries: z.array(z.unknown()),
  exercises: z.array(z.unknown()),
  runOperationReceipts: z.array(z.record(z.unknown())).optional(),
  subscriptionEntitlements: z.array(z.record(z.unknown())).optional(),
  bouldering: z
    .object({
      ascents: z.array(z.record(z.unknown())),
      receipts: z.array(z.record(z.unknown())),
      projects: z.array(z.record(z.unknown())).optional(),
    })
    .optional(),
  /** History import batches and per-record provenance (ADR-0083). */
  historyImports: z
    .object({
      batches: z.array(z.record(z.unknown())),
      records: z.array(z.record(z.unknown())),
    })
    .optional(),
  workouts: z.array(z.unknown()),
  workoutSets: z.array(z.unknown()),
  bodyMeasurements: z.array(z.unknown()),
  conversations: z.array(conversationStubSchema),
  memories: z.array(z.unknown()),
  privateMedia: z.array(exportedMediaAssetSchema),
  feedback: z.array(z.unknown()).default([]),
  aiConsent: z.unknown().nullable().optional(),
  healthDataConsent: z.unknown().nullable().optional(),
  healthDataConsentHistory: z.array(z.record(z.unknown())).optional(),
  community: communityAccountExportSchema.optional(),
  calorieAdjustmentProposals: z.array(z.record(z.unknown())).optional(),
  /**
   * Installed Store builds up to 1.0.9 (9) parse this object strictly with
   * only `schedules` and `occurrences`, so the server never adds keys here.
   * The `suggestion*` keys are accepted only from servers that predate
   * `recurringMealSuggestions` (Dev rollout skew); current servers omit them.
   */
  recurringMeals: z
    .object({
      schedules: z.array(z.record(z.unknown())),
      occurrences: z.array(z.record(z.unknown())),
      suggestionStates: z.array(z.record(z.unknown())).optional(),
      suggestionPreferences: z.array(z.record(z.unknown())).optional(),
      suggestionReceipts: z.array(z.record(z.unknown())).optional(),
    })
    .strict()
    .optional(),
  /** Recurring meal suggestion state, preferences and operation receipts. */
  recurringMealSuggestions: z
    .object({
      states: z.array(z.record(z.unknown())),
      preferences: z.array(z.record(z.unknown())),
      receipts: z.array(z.record(z.unknown())),
    })
    .strict()
    .optional(),
  productAnalytics: z
    .object({
      consent: analyticsConsentResponseSchema.nullable(),
      events: z.array(analyticsEventV2Schema),
      catalog: z
        .enum([
          "legacy-v2",
          ANALYTICS_DASHBOARD_V1_CATALOG,
          ANALYTICS_ACTIVATION_V1_CATALOG,
          ANALYTICS_DASHBOARD_CATALOG,
        ])
        .optional(),
      omittedEventCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type AccountExport = z.infer<typeof accountExportSchema>;

export const accountExportResponseSchema = z.object({
  export: accountExportSchema,
});
/** Mirrors the pre-dashboard client's strict embedded analytics parser. */
export const legacyAccountExportResponseSchema = z.object({
  export: accountExportSchema.extend({
    productAnalytics: z
      .object({
        consent: analyticsConsentResponseSchema.nullable(),
        events: z.array(legacyAnalyticsEventV2Schema),
      })
      .optional(),
  }),
});

export type AccountExportResponse = z.infer<typeof accountExportResponseSchema>;

/**
 * Body for `DELETE /v1/account`. The confirmation token is the
 * only required field; everything else is reserved for future
 * options (e.g. `dryRun: true`).
 */
export const accountDeleteSchema = z
  .object({
    confirmationToken: z.string().trim().min(1).max(256),
    appleAuthorizationCode: z.string().trim().min(1).optional(),
  })
  .strict();

export type AccountDeleteBody = z.infer<typeof accountDeleteSchema>;

export const accountDeleteResponseSchema = z.object({
  deleted: z.boolean(),
});

export type AccountDeleteResponse = z.infer<typeof accountDeleteResponseSchema>;

export const accountDeleteChallengeResponseSchema = z.object({
  confirmationToken: z.string(),
  expiresAt: z.string().datetime(),
});

export type AccountDeleteChallengeResponse = z.infer<
  typeof accountDeleteChallengeResponseSchema
>;

export const accountDeleteStatusSchema = z
  .object({
    confirmationToken: z.string().trim().min(1).max(256),
  })
  .strict();

export type AccountDeleteStatusBody = z.infer<typeof accountDeleteStatusSchema>;

export const accountDeleteStatusResponseSchema = z.object({
  status: z.enum(["challenge_issued", "in_progress", "completed", "failed"]),
  stage: z.enum(["none", "storage", "memory", "auth", "done"]),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type AccountDeleteStatusResponse = z.infer<
  typeof accountDeleteStatusResponseSchema
>;

/**
 * AI disclosure version saved by builds that named only Google Gemini
 * (including the installed build6/build7 Store apps).
 */
export const LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY = "2026-09-08";

/**
 * The first per-feature Anthropic and Google disclosure, which said Log
 * activity stays on Apple Intelligence iPhones (ADR-0077).
 */
export const AI_CONSENT_VERSION_TWO_PROVIDERS = "2026-10-20";

/**
 * Current authoritative version for third-party AI processing disclosures:
 * the per-feature Anthropic and Google Gemini disclosure, where Log activity
 * falls back to Anthropic when the on-device model fails (ADR-0074, amended
 * 2026-10-21). New builds save and display this version. (Finding R5 /
 * REL-AUD-005 / Q8-B).
 */
export const CURRENT_AI_CONSENT_VERSION = "2026-10-21";

/**
 * Stored consent versions the server accepts by default, so installed older
 * builds keep working. An environment narrows this with
 * `AI_CONSENT_ACCEPTED_VERSIONS` (for example Dev, to ask testers again).
 */
export const DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS: readonly string[] = [
  LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
  AI_CONSENT_VERSION_TWO_PROVIDERS,
  CURRENT_AI_CONSENT_VERSION,
];

/**
 * Stored consent versions whose disclosure names Anthropic (Claude). The
 * server may serve a request with Anthropic only when the user's authorized
 * stored version is listed here; every other version (including the legacy
 * Gemini-only `2026-09-08`) is served by Gemini. Add a future version here
 * only when its disclosure names Anthropic.
 */
export const AI_CONSENT_VERSIONS_DISCLOSING_ANTHROPIC: readonly string[] = [
  AI_CONSENT_VERSION_TWO_PROVIDERS,
  CURRENT_AI_CONSENT_VERSION,
];

/**
 * Whether a stored AI consent version disclosed Anthropic as a processor.
 * Unknown, missing and legacy versions return false (fail closed to Gemini).
 */
export const aiConsentDisclosesAnthropic = (
  version: string | null | undefined,
): boolean =>
  typeof version === "string" &&
  AI_CONSENT_VERSIONS_DISCLOSING_ANTHROPIC.includes(version);

/** AI features a consent disclosure can name per vendor (ADR-0077). */
export type AiRoutedFeature =
  | "coach"
  | "mealText"
  | "mealPhoto"
  | "activityDraft"
  | "recipeIdeas"
  | "ingredientPhoto"
  | "cookingAssistant"
  | "stretchPlan";

/**
 * Features the Anthropic-naming disclosures (2026-10-20, 2026-10-21) list
 * for Anthropic: Coach chat, typed meal estimates and draft changes, and Log
 * activity descriptions. Every other feature was disclosed for Google only.
 */
export const AI_FEATURES_DISCLOSED_FOR_ANTHROPIC: readonly AiRoutedFeature[] = [
  "coach",
  "mealText",
  "activityDraft",
];

/**
 * Whether a stored consent version disclosed Anthropic for this feature.
 * Fails closed (false) for undisclosed features and unknown versions.
 */
export const aiConsentDisclosesAnthropicFor = (
  version: string | null | undefined,
  feature: AiRoutedFeature,
): boolean =>
  aiConsentDisclosesAnthropic(version) &&
  AI_FEATURES_DISCLOSED_FOR_ANTHROPIC.includes(feature);

export const aiConsentSchema = z.object({
  granted: z.boolean(),
  confirmedAdult: z.boolean(),
  consentVersion: z.string(),
  consentedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});

export type AiConsent = z.infer<typeof aiConsentSchema>;

export const updateAiConsentSchema = z.object({
  granted: z.boolean(),
  confirmedAdult: z.boolean(),
  consentVersion: z.string().default(CURRENT_AI_CONSENT_VERSION),
  birthYear: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear())
    .optional(),
});

export type UpdateAiConsent = z.infer<typeof updateAiConsentSchema>;

export const aiConsentResponseSchema = z.object({
  consent: aiConsentSchema,
});

export type AiConsentResponse = z.infer<typeof aiConsentResponseSchema>;

/**
 * Re-exports the `YYYY-MM-DD` schema for callers that need to
 * reason about export slicing by date in a future segment.
 */
export { isoDateSchema };

/**
 * Explicit consent to store and use health data (GDPR Art. 9(2)(a), PRIV-01):
 * weight, body measurements, height, sex at birth, birth year, meals and
 * workouts. Separate from the Terms, AI consent and analytics. Bump the
 * version when the in-app explanation changes materially.
 */
export const CURRENT_HEALTH_DATA_CONSENT_VERSION = "2026-10-27";

export const healthDataConsentSchema = z.object({
  granted: z.boolean(),
  consentVersion: z.string(),
  consentedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});

export type HealthDataConsent = z.infer<typeof healthDataConsentSchema>;

export const updateHealthDataConsentSchema = z
  .object({
    granted: z.boolean(),
    consentVersion: z.string().trim().min(1).max(32),
  })
  .strict();

export type UpdateHealthDataConsent = z.infer<
  typeof updateHealthDataConsentSchema
>;

export const healthDataConsentResponseSchema = z.object({
  consent: healthDataConsentSchema,
});

export type HealthDataConsentResponse = z.infer<
  typeof healthDataConsentResponseSchema
>;

/** True for a granted, unrevoked consent to the current explanation. */
export const isHealthDataConsentCurrent = (
  consent: Pick<
    HealthDataConsent,
    "granted" | "consentVersion" | "revokedAt"
  > | null,
): boolean =>
  consent !== null &&
  consent.granted &&
  consent.revokedAt === null &&
  consent.consentVersion === CURRENT_HEALTH_DATA_CONSENT_VERSION;
