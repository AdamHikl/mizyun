/**
 * `POST /v1/stretch-plans/refine` — AI refinement of the evening stretch
 * session (#298, ADR-0076). Registered only when `stretchAiEnabled`
 * (Dev, or `MIZYUN_STRETCH_AI_ENABLED=true`); otherwise the route is
 * absent and answers 404.
 *
 * The deterministic plan from `@mizyun/core` stays the source of truth:
 * the model only chooses catalog stretches by id, their holds and the
 * focus muscles, and tags custom exercise names with catalog muscles.
 * The server rebuilds the plan with `stretchPlanFromChoice`; output that
 * does not form a valid plan is a 502, so the app keeps its own plan.
 *
 * Same admission as activity drafts (ADR-0024: authenticated, adult-
 * eligible, current AI consent), a deletion fence like recipes, and the
 * shared daily draft budget, counted as a text draft. Exercise names and
 * model output are never logged.
 */

import type { FastifyPluginAsync } from "fastify";
import {
  buildEveningStretchSession,
  listStretchOptions,
  STRETCH_MUSCLE_VOCABULARY,
  stretchPlanFromChoice,
  unresolvedStretchExerciseNames,
  type AccountRepository,
  type AiConsentRepository,
  type PlanTier,
  type ProfileRepository,
  type StretchSessionInput,
  type UserId,
} from "@mizyun/core";
import {
  screenCoachInput,
  STRETCH_REFINE_ESTIMATED_TOKENS,
  VisionProviderError,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";
import {
  stretchRefineRequestSchema,
  stretchRefineResponseSchema,
  type AiProvider,
  type LimitReasonKind,
  type StretchRefineResponse,
} from "@mizyun/contracts";
import { randomUUID } from "node:crypto";

import { runWithAiConsent } from "../../ai-consent-routing.js";
import { authorizeAiAccess } from "../../ai-eligibility.js";
import { sendApiError } from "../../errors.js";
import type { CoachLimitService } from "../coach/limits.js";
import type { FoodDraftRateLimiter } from "../food-entries/draft-rate-limit.js";

interface StretchPlanRoutesOptions {
  readonly visionProvider: VisionDraftProvider;
  readonly resolveVisionProvider?: (
    provider: AiProvider,
  ) => VisionDraftProvider;
  readonly profileRepository?: ProfileRepository;
  readonly aiConsentRepository?: AiConsentRepository;
  /** Deletion fence; the route fails closed without `getDeletionJob`. */
  readonly accountRepository?: Pick<AccountRepository, "getDeletionJob">;
  /** Shared with meal and activity drafts, so one budget covers all. */
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

const DELETING_STATUSES: ReadonlySet<string> = new Set([
  "in_progress",
  "failed",
  "completed",
]);

const failureStatus = (kind: VisionProviderError["kind"]): number =>
  kind === "rate_limited"
    ? 429
    : kind === "refused"
      ? 422
      : kind === "timeout" || kind === "unavailable"
        ? 502
        : 503;

export const stretchPlanRoutes: FastifyPluginAsync<
  StretchPlanRoutesOptions
> = async (app, options) => {
  /** "deleting", "unavailable" or null when the account may continue. */
  const deletionFence = async (
    userId: UserId,
  ): Promise<"deleting" | "unavailable" | null> => {
    const getDeletionJob = options.accountRepository?.getDeletionJob?.bind(
      options.accountRepository,
    );
    if (!getDeletionJob) return "unavailable";
    try {
      const job = await getDeletionJob(userId);
      return job && DELETING_STATUSES.has(job.status) ? "deleting" : null;
    } catch {
      return "unavailable";
    }
  };

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
      // Every durable denial stands, including `minute`: the ledger then
      // reserved nothing, so proceeding would skip its daily check (#301).
      if (!res.allowed) {
        options.rateLimiter?.release(userId, "text");
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
    "/refine",
    { preHandler: app.authenticate },
    async (request, reply): Promise<StretchRefineResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const userId = principal.userId as UserId;
      const parsed = stretchRefineRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Send today's exercises (up to 40) or activities to tailor the stretch session.",
        );
      }
      // Before the profile lookup, which may create a profile row.
      const fence = await deletionFence(userId);
      if (fence === "deleting") {
        return sendApiError(
          reply,
          request,
          403,
          "ACCOUNT_DELETION_IN_PROGRESS",
          "Account deletion is in progress.",
        );
      }
      if (fence === "unavailable") {
        return sendApiError(
          reply,
          request,
          503,
          "AI_UNAVAILABLE",
          "AI stretch refinement is unavailable right now.",
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
      if (
        parsed.data.exercises.some(
          (exercise) => !screenCoachInput(exercise.name).allowed,
        )
      ) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Exercise names must name exercises, not ask for instructions or medical advice.",
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
        if (auth.provider.refineStretchPlan === undefined) {
          throw new VisionProviderError(
            "not_configured",
            "AI stretch refinement is not configured on this server.",
            false,
          );
        }
        const input: StretchSessionInput = {
          exercises: parsed.data.exercises,
          activities: parsed.data.activities,
        };
        const deterministic = buildEveningStretchSession(input);
        const refineStretchPlan = auth.provider.refineStretchPlan;
        const candidate = await runWithAiConsent(auth.consent, () =>
          refineStretchPlan.call(auth.provider, {
            userId,
            exercises: parsed.data.exercises,
            activities: parsed.data.activities,
            unresolvedNames: unresolvedStretchExerciseNames(input),
            deterministic: {
              focusMuscles: deterministic.focusMuscles,
              stepIds: deterministic.steps.map((step) => step.exerciseId),
            },
            options: listStretchOptions(),
            muscleVocabulary: STRETCH_MUSCLE_VOCABULARY,
            requestId,
          }),
        );
        // The model was called, so its tokens count even when the
        // choice turns out unusable.
        await options.limits?.commitDraftTokens(
          userId,
          candidate.tokensUsed ?? STRETCH_REFINE_ESTIMATED_TOKENS,
        );
        committed = true;
        const plan = stretchPlanFromChoice(
          { ...input, muscleTags: candidate.muscleTags },
          { picks: candidate.picks, focusMuscles: candidate.focusMuscles },
        );
        const response =
          plan === null
            ? null
            : stretchRefineResponseSchema.safeParse({
                plan: {
                  focusMuscles: plan.focusMuscles,
                  steps: plan.steps.map((step) => ({
                    exerciseId: step.exerciseId,
                    holdSeconds: step.holdSeconds,
                  })),
                },
                provenance: candidate.provenance,
                requestId,
              });
        if (response === null || !response.success) {
          return sendApiError(
            reply,
            request,
            502,
            "AI_UNAVAILABLE",
            "AI could not tailor the stretch session.",
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
              ? "AI stretch refinement is not available on this server."
              : error.kind === "refused"
                ? "AI couldn't tailor the stretch session for today's training."
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
