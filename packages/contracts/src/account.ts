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

/** Private media stub: only `id`, `createdAt`. */
export const privateMediaStubSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});

/**
 * Exhaustive user export envelope. Every Phase 2 feature is
 * represented; reserved fields default to empty arrays until the
 * per-feature list endpoints land.
 */
export const accountExportSchema = z.object({
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
  privateMedia: z.array(privateMediaStubSchema),
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

/**
 * Re-exports the `YYYY-MM-DD` schema for callers that need to
 * reason about export slicing by date in a future segment.
 */
export { isoDateSchema };
