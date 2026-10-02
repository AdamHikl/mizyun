import type { FastifyPluginAsync } from "fastify";
import {
  VisionProviderError,
  type VisionDraftProvider,
  type VisionMimeType,
} from "@mizyun/agent-runtime";
import type {
  AiConsentRepository,
  ConversationId,
  ConversationRepository,
  PlanTier,
  ProfileRepository,
  StoredConversation,
  StoredConversationMessage,
  UserId,
} from "@mizyun/core";
import {
  coachMessageResponseSchema,
  coachNutritionProposalSchema,
  type CoachConversation,
  type CoachMessage,
} from "@mizyun/contracts";

import { authorizeAiAccess } from "../../ai-eligibility.js";
import { sendApiError } from "../../errors.js";
import type { FoodDraftRateLimiter } from "../food-entries/draft-rate-limit.js";
import {
  draftForCapability,
  hasAdvancedNutritionForDraft,
} from "../food-entries/index.js";
import type { BetaProRepository } from "../../beta-pro-repository.js";
import type { CoachLimitService } from "./limits.js";

interface CoachNutritionPhotoRoutesOptions {
  readonly betaProRepository?: BetaProRepository;
  readonly conversationRepository: ConversationRepository;
  readonly profileRepository: ProfileRepository;
  readonly aiConsentRepository?: AiConsentRepository;
  readonly limits?: CoachLimitService;
  readonly nutritionDraftProvider: VisionDraftProvider;
  readonly resolveNutritionDraftProvider?: (
    provider: import("@mizyun/contracts").AiProvider,
  ) => VisionDraftProvider;
  readonly nutritionDraftRateLimiter: FoodDraftRateLimiter;
  readonly planTierOverride?: PlanTier | undefined;
  readonly now?: (() => Date) | undefined;
  readonly allowedEmails?: readonly string[] | undefined;
}

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const USER_MESSAGE_TEXT = "Shared a meal photo for a nutrition draft.";
const ALLOWED_MIME_TYPES: ReadonlySet<VisionMimeType> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const toConversationWire = (stored: StoredConversation): CoachConversation => ({
  id: stored.id,
  title: stored.title,
  status: stored.status,
  createdAt: stored.createdAt.toISOString(),
  updatedAt: stored.updatedAt.toISOString(),
});

const toMessageWire = (stored: StoredConversationMessage): CoachMessage => {
  const actionProposal = coachNutritionProposalSchema.safeParse(
    stored.providerMetadata.actionProposal,
  );
  return {
    id: stored.id,
    conversationId: stored.conversationId,
    role: stored.role,
    text: stored.text,
    status: stored.status,
    provider:
      typeof stored.providerMetadata.provider === "string"
        ? stored.providerMetadata.provider
        : null,
    evidenceKinds: [],
    actionProposal: actionProposal.success ? actionProposal.data : null,
    createdAt: stored.createdAt.toISOString(),
  };
};

const principalOrThrow = (): never => {
  throw new Error("principal missing after authentication");
};

export const coachNutritionPhotoRoutes: FastifyPluginAsync<
  CoachNutritionPhotoRoutesOptions
