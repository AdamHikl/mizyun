import type { FastifyPluginAsync } from "fastify";
import {
  VisionProviderError,
  screenCoachInput,
  screenCoachPhotoAdvice,
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

import { runWithAiConsent } from "../../ai-consent-routing.js";
import { authorizeAiAccess } from "../../ai-eligibility.js";
import { sendApiError } from "../../errors.js";
import type { FoodDraftRateLimiter } from "../food-entries/draft-rate-limit.js";
import {
  draftForCapability,
  hasAdvancedNutritionForDraft,
} from "../food-entries/index.js";
import type { BetaProRepository } from "../../beta-pro-repository.js";
import type { CoachLimitService } from "./limits.js";
import { stripCoachPayloadForLegacyClient } from "./legacy-client-compat.js";

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

  // Installed Store builds (<= 9) parse Coach proposals strictly and do not
  // know `additionalCandidates`; strip it from responses to them.
  app.addHook("preSerialization", async (request, _reply, payload) =>
    stripCoachPayloadForLegacyClient(request, payload),
  );

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
      if (
        userMessage !== null &&
        userMessage.text !== USER_MESSAGE_TEXT &&
        ![1, 2, 3].includes(
          Number(userMessage.providerMetadata.photoAttachmentCount),
        )
      ) {
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
      const includeAdvancedNutrition = await hasAdvancedNutritionForDraft(
        options,
        principal.userId,
        principal.accessToken,
        profile.planTier,
      );
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

      const photos: { photo: Uint8Array; mimeType: VisionMimeType }[] = [];
      const maxPhotos = includeAdvancedNutrition ? 3 : 1;
      let aggregateBytes = 0;
      let textHint: string | undefined;
      let committed = false;
      try {
        try {
          for await (const part of request.parts({
            limits: { files: 3, fields: 4, parts: 7, fieldSize: 2000 },
          })) {
            if (part.type === "field" && part.fieldname === "textHint") {
              textHint = String(part.value).slice(0, 500);
              continue;
            }
            if (part.type === "file" && part.fieldname !== "image") {
              return sendApiError(
                reply,
                request,
                422,
                "VALIDATION_ERROR",
                "Only `image` file fields are accepted.",
              );
            }
            if (part.type !== "file") continue;
            if (photos.length >= maxPhotos) {
              return sendApiError(
                reply,
                request,
                422,
                "VALIDATION_ERROR",
                maxPhotos === 1
                  ? "Multiple meal photos require Pro. Only one `image` field is allowed."
                  : "At most three meal photos are allowed.",
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
            const mimeType = candidateMime as VisionMimeType;
            const chunks: Buffer[] = [];
            let total = 0;
            for await (const chunk of part.file) {
              total += chunk.length;
              aggregateBytes += chunk.length;
              if (aggregateBytes > MAX_PHOTO_BYTES) {
                return sendApiError(
                  reply,
                  request,
                  422,
                  "VALIDATION_ERROR",
                  "Meal photos exceed the combined 15 MiB limit.",
                );
              }
              chunks.push(chunk as Buffer);
            }
            if (part.file.truncated || total === 0) {
              return sendApiError(
                reply,
                request,
                422,
                "VALIDATION_ERROR",
                "The meal photo is empty or exceeds the 15 MiB limit.",
              );
            }
            photos.push({
              photo: new Uint8Array(Buffer.concat(chunks, total)),
              mimeType,
            });
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
        const primary = photos[0];
        if (primary === undefined) {
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
              text: textHint?.trim()
                ? `${textHint.trim()}\n\n[${photos.length} ${photos.length === 1 ? "photo" : "photos"} attached]`
                : photos.length === 1
                  ? USER_MESSAGE_TEXT
                  : `[${photos.length} photos attached]`,
              status: "complete",
              idempotencyKey,
              providerMetadata: { photoAttachmentCount: photos.length },
            },
            { accessToken: principal.accessToken, now: now() },
          );
        }

        const draftProvider = options.resolveNutritionDraftProvider
          ? options.resolveNutritionDraftProvider(profile.aiProvider)
          : options.nutritionDraftProvider;

        try {
          const inputSafety = screenCoachInput(textHint ?? "");
          const generated = inputSafety.allowed
            ? await runWithAiConsent(consent, () =>
                draftProvider.generateDraft({
                  userId: principal.userId as UserId,
                  ...primary,
                  ...(photos.length > 1
                    ? { additionalPhotos: photos.slice(1) }
                    : {}),
                  requestId: crypto.randomUUID(),
                  includeAdvancedNutrition,
                  purpose: "coach",
                  ...(textHint !== undefined ? { textHint } : {}),
                }),
              )
            : null;
          const candidate =
            generated === null
              ? null
              : draftForCapability(generated, includeAdvancedNutrition);
          const actionProposal =
            candidate !== null &&
            !(candidate.name === null && candidate.photoAdvice !== undefined)
              ? coachNutritionProposalSchema.parse({
                  id: crypto.randomUUID(),
                  kind: "meal_log",
                  candidate,
                  ...(photos.length > 1 &&
                  includeAdvancedNutrition &&
                  generated?.additionalDrafts?.length
                    ? {
                        additionalCandidates: generated.additionalDrafts.map(
                          (draft) =>
                            draftForCapability(draft, includeAdvancedNutrition),
                        ),
                      }
                    : {}),
                })
              : undefined;
          const adviceSafety =
            candidate?.photoAdvice === undefined
              ? { allowed: true as const }
              : screenCoachPhotoAdvice(candidate.photoAdvice);
          const assistantText = !inputSafety.allowed
            ? inputSafety.response
            : !adviceSafety.allowed
              ? adviceSafety.response
              : candidate?.name === null && candidate.photoAdvice !== undefined
                ? candidate.photoAdvice
                : candidate?.additionalDrafts?.length
                  ? "I drafted separate meal estimates from the photos. Review each portion and nutrition estimate before logging it."
                  : "I drafted a meal estimate from the photo. Review the portion and nutrition estimates before logging it.";
          const assistantMessage =
            await options.conversationRepository.addMessage(
              principal.userId,
              {
                id: crypto.randomUUID(),
                conversationId,
                role: "assistant",
                text: assistantText,
                status: "complete",
                idempotencyKey: null,
                providerMetadata: {
                  provider: candidate?.provenance.provider ?? "mizyun-safety",
                  replyTo: userMessage.id,
                  evidenceKinds: [],
                  ...(actionProposal !== undefined && adviceSafety.allowed
                    ? { actionProposal }
                    : {}),
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
          if (generated !== null) {
            if (acquiredUnifiedLimit && options.limits) {
              await options.limits.commitDraftTokens(
                principal.userId,
                generated.tokensUsed ?? 1500,
              );
            }
            committed = true;
          }
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
      } finally {
        if (!committed && acquiredUnifiedLimit && options.limits) {
          await options.limits.releaseDraftSlot(principal.userId);
        }
      }
    },
  );
};
