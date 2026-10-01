import { z } from "zod";

/** Explicitly published targets, never the private routine details object. */
export const communityRoutineExerciseSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    sets: z.number().int().min(1).max(20),
    repsMin: z.number().int().min(1).max(100),
    repsMax: z.number().int().min(1).max(100),
    loadKg: z.number().min(0).max(1000).nullable(),
    restSeconds: z.number().int().min(0).max(1800),
  })
  .strict()
  .refine((e) => e.repsMin <= e.repsMax, "Invalid repetition range");
export const communityRoutineSnapshotSchema = z
  .object({
    schemaVersion: z.literal("2026-10-01"),
    title: z.string().trim().min(1).max(80),
    exercises: z.array(communityRoutineExerciseSchema).min(1).max(30),
  })
  .strict();
export const communityRoutinePreviewSchema = z
  .object({
    sourceUpdatedAt: z.string().datetime({ offset: true }),
    snapshot: communityRoutineSnapshotSchema,
  })
  .strict();
export const communityRoutineShareSchema = z
  .object({
    id: z.string().uuid(),
    authorHandle: z.string(),
    version: z.number().int().positive(),
    isOwner: z.boolean(),
    available: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    snapshot: communityRoutineSnapshotSchema,
  })
  .strict();
export const communityRoutineListSchema = z
  .object({
    items: z.array(communityRoutineShareSchema).max(50),
    nextCursor: z.string().uuid().nullable(),
  })
  .strict();
export const communityRoutinePublishSchema = z
  .object({
    sourceWorkoutId: z.string().uuid(),
    sourceUpdatedAt: z.string().datetime({ offset: true }),
    operationId: z.string().uuid(),
    snapshot: communityRoutineSnapshotSchema,
    confirmed: z.literal(true),
  })
  .strict();
export const communityRoutineImportSchema = z
  .object({
    confirmed: z.literal(true),
    version: z.number().int().positive(),
  })
  .strict();
export const communityRoutineImportResultSchema = z
  .object({
    workoutId: z.string().uuid(),
    alreadyImported: z.boolean(),
  })
  .strict();
export type CommunityRoutineSnapshot = z.infer<
  typeof communityRoutineSnapshotSchema
>;
export type CommunityRoutinePreview = z.infer<
  typeof communityRoutinePreviewSchema
>;
export type CommunityRoutineShare = z.infer<typeof communityRoutineShareSchema>;

export const communityRoutineIdSchema = z
  .object({ id: z.string().uuid() })
  .strict();
export const communityRoutinePreviewInputSchema = z
  .object({
    sourceWorkoutId: z.string().uuid(),
    title: z.string().trim().min(1).max(80),
  })
  .strict();
export const communityRoutineQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().uuid().optional(),
    mine: z.enum(["true", "false"]).optional(),
  })
  .strict();
export const communityRoutineUnshareResultSchema = z
  .object({ unshared: z.literal(true) })
  .strict();

export type CommunityRoutineList = z.infer<typeof communityRoutineListSchema>;
export type CommunityRoutineImportResult = z.infer<
  typeof communityRoutineImportResultSchema
>;
