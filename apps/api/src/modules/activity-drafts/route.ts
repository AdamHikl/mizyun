/**
 * `POST /v1/activity-drafts/text` — draft the Log activity form
 * from a free-text description ("did yardwork for 2 hours this
 * morning"). Nothing is saved: the app shows the fields for review.
 *
 * Same admission as meal text drafts (ADR-0024: authenticated,
 * adult-eligible, current AI consent) and the same shared daily
 * draft budget, counted as a text draft. The description and the
 * device's local date/time are the only user data sent to the model.
 */

import type { FastifyPluginAsync } from "fastify";
import type {
  AiConsentRepository,
  PlanTier,
  ProfileRepository,
  UserId,
} from "@mizyun/core";
import {
  ACTIVITY_DRAFT_ESTIMATED_TOKENS,
  screenCoachInput,
  VisionProviderError,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";
import {
  activityDraftResponseSchema,
  activityTextDraftRequestSchema,
  type ActivityDraftResponse,
  type AiProvider,
  type LimitReasonKind,
} from "@mizyun/contracts";
import { randomUUID } from "node:crypto";

import { runWithAiConsent } from "../../ai-consent-routing.js";
import { authorizeAiAccess } from "../../ai-eligibility.js";
import { sendApiError } from "../../errors.js";
import type { CoachLimitService } from "../coach/limits.js";
import type { FoodDraftRateLimiter } from "../food-entries/draft-rate-limit.js";

interface ActivityDraftRoutesOptions {
  readonly visionProvider: VisionDraftProvider;
  readonly resolveVisionProvider?: (
    provider: AiProvider,
  ) => VisionDraftProvider;
  readonly profileRepository?: ProfileRepository;
  readonly aiConsentRepository?: AiConsentRepository;
  /** Shared with meal drafts, so one budget covers both. */
  readonly rateLimiter?: FoodDraftRateLimiter;
  readonly limits?: CoachLimitService;
  readonly resolvePlanTier: (userId: UserId) => PlanTier;
}

const AGE_RESTRICTED = {
  authorized: false,
  statusCode: 403,
  code: "AI_AGE_RESTRICTED",
  message:
    "AI features require adult eligibility (18 years or older) under provider terms.",
} as const;

const failureStatus = (kind: VisionProviderError["kind"]): number =>
  kind === "rate_limited"
    ? 429
    : kind === "refused"
      ? 422
      : kind === "timeout" || kind === "unavailable"
        ? 502
        : 503;

export const activityDraftRoutes: FastifyPluginAsync<
  ActivityDraftRoutesOptions
> = async (app, options) => {
  const admit = async (userId: UserId, accessToken: string) => {
    if (!options.profileRepository) return { ...AGE_RESTRICTED };
    try {
      const profile = await options.profileRepository.getOrCreate(userId, {
        now: new Date(),
        accessToken,
      });
      const consent = options.aiConsentRepository
        ? await options.aiConsentRepository.getConsent(userId, { accessToken })
        : null;
      const auth = authorizeAiAccess({ profile, consent, now: new Date() });
      const provider =
        auth.authorized && options.resolveVisionProvider
          ? options.resolveVisionProvider(profile.aiProvider)
          : options.visionProvider;
      // The stored consent picks the vendor at call time (consent-gated
      // routing: Anthropic only when the consent disclosed it).
      return { ...auth, planTier: profile.planTier, provider, consent };
    } catch {
      return { ...AGE_RESTRICTED };
    }
  };

  const acquire = async (
    userId: UserId,
    tier: PlanTier,
  ): Promise<{
    readonly allowed: boolean;
    readonly reason?: LimitReasonKind;
    readonly retryAfter?: number;
    readonly resetAt?: string;
  }> => {
    const denied = (
      reason: LimitReasonKind,
      retryAfter: number | undefined,
    ) => ({
      allowed: false,
      reason,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      ...(reason === "daily_budget_exhausted"
        ? {
            resetAt: new Date(
              Date.now() + (retryAfter ?? 0) * 1000,
            ).toISOString(),
          }
        : {}),
    });
    if (options.rateLimiter) {
      const res = options.rateLimiter.acquire(userId, tier, "text");
      if (!res.allowed) {
        return denied(
          res.reason === "daily_limit_exceeded"
            ? "daily_budget_exhausted"
            : "minute_rate_limit",
          res.retryAfter,
        );
      }
    }
    if (options.limits) {
      const res = await options.limits.acquireDraftSlot(userId, tier, "text");
      // The in-memory limiter, when present, owns the per-minute rule.
      if (!res.allowed && !(options.rateLimiter && res.reason === "minute")) {
        if (options.rateLimiter) options.rateLimiter.release(userId, "text");
        return denied(
          res.reason === "drafts" || res.reason === "tokens"
            ? "daily_budget_exhausted"
            : res.reason === "inflight"
              ? "concurrent_in_flight"
              : "minute_rate_limit",
          res.retryAfter,
        );
      }
    }
    return { allowed: true };
  };

  const release = async (userId: UserId) => {
    options.rateLimiter?.release(userId, "text");
    await options.limits?.releaseDraftSlot(userId, "text");
  };

  app.post(
    "/text",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ActivityDraftResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const userId = principal.userId as UserId;
      const parsed = activityTextDraftRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Describe the activity in 2 to 1,000 characters.",
        );
      }
      const auth = await admit(userId, principal.accessToken);
      if (!auth.authorized) {
        return sendApiError(
          reply,
          request,
          auth.statusCode,
          auth.code,
          auth.message,
        );
      }
      if (!screenCoachInput(parsed.data.description).allowed) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "The description must say what activity you did, not ask for instructions or medical advice.",
        );
      }
      const tier: PlanTier =
        auth.planTier === "paid" || options.resolvePlanTier(userId) === "paid"
          ? "paid"
          : (auth.planTier ?? "free");
      const rate = await acquire(userId, tier);
      if (!rate.allowed) {
        if (rate.retryAfter) {
          reply.header("retry-after", String(rate.retryAfter));
        }
        const message =
          rate.reason === "daily_budget_exhausted"
            ? "You've reached today's AI drafts limit. It resets at midnight UTC."
            : rate.reason === "concurrent_in_flight"
              ? "An AI draft is already in progress. Please wait for it to finish."
              : `AI drafts are limited per minute. Try again in ${rate.retryAfter ?? 1} second(s).`;
        return sendApiError(reply, request, 429, "RATE_LIMITED", message, {
          ...(rate.reason ? { reason: rate.reason } : {}),
          ...(rate.retryAfter !== undefined
            ? { retryAfterSeconds: rate.retryAfter }
            : {}),
          ...(rate.resetAt ? { resetAt: rate.resetAt } : {}),
        });
      }
      const requestId = randomUUID();
      let committed = false;
      try {
        if (auth.provider.generateActivityDraft === undefined) {
          throw new VisionProviderError(
            "not_configured",
            "AI activity drafts are not configured on this server.",
            false,
          );
        }
        const generateActivityDraft = auth.provider.generateActivityDraft;
        const candidate = await runWithAiConsent(auth.consent, () =>
          generateActivityDraft.call(auth.provider, {
            userId,
            description: parsed.data.description,
            localDate: parsed.data.localDate,
            localTime: parsed.data.localTime,
            requestId,
          }),
        );
        await options.limits?.commitDraftTokens(
          userId,
          candidate.tokensUsed ?? ACTIVITY_DRAFT_ESTIMATED_TOKENS,
        );
        committed = true;
        const { tokensUsed: _tokens, ...draft } = candidate;
        const response = activityDraftResponseSchema.safeParse({
          draft,
          requestId,
        });
        if (!response.success) {
          return sendApiError(
            reply,
            request,
            503,
            "AI_CONFIGURATION_ERROR",
            "The AI provider returned an invalid activity draft.",
          );
        }
        return reply.status(200).send(response.data);
      } catch (error) {
        if (error instanceof VisionProviderError) {
          const status = failureStatus(error.kind);
          return sendApiError(
            reply,
            request,
            status,
            status === 429
              ? "RATE_LIMITED"
              : status === 422
                ? "VALIDATION_ERROR"
                : status === 503
                  ? "AI_CONFIGURATION_ERROR"
                  : "AI_UNAVAILABLE",
            error.kind === "not_configured" ||
              error.kind === "external_access_disabled"
              ? "AI activity drafts are not available on this server."
              : error.kind === "refused"
                ? "AI couldn't draft an activity from that description."
                : error.message,
          );
        }
        throw error;
      } finally {
        if (!committed) await release(userId);
      }
    },
  );
};
