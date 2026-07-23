import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Stable error codes returned through the `apiErrorSchema` envelope.
 *
 * The set is deliberately small: anything outside it is a 500 with
 * `INTERNAL_ERROR` and a request ID. Adding a new code is an explicit
 * contract change and should be reviewed against `docs/LOGGING_POLICY.md`.
 */
export type ApiErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_ACCESS_TOKEN"
  | "AUTHENTICATION_UNAVAILABLE"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "INTERNAL_ERROR";

interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId?: string;
  };
}

const requestIdOf = (request: FastifyRequest): string => request.id;

/**
 * Send a normalised `apiErrorSchema`-shaped response. Centralising
 * the shape here means a future contract change (e.g. adding
 * `retryAfter` to `RATE_LIMITED`) is a single-file edit. The request
 * ID is always included so the user-facing message can be
 * cross-referenced with log lines.
 */
export const sendApiError = (
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: ApiErrorCode,
  message: string,
): FastifyReply => {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId: requestIdOf(request),
    },
  };
  return reply.status(status).send(body);
};

/**
 * Build the safe public body for an unhandled exception. The raw
 * error is logged by the caller (with the redaction-stripping
 * `safeErrorSerializer`); the response only carries `INTERNAL_ERROR`
 * and the request ID. This is the documented failure shape in
 * `docs/LOGGING_POLICY.md`.
 */
export const internalErrorBody = (request: FastifyRequest): ApiErrorBody => ({
  error: {
    code: "INTERNAL_ERROR",
    message: "The request could not be completed.",
    requestId: requestIdOf(request),
  },
});
