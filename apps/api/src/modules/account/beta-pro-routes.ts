import type { FastifyPluginAsync } from "fastify";
import type { UserId } from "@mizyun/core";
import {
  betaProRequestInputSchema,
  betaProStatusResponseSchema,
  type BetaProRequestInput,
  type BetaProStatusResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";
import type { BetaProRepository } from "../../beta-pro-repository.js";

export interface BetaProRoutesOptions {
  readonly repository: BetaProRepository;
}

export const betaProRoutes: FastifyPluginAsync<BetaProRoutesOptions> = async (
  app,
  options,
) => {
  const isPrefixedWithBetaPro = app.prefix.endsWith("/beta-pro");
  const statusPath = isPrefixedWithBetaPro ? "/status" : "/beta-pro/status";
  const requestPath = isPrefixedWithBetaPro ? "/request" : "/beta-pro/request";
  const pushTokenPath = isPrefixedWithBetaPro
    ? "/push-token"
    : "/beta-pro/push-token";

  // Automatic push registration must never submit a Beta Pro request.
  app.put(
    pushTokenPath,
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const parsed = betaProRequestInputSchema
        .pick({ pushToken: true })
        .required()
        .safeParse(request.body);
      if (!parsed.success || !parsed.data.pushToken.trim()) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "A valid push token is required.",
        );
      }
      const repositoryOptions = { accessToken: principal.accessToken };
      const updated = await options.repository.updatePushToken(
        principal.userId,
        parsed.data.pushToken,
        repositoryOptions,
      );
      return { updated };
    },
  );

  // GET /v1/beta-pro/status — query status of current user's Beta Pro request
  app.get(
    statusPath,
    { preHandler: app.authenticate },
    async (request, _reply): Promise<BetaProStatusResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }

      const row = await options.repository.getRequest(principal.userId, {
        accessToken: principal.accessToken,
      });

      if (!row) {
        return betaProStatusResponseSchema.parse({
          status: "none",
          requestedAt: null,
          reviewedAt: null,
          notes: null,
        });
      }

      return betaProStatusResponseSchema.parse({
        status: row.status,
        requestedAt: row.createdAt
          ? new Date(row.createdAt).toISOString()
          : null,
        reviewedAt: row.reviewedAt
          ? new Date(row.reviewedAt).toISOString()
          : null,
        notes: row.notes,
      });
    },
  );

  // POST /v1/beta-pro/request — submit or update Beta Pro request
  app.post(
    requestPath,
    { preHandler: app.authenticate },
    async (request, reply): Promise<{ status: string } | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }

      const parsed = betaProRequestInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid beta pro request: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
      }

      const input: BetaProRequestInput = parsed.data;
      const email = principal.email ?? `${principal.userId}@user.mizyun`;

      await options.repository.saveRequest(
        {
          userId: principal.userId as UserId,
          email,
          ...(input.pushToken !== undefined
            ? { pushToken: input.pushToken }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        {
          accessToken: principal.accessToken,
        },
      );

      return { status: "pending" };
    },
  );
};
