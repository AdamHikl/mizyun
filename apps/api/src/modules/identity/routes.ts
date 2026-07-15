import type { FastifyPluginAsync } from "fastify";

import { meResponseSchema, type MeResponse } from "@mizyun/contracts";

export const identityRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/me",
    { preHandler: app.authenticate },
    async (request): Promise<MeResponse> =>
      // The schema is parsed (not just cast) so any future drift between
      // the AuthPrincipal shape and the wire contract is caught at the
      // producer side, not at a downstream mobile consumer.
      meResponseSchema.parse({ user: request.principal }),
  );
};
