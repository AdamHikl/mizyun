import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("API foundation", () => {
  it("reports API health independently from optional providers", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "mizyun-api",
    });
  });

  it("reports the intentionally disabled agent provider", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/coach/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ready: false,
      provider: "disabled",
    });
  });

  it("rejects access to protected routes without a bearer token", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it("exposes the verified principal to protected routes", async () => {
    const tokenVerifier: AccessTokenVerifier = {
      verify: async (token) =>
        token === "valid-token"
          ? {
              userId: "00000000-0000-4000-8000-000000000001" as UserId,
              email: "person@example.com",
              accessToken: "test-token",
            }
          : null,
    };
    const app = buildApp({
      tokenVerifier,
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        userId: "00000000-0000-4000-8000-000000000001",
        email: "person@example.com",
      },
    });
  });

  it("/v1/me response body is validated by meResponseSchema (rejects non-UUID principals)", async () => {
    // This test exercises the server-side contract enforcement added in
    // API-001: the `/v1/me` route parses its output through `meResponseSchema`,
    // so a verifier that returns a non-UUID principal should cause a parse
    // failure rather than a successful response with garbage data.
    const tokenVerifier: AccessTokenVerifier = {
      verify: async () => ({
        userId: "not-a-uuid" as unknown as UserId,
        accessToken: "test-token",
      }),
    };
    const app = buildApp({
      tokenVerifier,
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer any-token" },
    });

    // The schema parse throws; the global error handler returns 500 with
    // a normalised `apiErrorSchema` body — the contract surface is
    // intentional even on this internal-violation path.
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error?.code).toBe("INTERNAL_ERROR");
  });

  it("reports an unavailable token verifier as 503, not an invalid token", async () => {
    // Clients sign out on 401. An auth outage must not end valid sessions.
    const tokenVerifier: AccessTokenVerifier = {
      verify: async () => {
        throw new Error("Access token verification is unavailable.");
      },
    };
    const app = buildApp({
      tokenVerifier,
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer any-token" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error?.code).toBe("AUTHENTICATION_UNAVAILABLE");
  });
});
