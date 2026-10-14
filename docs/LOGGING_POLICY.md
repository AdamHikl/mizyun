# Logging policy

> What Mizyun logs, what it does not, and how a request ID lets a user-facing error message cross-reference the log line. Companion to `docs/QUALITY_GATES.md`.

## Why this exists

Log lines that contain bearer tokens, passwords, emails, or session payloads can be exfiltrated by anyone with access to the log aggregator (or by a misconfigured shipping target). The pre-OPS-001 setup had a partial redaction list inline in `apps/api/src/app.ts` and no documented contract for what the error envelope must contain. This policy fixes both gaps.

## Scope

This document governs logs produced by the Fastify API (`apps/api`). Mobile client logging is intentionally out of scope — the React Native runtime emits its own logs, and the bundle-purity invariant (`pnpm --filter @mizyun/mobile bundle:check`) is the boundary that protects against accidentally shipping a token there.

## What is logged

Every Fastify request produces a single structured JSON line at completion (level `info` in production, `debug` otherwise) plus a separate line for any thrown exception (level `error`). Each line carries:

- The stable request ID (`request.id`, generated from the `x-request-id` header if the caller supplies one, otherwise a UUID).
- The request method, URL, host, remote address, remote port.
- The request headers — with sensitive paths redacted (see below).
- The response status code.
- The response `set-cookie` header — with the redaction path applied.
- For thrown exceptions: a structured `err` payload with `type`, `message`, `stack`, `code`, `statusCode`. The `cause` and `errors` chains are intentionally stripped so a downstream SDK error cannot smuggle the original request body into a log line.

## What is not logged

The redact list in `apps/api/src/logging.ts` is the single source of truth. Today it covers:

| Path                        | Rationale                                               |
| --------------------------- | ------------------------------------------------------- |
| `req.headers.authorization` | Bearer token used to identify the user.                 |
| `req.headers.cookie`        | Session cookie used by some auth flows.                 |
| `req.body.password`         | Plaintext password in a sign-in / change-password body. |
| `req.body.refresh_token`    | Long-lived credential.                                  |
| `req.body.access_token`     | Short-lived credential.                                 |
| `req.body.session`          | Provider-issued session payload (raw, pre-parse).       |
| `req.body.token`            | Generic token field on request bodies.                  |
| `req.body.email`            | PII; we route identity by user ID, not email.           |
| `res.headers['set-cookie']` | Response cookie; reverse-direction leakage vector.      |

Apple authorization codes, deletion confirmation receipts, encrypted revocation tokens, refresh tokens and server signing/encryption keys are covered by the central redaction list. Provider cleanup uses fixed errors; provider response bodies and causes never enter deletion jobs or public errors.

Community request URLs are reduced to `/v1/community/[redacted]`. Confidential report and appeal notes/reasons, staff/reviewer notes, target IDs and interaction receipt IDs are also covered by body redaction paths; normal request serialization omits bodies entirely. Meal publication source identifiers (`mealId`) and confirmed name/nutrition snapshots (`expectedMealDetails`) are redacted at request-body, body and top-level diagnostic paths. Staff case evidence lives in the restricted database audit, never generic API logs.

The list is enforced by `apps/api/src/logging.test.ts` so removing a path is a deliberate code change, not a refactor side-effect.

The pino censor string is the default `[Redacted]`. Tests assert this string appears in the log line when a sensitive field is sent, and assert the sensitive value never does.

## The `apiErrorSchema` envelope

Every 4xx and 5xx response carries the `apiErrorSchema` shape declared in `@mizyun/contracts`:

```json
{
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "A valid bearer token is required.",
    "requestId": "caller-supplied-id-or-generated"
  }
}
```

Stable error codes are listed in `apps/api/src/errors.ts` (`ApiErrorCode`). Anything outside the list collapses to `INTERNAL_ERROR` with the request ID; the underlying exception is logged via `request.log.error(...)` but never echoed back to the caller.

