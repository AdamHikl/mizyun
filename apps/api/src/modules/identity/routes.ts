import type { FastifyPluginAsync } from "fastify";

export const identityRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", { preHandler: app.authenticate }, async (request) => ({
    user: request.principal,
  }));
};
