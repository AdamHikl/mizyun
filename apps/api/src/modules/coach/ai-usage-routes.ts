import type { FastifyPluginAsync } from "fastify";
import type { PlanTier, ProfileRepository, UserId } from "@mizyun/core";
import { aiUsageResponseSchema, type AiUsageResponse } from "@mizyun/contracts";

import type { CoachLimitService } from "./limits.js";

export interface AiUsageRoutesOptions {
  readonly profileRepository?: ProfileRepository;
  readonly limits?: CoachLimitService;
  readonly coachLimits?: CoachLimitService;
  readonly planTierOverride?: PlanTier | undefined;
  readonly clock?: () => Date;
  readonly now?: () => Date;
}

export const aiUsageRoutes: FastifyPluginAsync<AiUsageRoutesOptions> = async (
  app,
  options,
) => {
  const limitsService = options.coachLimits ?? options.limits;
  if (!limitsService) {
    throw new Error("CoachLimitService must be provided to aiUsageRoutes");
  }

  const isPrefixedWithAi = app.prefix.endsWith("/ai");
  const path = isPrefixedWithAi ? "/usage" : "/ai/usage";

  app.get(
    path,
    { preHandler: app.authenticate },
    async (request, _reply): Promise<AiUsageResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }

      let planTier: PlanTier = "free";
      if (options.planTierOverride) {
        planTier = options.planTierOverride;
      } else if (options.profileRepository) {
        try {
          const clock = options.now ?? options.clock ?? (() => new Date());
          const profile = await options.profileRepository.getOrCreate(
            principal.userId as UserId,
            {
              now: clock(),
              accessToken: principal.accessToken,
            },
          );
          if (profile?.planTier === "paid") {
            planTier = "paid";
          }
        } catch {
          planTier = "free";
        }
      }

      const usage = await limitsService.getAiUsage(
        principal.userId as UserId,
        planTier,
      );

      return aiUsageResponseSchema.parse({
        planTier,
        resetsAt: usage.resetsAt,
        coach: usage.coach,
        photos: usage.photos,
      });
    },
  );
};
