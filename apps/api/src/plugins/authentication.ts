import plugin from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import type { AccessTokenVerifier, AuthPrincipal } from "@mizyun/identity";

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthPrincipal | null;
  }

  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

interface AuthenticationPluginOptions {
  readonly tokenVerifier: AccessTokenVerifier;
}

const bearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
};

const authentication: FastifyPluginAsync<AuthenticationPluginOptions> = async (
  app,
  options,
) => {
  app.decorateRequest("principal", null);
  app.decorate("authenticate", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      await reply.status(401).send({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "A valid bearer token is required.",
          requestId: request.id,
        },
      });
      return;
    }

    try {
      request.principal = await options.tokenVerifier.verify(token);
    } catch (error) {
      request.log.error({ error }, "token verification unavailable");
      await reply.status(503).send({
        error: {
          code: "AUTHENTICATION_UNAVAILABLE",
          message: "Authentication is temporarily unavailable.",
          requestId: request.id,
        },
      });
      return;
    }

    if (!request.principal) {
      await reply.status(401).send({
        error: {
          code: "INVALID_ACCESS_TOKEN",
          message: "The access token is invalid or expired.",
          requestId: request.id,
        },
      });
    }
  });
};

export const authenticationPlugin = plugin(authentication, {
  name: "mizyun-authentication",
});
