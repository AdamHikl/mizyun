import { z } from "zod";

/**
 * AI draft of a Log activity form from a free-text description
 * ("did yardwork for 2 hours this morning"). Every field is a
 * suggestion the user reviews before saving; null where the
 * description said nothing usable.
 */

export const ACTIVITY_DRAFT_MAX_DURATION_SECONDS = 86_400;
export const ACTIVITY_DRAFT_MAX_DISTANCE = 1_000;

const localDatePattern = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** A real calendar day, not just a well-formed string. */
const isCalendarDate = (value: string): boolean => {
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const activityDraftLocalDateSchema = z
  .string()
  .regex(localDatePattern)
  .refine(isCalendarDate, "date must be a real calendar day");

export const activityDraftLocalTimeSchema = z.string().regex(localTimePattern);

export const activityDraftDistanceUnitSchema = z.enum(["m", "yd", "km", "mi"]);

export const activityTextDraftRequestSchema = z
  .object({
    description: z.string().trim().min(2).max(1_000),
    /** The device's local date and time, so "yesterday" resolves correctly. */
    localDate: activityDraftLocalDateSchema,
    localTime: activityDraftLocalTimeSchema,
  })
  .strict();

export type ActivityTextDraftRequest = z.infer<
  typeof activityTextDraftRequestSchema
>;

export const activityDraftSchema = z
  .object({
    activityName: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[^\p{Cc}]*$/u)
      .nullable(),
    durationSeconds: z
      .number()
      .int()
      .min(1)
      .max(ACTIVITY_DRAFT_MAX_DURATION_SECONDS)
      .nullable(),
    distance: z
      .object({
        value: z.number().finite().positive().max(ACTIVITY_DRAFT_MAX_DISTANCE),
        unit: activityDraftDistanceUnitSchema,
      })
      .strict()
      .nullable(),
    date: activityDraftLocalDateSchema.nullable(),
    /** Start time on `date`; null when only the day is known. */
    startTime: activityDraftLocalTimeSchema.nullable(),
    /** True for "just", "now": the activity ended at the current time. */
    endedNow: z.boolean(),
    environment: z.enum(["treadmill", "outdoor"]).nullable(),
    /** A short place or context note such as "In the ocean". */
    note: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^\p{Cc}]*$/u)
      .nullable(),
    provenance: z
      .object({
        provider: z.string().min(1).max(40),
        model: z.string().min(1).max(120),
        promptVersion: z.string().min(1).max(60),
      })
      .strict(),
  })
  .strict();

export type ActivityDraft = z.infer<typeof activityDraftSchema>;

export const activityDraftResponseSchema = z
  .object({
    draft: activityDraftSchema,
    /** Server-side correlation id for log tracing. */
    requestId: z.string().min(1),
  })
  .strict();

export type ActivityDraftResponse = z.infer<typeof activityDraftResponseSchema>;
