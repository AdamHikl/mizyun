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
export const accountExportSchema = z.object({
  manifest: exportManifestSchema.optional(),
  userId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  profile: z.unknown().nullable(),
  goals: z.array(z.unknown()),
  foodEntries: z.array(z.unknown()),
  exercises: z.array(z.unknown()),
  workouts: z.array(z.unknown()),
  workoutSets: z.array(z.unknown()),
  bodyMeasurements: z.array(z.unknown()),
  conversations: z.array(conversationStubSchema),
  memories: z.array(z.unknown()),
  privateMedia: z.array(exportedMediaAssetSchema),
  feedback: z.array(z.unknown()).default([]),
  aiConsent: z.unknown().nullable().optional(),
});

export type AccountExport = z.infer<typeof accountExportSchema>;

export const accountExportResponseSchema = z.object({
  export: accountExportSchema,
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
 * Current authoritative version for third-party AI processing disclosures.
 * (Finding R5 / REL-AUD-005 / Q8-B).
 */
export const CURRENT_AI_CONSENT_VERSION = "2026-09-08";

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
