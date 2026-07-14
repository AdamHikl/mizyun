import type { FastifyPluginAsync } from "fastify";

import type { HealthResponse } from "@mizyun/contracts";

export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "mizyun-api",
    timestamp: new Date().toISOString(),
  }));
};
