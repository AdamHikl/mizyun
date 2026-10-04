import { z } from "./zod-runtime.mjs";
import { foodDraftCandidateSchema } from "./food-entry.mjs";
import { trainingPrescriptionSchema } from "./training-prescription.mjs";
export const coachProviderStatusSchema = z.discriminatedUnion("ready", [
  z.object({
    ready: z.literal(true),
    provider: z.string(),
    model: z.string().optional(),
    externalAccess: z.literal(true),
  }),
  z.object({
    ready: z.literal(false),
    provider: z.string(),
    model: z.string().optional(),
    externalAccess: z.literal(false),
    reason: z.string(),
  }),
]);
export const coachConversationStatusSchema = z.enum(["active", "archived"]);
export const coachNutritionProposalSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("meal_log"),
    candidate: foodDraftCandidateSchema,
  })
  .strict();
export const coachWorkoutProposalSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("workout_start"),
    prescriptionVersion: z.string().min(1).max(100),
    volumeAction: z.enum(["build", "hold", "reduce"]),
    session: trainingPrescriptionSchema.shape.sessions.element,
  })
  .strict();
export const coachDailyPlanProposalSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("daily_plan"),
    version: z.string().min(1).max(100),
    date: z.string().date(),
    calorie: z
      .object({
        targetKcal: z.number().nonnegative(),
        consumedKcal: z.number().nonnegative().nullable(),
        remainingKcal: z.number().nonnegative().nullable(),
      })
      .nullable(),
    protein: z
      .object({
        targetG: z.number().nonnegative(),
        consumedG: z.number().nonnegative().nullable(),
        remainingG: z.number().nonnegative().nullable(),
      })
      .nullable(),
    training: z
      .object({
        due: z.boolean(),
        completedToday: z.boolean(),
        completedSessionsLast7Days: z.number().int().nonnegative(),
      })
      .nullable(),
    missingInputs: z.array(z.string().min(1).max(100)),
    nextAction: z.enum([
      "complete_setup",
      "log_meal",
      "prioritise_protein",
      "train",
      "stay_on_plan",
    ]),
  })
  .strict();
export const coachWeeklyAdaptationProposalSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("weekly_adaptation"),
    version: z.string().min(1).max(100),
    goalId: z.string().uuid().nullable(),
    readiness: z.enum(["ready", "insufficient_data"]),
    goalKind: z.enum(["cut", "bulk", "recomp", "maintain"]).nullable(),
    currentPace: z.enum(["steady", "gradual", "aggressive"]).nullable(),
    proposedPace: z.enum(["steady", "gradual", "aggressive"]).nullable(),
    calorieAction: z.enum(["hold", "increase", "decrease"]),
    trainingVolumeAction: z.enum(["build", "hold", "reduce"]),
    observations: z.object({
      loggedNutritionDays: z.number().int().nonnegative().max(7),
      averageCalorieAdherencePercent: z.number().nonnegative().nullable(),
      averageProteinAdherencePercent: z.number().nonnegative().nullable(),
      weeklyWeightChangeKg: z.number().nullable(),
      weeklyWeightChangePercent: z.number().nullable(),
      targetKcal: z.number().nullable().optional(),
      averageCaloriesKcal: z.number().nullable().optional(),
      targetProteinG: z.number().nullable().optional(),
      averageProteinG: z.number().nullable().optional(),
      completedWorkoutsCount: z.number().nullable().optional(),
      smoothedWeightKg: z.number().nullable().optional(),
      latestWeightKg: z.number().nullable().optional(),
    }),
    reasons: z.array(z.string().min(1).max(500)).min(1).max(5),
  })
  .strict();
/**
 * AI-ACT-006 — multi-session workout plan proposal.
 *
 * The Coach detects an explicit multi-session request ("3 day plan",
 * "Push Pull Legs split", "V-shape with 2-hour sessions") and asks
 * the deterministic training-prescription engine to build an ordered
 * list of N sessions. Sessions are pre-scheduled to target days
 * across the next 7 days so the mobile UI can save them in one tap
 * and the user gets an actual interactive workout for each one.
 *
 * The action is advisory until the user taps "Save all" (or the
 * per-session "Start"); saving creates real `workout` + `workout_set`
 * records via the existing repositories. The LLM never invents
 * exercise content — it only extracts {sessions, focus, sessionMinutes}
 * which are passed to the deterministic engine.
 */
