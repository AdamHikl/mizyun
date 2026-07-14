import type { FastifyPluginAsync } from "fastify";

import type { AgentOrchestrator } from "@mizyun/agent-runtime";

interface CoachRoutesOptions {
  readonly agent: AgentOrchestrator;
}

export const coachRoutes: FastifyPluginAsync<CoachRoutesOptions> = async (
  app,
  options,
) => {
  app.get("/status", async () => options.agent.status());
};
