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
});
