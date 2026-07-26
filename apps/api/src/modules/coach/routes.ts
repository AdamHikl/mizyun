import type { FastifyPluginAsync } from "fastify";
import {
  AgentProviderError,
  COACH_PROMPT_VERSION,
  screenCoachInput,
  type AgentOrchestrator,
  type VisionDraftProvider,
  VisionProviderError,
} from "@mizyun/agent-runtime";
import type {
  BodyMeasurementRepository,
  ConversationId,
  ConversationRepository,
  FoodEntryRepository,
  GoalRepository,
  PlanTier,
  ProfileRepository,
  StoredConversation,
  StoredConversationMessage,
  UserId,
  WorkoutRepository,
  WorkoutSetRepository,
} from "@mizyun/core";
import {
  coachConversationCreateSchema,
  coachConversationListResponseSchema,
  coachConversationPatchSchema,
  coachConversationResponseSchema,
  coachActionProposalSchema,
  coachDailyPlanProposalSchema,
  coachWeeklyAdaptationProposalSchema,
  coachWeeklyAdaptationAcceptResponseSchema,
  coachMessageCreateSchema,
  coachMessageResponseSchema,
  coachNutritionProposalSchema,
  coachProviderStatusSchema,
  coachThreadResponseSchema,
  trainingPrescriptionResponseSchema,
  type CoachConversation,
  type CoachMessage,
  type TrainingPrescriptionResponse,
} from "@mizyun/contracts";
import type { MemoryStore } from "@mizyun/memory";

import { sendApiError } from "../../errors.js";
import type { FoodDraftRateLimiter } from "../food-entries/draft-rate-limit.js";
import { buildCoachGrounding } from "./grounding.js";
import { isExplicitDailyPlanIntent } from "./daily-plan-action.js";
import type { CoachLimitService } from "./limits.js";
import { isExplicitMealLoggingIntent } from "./nutrition-action.js";
import {
  buildDailyActionPlanForUser,
  buildTrainingPrescriptionForUser,
  buildWeeklyAdaptationForUser,
} from "./tools.js";
import { isExplicitWorkoutProposalIntent } from "./workout-action.js";
import { isExplicitWeeklyAdaptationIntent } from "./weekly-adaptation-action.js";

interface CoachRoutesOptions {
  readonly agent: AgentOrchestrator;
  readonly conversationRepository: ConversationRepository;
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  readonly limits: CoachLimitService;
  readonly nutritionDraftProvider: VisionDraftProvider;
  readonly nutritionDraftRateLimiter: FoodDraftRateLimiter;
  /**
   * Optional. When supplied (MEM-001), the grounding build pulls
   * active memories from the store and surfaces them as
   * `kind: "memory"` items. The route filters `kind: "memory"`
   * out of the response's `evidenceKinds` so the mobile UI never
   * claims "Used confirmed: memory" for user-edited content.
   */
  readonly memoryStore?: MemoryStore;
  /**
   * Optional test/dev override for the per-user plan tier.
   * Production leaves it undefined; the route reads the tier from
   * the profile. The dev container may set this via the
   * `AI_USER_TIER_OVERRIDE` env var, surfaced through
   * `AppDependencies`.
   */
  readonly planTierOverride?: PlanTier | undefined;
  readonly now?: (() => Date) | undefined;
}

const toConversationWire = (stored: StoredConversation): CoachConversation => ({
  id: stored.id,
  title: stored.title,
  status: stored.status,
  createdAt: stored.createdAt.toISOString(),
  updatedAt: stored.updatedAt.toISOString(),
});

const evidenceKinds = (
  metadata: Readonly<Record<string, unknown>>,
): CoachMessage["evidenceKinds"] => {
  const raw = metadata.evidenceKinds;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (
      value,
    ): value is
      | "profile"
      | "goal"
      | "nutrition"
      | "training"
      | "body"
      | "energy"
      | "plan" =>
      value === "profile" ||
      value === "goal" ||
      value === "nutrition" ||
      value === "training" ||
      value === "body" ||
      value === "energy" ||
      value === "plan",
  );
};

