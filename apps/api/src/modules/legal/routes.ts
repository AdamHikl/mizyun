import type { FastifyPluginAsync } from "fastify";

const websiteOrigin = "https://www.phiskel.com";
const destinations = {
  privacy: `${websiteOrigin}/mizyun/privacy`,
  terms: `${websiteOrigin}/mizyun/terms`,
  support: `${websiteOrigin}/mizyun/support`,
  deleteAccount: `${websiteOrigin}/mizyun/delete-account`,
} as const;

export const legalRoutes: FastifyPluginAsync = async (app) => {
  app.get("/privacy", async (_request, reply) =>
    reply.redirect(destinations.privacy, 302),
  );
  app.get("/terms", async (_request, reply) =>
    reply.redirect(destinations.terms, 302),
  );
  app.get("/support", async (_request, reply) =>
    reply.redirect(destinations.support, 302),
  );
  app.get("/delete-account", async (_request, reply) =>
    reply.redirect(destinations.deleteAccount, 302),
  );
};
