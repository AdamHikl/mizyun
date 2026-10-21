/**
 * VISION-001 — `POST /v1/food-entries/draft`.
 *
 * Accepts multipart form data:
 *   - `image` (required): JPEG / PNG / WebP bytes, max 15 MiB
 *     (matches the `private-media` bucket policy).
 *   - `textHint` (optional): free-text description from the user
 *     ("this is my lunch", etc.).
 *
 * Returns a structured `FoodDraftCandidate` the mobile app shows
 * in an editable form. Photo bytes are transient: the route
 * holds them in memory, calls the vision provider, and discards
 * them. Per ADR-0017 §"Photo / vision invariants", the bytes
 * never enter the text-coach prompt, conversation persistence,
 * analytics, or log lines.
 *
 * Rate-limited: free 1/min, paid 3/min via the in-memory
 * `FoodDraftRateLimiter` (replaceable with the durable limiter
 * once MEM-001's `memoryWriteRateLimit` shape lands).
 */

import type { FastifyPluginAsync } from "fastify";
import type {
  AiConsentRepository,
  PlanTier,
  ProfileRepository,
  StoredAiConsent,
  UserId,
} from "@mizyun/core";
import {
  screenCoachInput,
  VisionProviderError,
  type VisionDraftProvider,
  type VisionDraftRequest,
  type VisionMimeType,
} from "@mizyun/agent-runtime";
import {
  foodDraftResponseSchema,
  foodRefineDraftRequestSchema,
  foodTextDraftRequestSchema,
  type AiProvider,
  type FoodDraftResponse,
  type LimitReasonKind,
} from "@mizyun/contracts";
import { randomUUID } from "node:crypto";

import { runWithAiConsent } from "../../ai-consent-routing.js";
import {
  authorizeAiAccess,
  type AiAuthorizationResult,
} from "../../ai-eligibility.js";
import { sendApiError } from "../../errors.js";
import type { CoachLimitService, DraftKind } from "../coach/limits.js";
import { FoodDraftRateLimiter } from "./draft-rate-limit.js";
import type { BetaProRepository } from "../../beta-pro-repository.js";
import {
  draftForCapability,
  hasAdvancedNutritionForDraft,
} from "./advanced-nutrition.js";

interface FoodDraftRoutesOptions {
  readonly visionProvider: VisionDraftProvider;
  readonly resolveVisionProvider?: (
    provider: AiProvider,
  ) => VisionDraftProvider;
  readonly profileRepository?: ProfileRepository;
  readonly betaProRepository?: BetaProRepository;
  readonly aiConsentRepository?: AiConsentRepository;
  readonly rateLimiter?: FoodDraftRateLimiter;
  readonly limits?: CoachLimitService;
  /**
   * Resolves the plan tier for the principal. Production wires
   * this from `profiles.plan_tier`; tests inject a stub.
   */
  readonly resolvePlanTier: (userId: UserId) => PlanTier;
  readonly allowedEmails?: readonly string[];
}

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES: ReadonlySet<VisionMimeType> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const principalOrThrow = (): never => {
  throw new Error("principal missing after authentication");
};

const visionFailureToHttpStatus = (
  kind: VisionProviderError["kind"],
): number => {
  switch (kind) {
    case "not_configured":
    case "external_access_disabled":
      return 503;
    case "authentication":
    case "invalid_request":
    case "refused":
    case "malformed_response":
      return 503;
    case "rate_limited":
      return 429;
    case "timeout":
    case "unavailable":
      return 502;
    default:
      return 502;
  }
};

export const foodDraftRoutes: FastifyPluginAsync<
  FoodDraftRoutesOptions
