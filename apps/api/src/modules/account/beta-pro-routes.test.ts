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
