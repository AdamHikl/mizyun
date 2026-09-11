import { apiErrorSchema } from "@mizyun/contracts";
import { err, type Result } from "@mizyun/core";

import type { ApiError } from "./types";

/**
 * Try to parse a non-2xx response body as the wire `apiErrorSchema`. On
 * success, surface the parsed `code` / `message` / `requestId` as
 * `kind: "http_error"`. On failure, surface the structural mismatch as
 * `kind: "parse_error"` so the consumer knows the server returned an
 * unexpected shape.
 */
export const parseApiErrorBody = (
  body: unknown,
): Result<Extract<ApiError, { kind: "http_error" }>, ApiError> => {
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) {
    return err({ kind: "parse_error", cause: parsed.error });
  }
  const { code, message, requestId, reason, retryAfterSeconds, resetAt } =
    parsed.data.error;
  return err({
    kind: "http_error",
    status: 0,
    code,
    message,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
  });
};

/**
 * Map a raw `fetch` rejection to a typed `network_error`. The cause is
 * preserved unchanged so feature code can distinguish offline, DNS, and
 * `AbortError` if it needs to. `status` is `0` for these cases — consumers
 * should branch on `kind` first.
 */
export const mapFetchError = (cause: unknown): ApiError => ({
  kind: "network_error",
  cause,
});
