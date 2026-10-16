import { z } from "zod";

import { isStorableRunTimezone } from "./run";

// @mizyun/contracts does not depend on @mizyun/core, so the Font grade list and
// normaliser are duplicated here. Keep in sync with core/bouldering-grades.ts.
const FONT_GRADES = [
  "3",
  "4",
  "4+",
  "5",
  "5+",
  "6A",
  "6A+",
  "6B",
  "6B+",
  "6C",
  "6C+",
  "7A",
  "7A+",
  "7B",
  "7B+",
  "7C",
  "7C+",
  "8A",
  "8A+",
  "8B",
  "8B+",
  "8C",
  "8C+",
] as const;
export type BoulderFontGrade = (typeof FONT_GRADES)[number];
const normaliseFontGrade = (input: string): BoulderFontGrade | null => {
  const candidate = input.trim().toUpperCase();
  return (FONT_GRADES as readonly string[]).includes(candidate)
    ? (candidate as BoulderFontGrade)
    : null;
};

const BOULDER_NOTE_MAX = 280;
const BOULDER_GYM_NAME_MAX = 60;
const BOULDER_ATTEMPTS_MAX = 99;

export const fontGradeSchema = z.string().transform((value, ctx) => {
  const grade = normaliseFontGrade(value);
  if (grade === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose a Font grade.",
    });
    return z.NEVER;
  }
  return grade;
});

export const boulderResultSchema = z.enum(["flash", "sent", "not_yet"]);
export type BoulderResultValue = z.infer<typeof boulderResultSchema>;
export const holdColourSchema = z.enum([
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "black",
  "white",
  "grey",
  "other",
]);
export type HoldColourValue = z.infer<typeof holdColourSchema>;

const activityDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Enter a valid calendar date.");
const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid timezone.");
const instantSchema = z.string().datetime({ offset: true });
const gymNameSchema = z.string().trim().min(1).max(BOULDER_GYM_NAME_MAX);
const sessionNotesSchema = z.string().trim().max(4000);
const noteSchema = z
  .string()
  .trim()
  .max(BOULDER_NOTE_MAX)
  .transform((value) => (value === "" ? null : value));

export const isStorableBoulderTimezone = isStorableRunTimezone;

export const boulderSessionDetailsSchema = z
  .object({
    version: z.literal(1),
    gradeScale: z.literal("font"),
    recordingTimezone: timezoneSchema,
    activityDate: activityDateSchema,
    gymName: gymNameSchema.nullable(),
  })
  .strict();
export type BoulderSessionDetails = z.infer<typeof boulderSessionDetailsSchema>;

export const boulderSessionStartSchema = z
  .object({
    clientOperationId: z.string().uuid(),
    recordingTimezone: timezoneSchema.refine(
      isStorableBoulderTimezone,
      "Enter a named timezone.",
    ),
    gymName: gymNameSchema.nullable().default(null),
  })
  .strict();
export type BoulderSessionStart = z.infer<typeof boulderSessionStartSchema>;

export const boulderSessionFinishSchema = z
  .object({ notes: sessionNotesSchema.nullable().default(null) })
  .strict();
export type BoulderSessionFinish = z.infer<typeof boulderSessionFinishSchema>;

