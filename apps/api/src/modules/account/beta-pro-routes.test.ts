import { afterEach, describe, expect, it } from "vitest";

import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";

import { buildApp } from "../../app.js";
import { InMemoryBetaProRepository } from "../../beta-pro-repository.js";

const userA: UserId = "00000000-0000-4000-8000-000000000001" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (userId: UserId): AccessTokenVerifier => ({
  verify: async (token) =>
    token === "valid"
      ? {
          userId,
          role: "authenticated",
          accessToken: "test-token",
          email: "adam.hikl@outlook.com",
        }
      : null,
});

describe("Beta Pro Routes", () => {
  describe("PUT /v1/beta-pro/push-token", () => {
    it("does not create a request when registering a token before requesting a pass", async () => {
      const repo = new InMemoryBetaProRepository();
      const app = buildApp({
        betaProRepository: repo,
        tokenVerifier: tokenVerifierFor(userA),
      });
      apps.push(app);
      const response = await app.inject({
        method: "PUT",
        url: "/v1/beta-pro/push-token",
        headers: { authorization: "Bearer valid" },
        payload: { pushToken: "device-token" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ updated: false });
      expect(await repo.getRequest(userA)).toBeNull();
    });

    it("updates only the authenticated user's existing token without changing review state", async () => {
      const repo = new InMemoryBetaProRepository();
      const existing = {
        id: "req-1",
        userId: userA,
        email: "test@example.com",
        pushToken: null,
        status: "approved" as const,
        notes: "reviewed",
        createdAt: new Date("2026-09-12T12:00:00Z"),
        reviewedAt: new Date("2026-09-12T14:00:00Z"),
      };
      repo.__seedForTest(existing);
      const app = buildApp({
        betaProRepository: repo,
        tokenVerifier: tokenVerifierFor(userA),
      });
      apps.push(app);
      const response = await app.inject({
        method: "PUT",
        url: "/v1/beta-pro/push-token",
        headers: { authorization: "Bearer valid" },
        payload: {
          pushToken: "new-token",
          userId: "other-user",
          notes: "overwrite",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ updated: true });
      expect(await repo.getRequest(userA)).toEqual({
        ...existing,
        pushToken: "new-token",
      });
    });

    it("rejects unauthenticated registration", async () => {
      const repo = new InMemoryBetaProRepository();
      const app = buildApp({
        betaProRepository: repo,
        tokenVerifier: tokenVerifierFor(userA),
      });
      apps.push(app);
      const response = await app.inject({
        method: "PUT",
        url: "/v1/beta-pro/push-token",
        payload: { pushToken: "token" },
      });
      expect(response.statusCode).toBe(401);
      expect(await repo.getRequest(userA)).toBeNull();
    });

    it.each([{}, { pushToken: "" }, { pushToken: "x".repeat(256) }])(
      "rejects invalid input %j",
      async (payload) => {
        const repo = new InMemoryBetaProRepository();
        const app = buildApp({
          betaProRepository: repo,
          tokenVerifier: tokenVerifierFor(userA),
        });
        apps.push(app);
        const response = await app.inject({
          method: "PUT",
          url: "/v1/beta-pro/push-token",
          headers: { authorization: "Bearer valid" },
          payload,
        });
        expect(response.statusCode).toBe(422);
        expect(await repo.getRequest(userA)).toBeNull();
      },
    );
  });

  describe("GET /v1/beta-pro/status", () => {
    it("returns status none when no request has been submitted", async () => {
      const repo = new InMemoryBetaProRepository();
      const app = buildApp({
        betaProRepository: repo,
        tokenVerifier: tokenVerifierFor(userA),
      });
      apps.push(app);

      const res = await app.inject({
        method: "GET",
        url: "/v1/beta-pro/status",
        headers: { authorization: "Bearer valid" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("none");
      expect(body.requestedAt).toBeNull();
      expect(body.reviewedAt).toBeNull();
    });

    it("returns approved status when user has approved request", async () => {
      const repo = new InMemoryBetaProRepository();
      repo.__seedForTest({
        id: "req-1",
        userId: userA,
        email: "adam.hikl@outlook.com",
        pushToken: null,
        status: "approved",
        notes: null,
        createdAt: new Date("2026-09-12T12:00:00Z"),
        reviewedAt: new Date("2026-09-12T14:00:00Z"),
      });

      const app = buildApp({
        betaProRepository: repo,
        tokenVerifier: tokenVerifierFor(userA),
      });
      apps.push(app);

      const res = await app.inject({
        method: "GET",
        url: "/v1/beta-pro/status",
        headers: { authorization: "Bearer valid" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("approved");
    });
  });

  describe("POST /v1/beta-pro/request", () => {
    it("creates new pending request with push token", async () => {
      const repo = new InMemoryBetaProRepository();
      const app = buildApp({
        betaProRepository: repo,
        tokenVerifier: tokenVerifierFor(userA),
      });
      apps.push(app);

      const res = await app.inject({
        method: "POST",
        url: "/v1/beta-pro/request",
        headers: { authorization: "Bearer valid" },
        payload: {
          pushToken: "ExponentPushToken[abc-123]",
          notes: "Need higher photo quota",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "pending" });

      const saved = await repo.getRequest(userA);
      expect(saved).not.toBeNull();
      expect(saved?.pushToken).toBe("ExponentPushToken[abc-123]");
      expect(saved?.status).toBe("pending");
    });

    it("updates pushToken on existing approved request without changing status", async () => {
      const repo = new InMemoryBetaProRepository();
      repo.__seedForTest({
        id: "req-1",
        userId: userA,
        email: "adam.hikl@outlook.com",
        pushToken: null,
        status: "approved",
        notes: null,
        createdAt: new Date("2026-09-12T12:00:00Z"),
        reviewedAt: new Date("2026-09-12T14:00:00Z"),
      });

      const app = buildApp({
        betaProRepository: repo,
        tokenVerifier: tokenVerifierFor(userA),
      });
      apps.push(app);

      const res = await app.inject({
        method: "POST",
        url: "/v1/beta-pro/request",
        headers: { authorization: "Bearer valid" },
        payload: {
          pushToken:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      });

      expect(res.statusCode).toBe(200);

      const updated = await repo.getRequest(userA);
      expect(updated).not.toBeNull();
      expect(updated?.pushToken).toBe(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      );
      expect(updated?.status).toBe("approved");
    });
  });
});
