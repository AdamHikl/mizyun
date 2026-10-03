import { z } from "zod";

export const recurringMealLocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const recurringMealTimeZoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(value)) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "timeZone must be a supported IANA time zone");
export const recurringMealWeekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .refine(
    (days) => new Set(days).size === days.length,
    "weekdays must be unique",
  )
  .transform((days) => [...days].sort((a, b) => a - b));
export const recurringMealLocalDateSchema = z.string().refine((value) => {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}, "localDate must be a real date in YYYY-MM-DD form");

export const recurringMealSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  localTime: recurringMealLocalTimeSchema,
  timeZone: recurringMealTimeZoneSchema,
  weekdays: recurringMealWeekdaysSchema,
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RecurringMeal = z.infer<typeof recurringMealSchema>;
export const recurringMealCreateSchema = z
  .object({
    id: z.string().uuid(),
    sourceEntryId: z.string().uuid(),
    localTime: recurringMealLocalTimeSchema,
    timeZone: recurringMealTimeZoneSchema,
    weekdays: recurringMealWeekdaysSchema,
  })
  .strict();
export type RecurringMealCreate = z.infer<typeof recurringMealCreateSchema>;
export const recurringMealPatchSchema = recurringMealCreateSchema
  .omit({ id: true })
  .partial()
  .extend({ enabled: z.boolean().optional() })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "At least one schedule field is required",
  );
export type RecurringMealPatch = z.infer<typeof recurringMealPatchSchema>;
export const recurringMealSkipSchema = z
  .object({ localDate: recurringMealLocalDateSchema })
  .strict();
export type RecurringMealSkip = z.infer<typeof recurringMealSkipSchema>;
export const recurringMealResponseSchema = z.object({
  recurringMeal: recurringMealSchema,
});
export type RecurringMealResponse = z.infer<typeof recurringMealResponseSchema>;
export const recurringMealListResponseSchema = z.object({
  recurringMeals: z.array(recurringMealSchema),
});
export type RecurringMealListResponse = z.infer<
  typeof recurringMealListResponseSchema
>;
