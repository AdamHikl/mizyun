import { afterEach, describe, expect, it } from "vitest";

import { apiErrorSchema } from "@mizyun/contracts";

import { buildApp } from "./app.js";
import { sendApiError, internalErrorBody } from "./errors.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("error envelope", () => {
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
