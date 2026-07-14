import Fastify, { type FastifyInstance } from "fastify";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { createSupabaseAccessTokenVerifier } from "@mizyun/adapter-supabase-server";
import {
  RejectingAccessTokenVerifier,
  type AccessTokenVerifier,
} from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { coachRoutes } from "./modules/coach/routes.js";
import { identityRoutes } from "./modules/identity/routes.js";
import { systemRoutes } from "./modules/system/routes.js";
import { authenticationPlugin } from "./plugins/authentication.js";

export interface AppDependencies {
  readonly agent: AgentOrchestrator;
  readonly tokenVerifier: AccessTokenVerifier;
}

const defaultTokenVerifier = (): AccessTokenVerifier => {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && publishableKey
    ? createSupabaseAccessTokenVerifier({ url, publishableKey })
    : new RejectingAccessTokenVerifier();
};

const defaultDependencies = (): AppDependencies => ({
  agent: new AgentOrchestrator({
    provider: new DisabledAgentProvider(),
    memories: new InMemoryMemoryStore(),
  }),
  tokenVerifier: defaultTokenVerifier(),
});

export const buildApp = (
  dependencies: AppDependencies = defaultDependencies(),
): FastifyInstance => {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === "test"
        ? false
        : { redact: ["req.headers.authorization", "req.headers.cookie"] },
    requestIdHeader: "x-request-id",
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, "request failed");
    void reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: request.id,
      },
    });
  });

  void app.register(authenticationPlugin, {
    tokenVerifier: dependencies.tokenVerifier,
  });
  void app.register(systemRoutes, { prefix: "/v1" });
  void app.register(identityRoutes, { prefix: "/v1" });
  void app.register(coachRoutes, {
    prefix: "/v1/coach",
    agent: dependencies.agent,
  });

  return app;
};
