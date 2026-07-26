import { z } from "zod";
import { foodDraftCandidateSchema } from "./food-entry";
import { trainingPrescriptionSchema } from "./training-prescription";

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

export const coachActionProposalSchema = z.discriminatedUnion("kind", [
  coachNutritionProposalSchema,
  coachWorkoutProposalSchema,
  coachDailyPlanProposalSchema,
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

export const coachConversationPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).nullable().optional(),
    status: coachConversationStatusSchema.optional(),
  })
  .strict()
  .refine(
    (patch) => patch.title !== undefined || patch.status !== undefined,
    "at least one field must be present",
  );

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

export type CoachProviderStatus = z.infer<typeof coachProviderStatusSchema>;
export type CoachNutritionProposal = z.infer<
  typeof coachNutritionProposalSchema
>;
export type CoachWorkoutProposal = z.infer<typeof coachWorkoutProposalSchema>;
export type CoachDailyPlanProposal = z.infer<
  typeof coachDailyPlanProposalSchema
>;
export type CoachActionProposal = z.infer<typeof coachActionProposalSchema>;
export type CoachConversation = z.infer<typeof coachConversationSchema>;
export type CoachMessage = z.infer<typeof coachMessageSchema>;
export type CoachConversationCreate = z.infer<
  typeof coachConversationCreateSchema
>;
export type CoachConversationPatch = z.infer<
  typeof coachConversationPatchSchema
>;
export type CoachMessageCreate = z.infer<typeof coachMessageCreateSchema>;
export type CoachConversationResponse = z.infer<
  typeof coachConversationResponseSchema
>;
export type CoachConversationListResponse = z.infer<
  typeof coachConversationListResponseSchema
>;
export type CoachThreadResponse = z.infer<typeof coachThreadResponseSchema>;
export type CoachMessageResponse = z.infer<typeof coachMessageResponseSchema>;

// =========================================================================
// MEM-001 — Coach memory controls.
// =========================================================================

/**
 * `candidate` is not yet surfaced to the Coach prompt. `active`
 * memories are filtered by `confidence >= 0.5` and
 * `importance >= 3` (per ADR-0017 §"Memory invariants"). `deleted`
 * is a soft-delete; the row is preserved for the audit trail
 * but never returned by the route.
 */
export const coachMemoryStatusSchema = z.enum([
  "candidate",
  "active",
  "superseded",
  "deleted",
]);

export const coachMemoryKindSchema = z.enum([
  "profile",
  "goal",
  "preference",
  "constraint",
  "observation",
  "summary",
]);

export const coachMemorySummarySchema = z.object({
  id: z.string().uuid(),
  kind: coachMemoryKindSchema,
  source: z.string(),
  status: coachMemoryStatusSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().int().min(0).max(10),
  preview: z.string().trim().min(1).max(280),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
});

export const coachMemorySchema = z.object({
  id: z.string().uuid(),
  kind: coachMemoryKindSchema,
  source: z.string(),
  status: coachMemoryStatusSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().int().min(0).max(10),
  content: z.string().trim().min(1).max(4_000),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
});

/**
 * Patch shape for `PATCH /v1/coach/memories/:id`. Every field is
 * optional; the validator rejects a patch that touches no field
 * at all. The route layer runs `screenCoachInput` on `content`
 * to defend against prompt injection via the controls API.
 */
export const coachMemoryPatchSchema = z
  .object({
    content: z.string().trim().min(1).max(4_000).optional(),
    confidence: z.number().min(0).max(1).optional(),
    importance: z.number().int().min(0).max(10).optional(),
    status: coachMemoryStatusSchema.optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.content !== undefined ||
      patch.confidence !== undefined ||
      patch.importance !== undefined ||
      patch.status !== undefined ||
      patch.expiresAt !== undefined,
    "at least one field must be present",
  );

export const coachMemoryListResponseSchema = z.object({
  memories: z.array(coachMemorySummarySchema),
});

export const coachMemoryCreateSchema = z
  .object({
    kind: coachMemoryKindSchema,
    content: z.string().trim().min(1).max(4_000),
    importance: z.number().int().min(3).max(10).default(5),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export const coachMemoryResponseSchema = z.object({
  memory: coachMemorySchema,
});

export type CoachMemorySummary = z.infer<typeof coachMemorySummarySchema>;
export type CoachMemory = z.infer<typeof coachMemorySchema>;
export type CoachMemoryPatch = z.infer<typeof coachMemoryPatchSchema>;
export type CoachMemoryCreate = z.infer<typeof coachMemoryCreateSchema>;
export type CoachMemoryListResponse = z.infer<
  typeof coachMemoryListResponseSchema
>;
export type CoachMemoryResponse = z.infer<typeof coachMemoryResponseSchema>;
export type CoachMemoryStatus = z.infer<typeof coachMemoryStatusSchema>;
export type CoachMemoryKind = z.infer<typeof coachMemoryKindSchema>;
