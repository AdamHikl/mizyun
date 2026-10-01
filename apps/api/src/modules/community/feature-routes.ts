import type { FastifyPluginAsync } from "fastify";
import { communityFeatureStatusSchema } from "@mizyun/contracts";
export const communityFeatureRoutes: FastifyPluginAsync<{
  read: (token: string) => Promise<unknown>;
}> = async (app, { read }) => {
  app.get("/features", { preHandler: app.authenticate }, async (request) => {
    if (!request.principal) throw new Error("principal missing");
    return communityFeatureStatusSchema.parse(
      await read(request.principal.accessToken),
    );
  });
};
