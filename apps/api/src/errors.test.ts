import { afterEach, describe, expect, it, vi } from "vitest";

import { apiErrorSchema } from "@mizyun/contracts";

import { buildApp } from "./app.js";
import { sendApiError, internalErrorBody } from "./errors.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("error envelope", () => {
  it.each([
    ["empty", "", 400],
    ["malformed", '{"notes":"PRIVATE_SYNTHETIC_BODY",', 400],
    ["oversized", JSON.stringify({ notes: "x".repeat(1024 * 1024 + 1) }), 413],
  ])(
    "rejects %s JSON through the parser without running the route",
    async (_label, payload, status) => {
      const app = buildApp();
      apps.push(app);
      const handler = vi.fn(() => ({ saved: true }));
      const warn = vi.fn();
      app.addHook("onRequest", async (request) => {
        request.log.warn = warn;
      });
      app.post("/v1/__test-parser", handler);
      const response = await app.inject({
        method: "POST",
        url: "/v1/__test-parser",
        headers: {
          "content-type": "application/json",
          "x-request-id": "parser-request-id",
        },
        payload,
      });
      expect(response.statusCode).toBe(status);
      expect(handler).not.toHaveBeenCalled();
      expect(response.json()).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request body could not be accepted.",
          requestId: "parser-request-id",
        },
      });
      expect(apiErrorSchema.safeParse(response.json()).success).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        { code: expect.stringMatching(/^FST_ERR_CTP_/), statusCode: status },
        "request body rejected",
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        "PRIVATE_SYNTHETIC_BODY",
      );
      expect(response.body).not.toContain("PRIVATE_SYNTHETIC_BODY");
    },
  );

  it("keeps valid JSON and bodyless requests working", async () => {
    const app = buildApp();
    apps.push(app);
    app.post("/v1/__test-parser", async (request) => ({
      body: request.body ?? null,
    }));
    const json = await app.inject({
      method: "POST",
      url: "/v1/__test-parser",
      payload: { notes: "synthetic" },
    });
    expect(json.statusCode).toBe(200);
    expect(json.json()).toEqual({ body: { notes: "synthetic" } });
    const bodyless = await app.inject({
      method: "POST",
      url: "/v1/__test-parser",
    });
    expect(bodyless.statusCode).toBe(200);
    expect(bodyless.json()).toEqual({ body: null });
  });

  it("normalizes unsupported media and mismatched lengths as client errors", async () => {
    const app = buildApp();
    apps.push(app);
    const handler = vi.fn(() => ({ saved: true }));
    app.post("/v1/__test-parser", handler);
    for (const [headers, status] of [
      [{ "content-type": "application/x-unsupported" }, 415],
      [{ "content-type": "application/json", "content-length": "30" }, 400],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/__test-parser",
        headers,
        payload: "{}",
      });
      expect(response.statusCode).toBe(status);
      expect(apiErrorSchema.safeParse(response.json()).success).toBe(true);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["PROVIDER_BAD_REQUEST", "__proto__", "constructor", "toString"])(
    "does not downgrade an application exception carrying code %s and a client status",
    async (code) => {
      const app = buildApp();
      apps.push(app);
      app.get("/v1/__test-application-error", async () => {
        throw Object.assign(new Error("PRIVATE_SYNTHETIC_ERROR"), {
          statusCode: 400,
          code,
        });
      });
      const response = await app.inject({
        method: "GET",
        url: "/v1/__test-application-error",
      });
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe("INTERNAL_ERROR");
      expect(response.body).not.toContain("PRIVATE_SYNTHETIC_ERROR");
    },
  );

  it("sendApiError returns the apiErrorSchema-shaped body with the request ID", async () => {
    const app = buildApp();
    apps.push(app);

    app.get("/v1/__test-error", async (request, reply) =>
      sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        "Field 'name' is required.",
      ),
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/__test-error",
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Field 'name' is required.",
        requestId: expect.any(String),
      },
    });
  });

  it("surfaces AI configuration failures through the shared schema", async () => {
    const app = buildApp();
    apps.push(app);
    app.get("/v1/__test-ai-configuration", async (request, reply) =>
      sendApiError(
        reply,
        request,
        503,
        "AI_CONFIGURATION_ERROR",
        "Coach configuration needs attention.",
      ),
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/__test-ai-configuration",
    });

    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json().error.code).toBe("AI_CONFIGURATION_ERROR");
  });

  it("internalErrorBody returns INTERNAL_ERROR with the request ID", () => {
    const fakeRequest = { id: "test-request-id" } as never;
    expect(internalErrorBody(fakeRequest)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: "test-request-id",
      },
    });
  });

  it("the global error handler returns INTERNAL_ERROR with the request ID for thrown exceptions", async () => {
    const app = buildApp();
    apps.push(app);

    app.get("/v1/__test-throw", async () => {
      throw new Error("boom");
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/__test-throw",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: expect.any(String),
      },
    });
  });

  it("x-request-id from the caller is preserved through the error response", async () => {
    const app = buildApp();
    apps.push(app);

    app.get("/v1/__test-throw-2", async () => {
      throw new Error("boom");
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/__test-throw-2",
      headers: { "x-request-id": "caller-supplied-id" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.requestId).toBe("caller-supplied-id");
  });

  it("authentication plugin surfaces AUTHENTICATION_REQUIRED with the apiErrorSchema envelope", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "A valid bearer token is required.",
        requestId: expect.any(String),
      },
    });
  });
});
