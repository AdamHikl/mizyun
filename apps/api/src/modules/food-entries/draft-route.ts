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
} from "@mizyun/contracts";
import { randomUUID } from "node:crypto";

import {
  authorizeAiAccess,
  type AiAuthorizationResult,
} from "../../ai-eligibility.js";
import { sendApiError } from "../../errors.js";
import type { CoachLimitService, DraftKind } from "../coach/limits.js";
import { FoodDraftRateLimiter } from "./draft-rate-limit.js";

interface FoodDraftRoutesOptions {
  readonly visionProvider: VisionDraftProvider;
  readonly resolveVisionProvider?: (
    provider: AiProvider,
  ) => VisionDraftProvider;
  readonly profileRepository?: ProfileRepository;
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
  ): Promise<AiAuthorizationResult> => {
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
      return authorizeAiAccess({
        profile,
        consent,
        now: new Date(),
        userEmail,
        allowedEmails: options.allowedEmails,
      });
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
  ): Promise<{ allowed: boolean; retryAfter?: number }> => {
    if (options.rateLimiter) {
      const res = options.rateLimiter.acquire(userId, tier);
      if (!res.allowed) {
        return {
          allowed: false,
          ...(res.retryAfter !== undefined
            ? { retryAfter: res.retryAfter }
            : {}),
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
        return {
          allowed: false,
          ...(res.retryAfter !== undefined
            ? { retryAfter: res.retryAfter }
            : {}),
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

  const releaseDraftLimit = async (userId: UserId) => {
    if (options.limits) {
      await options.limits.releaseDraftSlot(userId);
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
      const tier = options.resolvePlanTier(principal.userId as UserId);
      const rate = await acquireDraftLimit(
        principal.userId as UserId,
        tier,
        "text",
      );
      if (!rate.allowed) {
        if (rate.retryAfter) {
          reply.header("retry-after", String(rate.retryAfter));
        }
        return sendApiError(
          reply,
          request,
          429,
          "RATE_LIMITED",
          `Nutrition drafts are limited to ${tier === "paid" ? 3 : 1} request per minute.`,
        );
      }
      const requestId = randomUUID();
      const vision = await resolveActiveVisionProvider(
        principal.userId as UserId,
        principal.accessToken,
      );
      try {
        if (vision.generateTextDraft === undefined) {
          throw new VisionProviderError(
            "not_configured",
            "Text nutrition drafts are not configured on this server.",
            false,
          );
        }
        const candidate = await vision.generateTextDraft({
          userId: principal.userId as UserId,
          description: parsed.data.description,
          requestId,
        });
        await commitDraftLimit(
          principal.userId as UserId,
          candidate.tokensUsed ?? 500,
        );
        return reply
          .status(200)
          .send(foodDraftResponseSchema.parse({ draft: candidate, requestId }));
      } catch (error) {
        await releaseDraftLimit(principal.userId as UserId);
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
      const tier = options.resolvePlanTier(principal.userId as UserId);
      const rate = await acquireDraftLimit(
        principal.userId as UserId,
        tier,
        "refine",
      );
      if (!rate.allowed) {
        if (rate.retryAfter) {
          reply.header("retry-after", String(rate.retryAfter));
        }
        return sendApiError(
          reply,
          request,
          429,
          "RATE_LIMITED",
          `Nutrition drafts are limited to ${tier === "paid" ? 3 : 1} request per minute.`,
        );
      }
      const requestId = randomUUID();
      const vision = await resolveActiveVisionProvider(
        principal.userId as UserId,
        principal.accessToken,
      );
      try {
        if (vision.refineDraft === undefined) {
          throw new VisionProviderError(
            "not_configured",
            "Draft refinement is not configured on this server.",
            false,
          );
        }
        const candidate = await vision.refineDraft({
          userId: principal.userId as UserId,
          currentDraft: parsed.data.currentDraft,
          instruction: parsed.data.instruction,
          requestId,
        });
        await commitDraftLimit(
          principal.userId as UserId,
          candidate.tokensUsed ?? 800,
        );
        return reply
          .status(200)
          .send(foodDraftResponseSchema.parse({ draft: candidate, requestId }));
      } catch (error) {
        await releaseDraftLimit(principal.userId as UserId);
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
      const tier = options.resolvePlanTier(principal.userId as UserId);
      const rate = await acquireDraftLimit(
        principal.userId as UserId,
        tier,
        "photo",
      );
      if (!rate.allowed) {
        if (rate.retryAfter) {
          reply.header("retry-after", String(rate.retryAfter));
        }
        return sendApiError(
          reply,
          request,
          429,
          "RATE_LIMITED",
          `Photo drafts are limited to ${
            tier === "paid" ? 3 : 1
          } request per minute. Try again in ${rate.retryAfter ?? 1} second(s).`,
        );
      }

      // Read the multipart body. The route accepts exactly one
      // `image` file + an optional `textHint` field.
      let photo: Buffer | null = null;
      let mimeType: VisionMimeType | null = null;
      let textHint: string | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === "file" && part.fieldname === "image") {
            if (photo !== null) {
              return sendApiError(
                reply,
                request,
                422,
                "VALIDATION_ERROR",
                "Only one `image` field is allowed.",
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
            mimeType = candidate as VisionMimeType;
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
                  `Image exceeds the 15 MiB limit (got ${total} bytes).`,
                );
              }
              chunks.push(chunk as Buffer);
            }
            photo = Buffer.concat(chunks, total);
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

      if (photo === null || mimeType === null) {
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
        photo: new Uint8Array(photo),
        mimeType,
        ...(textHint !== undefined ? { textHint } : {}),
        requestId,
      };

      const vision = await resolveActiveVisionProvider(
        principal.userId as UserId,
        principal.accessToken,
      );

      try {
        const candidate = await vision.generateDraft(visionRequest);
        await commitDraftLimit(
          principal.userId as UserId,
          candidate.tokensUsed ?? 1500,
        );
        return reply
          .status(200)
          .send(foodDraftResponseSchema.parse({ draft: candidate, requestId }));
      } catch (error) {
        await releaseDraftLimit(principal.userId as UserId);
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
      }
    },
  );
};
