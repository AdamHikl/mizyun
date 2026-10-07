import { z } from "zod";

/** INT-04: outbound-only types. No account ownership or source metadata crosses this boundary. */
export const healthExportProviderSchema = z.enum([
  "apple_health",
  "health_connect",
]);
export const healthExportKindSchema = z.enum(["nutrition", "workout"]);
export const healthExportInstantSchema = z
  .string()
  .max(32)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  .datetime()
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 19) === value.slice(0, 19),
    "An actual UTC calendar instant is required.",
  );
export const healthExportRevisionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

/** Created locally only after saving an explicitly user-entered record.
 * Confirmation does not cleanse imported, provider, AI or derivative lineage.
 * This receipt is an application assertion, not cryptographic provenance.
 */
export const healthExportConfirmationSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordId: z.string().uuid(),
    savedUpdatedAt: healthExportInstantSchema,
    origin: z.literal("mizyun_user_entered"),
    rights: z.literal("first_party"),
    derivedFrom: z.array(z.never()).max(0),
    timeBasis: z.enum(["observed", "date_only"]),
  })
  .strict();

const identityFields = {
  type: z.enum(["upsert", "delete"]),
  clientId: z.string().uuid(),
  revision: healthExportRevisionSchema,
};
const nutrient = (maximum: number) =>
  z.number().finite().nonnegative().max(maximum).nullable();

export const healthExportNutritionValuesSchema = z
  .object({
    consumedAt: healthExportInstantSchema,
    energyKcal: nutrient(20_000),
    proteinG: nutrient(10_000),
    carbsG: nutrient(10_000),
    fatG: nutrient(10_000),
  })
  .strict()
  .refine(
    (record) =>
      [record.energyKcal, record.proteinG, record.carbsG, record.fatG].some(
        (value) => value !== null,
      ),
    "At least one known nutrient is required.",
  );

export const healthExportWorkoutValuesSchema = z
  .object({
    startedAt: healthExportInstantSchema,
    endedAt: healthExportInstantSchema,
  })
  .strict()
  .refine((record) => {
    const duration = Date.parse(record.endedAt) - Date.parse(record.startedAt);
    return duration > 0 && duration <= 86_400_000;
  }, "Completed workout must have an actual positive interval of at most one day.");

export const healthNutritionExportSchema = z
  .object({
    ...identityFields,
    category: z.literal("nutrition"),
    nutrition: healthExportNutritionValuesSchema,
  })
  .strict();
export const healthWorkoutExportSchema = z
  .object({
    ...identityFields,
    category: z.literal("workout"),
    workout: healthExportWorkoutValuesSchema,
  })
  .strict();

export const healthExportPayloadSchema = z.union([
  healthNutritionExportSchema,
  healthWorkoutExportSchema,
]);

export type HealthExportProvider = z.infer<typeof healthExportProviderSchema>;
export type HealthExportKind = z.infer<typeof healthExportKindSchema>;
export type HealthExportConfirmation = z.infer<
  typeof healthExportConfirmationSchema
>;
export type HealthNutritionExport = z.infer<typeof healthNutritionExportSchema>;
export type HealthWorkoutExport = z.infer<typeof healthWorkoutExportSchema>;
export type HealthExportPayload = z.infer<typeof healthExportPayloadSchema>;
