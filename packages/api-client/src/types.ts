import type { z } from "zod";

/**
 * Typed failure envelope for every API request. Mirrors the discriminated
 * unions used elsewhere in the codebase (`AuthConfigurationStatus`,
 * `AgentProviderStatus`) so feature code can `switch (error.kind)` without
 * reading human-readable strings.
 *
 * `not_configured` is reserved for `DisabledApiClient`. `parse_error`
 * surfaces the rare case of a 4xx/5xx body that does not match the wire
 * `apiErrorSchema` — the structural mismatch is preserved instead of
 * swallowed. `validation_error` is the contract-violation case (200 OK
 * with a body that does not match the route's Zod schema) and is the
 * boundary the QUALITY_GATES "validated at trust boundaries" rule points to.
 * `context_changed` is local request retirement, distinct from missing Auth;
 * an optional cause retains the original transport denial or transient failure.
 */
export type ApiError =
  | { readonly kind: "not_configured"; readonly reason: string }
  | { readonly kind: "no_session" }
  | { readonly kind: "session_expired" }
  | { readonly kind: "context_changed"; readonly cause?: ApiError }
  | {
      readonly kind: "http_error";
      readonly status: number;
      readonly code: string;
      readonly message: string;
      readonly requestId?: string;
      readonly reason?: string;
      readonly retryAfterSeconds?: number;
      readonly resetAt?: string;
    }
  | {
      readonly kind: "validation_error";
      readonly issues: readonly z.ZodIssue[];
    }
  | { readonly kind: "parse_error"; readonly cause: unknown }
  | { readonly kind: "network_error"; readonly cause: unknown };

/**
 * Provider-neutral status of the API client. Mirrors `AuthConfigurationStatus`
 * so the mobile composition root can render the same "not configured" UI
 * surface for both clients.
 */
export type ApiConfigurationStatus =
  | { readonly configured: true; readonly baseUrl: string }
  | { readonly configured: false; readonly reason: string };

/**
 * Per-request options. The schema is optional so a caller can omit it for
 * endpoints whose response shape is not yet in `@mizyun/contracts`. A
 * `RequestOptions` value is always passed by value; the client does not
 * hold a reference beyond a single request.
 */
export interface RequestOptions<TBody = unknown> {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Relative path beginning with `/`, e.g. `/v1/me`. */
  readonly path: string;
  /** JSON-serialized by the client. Omit for body-less requests. */
  readonly body?: TBody;
  /**
   * Optional Zod schema. When present, the 2xx response body is parsed
   * with `safeParse` and a failure surfaces as `kind: "validation_error"`.
   */
  readonly schema?: z.ZodTypeAny;
  /** Caller-controlled cancellation. Forwarded to `fetch`. */
  readonly signal?: AbortSignal;
  /** Bind account-sensitive intent across asynchronous token lookup. */
  readonly expectedUserId?: string;
  /** False when the originating screen/controller has been retired. */
  readonly isCurrent?: () => boolean;
  /**
   * Extra request headers. Caller-provided `Authorization` is intentionally
   * ignored — the bearer token is the client's responsibility.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Phase 2 G — conditional revalidation. On a `GET`, the client sends this
   * entity tag as `If-None-Match`. A `304 Not Modified` then resolves to a
   * {@link NotModifiedResult} (`value: undefined`, no schema validation).
   * Ignored for other methods. Only callers that pass this option can
   * receive a not-modified result.
   */
  readonly ifNoneMatch?: string;
}

/**
 * Successful result for a `GET` sent with `ifNoneMatch` when the server
 * answered `304 Not Modified`: the caller's stored representation is still
 * current. `value` is `undefined`; narrow with `isNotModified(result)`.
 */
export interface NotModifiedResult {
  readonly ok: true;
  readonly value: undefined;
  readonly notModified: true;
}

/**
 * Optional revalidation metadata attached to a successful `request` result.
 * `etag` is present on a 200 that carried a usable `ETag` header (printable
 * ASCII, at most 256 characters); `notModified` only on a 304 answer to a
 * request that passed `ifNoneMatch`. Read with `resultEtag(...)` and
 * `isNotModified(...)` so existing `Result<T, ApiError>` callers are
 * unaffected.
 */
export interface RevalidationMetadata {
  readonly etag?: string;
  readonly notModified?: true;
}
