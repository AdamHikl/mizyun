import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyBaseLogger } from "fastify";
import pino from "pino";

import { loggerConfig, redactPaths } from "./logging.js";
import { buildApp } from "./app.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("loggerConfig", () => {
  it("disables the logger when env is 'test'", () => {
    expect(loggerConfig("test")).toEqual({ logger: false });
  });

  it("uses info level in production", () => {
    const config = loggerConfig("production");
    expect(config.logger).not.toBe(false);
    if (config.logger === false) return;
    expect(config.logger.level).toBe("info");
  });

  it("uses debug level outside production and test", () => {
    const config = loggerConfig("development");
    expect(config.logger).not.toBe(false);
    if (config.logger === false) return;
    expect(config.logger.level).toBe("debug");
  });

  it("includes the documented redact paths", () => {
    expect(redactPaths).toContain("req.headers.authorization");
    expect(redactPaths).toContain("req.headers.cookie");
    expect(redactPaths).toContain("req.body.password");
    expect(redactPaths).toContain("req.body.imageBase64");
    expect(redactPaths).toContain("req.body.email");
    expect(redactPaths).toContain("req.body.token");
    expect(redactPaths).toContain("req.body.access_token");
    expect(redactPaths).toContain("req.body.refresh_token");
  });

  it("forwards the `req`, `res`, `err`, and `error` serializers", () => {
    const config = loggerConfig("development");
    expect(config.logger).not.toBe(false);
    if (config.logger === false) return;
    expect(typeof config.logger.serializers.req).toBe("function");
    expect(typeof config.logger.serializers.res).toBe("function");
    expect(typeof config.logger.serializers.err).toBe("function");
    expect(typeof config.logger.serializers.error).toBe("function");
  });

  it("redacts community invitation tokens and handle queries in request URLs", () => {
    const config = loggerConfig("development");
    if (config.logger === false) throw new Error("logger unavailable");
    for (const url of [
      "/v1/community/invitations/private-bearer-token",
      "/v1/community/search?q=private_handle",
    ]) {
      expect(config.logger.serializers.req({ url }).url).toBe(
        "/v1/community/[redacted]",
      );
    }
  });

  it("safeErrorSerializer strips `cause` and `errors` chains from an error", () => {
    const config = loggerConfig("development");
    expect(config.logger).not.toBe(false);
    if (config.logger === false) return;
    const serializer = config.logger.serializers.error;
    const inner = new Error("inner cause with secret=abc");
    const outer = new Error("outer message");
    Object.assign(outer, { cause: inner });
    const serialised = serializer(outer);
    // The serializer must not carry the `cause` key — only the safe
    // top-level fields. If a downstream SDK error carries the request
    // body in its `cause`, this is the boundary that stops it.
    expect(serialised).not.toHaveProperty("cause");
    expect(serialised).not.toHaveProperty("errors");
    expect(serialised.type).toBe("Error");
    expect(serialised.message).toBe("outer message");
  });

  it("safeErrorSerializer preserves optional `code` and `statusCode` for diagnostic context", () => {
    const config = loggerConfig("development");
    expect(config.logger).not.toBe(false);
    if (config.logger === false) return;
    const serializer = config.logger.serializers.error;
    const error = Object.assign(new Error("oops"), {
      code: "ETIMEDOUT",
      statusCode: 503,
    });
    const serialised = serializer(error);
    expect(serialised.code).toBe("ETIMEDOUT");
    expect(serialised.statusCode).toBe(503);
  });
});

describe("redaction against a live Fastify instance", () => {
  it("replaces the Authorization header value with [Redacted] in the request log line", async () => {
    const { app, lines } = buildAppWithCapturedLogger();
    apps.push(app);

    await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: {
        authorization: "Bearer SECRET_TOKEN_DO_NOT_LOG_abcdef0123",
      },
    });

    // The token must not appear in any captured log line.
    for (const line of lines) {
      expect(line).not.toContain("SECRET_TOKEN_DO_NOT_LOG_abcdef0123");
    }
    // Pino's default censor string is `[Redacted]`. The Authorization
    // path must therefore appear at least once with that marker.
    expect(lines.some((line) => line.includes("Redacted"))).toBe(true);
  });

  it("replaces the Authorization header value with [Redacted] when the route throws", async () => {
    const { app, lines } = buildAppWithCapturedLogger();
    apps.push(app);

    app.get("/v1/__throw", async () => {
      throw new Error("boom");
    });

    await app.inject({
      method: "GET",
      url: "/v1/__throw",
      headers: {
        authorization: "Bearer SECRET_THROW_TOKEN_9999",
      },
    });

    for (const line of lines) {
      expect(line).not.toContain("SECRET_THROW_TOKEN_9999");
    }
  });

  it("strips error.cause from the log line so downstream secrets do not leak", async () => {
    const { app, lines } = buildAppWithCapturedLogger();
    apps.push(app);

    app.get("/v1/__throw-cause", async () => {
      const inner = new Error("DOWNSTREAM_SECRET_CAUSE_zzz");
      throw Object.assign(new Error("outer message"), { cause: inner });
    });

    await app.inject({
      method: "GET",
      url: "/v1/__throw-cause",
    });

    // Pino's default error serializer includes the `cause` field by
    // default (since pino v9). Our `safeErrorSerializer` is supposed
    // to omit it, so the inner-secret must not appear.
    expect(lines.some((l) => l.includes("DOWNSTREAM_SECRET_CAUSE_zzz"))).toBe(
      false,
    );
  });
});

/**
 * Build a Fastify instance that uses the same logger configuration as
 * `buildApp()` but with a captured pino stream so the tests can
 * assert redaction without depending on `process.stdout`.
 */
const buildAppWithCapturedLogger = (): {
  app: FastifyInstance;
  lines: string[];
} => {
  const lines: string[] = [];
  const stream = {
    write(chunk: string) {
      lines.push(chunk);
      return true;
    },
  };
  const config = loggerConfig("development");
  if (config.logger === false) {
    throw new Error("loggerConfig must not be false in this test");
  }
  // pino's full `Logger` interface includes a `msgPrefix` field that
  // Fastify's `FastifyBaseLogger` does not require. We cast through
  // `unknown` because the runtime object is structurally compatible
  // with what Fastify needs.
  const logger = pino(
    {
      level: config.logger.level,
      redact: config.logger.redact,
      serializers: config.logger.serializers,
    },
    stream,
  ) as unknown as FastifyBaseLogger;
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: "x-request-id",
  });
  return { app, lines };
};
