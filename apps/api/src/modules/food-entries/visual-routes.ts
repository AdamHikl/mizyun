import type { FastifyPluginAsync } from "fastify";
import type { ProfileRepository, UserId } from "@mizyun/core";
import type { BetaProRepository } from "../../beta-pro-repository.js";
import { hasMealVisuals } from "../../meal-visual-access.js";

export const mealVisualRoutes: FastifyPluginAsync<{
  profileRepository: ProfileRepository;
  betaProRepository: BetaProRepository;
}> = async (app, options) => {
  app.get(
    "/visuals/capability",
    { preHandler: app.authenticate },
    async (request) => ({
      mealVisuals: await hasMealVisuals(
        options,
        request.principal!.userId as UserId,
        request.principal!.accessToken,
      ),
    }),
  );
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });
};
