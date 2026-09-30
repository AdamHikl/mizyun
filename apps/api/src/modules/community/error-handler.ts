import type { FastifyInstance } from "fastify";
import { CommunityMutationError } from "@mizyun/core";
import { sendApiError } from "../../errors.js";

/** Repository decisions are transactional; map them without exposing targets or blocks. */
export const registerCommunityErrorHandler = (app: FastifyInstance): void => {
  const fallback = app.errorHandler;
  app.setErrorHandler((error, request, reply) => {
    if (!(error instanceof CommunityMutationError)) {
      return fallback.call(app, error, request, reply);
    }
    switch (error.code) {
      case "invalid_profile":
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Use plain social text without contact details in your bio.",
        );
      case "unavailable":
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Community item unavailable.",
        );
      case "conflict":
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "This action is no longer current. Refresh and try again.",
        );
      case "rate_limited":
        return sendApiError(
          reply,
          request,
          429,
          "RATE_LIMITED",
          "Please wait before making another Community request.",
        );
      case "handle_taken":
        return sendApiError(
          reply,
          request,
          409,
          "HANDLE_TAKEN",
          "This handle is unavailable.",
        );
    }
  });
};