const toMessageWire = (stored: StoredConversationMessage): CoachMessage => ({
  id: stored.id,
  conversationId: stored.conversationId,
  role: stored.role,
  text: stored.text,
  status: stored.status,
  provider:
    typeof stored.providerMetadata.provider === "string"
      ? stored.providerMetadata.provider
      : null,
  evidenceKinds: evidenceKinds(stored.providerMetadata),
  actionProposal: (() => {
    const parsed = coachActionProposalSchema.safeParse(
      stored.providerMetadata.actionProposal,
    );
    return parsed.success ? parsed.data : null;
  })(),
  createdAt: stored.createdAt.toISOString(),
});

const parseConversationId = (raw: string): ConversationId =>
  raw as ConversationId;

const principalOrThrow = (): never => {
  throw new Error("principal missing after authentication");
};

export const coachRoutes: FastifyPluginAsync<CoachRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    "/training-prescription",
    { preHandler: app.authenticate },
    async (request): Promise<TrainingPrescriptionResponse> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const prescription = await buildTrainingPrescriptionForUser(
        options,
        principal.userId,
        principal.accessToken,
        (options.now ?? (() => new Date()))(),
      );
      return trainingPrescriptionResponseSchema.parse({ prescription });
    },
  );

  const now = options.now ?? (() => new Date());
  const limits = options.limits;
  const planTierOverride = options.planTierOverride;

  app.get("/status", async () =>
    coachProviderStatusSchema.parse(await options.agent.status()),
  );

  app.post(
    "/conversations",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const parsed = coachConversationCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "The conversation title is invalid.",
        );
      }
      const conversation = await options.conversationRepository.create(
        principal.userId,
        {
          id: crypto.randomUUID() as ConversationId,
          title: parsed.data.title ?? null,
        },
        { accessToken: principal.accessToken, now: now() },
      );
      return reply.status(201).send(
        coachConversationResponseSchema.parse({
          conversation: toConversationWire(conversation),
        }),
      );
    },
  );

  app.get(
    "/conversations",
    { preHandler: app.authenticate },
    async (request) => {
      const principal = request.principal ?? principalOrThrow();
      const conversations = await options.conversationRepository.list(
        principal.userId,
        { accessToken: principal.accessToken, limit: 100 },
      );
      return coachConversationListResponseSchema.parse({
        conversations: conversations.map(toConversationWire),
      });
    },
  );

  app.get(
    "/conversations/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const id = parseConversationId(
        (request.params as { readonly id: string }).id,
      );
      const conversation = await options.conversationRepository.get(
        principal.userId,
        id,
        { accessToken: principal.accessToken },
      );
      if (conversation === null) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Conversation not found.",
        );
      }
      const messages = await options.conversationRepository.listMessages(
        principal.userId,
        id,
        { accessToken: principal.accessToken, limit: 200 },
      );
      return coachThreadResponseSchema.parse({
        conversation: toConversationWire(conversation),
        messages: messages.map(toMessageWire),
      });
    },
  );

  app.patch(
    "/conversations/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const parsed = coachConversationPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "The conversation update is invalid.",
        );
      }
      const conversation = await options.conversationRepository.update(
        principal.userId,
        parseConversationId((request.params as { readonly id: string }).id),
        {
          ...(parsed.data.title !== undefined
            ? { title: parsed.data.title }
            : {}),
          ...(parsed.data.status !== undefined
            ? { status: parsed.data.status }
            : {}),
        },
        { accessToken: principal.accessToken, now: now() },
      );
      if (conversation === null) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Conversation not found.",
        );
      }
      return coachConversationResponseSchema.parse({
        conversation: toConversationWire(conversation),
      });
    },
  );

  app.delete(
    "/conversations/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const deleted = await options.conversationRepository.delete(
        principal.userId,
        parseConversationId((request.params as { readonly id: string }).id),
        { accessToken: principal.accessToken },
      );
      if (!deleted) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Conversation not found.",
        );
      }
      return reply.status(204).send();
    },
  );

  app.post(
    "/conversations/:id/weekly-adaptations/:proposalId/accept",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const params = request.params as {
        readonly id: string;
        readonly proposalId: string;
      };
      const conversationId = parseConversationId(params.id);
      const conversation = await options.conversationRepository.get(
        principal.userId,
        conversationId,
        { accessToken: principal.accessToken },
      );
      if (conversation === null) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Conversation not found.",
        );
      }
      const messages = await options.conversationRepository.listMessages(
        principal.userId,
        conversationId,
        { accessToken: principal.accessToken, limit: 200 },
      );
      const existingAcceptance = messages.find(
        (message) =>
          message.providerMetadata.acceptedProposalId === params.proposalId,
      );
      const proposal = messages
        .map((message) =>
          coachWeeklyAdaptationProposalSchema.safeParse(
            message.providerMetadata.actionProposal,
          ),
        )
        .find(
          (candidate) =>
            candidate.success && candidate.data.id === params.proposalId,
        );
      if (proposal === undefined || !proposal.success) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Weekly adaptation proposal not found.",
        );
      }
      if (
        proposal.data.readiness !== "ready" ||
        proposal.data.goalId === null ||
        proposal.data.currentPace === null ||
        proposal.data.proposedPace === null ||
        proposal.data.proposedPace === proposal.data.currentPace
      ) {
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "This weekly review does not contain an applicable goal change.",
        );
      }
      const activeGoal = await options.goalRepository.getActive(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (activeGoal === null || activeGoal.id !== proposal.data.goalId) {
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "The active goal has changed since this proposal was created.",
        );
      }
      if (existingAcceptance !== undefined) {
        return coachWeeklyAdaptationAcceptResponseSchema.parse({
          applied: false,
          pace: activeGoal.pace,
          assistantMessage: toMessageWire(existingAcceptance),
        });
      }
      if (activeGoal.pace !== proposal.data.currentPace) {
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "The goal pace has changed since this proposal was created.",
        );
      }
      const acceptedAt = now();
      const savedGoal = await options.goalRepository.update(
        principal.userId,
        {
          ...activeGoal,
          pace: proposal.data.proposedPace,
          updatedAt: acceptedAt,
        },
        { accessToken: principal.accessToken },
      );
      const assistantMessage = await options.conversationRepository.addMessage(
        principal.userId,
        {
          id: crypto.randomUUID(),
          conversationId,
          role: "assistant",
          text: `Accepted. Your goal pace changed from ${proposal.data.currentPace} to ${proposal.data.proposedPace}. Future calorie plans will use the recalculated deterministic target.`,
          status: "complete",
          idempotencyKey: null,
          providerMetadata: {
            provider: "mizyun-planner",
            evidenceKinds: ["goal", "plan", "energy"],
            acceptedProposalId: proposal.data.id,
          },
        },
        { accessToken: principal.accessToken, now: acceptedAt },
      );
      return coachWeeklyAdaptationAcceptResponseSchema.parse({
        applied: true,
        pace: savedGoal.pace,
        assistantMessage: toMessageWire(assistantMessage),
      });
    },
  );

  app.post(
    "/conversations/:id/messages",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const conversationId = parseConversationId(
        (request.params as { readonly id: string }).id,
      );
      const parsed = coachMessageCreateSchema.safeParse(request.body);
      const idempotencyKey = request.headers["idempotency-key"];
      if (
        !parsed.success ||
        typeof idempotencyKey !== "string" ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      ) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "A valid message and idempotency key are required.",
        );
      }
      const conversation = await options.conversationRepository.get(
        principal.userId,
        conversationId,
        { accessToken: principal.accessToken },
      );
      if (conversation === null) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Conversation not found.",
        );
      }

      let userMessage =
        await options.conversationRepository.findUserMessageByIdempotencyKey(
          principal.userId,
          conversationId,
          idempotencyKey,
          { accessToken: principal.accessToken },
        );
      if (userMessage === null) {
        userMessage = await options.conversationRepository.addMessage(
          principal.userId,
          {
            id: crypto.randomUUID(),
            conversationId,
            role: "user",
            text: parsed.data.text,
            status: "complete",
            idempotencyKey,
          },
          { accessToken: principal.accessToken, now: now() },
        );
      } else if (userMessage.text !== parsed.data.text) {
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "That idempotency key was already used for another message.",
        );
      }

      const storedMessages = await options.conversationRepository.listMessages(
        principal.userId,
        conversationId,
        { accessToken: principal.accessToken, limit: 40 },
      );
      const existingAssistant = storedMessages.find(
        (message) =>
          message.role === "assistant" &&
          message.providerMetadata.replyTo === userMessage.id,
      );
      if (existingAssistant !== undefined) {
        return coachMessageResponseSchema.parse({
          conversation: toConversationWire(conversation),
          userMessage: toMessageWire(userMessage),
          assistantMessage: toMessageWire(existingAssistant),
        });
      }

      const safety = screenCoachInput(parsed.data.text);
      if (!safety.allowed) {
        const assistantMessage =
          await options.conversationRepository.addMessage(
            principal.userId,
            {
              id: crypto.randomUUID(),
              conversationId,
              role: "assistant",
              text: safety.response,
              status: "complete",
              idempotencyKey: null,
              providerMetadata: {
                provider: "mizyun-safety",
                replyTo: userMessage.id,
                evidenceKinds: [],
                safetyCategory: safety.category,
                promptVersion: COACH_PROMPT_VERSION,
              },
            },
            { accessToken: principal.accessToken, now: now() },
          );
        const latestConversation =
          (await options.conversationRepository.get(
            principal.userId,
            conversationId,
            { accessToken: principal.accessToken },
          )) ?? conversation;
        return coachMessageResponseSchema.parse({
          conversation: toConversationWire(latestConversation),
          userMessage: toMessageWire(userMessage),
          assistantMessage: toMessageWire(assistantMessage),
        });
      }

      // Resolve plan tier: explicit override wins, otherwise the
      // profile value. Unknown profile values fall back to `free`.
      const profile = await options.profileRepository.getOrCreate(
        principal.userId,
        { now: now(), accessToken: principal.accessToken },
      );
      const planTier: PlanTier = planTierOverride ?? profile.planTier;

      if (isExplicitMealLoggingIntent(parsed.data.text)) {
        const rate = options.nutritionDraftRateLimiter.acquire(
          principal.userId,
          planTier,
        );
        if (!rate.allowed) {
          reply.header("retry-after", String(rate.retryAfter));
          return sendApiError(
            reply,
            request,
            429,
            "RATE_LIMITED",
            "Meal drafts are limited. Try again shortly.",
          );
        }
        try {
          if (options.nutritionDraftProvider.generateTextDraft === undefined) {
            throw new VisionProviderError(
              "not_configured",
              "Text nutrition drafts are not configured on this server.",
              false,
            );
          }
          const candidate =
            await options.nutritionDraftProvider.generateTextDraft({
              userId: principal.userId as UserId,
              description: parsed.data.text,
              requestId: crypto.randomUUID(),
            });
          const actionProposal = coachNutritionProposalSchema.parse({
            id: crypto.randomUUID(),
            kind: "meal_log",
            candidate,
          });
          const assistantMessage =
            await options.conversationRepository.addMessage(
              principal.userId,
              {
                id: crypto.randomUUID(),
                conversationId,
                role: "assistant",
                text: "I drafted that meal from your description. Review the portion, calories, and macros before logging it.",
                status: "complete",
                idempotencyKey: null,
                providerMetadata: {
                  provider: candidate.provenance.provider,
                  replyTo: userMessage.id,
                  evidenceKinds: [],
                  actionProposal,
                },
              },
              { accessToken: principal.accessToken, now: now() },
            );
          const latestConversation =
            (await options.conversationRepository.get(
              principal.userId,
              conversationId,
              { accessToken: principal.accessToken },
            )) ?? conversation;
          return coachMessageResponseSchema.parse({
            conversation: toConversationWire(latestConversation),
            userMessage: toMessageWire(userMessage),
            assistantMessage: toMessageWire(assistantMessage),
          });
        } catch (error) {
          if (error instanceof VisionProviderError) {
            const status =
              error.kind === "rate_limited"
                ? 429
                : error.kind === "timeout" || error.kind === "unavailable"
                  ? 502
                  : 503;
            if (status === 429) reply.header("retry-after", "1");
            return sendApiError(
              reply,
              request,
              status,
              status === 429
                ? "RATE_LIMITED"
                : status === 503
                  ? "AI_CONFIGURATION_ERROR"
                  : "AI_UNAVAILABLE",
              error.message,
            );
          }
          throw error;
        }
      }

      if (isExplicitWorkoutProposalIntent(parsed.data.text)) {
        const prescription = await buildTrainingPrescriptionForUser(
          options,
          principal.userId,
          principal.accessToken,
          now(),
        );
        const session =
          prescription.sessions.length === 0
            ? null
            : (prescription.sessions[
                prescription.recentLoad.completedSessionsLast7Days %
                  prescription.sessions.length
              ] ??
              prescription.sessions[0] ??
              null);
        const actionProposal =
          session === null
            ? null
            : coachActionProposalSchema.parse({
                id: crypto.randomUUID(),
                kind: "workout_start",
                prescriptionVersion: prescription.version,
                volumeAction: prescription.volumeAction,
                session,
              });
        const assistantMessage =
          await options.conversationRepository.addMessage(
            principal.userId,
            {
              id: crypto.randomUUID(),
              conversationId,
              role: "assistant",
              text:
                actionProposal === null
                  ? `I need ${prescription.missingInputs.join(
                      ", ",
                    )} before I can build a workout. Add those Coach preferences first.`
                  : `I prepared ${session?.label ?? "today’s workout"} from your confirmed goal, schedule, equipment, limitations, and recent training load. Review it before starting.`,
              status: "complete",
              idempotencyKey: null,
              providerMetadata: {
                provider: "mizyun-planner",
                replyTo: userMessage.id,
                evidenceKinds: ["plan", "training", "profile", "goal"],
                ...(actionProposal === null ? {} : { actionProposal }),
              },
            },
            { accessToken: principal.accessToken, now: now() },
          );
        const latestConversation =
          (await options.conversationRepository.get(
            principal.userId,
            conversationId,
            { accessToken: principal.accessToken },
          )) ?? conversation;
        return coachMessageResponseSchema.parse({
          conversation: toConversationWire(latestConversation),
          userMessage: toMessageWire(userMessage),
          assistantMessage: toMessageWire(assistantMessage),
        });
      }

      if (isExplicitDailyPlanIntent(parsed.data.text)) {
        const dailyPlan = await buildDailyActionPlanForUser(
          options,
          principal.userId,
          principal.accessToken,
          now(),
        );
        const actionProposal = coachDailyPlanProposalSchema.parse({
          id: crypto.randomUUID(),
          kind: "daily_plan",
          ...dailyPlan,
        });
        const assistantMessage =
          await options.conversationRepository.addMessage(
            principal.userId,
            {
              id: crypto.randomUUID(),
              conversationId,
              role: "assistant",
              text:
                dailyPlan.nextAction === "complete_setup"
                  ? "Your daily plan needs a few confirmed inputs before it can be complete."
                  : "Here is today’s plan from your confirmed meals, targets, and training. The priority is deterministic and will update as you log.",
              status: "complete",
              idempotencyKey: null,
              providerMetadata: {
                provider: "mizyun-planner",
                replyTo: userMessage.id,
                evidenceKinds: [
                  "plan",
                  "nutrition",
                  "training",
                  "profile",
                  "goal",
                  "energy",
                ],
                actionProposal,
              },
            },
            { accessToken: principal.accessToken, now: now() },
          );
        const latestConversation =
          (await options.conversationRepository.get(
            principal.userId,
            conversationId,
            { accessToken: principal.accessToken },
          )) ?? conversation;
        return coachMessageResponseSchema.parse({
          conversation: toConversationWire(latestConversation),
          userMessage: toMessageWire(userMessage),
          assistantMessage: toMessageWire(assistantMessage),
        });
      }

      if (isExplicitWeeklyAdaptationIntent(parsed.data.text)) {
        const weekly = await buildWeeklyAdaptationForUser(
          options,
          principal.userId,
          principal.accessToken,
          now(),
        );
        const actionProposal = coachWeeklyAdaptationProposalSchema.parse({
          id: crypto.randomUUID(),
          kind: "weekly_adaptation",
          ...weekly,
        });
        const assistantMessage =
          await options.conversationRepository.addMessage(
            principal.userId,
            {
              id: crypto.randomUUID(),
              conversationId,
              role: "assistant",
              text:
                weekly.readiness === "insufficient_data"
                  ? "I reviewed the confirmed week, but there is not enough reliable adherence and weight-trend evidence to change the plan."
                  : weekly.proposedPace !== weekly.currentPace
                    ? "The confirmed week supports one conservative goal-pace adjustment. Review it before accepting; nothing has changed yet."
                    : "The confirmed week supports holding your current goal pace. Training volume is shown separately from calorie adaptation.",
              status: "complete",
              idempotencyKey: null,
              providerMetadata: {
                provider: "mizyun-planner",
                replyTo: userMessage.id,
                evidenceKinds: [
                  "plan",
                  "nutrition",
                  "training",
                  "body",
                  "goal",
                  "energy",
                ],
                actionProposal,
              },
            },
            { accessToken: principal.accessToken, now: now() },
          );
        const latestConversation =
          (await options.conversationRepository.get(
            principal.userId,
            conversationId,
            { accessToken: principal.accessToken },
          )) ?? conversation;
        return coachMessageResponseSchema.parse({
          conversation: toConversationWire(latestConversation),
          userMessage: toMessageWire(userMessage),
          assistantMessage: toMessageWire(assistantMessage),
        });
      }

      // Acquire a durable slot via the AI-OPS-001 limiter service.
      // `tokensEstimated` is the per-request upper bound used by
      // `ai_reserve_tokens` to gate against the daily budget before
      // the provider call lands. We clamp to the per-tier budget so
      // a misconfigured tiny budget (e.g. test fixture = 1) does not
      // make every request reject before reaching the provider.
      const cap = limits.resolveCap(planTier);
      const slot = await limits.acquireSlot({
        userId: principal.userId,
        conversationId,
        idempotencyKey,
        planTier,
        tokensEstimated: Math.min(cap.dailyTokenBudget, 1_200),
      });

      if (slot.kind === "limited") {
        reply.header("retry-after", String(slot.retryAfter));
        const message =
          slot.reason === "tokens"
            ? "Your daily AI budget has been reached. Try again tomorrow."
            : slot.reason === "inflight"
              ? "A Coach request is already in progress. Try again shortly."
              : slot.reason === "lock_busy"
                ? "The Coach limiter is busy. Try again shortly."
                : "Too many Coach requests. Try again shortly.";
        return sendApiError(reply, request, 429, "RATE_LIMITED", message);
      }

      if (slot.kind === "conflict") {
        reply.header("retry-after", String(slot.retryAfter));
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "That idempotency key was already used for a failed request.",
        );
      }

      if (slot.kind === "replayed") {
        if (slot.existingMessageId === null) {
          // Prior call still in flight; the second caller bails.
          reply.header("retry-after", "1");
          return sendApiError(
            reply,
            request,
            409,
            "CONFLICT",
            "That Coach request is already in progress.",
          );
        }
        // Re-read the assistant message for the reply body.
        const replayedMessages =
          await options.conversationRepository.listMessages(
            principal.userId,
            conversationId,
            { accessToken: principal.accessToken, limit: 40 },
          );
        const replayedAssistant = replayedMessages.find(
          (message) =>
            message.role === "assistant" &&
            message.providerMetadata.replyTo === userMessage.id,
        );
        if (replayedAssistant !== undefined) {
          const latestConversation =
            (await options.conversationRepository.get(
              principal.userId,
              conversationId,
              { accessToken: principal.accessToken },
            )) ?? conversation;
          return coachMessageResponseSchema.parse({
            conversation: toConversationWire(latestConversation),
            userMessage: toMessageWire(userMessage),
            assistantMessage: toMessageWire(replayedAssistant),
          });
        }
        // Fall through: ledger says replayed but we cannot find the
        // assistant row. Treat as a fresh request rather than 500.
      }

      const providerCallId =
        slot.kind === "reserved" ? slot.providerCallId : "";

      try {
        const grounding = await buildCoachGrounding(
          options,
          principal.userId,
          principal.accessToken,
          now(),
        );
        // MEM-001: memories surface in the prompt as
        // `kind: "memory"`, but we filter that kind out of the
        // response's `evidenceKinds` because memory text is
        // user-edited and may contain untrusted content. The model
        // still sees the grounding; the mobile UI just doesn't
        // claim "Used confirmed: memory".
        const response = await options.agent.respond({
          userId: principal.userId,
          accessToken: principal.accessToken,
          conversationId,
          messages: storedMessages.map((message) => ({
            role: message.role,
            text: message.text,
          })),
          grounding,
        });
        const evidenceKinds = [...grounding, ...response.evidence]
          .map((item) => item.kind)
          .filter(
            (
              kind,
            ): kind is
              | "profile"
              | "goal"
              | "nutrition"
              | "training"
              | "body"
              | "energy"
              | "plan" => kind !== "memory" && kind !== "tool",
          )
          .filter((kind, index, all) => all.indexOf(kind) === index);
        const totalTokens =
          typeof response.providerMetadata?.totalTokens === "number"
            ? response.providerMetadata.totalTokens
            : 0;
        const assistantMessage =
          await options.conversationRepository.addMessage(
            principal.userId,
            {
              id: crypto.randomUUID(),
              conversationId,
              role: "assistant",
              text: response.message.text,
              status: "complete",
              idempotencyKey: null,
              providerMetadata: {
                provider: response.provider,
                replyTo: userMessage.id,
                evidenceKinds,
                ...(response.providerMetadata ?? {}),
              },
            },
            { accessToken: principal.accessToken, now: now() },
          );
        await limits.commitTokens({
          userId: principal.userId,
          providerCallId,
          finalStatus: "succeeded",
          messageId: assistantMessage.id,
          tokensUsed: totalTokens,
        });
        const latestConversation =
          (await options.conversationRepository.get(
            principal.userId,
            conversationId,
            { accessToken: principal.accessToken },
          )) ?? conversation;
        return coachMessageResponseSchema.parse({
          conversation: toConversationWire(latestConversation),
          userMessage: toMessageWire(userMessage),
          assistantMessage: toMessageWire(assistantMessage),
        });
      } catch (error) {
        await limits
          .releaseSlot({
            userId: principal.userId,
            providerCallId,
            finalStatus: "failed",
            messageId: null,
            tokensUsed: 0,
          })
          .catch(() => {
            // Best-effort release. A subsequent request will
            // overwrite the slot state.
          });
        if (error instanceof AgentProviderError) {
          const configurationError =
            error.kind === "authentication" ||
            error.kind === "payment_required" ||
            error.kind === "invalid_request" ||
            error.kind === "malformed_response" ||
            error.kind === "refused";
          const status =
            error.kind === "rate_limited"
              ? 429
              : configurationError ||
                  error.kind === "not_configured" ||
                  error.kind === "external_access_disabled"
                ? 503
                : 502;
          if (error.kind === "rate_limited") reply.header("retry-after", "1");
          return sendApiError(
            reply,
            request,
            status,
            error.kind === "rate_limited"
              ? "RATE_LIMITED"
              : configurationError
                ? "AI_CONFIGURATION_ERROR"
                : "AI_UNAVAILABLE",
            error.message,
          );
        }
        throw error;
      }
    },
  );
};
