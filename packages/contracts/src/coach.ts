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
    additionalCandidates: z.array(foodDraftCandidateSchema).max(2).optional(),
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

/**
 * Coach messages left today (ADR-0085), sent with a new reply. Absent on
 * replays, local fallbacks and older servers.
 */
export const coachMessageUsageSchema = z.object({
  dailyMessageLimit: z.number().int().nonnegative(),
  messagesRemaining: z.number().int().nonnegative(),
  resetsAt: z.string().datetime(),
});

export const coachMessageResponseSchema = z.object({
  conversation: coachConversationSchema,
  userMessage: coachMessageSchema,
  assistantMessage: coachMessageSchema,
  usage: coachMessageUsageSchema.optional(),
});

export const coachWeeklyAdaptationAcceptResponseSchema = z.object({
  applied: z.boolean(),
  pace: z.enum(["steady", "gradual", "aggressive"]),
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
export type CoachWeeklyAdaptationProposal = z.infer<
  typeof coachWeeklyAdaptationProposalSchema
>;
export type CoachMultiWorkoutPlanProposalSession = z.infer<
  typeof coachMultiWorkoutPlanProposalSessionSchema
>;
export type CoachMultiWorkoutPlanProposal = z.infer<
  typeof coachMultiWorkoutPlanProposalSchema
>;
export type CoachWorkoutEditProposal = z.infer<
  typeof coachWorkoutEditProposalSchema
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
export type CoachMessageUsage = z.infer<typeof coachMessageUsageSchema>;
export type CoachWeeklyAdaptationAcceptResponse = z.infer<
  typeof coachWeeklyAdaptationAcceptResponseSchema
>;

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
    status: coachMemoryStatusSchema
      .extract(["candidate", "active"])
      .default("active"),
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

/**
 * Trims redundant markdown exercise/routine lists and verbose section breakdowns
 * from the assistant text when an interactive action proposal card (e.g. multi-session
 * workout plan or workout proposal) is attached.
 *
 * When an interactive proposal is attached, the widget itself renders the structured
 * sessions, exercises, sets, reps, and actions. Having the assistant message repeat
 * all exercises in a massive markdown text creates unnecessary clutter and pushes
 * the interactive widget off-screen.
 */
export const cleanAssistantProposalText = (
  rawText: string | null | undefined,
  proposal: CoachActionProposal | null | undefined,
): string => {
  if (!proposal) {
    return (rawText ?? "").trim();
  }

  const text = (rawText ?? "").trim();

  // For weekly adaptations, the conversational assistant text is the rich coaching review
  // (weekly snapshot, nutrition & meal recommendations, training guidance, next week focus).
  // Do not strip markdown or truncate it; only fall back if the text is empty.
  if (proposal.kind === "weekly_adaptation") {
    return text.length > 0
      ? text
      : "Here is your weekly progress review and adaptation proposal.";
  }

  if (text.length > 0) {
    // If the text contains markdown horizontal dividers (---, ***, ___),
    // headers (### Day 1), session markers, or exercise list items, strip
    // everything from the first divider / list / day header onwards.
    const splitRegex =
      /(?:\r?\n\s*[-*_]{3,}\s*(?:\r?\n|$))|(?:\r?\n\s*#{1,6}\s+)|(?:\r?\n\s*(?:\*\*|\*)?(?:Day|Session|Workout)\s+\d+)|(?:\r?\n\s*(?:\d+\.|\*|-)\s+(?:\*\*|\*)?[A-Z])/i;

    const match = text.search(splitRegex);
    let candidateIntro = (match !== -1 ? text.slice(0, match) : text).trim();

    // If it ends with a hanging colon (e.g. "Here's your 3-day split:"), replace with a period.
    candidateIntro = candidateIntro.replace(/:\s*$/, ".");

    // If the introductory text is clean and not excessively long (<= 350 chars), keep it.
    if (
      candidateIntro.length > 0 &&
      candidateIntro.length <= 350 &&
      !/^(?:Day|Session|Workout|\d+\.|\*|-|#{1,6})/i.test(candidateIntro)
    ) {
      return candidateIntro;
    }
  }

  // Otherwise, return a short fallback based on proposal kind.
  switch (proposal.kind) {
    case "multi_workout_plan":
      return `Here is your ${proposal.sessions.length}-session plan. Review and save your sessions below.`;
    case "workout_start":
      return `Here is your planned ${proposal.session.label} workout. Review and start below.`;
    case "daily_plan":
      return "Here is your daily action plan. Review your targets and next action below.";
    case "meal_log":
      return "I drafted that meal from your description. Review the portion, calories, and macros before logging it.";
    case "workout_edit":
      return "I updated the workout with your requested changes. Review the edits below.";
    default:
      return "";
  }
};
