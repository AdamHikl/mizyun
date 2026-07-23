import type { FastifyPluginAsync } from "fastify";
import {
  AgentProviderError,
  type AgentOrchestrator,
} from "@mizyun/agent-runtime";
import type {
  BodyMeasurementRepository,
  ConversationId,
  ConversationRepository,
  FoodEntryRepository,
  GoalRepository,
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
  coachMessageCreateSchema,
  coachMessageResponseSchema,
  coachProviderStatusSchema,
  coachThreadResponseSchema,
  type CoachConversation,
  type CoachMessage,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";
import { buildCoachGrounding } from "./grounding.js";

interface CoachRoutesOptions {
  readonly agent: AgentOrchestrator;
  readonly conversationRepository: ConversationRepository;
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  readonly dailyUserTokenBudget?: number;
  readonly now?: () => Date;
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
      "profile" | "goal" | "nutrition" | "training" | "body" | "energy" =>
      value === "profile" ||
      value === "goal" ||
      value === "nutrition" ||
      value === "training" ||
      value === "body" ||
      value === "energy",
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
  const now = options.now ?? (() => new Date());
  const tokenBudget = options.dailyUserTokenBudget ?? 100_000;
  const usage = new Map<string, { readonly day: string; tokens: number }>();

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

      const day = now().toISOString().slice(0, 10);
      const currentUsage = usage.get(principal.userId);
      const used = currentUsage?.day === day ? currentUsage.tokens : 0;
      if (used >= tokenBudget) {
        return sendApiError(
          reply,
          request,
          429,
          "RATE_LIMITED",
          "Your daily AI budget has been reached. Try again tomorrow.",
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

      const grounding = await buildCoachGrounding(
        options,
        principal.userId,
        principal.accessToken,
        now(),
      );
      try {
        const response = await options.agent.respond({
          userId: principal.userId,
          conversationId,
          messages: storedMessages.map((message) => ({
            role: message.role,
            text: message.text,
          })),
          grounding,
        });
        const totalTokens =
          typeof response.providerMetadata?.totalTokens === "number"
            ? response.providerMetadata.totalTokens
            : 0;
        usage.set(principal.userId, {
          day,
          tokens: used + Math.max(0, totalTokens),
        });
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
                evidenceKinds: response.evidence.map((item) => item.kind),
                ...(response.providerMetadata ?? {}),
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
        if (error instanceof AgentProviderError) {
          const status =
            error.kind === "rate_limited"
              ? 429
              : error.kind === "not_configured" ||
                  error.kind === "external_access_disabled"
                ? 503
                : 502;
          return sendApiError(
            reply,
            request,
            status,
            error.kind === "rate_limited" ? "RATE_LIMITED" : "AI_UNAVAILABLE",
            error.message,
          );
        }
        throw error;
      }
    },
  );
};
