import { z } from "zod";

export const coachingPlanSchema = z.object({
  version: z.string().min(1),
  computedAt: z.string().datetime(),
  complete: z.boolean(),
  missingInputs: z.array(
    z.enum(["active_goal", "body_weight", "energy_target"]),
  ),
  goalKind: z.enum(["cut", "bulk", "recomp", "maintain"]).nullable(),
  calorie: z
    .object({
      targetKcal: z.number().gte(0).lte(20_000),
      planningRangeLowKcal: z.number().gte(0).lte(20_000),
      planningRangeHighKcal: z.number().gte(0).lte(20_000),
      formulaVersion: z.string().min(1),
    })
    .nullable(),
  protein: z
    .object({
      basisWeightKg: z.number().gt(0).lte(1_000),
      minG: z.number().int().gte(0).lte(1_000),
      targetG: z.number().int().gte(0).lte(1_000),
      maxG: z.number().int().gte(0).lte(1_000),
      minGramsPerKg: z.number().gte(0).lte(5),
      targetGramsPerKg: z.number().gte(0).lte(5),
      maxGramsPerKg: z.number().gte(0).lte(5),
    })
    .nullable(),
  training: z
    .object({
      focus: z.enum([
        "retain_strength_and_lean_mass",
        "hypertrophy_and_strength",
        "hypertrophy_and_conditioning",
        "balanced_fitness",
      ]),
      resistanceDaysMin: z.number().int().gte(0).lte(7),
      resistanceDaysMax: z.number().int().gte(0).lte(7),
      aerobicMinutesMin: z.number().int().gte(0).lte(10_080),
      completedSessionsLast7Days: z.number().int().gte(0).lte(100),
      status: z.enum([
        "below_base_frequency",
        "within_base_frequency",
        "above_base_frequency",
        "unknown",
      ]),
      exerciseTypes: z.array(
        z.enum([
          "compound_resistance",
          "accessory_resistance",
          "moderate_aerobic",
          "mobility_recovery",
        ]),
      ),
    })
    .nullable(),
  assumptions: z.array(z.string().min(1).max(500)),
  safetyNotice: z.string().min(1).max(500),
});

export type CoachingPlan = z.infer<typeof coachingPlanSchema>;