The `internalErrorBody` and `sendApiError` helpers in `errors.ts` are the only places the envelope is constructed. Route handlers and the global error handler use these helpers — a future contract change is a single-file edit.

## Error codes

| Code                         | HTTP            | Where it is used                                                                                                               |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `AUTHENTICATION_REQUIRED`    | 401             | `authenticationPlugin` when no Authorization header is present.                                                                |
| `INVALID_ACCESS_TOKEN`       | 401             | `authenticationPlugin` when the verifier returns `null`.                                                                       |
| `AUTHENTICATION_UNAVAILABLE` | 503             | `authenticationPlugin` when the verifier throws.                                                                               |
| `NOT_FOUND`                  | 404             | Reserved for explicit 404 responses (future).                                                                                  |
| `VALIDATION_ERROR`           | 400/413/415/422 | Known request-parser failures use fixed messages and metadata-only warning logs; route validation retains its existing status. |
| `RATE_LIMITED`               | 429             | Per-user Coach request/token limits and provider 429 responses.                                                                |
| `AI_UNAVAILABLE`             | 502/503         | Recoverable provider timeout/unavailable/disabled responses.                                                                   |
| `AI_CONFIGURATION_ERROR`     | 503             | Non-retryable provider authentication/payment/schema failures.                                                                 |
| `INTERNAL_ERROR`             | 500             | Global error handler fallback.                                                                                                 |

## What feature code may add

When a route needs a structured log line, the pattern is:

```ts
request.log.info({ routeSpecific: "..." }, "human-readable event");
```

The structured payload must not include request bodies, response bodies, or any field on the redact list. If the field is structurally required, add the redaction path to `apps/api/src/logging.ts` first and extend the structural test in `logging.test.ts` to cover it.

## What feature code must not do

- Inline a `redact` array on a `Fastify({ logger: { redact: [...] } })` call. The list is centralised.
- Echo a raw exception's `message` to a caller. Use `internalErrorBody(request)` instead.
- Log a request body in full. If a body field is required for diagnostic value, add a `redact` path and a test.
- Construct an `apiErrorSchema`-shaped body inline. Use `sendApiError`.

## Adding a new error code

1. Add the literal to `ApiErrorCode` in `apps/api/src/errors.ts`.
2. Add a row to the table in this document.
3. Add a vitest case to `errors.test.ts` that asserts the code surfaces through `sendApiError` and matches the `apiErrorSchema` parser in `@mizyun/contracts`.
4. If the code corresponds to a new HTTP status, document the policy choice in `docs/QUALITY_GATES.md`.

## Cross-references

- `apps/api/src/logging.ts` — the redact list, serializers, and logger configuration.
- `apps/api/src/logging.test.ts` — structural assertions on the redact list and runtime assertions against a captured pino stream.
- `apps/api/src/errors.ts` — the `sendApiError` and `internalErrorBody` helpers and the `ApiErrorCode` union.
- `apps/api/src/errors.test.ts` — envelope-shape assertions.
- `apps/api/vitest.config.ts` — auto-loads `apps/api/.env.test` so the e2e suite can run without shell-pasted credentials.
- `packages/contracts/src/index.ts` — `apiErrorSchema` definition.
- `docs/QUALITY_GATES.md` — the pre-merge gate.
- `docs/RESEARCH_LOG.md` — dated AUTH/OPS/OPS-001 research entries.

Recipe routes never log inventory, model inputs/outputs, health context, normalized image bytes or provider exceptions. Diagnostic input/images/fingerprint/healthContext fields are redacted at supported request/body/top-level shapes. Provider/service failures use static normalized errors; the private operational ledger stores only bounded identity/status/usage metadata. Account export omits fingerprints and provider content.

Recurring suggestion routes treat proposals, family keys, candidate IDs and evidence digests as private health-derived content. Redact them at top/body/request-body shapes. Request URL serialization and Pino message serialization remove the candidate path segment, including Fastify default unmatched-route messages. Use static errors; do not log the detection evidence or frozen schedule payload.
