import { z } from "zod";

const equipmentSchema = z.enum([
  "bodyweight",
  "dumbbells",
  "barbell",
  "bench",
  "rack",
  "cable_machine",
  "resistance_bands",
  "pullup_bar",
  "cardio_machine",
  "full_gym",
]);

const movementPatternSchema = z.enum([
  "knee_dominant",
  "hip_hinge",
  "horizontal_push",
  "horizontal_pull",
  "vertical_push",
  "vertical_pull",
  "core",
  "aerobic",
  "mobility",
]);

export const trainingPrescriptionSchema = z.object({
  version: z.string().min(1),
  computedAt: z.string().datetime(),
  complete: z.boolean(),
  missingInputs: z.array(
    z.enum([
      "active_goal",
      "experience_level",
      "training_days",
      "session_duration",
    ]),
  ),
  goalKind: z.enum(["cut", "bulk", "recomp", "maintain"]).nullable(),
  requestedDaysPerWeek: z.number().int().gte(1).lte(7).nullable(),
  resistanceDaysPerWeek: z.number().int().gte(1).lte(4).nullable(),
  aerobicMinutesPerWeek: z.number().int().gte(0).lte(10_080),
  recentLoad: z.object({
    completedSessionsLast7Days: z.number().int().gte(0).lte(100),
    completedSetsLast7Days: z.number().int().gte(0).lte(10_000),
    averageRpeLast7Days: z.number().gte(0).lte(10).nullable(),
  }),
  volumeAction: z.enum(["build", "hold", "reduce"]),
  sessions: z.array(
    z.object({
      index: z.number().int().gte(1).lte(4),
      label: z.string().min(1).max(80),
      estimatedMinutes: z.number().int().gte(15).lte(180),
      exercises: z.array(
        z.object({
          catalogId: z.string().min(1).max(120),
          name: z.string().min(1).max(120),
          movementPattern: movementPatternSchema,
          equipment: z.array(equipmentSchema).max(4),
          sets: z.number().int().gte(1).lte(5),
          repsMin: z.number().int().gte(1).lte(100).nullable(),
          repsMax: z.number().int().gte(1).lte(100).nullable(),
          durationMinutes: z.number().int().gte(1).lte(180).nullable(),
          restSeconds: z.number().int().gte(0).lte(600),
          progression: z.enum(["double_progression", "time_progression"]),
        }),
      ),
    }),
  ),
  assumptions: z.array(z.string().min(1).max(500)),
  warnings: z.array(z.string().min(1).max(500)),
});

export const trainingPrescriptionResponseSchema = z.object({
  prescription: trainingPrescriptionSchema,
});

export type TrainingPrescription = z.infer<typeof trainingPrescriptionSchema>;
export type TrainingPrescriptionResponse = z.infer<
  typeof trainingPrescriptionResponseSchema
>;
