import { z } from "zod";

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
const durationSchema = z.number().int().min(1).max(86400);
const distanceSchema = z.number().positive().max(1000000).multipleOf(0.01);
const effortSchema = z.number().min(0).max(10).multipleOf(0.1);
export const runEnvironmentSchema = z.enum([
  "outdoor",
  "treadmill",
  "unspecified",
]);

export const runSummarySchema = z
  .object({
    version: z.literal(1),
    activityDate: activityDateSchema,
    recordingTimezone: timezoneSchema,
    timePrecision: z.enum(["day", "instant"]),
    startedAt: instantSchema.nullable(),
    durationSeconds: durationSchema,
    durationBasis: z.literal("elapsed"),
    distanceMeters: distanceSchema.nullable(),
    environment: runEnvironmentSchema,
    perceivedExertion: effortSchema.nullable(),
    origin: z.object({ kind: z.literal("manual") }).strict(),
    timestampEnvelope: z.enum(["observed", "date_anchor"]),
    revision: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.timePrecision === "day"
        ? value.startedAt !== null || value.timestampEnvelope !== "date_anchor"
        : value.startedAt === null || value.timestampEnvelope !== "observed"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Run time precision must match its timestamp source.",
        path: ["timePrecision"],
      });
    }
  });
export type RunSummary = z.infer<typeof runSummarySchema>;

const inputFields = {
  clientOperationId: z.string().uuid(),
  activityDate: activityDateSchema,
  recordingTimezone: timezoneSchema,
  startedAt: instantSchema.nullable().default(null),
  durationSeconds: durationSchema,
  distanceMeters: distanceSchema.nullable().default(null),
  environment: runEnvironmentSchema.default("unspecified"),
  perceivedExertion: effortSchema.nullable().default(null),
  name: z.string().trim().min(1).max(200).default("Run"),
  notes: z.string().trim().max(4000).nullable().default(null),
};
export const runCreateSchema = z.object(inputFields).strict();
export type RunCreate = z.infer<typeof runCreateSchema>;
export const runUpdateSchema = z
  .object({ ...inputFields, expectedRevision: z.number().int().positive() })
  .strict();
export type RunUpdate = z.infer<typeof runUpdateSchema>;
export const runRecordSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    clientOperationId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    notes: z.string().max(4000).nullable(),
    summary: runSummarySchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();
export type RunRecord = z.infer<typeof runRecordSchema>;
export const runResponseSchema = z.object({ run: runRecordSchema }).strict();
export type RunResponse = z.infer<typeof runResponseSchema>;
export const runListQuerySchema = z
  .object({
    from: activityDateSchema.optional(),
    to: activityDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    "The date range is reversed.",
  );
export type RunListQuery = z.infer<typeof runListQuerySchema>;
export const runListResponseSchema = z
  .object({ runs: z.array(runRecordSchema), nextCursor: z.string().nullable() })
  .strict();
export type RunListResponse = z.infer<typeof runListResponseSchema>;
export const runRemovedResponseSchema = z
  .object({ removed: z.literal(true) })
  .strict();
