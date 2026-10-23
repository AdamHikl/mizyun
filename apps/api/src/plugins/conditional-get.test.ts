import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../app.js";
import {
  computeEntityTag,
  conditionalGetPlugin,
  ifNoneMatchMatches,
} from "./conditional-get.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const buildTestApp = async (): Promise<FastifyInstance> => {
  const app = Fastify();
  apps.push(app);
  await app.register(conditionalGetPlugin);
  app.get("/v1/items", async (request, reply) => {
    if (request.headers.authorization !== "Bearer ok") {
      return reply.code(401).send({ error: "AUTHENTICATION_REQUIRED" });
    }
    if (request.headers["x-role"] === "stranger") {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    return { items: [1, 2, 3] };
  });
  app.post("/v1/items", async () => ({ created: true }));
  app.get("/v1/signed", async (_request, reply) => {
    reply.header("cache-control", "no-store, max-age=0");
    return { url: "https://example.test/signed?sig=abc" };
  });
  app.get("/v1/text", async (_request, reply) => {
    reply.type("text/plain");
    return "plain";
  });
  app.get("/legal/terms", async () => ({ terms: true }));
  return app;
};

const authorized = { authorization: "Bearer ok" };

describe("ifNoneMatchMatches", () => {
  const tag = '"sha256:abc"';
  it("matches exact, weak, list and * forms", () => {
    expect(ifNoneMatchMatches('"sha256:abc"', tag)).toBe(true);
    expect(ifNoneMatchMatches('W/"sha256:abc"', tag)).toBe(true);
    expect(ifNoneMatchMatches('"x", W/"sha256:abc" , "y"', tag)).toBe(true);
    expect(ifNoneMatchMatches("*", tag)).toBe(true);
    expect(ifNoneMatchMatches(['"x"', '"sha256:abc"'], tag)).toBe(true);
  });
  it("rejects missing, different and malformed values", () => {
    expect(ifNoneMatchMatches(undefined, tag)).toBe(false);
    expect(ifNoneMatchMatches('"sha256:abd"', tag)).toBe(false);
    expect(ifNoneMatchMatches("sha256:abc", tag)).toBe(false);
    expect(ifNoneMatchMatches("", tag)).toBe(false);
  });
});

describe("conditionalGetPlugin", () => {
  it("adds a payload-derived ETag and no-store to a personal GET", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/items",
      headers: authorized,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBe(computeEntityTag(response.body));
    expect(response.headers.etag).toMatch(/^"sha256:[A-Za-z0-9_-]{32}"$/);
  });

  it("returns an empty 304 for a matching If-None-Match", async () => {
    const app = await buildTestApp();
    const first = await app.inject({
      method: "GET",
      url: "/v1/items",
      headers: authorized,
    });
    const etag = first.headers.etag as string;
    for (const ifNoneMatch of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/items?x=1",
        headers: { ...authorized, "if-none-match": ifNoneMatch },
      });
      expect(response.statusCode).toBe(304);
      expect(response.body).toBe("");
      expect(response.headers.etag).toBe(etag);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["content-type"]).toBeUndefined();
      expect(response.headers["content-length"]).toBeUndefined();
    }
  });

  it("returns the full 200 for a non-matching If-None-Match", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/items",
      headers: { ...authorized, "if-none-match": '"sha256:stale"' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [1, 2, 3] });
  });

  it("never converts 401 or 403 into 304, even with If-None-Match: *", async () => {
    const app = await buildTestApp();
    const ok = await app.inject({
      method: "GET",
      url: "/v1/items",
      headers: authorized,
    });
    const etag = ok.headers.etag as string;
    for (const headers of [
      { "if-none-match": etag },
      { "if-none-match": "*" },
      { ...authorized, "x-role": "stranger", "if-none-match": "*" },
      { ...authorized, "x-role": "stranger", "if-none-match": etag },
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/items",
        headers,
      });
      expect([401, 403]).toContain(response.statusCode);
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toBe("");
    }
  });

  it("leaves POST without an ETag or 304 but still no-store", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { "if-none-match": "*" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("leaves routes that set their own Cache-Control untouched", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/signed",
      headers: { "if-none-match": "*" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(response.headers.etag).toBeUndefined();
  });

  it("skips non-JSON payloads and non-/v1 routes", async () => {
    const app = await buildTestApp();
    const text = await app.inject({ method: "GET", url: "/v1/text" });
    expect(text.headers.etag).toBeUndefined();
    expect(text.headers["cache-control"]).toBe("no-store");
    const legal = await app.inject({ method: "GET", url: "/legal/terms" });
    expect(legal.headers.etag).toBeUndefined();
    expect(legal.headers["cache-control"]).toBeUndefined();
  });

  it("applies no-store to 404 responses under /v1/", async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: "GET", url: "/v1/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBeUndefined();
  });
});

describe("conditional GET in the composed API", () => {
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
  const composed = () => {
    const app = buildApp({
      tokenVerifier,
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
    });
    apps.push(app);
    return app;
  };

  it("revalidates /v1/me with ETag and 304", async () => {
    const app = composed();
    const first = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    const etag = first.headers.etag as string;
    expect(etag).toBe(computeEntityTag(first.body));

    const second = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer valid-token", "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers.etag).toBe(etag);
  });

  it("does not turn an unauthenticated /v1/me into 304", async () => {
    const app = composed();
    for (const headers of [
      { "if-none-match": "*" },
      { authorization: "Bearer wrong-token", "if-none-match": "*" },
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers,
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });
});
