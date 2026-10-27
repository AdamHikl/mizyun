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

export const runImportProviderSchema = z.enum([
  "apple_health",
  "health_connect",
]);
export type RunImportProvider = z.infer<typeof runImportProviderSchema>;
const healthIdentifierSchema = z.string().trim().min(1).max(255);
/** Imported runs keep their provider identity; metrics are read-only provider facts. */
export const runHealthImportOriginSchema = z
  .object({
    kind: z.literal("health_import"),
    provider: runImportProviderSchema,
    sourceAppId: healthIdentifierSchema,
    sourceAppName: z.string().trim().min(1).max(200).nullable(),
    externalId: healthIdentifierSchema,
  })
  .strict();
/** A run from the user's own Strava account export (ADR-0083); never the Strava API. */
export const runFileImportOriginSchema = z
  .object({
    kind: z.literal("file_import"),
    format: z.literal("strava"),
    externalId: healthIdentifierSchema,
  })
  .strict();
export const runOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }).strict(),
  runHealthImportOriginSchema,
  runFileImportOriginSchema,
]);
export type RunOrigin = z.infer<typeof runOriginSchema>;

export const runSummarySchema = z
  .object({
    version: z.literal(1),
    activityDate: activityDateSchema,
    recordingTimezone: timezoneSchema,
    timePrecision: z.enum(["day", "instant"]),
    startedAt: instantSchema.nullable(),
    durationSeconds: durationSchema,
    durationBasis: z.enum(["elapsed", "active"]),
    distanceMeters: distanceSchema.nullable(),
    environment: runEnvironmentSchema,
    perceivedExertion: effortSchema.nullable(),
    origin: runOriginSchema,
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
    if (
      value.origin.kind === "manual"
        ? value.durationBasis !== "elapsed"
        : value.timePrecision !== "instant" ||
          (value.origin.kind === "file_import" &&
            value.durationBasis !== "elapsed")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Manual runs use elapsed duration; imported runs need a start time.",
        path: ["origin"],
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
    /**
     * Older clients parse only manual runs, so imported runs are opt-in:
     * `imports` adds Health imports, `all_imports` also history file imports.
     */
    include: z.enum(["imports", "all_imports"]).optional(),
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
/**
 * One user-selected Health workout copied into the account. The server derives
 * the activity date from `startedAt` in `recordingTimezone`; re-importing the
 * same provider/source/external ID while that run exists is a no-op.
 */
/**
 * Named IANA zones the database accepts (`run_validate`). Health Connect offsets
 * such as "+02:00" or "GMT+0200" pass Intl but are not storable run zones.
 */
export const isStorableRunTimezone = (value: string): boolean =>
  /^[A-Za-z_]+(\/[A-Za-z0-9_+.-]+)*$/.test(value) &&
  !["Factory", "localtime"].includes(value) &&
  !/^(posix|right)\//.test(value);
export const runImportSchema = z
  .object({
    clientOperationId: z.string().uuid(),
    provider: runImportProviderSchema,
    sourceAppId: healthIdentifierSchema,
    sourceAppName: z.string().trim().min(1).max(200).nullable(),
    externalId: healthIdentifierSchema,
    startedAt: instantSchema,
    recordingTimezone: timezoneSchema.refine(
      isStorableRunTimezone,
      "Enter a named timezone.",
    ),
    durationSeconds: durationSchema,
    durationBasis: z.enum(["elapsed", "active"]),
    distanceMeters: distanceSchema.nullable(),
    environment: runEnvironmentSchema,
  })
  .strict();
export type RunImport = z.infer<typeof runImportSchema>;
export const runImportResponseSchema = z
  .object({ run: runRecordSchema, created: z.boolean() })
  .strict();
export type RunImportResponse = z.infer<typeof runImportResponseSchema>;
export const runRemovedResponseSchema = z
  .object({ removed: z.literal(true) })
  .strict();
