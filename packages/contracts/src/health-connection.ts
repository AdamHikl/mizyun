import { z } from "zod";

/** INT-01 device-only previews. These records confer no account/sharing rights. */
export const healthPreviewKindSchema = z.enum(["weight", "workout"]);
export const healthPreviewProviderSchema = z.enum([
  "apple_health",
  "health_connect",
]);

export type HealthPreviewKind = z.infer<typeof healthPreviewKindSchema>;
export type HealthPreviewProvider = z.infer<typeof healthPreviewProviderSchema>;

const sourceFields = {
  provider: healthPreviewProviderSchema,
  externalId: z.string().min(1).max(256),
  sourceAppId: z.string().min(1).max(256),
  sourceAppName: z.string().min(1).max(256).nullable(),
  sourceTimeZone: z.string().min(1).max(128).nullable(),
};

/** UTC instants with seconds; native readers convert to these canonical units. */
export const healthPreviewInstantSchema = z
  .string()
  .max(32)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/)
  .datetime();

export const healthPreviewWeightSchema = z
  .object({
    kind: z.literal("weight"),
    ...sourceFields,
    measuredAt: healthPreviewInstantSchema,
    weightKg: z.number().finite().gte(30).lte(250),
  })
  .strict();

const workoutShapeSchema = z
  .object({
    kind: z.literal("workout"),
    ...sourceFields,
    startedAt: healthPreviewInstantSchema,
    endedAt: healthPreviewInstantSchema,
    activityType: z.string().min(1).max(128),
    durationSeconds: z.number().finite().gt(0).lte(86_400),
  })
  .strict();

// Apply the refinement after discriminating: Zod3 requires object options.
export const healthPreviewRecordSchema = z
  .discriminatedUnion("kind", [healthPreviewWeightSchema, workoutShapeSchema])
  .superRefine((record, context) => {
    if (record.kind !== "workout") return;
    const elapsedSeconds =
      (Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 1000;
    if (
      elapsedSeconds <= 0 ||
      record.durationSeconds > elapsedSeconds + 0.001
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endedAt"],
        message: "Completed workout duration must fit its positive time range.",
      });
    }
  });

export type HealthPreviewRecord = z.infer<typeof healthPreviewRecordSchema>;
