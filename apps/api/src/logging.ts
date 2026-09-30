/**
 * Centralised Fastify logger configuration.
 *
 * The redact list is the single source of truth for what is safe to log.
 * Adding a new credential or PII field to a route's body should also
 * add the corresponding redaction path here. The list is enforced by
 * `apps/api/src/logging.test.ts` so the test fails closed if a path
 * stops matching a live request shape.
 *
 * Why pino redaction paths instead of an in-house sanitizer:
 *   - pino strips fields at serialization time, before they hit stdout.
 *   - `@pinojs/redact` (the implementation behind pino's `redact`) is a
 *     well-audited CJS module — building our own would be a
 *     re-implementation of the same algorithm with a worse audit story.
 *   - The list is data, not code; tests can assert against it.
 *
 * The `serializers.error` strips `cause` chains so a redaction that
 * fails to scrub a downstream error does not silently leak the
 * original request payload into the log line.
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.refresh_token",
  "req.body.access_token",
  "req.body.session",
  "req.body.token",
  "req.body.email",
  "req.body.notes",
  "req.body.reason",
  "req.body.staffNotes",
  "req.body.reviewerNotes",
  "req.body.targetId",
  "req.body.interactionReceiptId",
  "res.headers['set-cookie']",
] as const;

/**
 * Strip `cause` and `errors` chains from an error before it reaches
 * the log line. Pino's standard error serializer includes `cause`
 * since v9, and a thrown SDK error can carry a deep chain that
 * contains the original request body. We only log `type`, `message`,
 * `stack`, and a shallow `code`/`statusCode`; the full chain is
 * preserved on the original error so test diagnostics still see it.
 */
const safeErrorSerializer = (error: Error) => {
  const withCode = error as Error & {
    code?: unknown;
    statusCode?: unknown;
  };
  const out: {
    type: string;
    message: string;
    stack: string;
    code?: string | number;
    statusCode?: string | number;
  } = {
    type: error.name,
    message: error.message,
    stack: error.stack ?? "",
  };
  if (typeof withCode.code === "string" || typeof withCode.code === "number") {
    out.code = withCode.code;
  }
  if (
    typeof withCode.statusCode === "string" ||
    typeof withCode.statusCode === "number"
  ) {
    out.statusCode = withCode.statusCode;
  }
  return out;
};

/**
 * Request serializer that includes headers so the redaction paths
 * above (e.g. `req.headers.authorization`) have something to redact.
 * The default Fastify pino `req` serializer omits headers; without
 * this, a Bearer token would never appear in the log line and the
 * redaction would be untestable. The shape matches Fastify's default
 * (`method`, `url`, `host`, `remoteAddress`, `remotePort`) plus
 * `headers`. Bodies are intentionally omitted because they are not
 * parsed at the time the request serializer runs.
 *
 * The signature accepts a structurally-typed request object — pino
 * only requires a function with this return shape.
 */
const requestSerializer = (request: {
  method?: unknown;
  url?: unknown;
  host?: unknown;
  ip?: unknown;
  socket?: { remotePort?: unknown };
  headers?: unknown;
}): Record<string, unknown> => ({
  method: request.method,
  // Community URL paths contain bearer invitation secrets and search queries.
  url:
    typeof request.url === "string" &&
    request.url.split("?")[0]?.startsWith("/v1/community/")
      ? "/v1/community/[redacted]"
      : request.url,
  host: request.host,
  remoteAddress: request.ip,
  remotePort:
    typeof request.socket?.remotePort === "number"
      ? request.socket.remotePort
      : undefined,
  headers: request.headers,
});

/**
 * Response serializer that includes `set-cookie` so the
 * `res.headers['set-cookie']` redaction path has something to act
 * on. Other headers are omitted because they are not sensitive.
 */
const responseSerializer = (reply: {
  statusCode?: unknown;
  getHeaders?: () => Record<string, unknown>;
}): Record<string, unknown> => {
  const headers =
    typeof reply.getHeaders === "function" ? reply.getHeaders() : {};
  return {
    statusCode: reply.statusCode,
    setCookie: headers["set-cookie"],
  };
};

export interface LoggerConfig {
  readonly logger:
    | false
    | {
        readonly level: string;
        readonly redact: string[];
        readonly serializers: {
          readonly req: typeof requestSerializer;
          readonly res: typeof responseSerializer;
          readonly err: typeof safeErrorSerializer;
          readonly error: typeof safeErrorSerializer;
        };
      };
}

/**
 * Build the Fastify logger configuration. Uses the validated env to
 * decide the log level: `test` disables the logger, `production` uses
 * `info`, everything else uses `debug`.
 */
export const loggerConfig = (env: string): LoggerConfig => {
  if (env === "test") return { logger: false };
  const level = env === "production" ? "info" : "debug";
  return {
    logger: {
      level,
      redact: [...REDACT_PATHS],
      serializers: {
        req: requestSerializer,
        res: responseSerializer,
        err: safeErrorSerializer,
        error: safeErrorSerializer,
      },
    },
  };
};

/**
 * Exported for tests that need to assert the redaction set covers the
 * fields Mizyun handles. Treat as readonly.
 */
export const redactPaths: ReadonlyArray<string> = REDACT_PATHS;
