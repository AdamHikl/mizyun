import plugin from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import type { AccessTokenVerifier, AuthPrincipal } from "@mizyun/identity";

import { sendApiError } from "../errors.js";

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
      await sendApiError(
        reply,
        request,
        401,
        "AUTHENTICATION_REQUIRED",
        "A valid bearer token is required.",
      );
      return;
    }

    try {
      request.principal = await options.tokenVerifier.verify(token);
    } catch (error) {
      request.log.error({ error }, "token verification unavailable");
      await sendApiError(
        reply,
        request,
        503,
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication is temporarily unavailable.",
      );
      return;
    }

    if (!request.principal) {
      await sendApiError(
        reply,
        request,
        401,
        "INVALID_ACCESS_TOKEN",
        "The access token is invalid or expired.",
      );
    }
  });
};

export const authenticationPlugin = plugin(authentication, {
  name: "mizyun-authentication",
});