> = async (app, options) => {
  const now = options.now ?? (() => new Date());

  app.post(
    "/conversations/:id/nutrition-photo",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal ?? principalOrThrow();
      const conversationId = (request.params as { readonly id: string })
        .id as ConversationId;
      const idempotencyKey = request.headers["idempotency-key"];
      if (
        typeof idempotencyKey !== "string" ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      ) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "A valid idempotency key is required.",
        );
      }
      if (!request.isMultipart()) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Meal photo proposals require multipart/form-data with an `image` field.",
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
      if (userMessage !== null && userMessage.text !== USER_MESSAGE_TEXT) {
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "That idempotency key was already used for another message.",
        );
      }
      if (userMessage !== null) {
        const storedMessages =
          await options.conversationRepository.listMessages(
            principal.userId,
            conversationId,
            { accessToken: principal.accessToken, limit: 40 },
          );
        const existingAssistant = storedMessages.find(
          (message) =>
            message.role === "assistant" &&
            message.providerMetadata.replyTo === userMessage?.id,
        );
        if (existingAssistant !== undefined) {
          return coachMessageResponseSchema.parse({
            conversation: toConversationWire(conversation),
            userMessage: toMessageWire(userMessage),
            assistantMessage: toMessageWire(existingAssistant),
          });
        }
      }

      const profile = await options.profileRepository.getOrCreate(
        principal.userId,
        { now: now(), accessToken: principal.accessToken },
      );
      const consent = options.aiConsentRepository
        ? await options.aiConsentRepository.getConsent(principal.userId, {
            accessToken: principal.accessToken,
          })
        : null;
      const authResult = authorizeAiAccess({
        profile,
        consent,
        now: now(),
        userEmail: request.principal?.email,
        allowedEmails: options.allowedEmails,
      });
      if (!authResult.authorized) {
        return sendApiError(
          reply,
          request,
          authResult.statusCode,
          authResult.code,
          authResult.message,
        );
      }
      const tier = options.planTierOverride ?? profile.planTier;
      let acquiredUnifiedLimit = false;
      if (options.limits) {
        const slot = await options.limits.acquireDraftSlot(
          principal.userId,
          tier,
          "photo",
        );
        if (!slot.allowed) {
          if (slot.retryAfter) {
            reply.header("retry-after", String(slot.retryAfter));
          }
          return sendApiError(
            reply,
            request,
            429,
            "RATE_LIMITED",
            "Meal photo drafts are limited. Try again shortly.",
          );
        }
        acquiredUnifiedLimit = true;
      } else {
        const rate = options.nutritionDraftRateLimiter.acquire(
          principal.userId,
          tier,
        );
        if (!rate.allowed) {
          reply.header("retry-after", String(rate.retryAfter));
          return sendApiError(
            reply,
            request,
            429,
            "RATE_LIMITED",
            "Meal photo drafts are limited. Try again shortly.",
          );
        }
      }

      let photo: Buffer | null = null;
      let mimeType: VisionMimeType | null = null;
      try {
        for await (const part of request.parts()) {
          if (part.type !== "file" || part.fieldname !== "image") continue;
          if (photo !== null) {
            return sendApiError(
              reply,
              request,
              422,
              "VALIDATION_ERROR",
              "Only one `image` field is allowed.",
            );
          }
          const candidateMime = part.mimetype.toLowerCase();
          if (!ALLOWED_MIME_TYPES.has(candidateMime as VisionMimeType)) {
            return sendApiError(
              reply,
              request,
              422,
              "VALIDATION_ERROR",
              "Use a JPEG, PNG, or WebP meal photo.",
            );
          }
          mimeType = candidateMime as VisionMimeType;
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of part.file) {
            total += chunk.length;
            if (total > MAX_PHOTO_BYTES) {
              return sendApiError(
                reply,
                request,
                422,
                "VALIDATION_ERROR",
                "The meal photo exceeds the 15 MiB limit.",
              );
            }
            chunks.push(chunk as Buffer);
          }
          photo = Buffer.concat(chunks, total);
        }
      } catch {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "The meal photo could not be read.",
        );
      }
      if (photo === null || mimeType === null) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Missing required `image` field.",
        );
      }

      if (userMessage === null) {
        userMessage = await options.conversationRepository.addMessage(
          principal.userId,
          {
            id: crypto.randomUUID(),
            conversationId,
            role: "user",
            text: USER_MESSAGE_TEXT,
            status: "complete",
            idempotencyKey,
          },
          { accessToken: principal.accessToken, now: now() },
        );
      }

      const draftProvider = options.resolveNutritionDraftProvider
        ? options.resolveNutritionDraftProvider(profile.aiProvider)
        : options.nutritionDraftProvider;

      try {
        const includeAdvancedNutrition = await hasAdvancedNutritionForDraft(
          options,
          principal.userId,
          principal.accessToken,
          profile.planTier,
        );
        const generated = await draftProvider.generateDraft({
          userId: principal.userId as UserId,
          photo: new Uint8Array(photo),
          mimeType,
          requestId: crypto.randomUUID(),
          includeAdvancedNutrition,
        });
        const candidate = draftForCapability(
          generated,
          includeAdvancedNutrition,
        );
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
              text: "I drafted a meal estimate from the photo. Review the portion and nutrition estimates before logging it.",
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
        if (acquiredUnifiedLimit && options.limits) {
          await options.limits.commitDraftTokens(
            principal.userId,
            candidate.tokensUsed ?? 1500,
          );
        }
        return coachMessageResponseSchema.parse({
          conversation: toConversationWire(latestConversation),
          userMessage: toMessageWire(userMessage),
          assistantMessage: toMessageWire(assistantMessage),
        });
      } catch (error) {
        if (acquiredUnifiedLimit && options.limits) {
          await options.limits.releaseDraftSlot(principal.userId);
        }
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
    },
  );
};