export const coachMultiWorkoutPlanProposalSessionSchema = z
  .object({
    index: z.number().int().gte(1).lte(7),
    label: z.string().min(1).max(80),
    estimatedMinutes: z.number().int().gte(15).lte(180),
    focus: z.string().min(1).max(80).nullable(),
    targetDay: z.string().date(),
    exercises: z
      .array(
        z.object({
          catalogId: z.string().min(1).max(120),
          name: z.string().min(1).max(120),
          movementPattern: z.enum([
            "knee_dominant",
            "hip_hinge",
            "horizontal_push",
            "horizontal_pull",
            "vertical_push",
            "vertical_pull",
            "core",
            "aerobic",
            "mobility",
          ]),
          equipment: z.array(z.string().min(1).max(40)).max(4),
          sets: z.number().int().gte(1).lte(5),
          repsMin: z.number().int().gte(1).lte(100).nullable(),
          repsMax: z.number().int().gte(1).lte(100).nullable(),
          durationMinutes: z.number().int().gte(1).lte(180).nullable(),
          restSeconds: z.number().int().gte(0).lte(600),
          progression: z.enum(["double_progression", "time_progression"]),
        }),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const coachMultiWorkoutPlanProposalSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("multi_workout_plan"),
    prescriptionVersion: z.string().min(1).max(100),
    volumeAction: z.enum(["build", "hold", "reduce"]),
    focus: z.string().min(1).max(80).nullable(),
    requestedSessions: z.number().int().gte(1).lte(7),
    sessionMinutes: z.number().int().gte(15).lte(180),
    rationale: z.string().min(1).max(500),
    sessions: z.array(coachMultiWorkoutPlanProposalSessionSchema).min(1).max(7),
    startDay: z.string().date(),
    endDay: z.string().date(),
  })
  .strict();
export const coachWorkoutEditProposalSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("workout_edit"),
    workoutId: z.string().uuid(),
    targetName: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(2000).nullable().optional(),
    exercises: z
      .array(
        z.object({
          catalogId: z.string().min(1).max(120),
          name: z.string().min(1).max(120),
          movementPattern: z.enum([
            "knee_dominant",
            "hip_hinge",
            "horizontal_push",
            "horizontal_pull",
            "vertical_push",
            "vertical_pull",
            "core",
            "aerobic",
            "mobility",
          ]),
          equipment: z.array(z.string().min(1).max(40)).max(4).optional(),
          sets: z.number().int().gte(1).lte(10),
          repsMin: z.number().int().gte(1).lte(100).nullable(),
          repsMax: z.number().int().gte(1).lte(100).nullable(),
          durationMinutes: z.number().int().gte(1).lte(180).nullable(),
          restSeconds: z.number().int().gte(0).lte(600),
          progression: z
            .enum(["double_progression", "time_progression"])
            .optional(),
        }),
      )
      .min(1)
      .max(20),
    summary: z.string().trim().min(1).max(500),
  })
  .strict();
export const coachActionProposalSchema = z.discriminatedUnion("kind", [
  coachNutritionProposalSchema,
  coachWorkoutProposalSchema,
  coachDailyPlanProposalSchema,
  coachWeeklyAdaptationProposalSchema,
  coachMultiWorkoutPlanProposalSchema,
  coachWorkoutEditProposalSchema,
]);
export const coachConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120).nullable(),
  status: coachConversationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const coachMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(20_000),
  status: z.enum(["complete", "failed"]),
  provider: z.string().nullable(),
  evidenceKinds: z.array(
    z.enum([
      "profile",
      "goal",
      "nutrition",
      "training",
      "body",
      "energy",
      "plan",
      "memory",
    ]),
  ),
  actionProposal: coachActionProposalSchema.nullable().default(null),
  createdAt: z.string().datetime(),
});
export const coachConversationCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const coachMessageCreateSchema = z
  .object({
    text: z.string().trim().min(1).max(4_000),
  })
  .strict();
export const coachConversationResponseSchema = z.object({
  conversation: coachConversationSchema,
});
export const coachConversationListResponseSchema = z.object({
  conversations: z.array(coachConversationSchema),
});
export const coachThreadResponseSchema = z.object({
  conversation: coachConversationSchema,
  messages: z.array(coachMessageSchema),
});
export const coachMessageResponseSchema = z.object({
  conversation: coachConversationSchema,
  userMessage: coachMessageSchema,
  assistantMessage: coachMessageSchema,
});