> = async (app, options) => {
  const resolveActiveVisionProvider = async (
    userId: UserId,
    accessToken: string,
  ): Promise<VisionDraftProvider> => {
    if (options.resolveVisionProvider && options.profileRepository) {
      try {
        const profile = await options.profileRepository.getOrCreate(userId, {
          now: new Date(),
          accessToken,
        });
        return options.resolveVisionProvider(profile.aiProvider);
      } catch {
        return options.visionProvider;
      }
    }
    return options.visionProvider;
  };

  const checkAiAuthorization = async (
    userId: UserId,
    accessToken: string,
    userEmail?: string | null,
  ): Promise<
    AiAuthorizationResult & {
      /** Stored consent that picks the vendor (consent-gated routing). */
      readonly consent?: StoredAiConsent | null;
      readonly countryCode?: string | null;
      readonly planTier?: PlanTier;
      readonly includeAdvancedNutrition?: boolean;
    }
  > => {
    if (!options.profileRepository) {
      return {
        authorized: false,
        statusCode: 403,
        code: "AI_AGE_RESTRICTED",
        message:
          "AI features require adult eligibility (18 years or older) under provider terms.",
      };
    }
    try {
      const profile = await options.profileRepository.getOrCreate(userId, {
        now: new Date(),
        accessToken,
      });
      const consent = options.aiConsentRepository
        ? await options.aiConsentRepository.getConsent(userId, { accessToken })
        : null;
      const auth = authorizeAiAccess({
        profile,
        consent,
        now: new Date(),
        userEmail,
        allowedEmails: options.allowedEmails,
      });
      let includeAdvancedNutrition = false;
      if (auth.authorized) {
        includeAdvancedNutrition = await hasAdvancedNutritionForDraft(
          options,
          userId,
          accessToken,
          profile.planTier,
        );
      }
      return {
        ...auth,
        consent,
        countryCode: profile.coachingPreferences?.countryCode ?? null,
        planTier: profile.planTier,
        includeAdvancedNutrition,
      };
    } catch {
      return {
        authorized: false,
        statusCode: 403,
        code: "AI_AGE_RESTRICTED",
        message:
          "AI features require adult eligibility (18 years or older) under provider terms.",
      };
    }
  };

  const acquireDraftLimit = async (
    userId: UserId,
    tier: PlanTier,
    draftKind: DraftKind,
  ): Promise<{
    allowed: boolean;
    reason?: LimitReasonKind;
    retryAfter?: number;
    resetAt?: string;
  }> => {
    if (options.rateLimiter) {
      const res = options.rateLimiter.acquire(userId, tier, draftKind);
      if (!res.allowed) {
        const isDaily = res.reason === "daily_limit_exceeded";
        const reason: LimitReasonKind = isDaily
          ? "daily_budget_exhausted"
          : "minute_rate_limit";
        const resetAt = isDaily
          ? new Date(Date.now() + (res.retryAfter ?? 0) * 1000).toISOString()
          : undefined;
        return {
          allowed: false,
          reason,
          ...(res.retryAfter !== undefined
            ? { retryAfter: res.retryAfter }
            : {}),
          ...(resetAt ? { resetAt } : {}),
        };
      }
    }
    if (options.limits) {
      const res = await options.limits.acquireDraftSlot(
        userId,
        tier,
        draftKind,
      );
      if (!res.allowed) {
        // When options.rateLimiter is provided, it is the primary authority on minute rate limits
        if (options.rateLimiter && res.reason === "minute") {
          return { allowed: true };
        }
        const isDaily = res.reason === "drafts" || res.reason === "tokens";
        const reason: LimitReasonKind = isDaily
          ? "daily_budget_exhausted"
          : res.reason === "inflight"
            ? "concurrent_in_flight"
            : "minute_rate_limit";
        const resetAt = isDaily
          ? new Date(Date.now() + (res.retryAfter ?? 0) * 1000).toISOString()
          : undefined;
        return {
          allowed: false,
          reason,
          ...(res.retryAfter !== undefined
            ? { retryAfter: res.retryAfter }
            : {}),
          ...(resetAt ? { resetAt } : {}),
        };
      }
    }
    return { allowed: true };
  };

  const commitDraftLimit = async (userId: UserId, tokens: number) => {
    if (options.limits) {
      await options.limits.commitDraftTokens(userId, tokens);
    }
  };

  const releaseDraftLimit = async (userId: UserId, draftKind?: DraftKind) => {
    if (options.rateLimiter) {
      options.rateLimiter.release(userId, draftKind);
    }
    if (options.limits) {
      await options.limits.releaseDraftSlot(userId, draftKind);
    }
  };

  app.post(
    "/draft/text",
    { preHandler: app.authenticate },
    async (request, reply): Promise<FoodDraftResponse | void> => {
      const principal = request.principal ?? principalOrThrow();
      const parsed = foodTextDraftRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Describe the meal in 2 to 1,000 characters.",
        );
      }
      const auth = await checkAiAuthorization(
        principal.userId as UserId,
        principal.accessToken,
        request.principal?.email,
      );
      if (!auth.authorized) {
        return sendApiError(
          reply,
          request,
          auth.statusCode,
          auth.code,
          auth.message,
        );
      }
      const safety = screenCoachInput(parsed.data.description);
      if (!safety.allowed) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "The meal description must contain food and portion details, not instructions or medical advice.",
        );
      }
      const tier =
        auth.planTier === "paid"
          ? "paid"
          : options.resolvePlanTier(principal.userId as UserId) === "paid"
            ? "paid"
            : (auth.planTier ?? "free");
      const rate = await acquireDraftLimit(
        principal.userId as UserId,
        tier,
        "text",
      );
      if (!rate.allowed) {
        if (rate.retryAfter) {
          reply.header("retry-after", String(rate.retryAfter));
        }
        const message =
          rate.reason === "daily_budget_exhausted"
            ? `Daily meal drafts limit reached (${tier === "paid" ? 100 : 5} per day). Quota resets at midnight UTC.`
            : rate.reason === "concurrent_in_flight"
              ? "A meal draft is already in progress. Please wait for it to finish."
              : `Nutrition drafts are limited to ${tier === "paid" ? 3 : 1} request per minute. Try again in ${rate.retryAfter ?? 1} second(s).`;
        return sendApiError(reply, request, 429, "RATE_LIMITED", message, {
          ...(rate.reason ? { reason: rate.reason } : {}),
          ...(rate.retryAfter !== undefined
            ? { retryAfterSeconds: rate.retryAfter }
            : {}),
          ...(rate.resetAt ? { resetAt: rate.resetAt } : {}),
        });
      }
      const requestId = randomUUID();
      const vision = await resolveActiveVisionProvider(
        principal.userId as UserId,
        principal.accessToken,
      );
      let committed = false;
      try {
        if (vision.generateTextDraft === undefined) {
          throw new VisionProviderError(
            "not_configured",
            "Text nutrition drafts are not configured on this server.",
            false,
          );
        }
        const resolvedCountryCode =
          parsed.data.countryCode ?? auth.countryCode ?? null;
        const generateTextDraft = vision.generateTextDraft;
        const candidate = await runWithAiConsent(auth.consent, () =>
          generateTextDraft.call(vision, {
            userId: principal.userId as UserId,
            description: parsed.data.description,
            requestId,
            countryCode: resolvedCountryCode,
            includeAdvancedNutrition: auth.includeAdvancedNutrition ?? false,
          }),
        );
        await commitDraftLimit(
          principal.userId as UserId,
          candidate.tokensUsed ?? 500,
        );
        committed = true;
        return reply.status(200).send(
          foodDraftResponseSchema.parse({
            draft: draftForCapability(candidate, auth.includeAdvancedNutrition),
            requestId,
          }),
        );
      } catch (error) {
        if (error instanceof VisionProviderError) {
          const status = visionFailureToHttpStatus(error.kind);
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
      } finally {
        if (!committed) {
          await releaseDraftLimit(principal.userId as UserId, "text");
        }
      }
    },
  );

  // AI-ACT-007 — Refine an existing draft with a follow-up
  // instruction. The route is JSON-only (no photo bytes flow
  // here) and shares the same rate-limiter as the text / photo
  // draft endpoints so a user can't bypass the cap by alternating
  // endpoints.
  app.post(
    "/draft/refine",
    { preHandler: app.authenticate },
    async (request, reply): Promise<FoodDraftResponse | void> => {
      const principal = request.principal ?? principalOrThrow();
      const parsed = foodRefineDraftRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Provide a current draft and a 2-to-1,000 character instruction.",
        );
      }
      const auth = await checkAiAuthorization(
        principal.userId as UserId,
        principal.accessToken,
        request.principal?.email,
      );
      if (!auth.authorized) {
        return sendApiError(
          reply,
          request,
          auth.statusCode,
          auth.code,
          auth.message,
        );
      }
      const safety = screenCoachInput(parsed.data.instruction);
      if (!safety.allowed) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "The refine instruction must describe a portion or value change, not medical or system advice.",
        );
      }
      const tier =
        auth.planTier === "paid"
          ? "paid"
          : options.resolvePlanTier(principal.userId as UserId) === "paid"
            ? "paid"
            : (auth.planTier ?? "free");
      const rate = await acquireDraftLimit(
        principal.userId as UserId,
        tier,
        "refine",
      );
      if (!rate.allowed) {
        if (rate.retryAfter) {
          reply.header("retry-after", String(rate.retryAfter));
        }
        const message =
          rate.reason === "daily_budget_exhausted"
            ? `Daily meal drafts limit reached (${tier === "paid" ? 100 : 5} per day). Quota resets at midnight UTC.`
            : rate.reason === "concurrent_in_flight"
              ? "A draft refinement is already in progress. Please wait for it to finish."
              : `Nutrition drafts are limited to ${tier === "paid" ? 3 : 1} request per minute. Try again in ${rate.retryAfter ?? 1} second(s).`;
        return sendApiError(reply, request, 429, "RATE_LIMITED", message, {
          ...(rate.reason ? { reason: rate.reason } : {}),
          ...(rate.retryAfter !== undefined
            ? { retryAfterSeconds: rate.retryAfter }
            : {}),
          ...(rate.resetAt ? { resetAt: rate.resetAt } : {}),
        });
      }
      const requestId = randomUUID();
      const vision = await resolveActiveVisionProvider(
        principal.userId as UserId,
        principal.accessToken,
      );
      let released = false;
      try {
        if (vision.refineDraft === undefined) {
          throw new VisionProviderError(
            "not_configured",
            "Draft refinement is not configured on this server.",
            false,
          );
        }
        const refineDraft = vision.refineDraft;
        const candidate = await runWithAiConsent(auth.consent, () =>
          refineDraft.call(vision, {
            userId: principal.userId as UserId,
            currentDraft: draftForCapability(
              parsed.data.currentDraft,
              auth.includeAdvancedNutrition,
            ),
            instruction: parsed.data.instruction,
            requestId,
            includeAdvancedNutrition: auth.includeAdvancedNutrition ?? false,
          }),
        );
        // Refine is free and does not consume daily meal draft quota; release in-flight slot
        await releaseDraftLimit(principal.userId as UserId, "refine");
        released = true;
        return reply.status(200).send(
          foodDraftResponseSchema.parse({
            draft: draftForCapability(candidate, auth.includeAdvancedNutrition),
            requestId,
          }),
        );
      } catch (error) {
        if (error instanceof VisionProviderError) {
          const status = visionFailureToHttpStatus(error.kind);
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
      } finally {
        if (!released) {
          await releaseDraftLimit(principal.userId as UserId, "refine");
        }
      }
    },
  );

  app.post(
    "/draft",
    { preHandler: app.authenticate },
    async (request, reply): Promise<FoodDraftResponse | void> => {
      const principal = request.principal ?? principalOrThrow();
      const requestId = randomUUID();

      if (!request.isMultipart()) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Photo drafts require multipart/form-data with an `image` field.",
        );
      }
      const auth = await checkAiAuthorization(
        principal.userId as UserId,
        principal.accessToken,
        request.principal?.email,
      );
      if (!auth.authorized) {
        return sendApiError(
          reply,
          request,
          auth.statusCode,
          auth.code,
          auth.message,
        );
      }

      // Per-tier rate limit. The bucket is per user, sliding
      // 60-second window. Reject with 429 + Retry-After before
      // any photo bytes are read.
      const tier =
        auth.planTier === "paid"
          ? "paid"
          : options.resolvePlanTier(principal.userId as UserId) === "paid"
            ? "paid"
            : (auth.planTier ?? "free");
      const rate = await acquireDraftLimit(
        principal.userId as UserId,
        tier,
        "photo",
      );
      if (!rate.allowed) {
        if (rate.retryAfter) {
          reply.header("retry-after", String(rate.retryAfter));
        }
        const message =
          rate.reason === "daily_budget_exhausted"
            ? `Daily meal photo drafts limit reached (${tier === "paid" ? 100 : 5} per day). Quota resets at midnight UTC.`
            : rate.reason === "concurrent_in_flight"
              ? "A meal photo draft is already in progress. Please wait for it to finish."
              : `Photo drafts are limited to ${tier === "paid" ? 3 : 1} request per minute. Try again in ${rate.retryAfter ?? 1} second(s).`;
        return sendApiError(reply, request, 429, "RATE_LIMITED", message, {
          ...(rate.reason !== undefined ? { reason: rate.reason } : {}),
          ...(rate.retryAfter !== undefined
            ? { retryAfterSeconds: rate.retryAfter }
            : {}),
          ...(rate.resetAt !== undefined ? { resetAt: rate.resetAt } : {}),
        });
      }

      // All photos remain transient and share one aggregate byte budget.
      const photos: { photo: Uint8Array; mimeType: VisionMimeType }[] = [];
      const maxPhotos = auth.includeAdvancedNutrition ? 3 : 1;
      let aggregateBytes = 0;
      let textHint: string | undefined;
      let committed = false;
      try {
        try {
          for await (const part of request.parts({
            limits: { files: 3, fields: 4, parts: 7, fieldSize: 2000 },
          })) {
            if (part.type === "file" && part.fieldname === "image") {
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
              const candidate = part.mimetype.toLowerCase();
              if (!ALLOWED_MIME_TYPES.has(candidate as VisionMimeType)) {
                return sendApiError(
                  reply,
                  request,
                  422,
                  "VALIDATION_ERROR",
                  `Image mime type "${part.mimetype}" is not allowed. Use image/jpeg, image/png, or image/webp.`,
                );
              }
              const mimeType = candidate as VisionMimeType;
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
            } else if (part.type === "file") {
              return sendApiError(
                reply,
                request,
                422,
                "VALIDATION_ERROR",
                "Only `image` file fields are accepted.",
              );
            } else if (part.type === "field" && part.fieldname === "textHint") {
              const value = (part.value as { toString(): string }).toString();
              textHint = value.slice(0, 500);
            }
          }
        } catch (error) {
          return sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            `Failed to read multipart body: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
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

        const visionRequest: VisionDraftRequest = {
          userId: principal.userId as UserId,
          ...primary,
          ...(photos.length > 1 ? { additionalPhotos: photos.slice(1) } : {}),
          ...(textHint !== undefined ? { textHint } : {}),
          requestId,
          countryCode: auth.countryCode ?? null,
          includeAdvancedNutrition: auth.includeAdvancedNutrition ?? false,
        };

        const vision = await resolveActiveVisionProvider(
          principal.userId as UserId,
          principal.accessToken,
        );

        const candidate = await runWithAiConsent(auth.consent, () =>
          vision.generateDraft(visionRequest),
        );
        await commitDraftLimit(
          principal.userId as UserId,
          candidate.tokensUsed ?? 1500,
        );
        committed = true;
        return reply.status(200).send(
          foodDraftResponseSchema.parse({
            draft: draftForCapability(candidate, auth.includeAdvancedNutrition),
            ...(photos.length > 1 &&
            auth.includeAdvancedNutrition &&
            candidate.additionalDrafts?.length
              ? {
                  drafts: [candidate, ...candidate.additionalDrafts].map(
                    (draft) =>
                      draftForCapability(draft, auth.includeAdvancedNutrition),
                  ),
                }
              : {}),
            requestId,
          }),
        );
      } catch (error) {
        if (error instanceof VisionProviderError) {
          const status = visionFailureToHttpStatus(error.kind);
          const code =
            status === 429
              ? "RATE_LIMITED"
              : status === 503
                ? "AI_CONFIGURATION_ERROR"
                : "AI_UNAVAILABLE";
          const message =
            error.kind === "not_configured"
              ? "Photo drafts are not configured on this server."
              : error.kind === "external_access_disabled"
                ? "External AI vision access is disabled."
                : error.message;
          return sendApiError(reply, request, status, code, message);
        }
        throw error;
      } finally {
        if (!committed) {
          await releaseDraftLimit(principal.userId as UserId, "photo");
        }
      }
    },
  );
};
