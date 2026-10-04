import { z } from "./zod-runtime.mjs";
import {
  analyticsConsentResponseSchema,
  analyticsEventV2Schema,
} from "./analytics.mjs";
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
    productAnalyticsEvents: z.number().int().nonnegative().optional(),
  }),
});
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
  productAnalytics: z
    .object({
      consent: analyticsConsentResponseSchema.nullable(),
      events: z.array(analyticsEventV2Schema),
    })
    .optional(),
});
export const accountExportResponseSchema = z.object({
  export: accountExportSchema,
});
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
export const updateAiConsentSchema = z.object({
  granted: z.boolean(),
  confirmedAdult: z.boolean(),
  consentVersion: z.string().default(CURRENT_AI_CONSENT_VERSION),
});
export const aiConsentResponseSchema = z.object({
  consent: aiConsentSchema,
});
