/**
 * History import wire schemas (#333, ADR-0083).
 *
 * `POST /v1/history-imports/preview` parses one exported file and writes
 * nothing. `POST /v1/history-imports` repeats the same file with the user's
 * exercise mapping and a client-generated batch id; replaying the same
 * request returns the same batch. `DELETE /v1/history-imports/:id` removes
 * the batch's records. Strava input is only `activities.csv` from the user's
 * own account export; GPS files are never sent.
 */
import { z } from "zod";

import { isStorableRunTimezone } from "./run";

export const historyImportFormatSchema = z.enum([
  "hevy",
  "strong",
  "strava",
  "generic",
]);
export type HistoryImportFormatWire = z.infer<typeof historyImportFormatSchema>;

/** File text cap; the route's body limit sits just above it. */
export const HISTORY_IMPORT_MAX_CONTENT = 8_000_000;
/**
 * Request body cap: 8,000,000 characters can take up to 3 UTF-8 bytes each,
 * plus JSON escaping and the mapping list.
 */
export const HISTORY_IMPORT_BODY_LIMIT = 26 * 1024 * 1024;

const fileFields = {
  /** Omitted: detect from the header row. */
  format: historyImportFormatSchema.optional(),
  fileName: z.string().trim().min(1).max(200).optional(),
  content: z.string().min(1).max(HISTORY_IMPORT_MAX_CONTENT),
  /** Named IANA zone for files that store local wall-clock times. */
  timezone: z
    .string()
    .min(1)
    .max(100)
    .refine(isStorableRunTimezone, "Enter a named timezone."),
  weightUnit: z.enum(["kg", "lb"]).default("kg"),
  distanceUnit: z.enum(["km", "mi"]).default("km"),
};

export const historyImportPreviewRequestSchema = z.object(fileFields).strict();
export type HistoryImportPreviewRequest = z.infer<
  typeof historyImportPreviewRequestSchema
>;

export const historyExerciseTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("catalog"),
      catalogId: z.string().min(1).max(120),
    })
    .strict(),
  z
    .object({
      kind: z.literal("custom"),
      name: z.string().trim().min(1).max(120),
    })
    .strict(),
  z.object({ kind: z.literal("skip") }).strict(),
]);
export type HistoryExerciseTargetWire = z.infer<
  typeof historyExerciseTargetSchema
>;

export const historyImportConfirmRequestSchema = z
  .object({
    ...fileFields,
    batchId: z.string().uuid(),
    mappings: z
      .array(
        z
          .object({
            sourceName: z.string().min(1).max(200),
            target: historyExerciseTargetSchema,
          })
          .strict(),
      )
      .max(400),
    /** Skip records that overlap an existing run or strength session. */
    skipOverlaps: z.boolean().default(true),
  })
  .strict();
export type HistoryImportConfirmRequest = z.infer<
  typeof historyImportConfirmRequestSchema
>;

const trackingModeSchema = z.enum([
  "load_reps",
  "duration",
  "duration_distance",
]);

export const historyImportPreviewSchema = z
  .object({
    format: historyImportFormatSchema,
    workouts: z.number().int().nonnegative(),
    sets: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
    firstStartedAt: z.string().datetime().nullable(),
    lastStartedAt: z.string().datetime().nullable(),
    /** Records already imported by an earlier batch. */
    alreadyImported: z.number().int().nonnegative(),
    /** Records that overlap an existing run or strength session. */
    overlapping: z.number().int().nonnegative(),
    /** False when a unit came from the request, not the file. */
    unitsFromFile: z.boolean(),
    exercises: z.array(
      z
        .object({
          sourceName: z.string(),
          setCount: z.number().int().positive(),
          workoutCount: z.number().int().positive(),
          trackingMode: trackingModeSchema,
          match: z
            .object({
              catalogId: z.string(),
              name: z.string(),
              confidence: z.enum(["exact", "suggested"]),
            })
            .nullable(),
        })
        .strict(),
    ),
    /** First issues in file order; `issueCount` is the total. */
    issues: z.array(
      z
        .object({
          line: z.number().int().positive(),
          code: z.enum([
            "malformed_row",
            "invalid_date",
            "invalid_number",
            "empty_set",
            "out_of_range",
            "future",
            "duplicate",
            "too_many_sets",
          ]),
        })
        .strict(),
    ),
    issueCount: z.number().int().nonnegative(),
    /** Strava activity types that are not imported, with counts. */
    skippedActivities: z.array(
      z
        .object({ type: z.string(), count: z.number().int().positive() })
        .strict(),
    ),
  })
  .strict();
export type HistoryImportPreview = z.infer<typeof historyImportPreviewSchema>;

export const historyImportPreviewResponseSchema = z
  .object({ preview: historyImportPreviewSchema })
  .strict();
export type HistoryImportPreviewResponse = z.infer<
  typeof historyImportPreviewResponseSchema
>;

export const historyImportBatchSchema = z
  .object({
    id: z.string().uuid(),
    format: historyImportFormatSchema,
    fileName: z.string().nullable(),
    status: z.enum(["importing", "complete"]),
    workoutCount: z.number().int().nonnegative(),
    setCount: z.number().int().nonnegative(),
    runCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    overlapCount: z.number().int().nonnegative(),
    firstStartedAt: z.string().datetime().nullable(),
    lastStartedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();
export type HistoryImportBatch = z.infer<typeof historyImportBatchSchema>;

export const historyImportBatchResponseSchema = z
  .object({ batch: historyImportBatchSchema })
  .strict();
export type HistoryImportBatchResponse = z.infer<
  typeof historyImportBatchResponseSchema
>;

export const historyImportBatchListResponseSchema = z
  .object({ batches: z.array(historyImportBatchSchema) })
  .strict();
export type HistoryImportBatchListResponse = z.infer<
  typeof historyImportBatchListResponseSchema
>;

export const historyImportRemovedResponseSchema = z
  .object({
    removed: z.literal(true),
    workouts: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
    exercises: z.number().int().nonnegative(),
  })
  .strict();
export type HistoryImportRemovedResponse = z.infer<
  typeof historyImportRemovedResponseSchema
>;