export const boulderSessionUpdateSchema = z
  .object({
    gymName: gymNameSchema.nullable().optional(),
    notes: sessionNotesSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.gymName !== undefined || value.notes !== undefined,
    "Provide a gym name or notes to update.",
  );
export type BoulderSessionUpdate = z.infer<typeof boulderSessionUpdateSchema>;

const attemptsRefinement = (
  value: { result: BoulderResultValue; attempts: number | null },
  ctx: z.RefinementCtx,
): void => {
  const { result, attempts } = value;
  let message: string | null = null;
  if (result === "flash") {
    if (attempts !== 1) message = "A flash is exactly one attempt.";
  } else if (attempts !== null) {
    const min = result === "sent" ? 2 : 1;
    if (attempts < min || attempts > BOULDER_ATTEMPTS_MAX)
      message =
        result === "sent"
          ? `Enter 2-${BOULDER_ATTEMPTS_MAX} attempts, or leave it blank.`
          : `Enter 1-${BOULDER_ATTEMPTS_MAX} attempts, or leave it blank.`;
  }
  if (message)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts"], message });
};

const ascentFields = {
  clientOperationId: z.string().uuid(),
  grade: fontGradeSchema,
  result: boulderResultSchema,
  attempts: z.number().int().nullable().default(null),
  holdColour: holdColourSchema.nullable().default(null),
  note: noteSchema.nullable().default(null),
  photoAssetId: z.string().uuid().nullable().default(null),
};

export const boulderAscentCreateSchema = z
  .object(ascentFields)
  .strict()
  .superRefine(attemptsRefinement);
export type BoulderAscentCreate = z.infer<typeof boulderAscentCreateSchema>;

export const boulderAscentUpdateSchema = z
  .object({ ...ascentFields, expectedRevision: z.number().int().positive() })
  .strict()
  .superRefine(attemptsRefinement);
export type BoulderAscentUpdate = z.infer<typeof boulderAscentUpdateSchema>;

export const boulderAscentRemoveQuerySchema = z
  .object({ operationId: z.string().uuid() })
  .strict();
export type BoulderAscentRemoveQuery = z.infer<
  typeof boulderAscentRemoveQuerySchema
>;

export const boulderAscentRecordSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    sequence: z.number().int().positive(),
    gradeScale: z.literal("font"),
    grade: fontGradeSchema,
    gradeRank: z
      .number()
      .int()
      .min(0)
      .max(FONT_GRADES.length - 1),
    result: boulderResultSchema,
    attempts: z.number().int().nullable(),
    holdColour: holdColourSchema.nullable(),
    note: z.string().max(BOULDER_NOTE_MAX).nullable(),
    photoAssetId: z.string().uuid().nullable(),
    projectId: z.string().uuid().nullable(),
    loggedAt: instantSchema,
    revision: z.number().int().positive(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();
export type BoulderAscentRecord = z.infer<typeof boulderAscentRecordSchema>;

export const boulderSessionSummarySchema = z
  .object({
    boulders: z.number().int().nonnegative(),
    sends: z.number().int().nonnegative(),
    flashes: z.number().int().nonnegative(),
    attempts: z.number().int().nonnegative(),
    attemptsComplete: z.boolean(),
    topGrade: fontGradeSchema.nullable(),
  })
  .strict();
export type BoulderSessionSummaryRecord = z.infer<
  typeof boulderSessionSummarySchema
>;

export const boulderSessionRecordSchema = z
  .object({
    id: z.string().uuid(),
    clientOperationId: z.string().uuid(),
    name: z.string(),
    notes: z.string().nullable(),
    startedAt: instantSchema,
    completedAt: instantSchema.nullable(),
    session: boulderSessionDetailsSchema,
    summary: boulderSessionSummarySchema,
  })
  .strict();
export type BoulderSessionRecord = z.infer<typeof boulderSessionRecordSchema>;

export const boulderAchievementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("first_session") }).strict(),
  z
    .object({
      kind: z.literal("personal_best"),
      gradeRank: z
        .number()
        .int()
        .min(0)
        .max(FONT_GRADES.length - 1),
      grade: fontGradeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("first_flash"),
      gradeRank: z
        .number()
        .int()
        .min(0)
        .max(FONT_GRADES.length - 1),
      grade: fontGradeSchema,
    })
    .strict(),
]);
export type BoulderAchievementRecord = z.infer<typeof boulderAchievementSchema>;

export const boulderSessionResponseSchema = z
  .object({
    session: boulderSessionRecordSchema,
    ascents: z.array(boulderAscentRecordSchema),
  })
  .strict();
export type BoulderSessionResponse = z.infer<
  typeof boulderSessionResponseSchema
>;

export const boulderFinishResponseSchema = z
  .object({
    session: boulderSessionRecordSchema,
    ascents: z.array(boulderAscentRecordSchema),
    achievements: z.array(boulderAchievementSchema),
  })
  .strict();
export type BoulderFinishResponse = z.infer<typeof boulderFinishResponseSchema>;

export const boulderAscentResponseSchema = z
  .object({ ascent: boulderAscentRecordSchema })
  .strict();
export type BoulderAscentResponse = z.infer<typeof boulderAscentResponseSchema>;

export const boulderRemovedResponseSchema = z
  .object({ removed: z.literal(true) })
  .strict();
export type BoulderRemovedResponse = z.infer<
  typeof boulderRemovedResponseSchema
>;

export const boulderSessionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();
export type BoulderSessionListQuery = z.infer<
  typeof boulderSessionListQuerySchema
>;

export const boulderSessionListResponseSchema = z
  .object({
    sessions: z.array(boulderSessionRecordSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type BoulderSessionListResponse = z.infer<
  typeof boulderSessionListResponseSchema
>;

export const boulderActiveSessionResponseSchema = z
  .object({
    session: boulderSessionRecordSchema.nullable(),
    ascents: z.array(boulderAscentRecordSchema),
  })
  .strict();
export type BoulderActiveSessionResponse = z.infer<
  typeof boulderActiveSessionResponseSchema
>;

export const boulderProgressWindowSchema = z.enum(["30d", "90d", "all"]);
export type BoulderProgressWindowValue = z.infer<
  typeof boulderProgressWindowSchema
>;
export const boulderProgressQuerySchema = z
  .object({ window: boulderProgressWindowSchema.default("90d") })
  .strict();
export type BoulderProgressQuery = z.infer<typeof boulderProgressQuerySchema>;

export const boulderProgressResponseSchema = z
  .object({
    window: boulderProgressWindowSchema,
    pyramid: z.array(
      z
        .object({
          grade: fontGradeSchema,
          gradeRank: z
            .number()
            .int()
            .min(0)
            .max(FONT_GRADES.length - 1),
          sends: z.number().int().nonnegative(),
          flashes: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    timeline: z.array(
      z
        .object({
          sessionId: z.string().uuid(),
          activityDate: activityDateSchema,
          topGrade: fontGradeSchema.nullable(),
          personalBest: z.boolean(),
        })
        .strict(),
    ),
    totals: z
      .object({
        sessions: z.number().int().nonnegative(),
        sends: z.number().int().nonnegative(),
        flashes: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type BoulderProgressResponse = z.infer<
  typeof boulderProgressResponseSchema
>;
