import { afterEach, describe, expect, it } from "vitest";
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { ProductAnalyticsRepository, UserId } from "@mizyun/core";
import {
  SupabaseProductAnalyticsRepository,
  type RepositorySupabaseClient,
} from "@mizyun/adapter-supabase-server";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";
import {
  CURRENT_ANALYTICS_CONSENT_VERSION,
  legacyAnalyticsEventsListResponseSchema,
  analyticsEventsListResponseSchema,
} from "@mizyun/contracts";

import { buildApp } from "../../app.js";
import { InMemoryProductAnalyticsRepository } from "../../product-analytics-repository.js";

const userA: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userB: UserId = "00000000-0000-4000-8000-000000000002" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (
  principal: { readonly userId: UserId } | null,
): AccessTokenVerifier => ({
  verify: async (token) => {
    if (token === "token-user-a") {
      return {
        userId: userA,
        role: "authenticated",
        accessToken: "token-user-a",
      };
    }
    if (token === "token-user-b") {
      return {
        userId: userB,
        role: "authenticated",
        accessToken: "token-user-b",
      };
    }
    return null;
  },
});

const build = (
  verifier = tokenVerifierFor(null),
  productAnalyticsRepository: ProductAnalyticsRepository = new InMemoryProductAnalyticsRepository(),
) => {
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    productAnalyticsRepository,
  });
  apps.push(app);
  return { app, productAnalyticsRepository };
};

describe("Product Analytics Routes (OBS-002)", () => {
  describe("Authentication", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const { app } = build();
      const res = await app.inject({
        method: "GET",
        url: "/v1/analytics/consent",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/analytics/consent", () => {
    it("returns zero-state defaults when no consent has been submitted", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));
      const res = await app.inject({
        method: "GET",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        version: CURRENT_ANALYTICS_CONSENT_VERSION,
        granted: false,
        revision: 0,
        consentedAt: null,
        revokedAt: null,
      });
    });
  });

  describe("PUT /v1/analytics/consent", () => {
    it("serializes the actual consent RPC JSON response after a successful save", async () => {
      const repository = new SupabaseProductAnalyticsRepository({
        client: {
          rpc: async () => ({
            error: null,
            data: {
              success: true,
              consent: {
                version: CURRENT_ANALYTICS_CONSENT_VERSION,
                granted: true,
                revision: 1,
                epoch: "22222222-2222-4222-8222-222222222222",
                consentedAt: "2026-09-15T08:20:20+00:00",
                revokedAt: null,
                updatedAt: "2026-09-15T08:20:20+00:00",
              },
            },
          }),
        } as unknown as RepositorySupabaseClient,
      });
      const { app } = build(tokenVerifierFor(null), repository);
      const response = await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        granted: true,
        revision: 1,
        consentedAt: "2026-09-15T08:20:20.000Z",
        updatedAt: "2026-09-15T08:20:20.000Z",
        revokedAt: null,
      });
    });

    it("grants consent and returns updated revision and epoch", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));
      const res = await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        version: CURRENT_ANALYTICS_CONSENT_VERSION,
        granted: true,
        revision: 1,
      });
      expect(body.epoch).toBeDefined();
      expect(body.consentedAt).not.toBeNull();
    });

    it("returns 409 CONFLICT on revision mismatch", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));
      // First grant (revision becomes 1)
      await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        },
      });

      // Attempt second update with stale expectedRevision 0
      const res = await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: false,
          expectedRevision: 0,
          operationId: "22222222-2222-4222-8222-222222222222",
        },
      });
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("CONFLICT");
    });
  });

  describe("POST /v1/analytics/events", () => {
    it("accepts a valid batch of events when consent matches", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));
      // Grant consent first
      const consentRes = await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        },
      });
      const { epoch } = JSON.parse(consentRes.body);

      const res = await app.inject({
        method: "POST",
        url: "/v1/analytics/events",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          consentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
          epoch,
          events: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              schemaVersion: 2,
              recordedAt: new Date().toISOString(),
              sessionId: "44444444-4444-4444-8444-444444444444",
              sequence: 0,
              platform: "ios",
              appVersion: "1.0.0",
              name: "screen_viewed",
              properties: { screen: "dashboard" },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.acceptedIds).toEqual([
        "33333333-3333-4333-8333-333333333333",
      ]);
      expect(body.rejectedCount).toBe(0);
    });

    it("returns 409 CONFLICT on epoch mismatch", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));
      // Grant consent
      await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/analytics/events",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          consentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
          epoch: "99999999-9999-4999-8999-999999999999",
          events: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              schemaVersion: 2,
              recordedAt: new Date().toISOString(),
              sessionId: "44444444-4444-4444-8444-444444444444",
              sequence: 0,
              platform: "ios",
              appVersion: "1.0.0",
              name: "screen_viewed",
              properties: { screen: "dashboard" },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe("CONFLICT");
    });

    it("returns 422 when event has future clock skew beyond 5 minutes", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));
      const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const res = await app.inject({
        method: "POST",
        url: "/v1/analytics/events",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          consentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
          epoch: "11111111-1111-4111-8111-111111111111",
          events: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              schemaVersion: 2,
              recordedAt: futureDate,
              sessionId: "44444444-4444-4444-8444-444444444444",
              sequence: 0,
              platform: "ios",
              appVersion: "1.0.0",
              name: "screen_viewed",
              properties: { screen: "dashboard" },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 when event contains unknown properties", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));
      const res = await app.inject({
        method: "POST",
        url: "/v1/analytics/events",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          consentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
          epoch: "11111111-1111-4111-8111-111111111111",
          events: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              schemaVersion: 2,
              recordedAt: new Date().toISOString(),
              sessionId: "44444444-4444-4444-8444-444444444444",
              sequence: 0,
              platform: "ios",
              appVersion: "1.0.0",
              name: "screen_viewed",
              properties: {
                screen: "dashboard",
                forbiddenFoodName: "Apple Pie",
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("DELETE /v1/analytics/events", () => {
    it("clears events and rotates epoch", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));
      // Grant consent
      const consentRes = await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        },
      });
      const initialEpoch = JSON.parse(consentRes.body).epoch;

      const clearRes = await app.inject({
        method: "DELETE",
        url: "/v1/analytics/events",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          expectedRevision: 1,
          operationId: "22222222-2222-4222-8222-222222222222",
        },
      });

      expect(clearRes.statusCode).toBe(200);
      const clearBody = JSON.parse(clearRes.body);
      expect(clearBody.cleared).toBe(true);
      expect(clearBody.revision).toBe(2);
      expect(clearBody.newEpoch).not.toBe(initialEpoch);
    });
  });

  describe("GET /v1/analytics/events", () => {
    it("keeps the unversioned list parseable by pre-dashboard clients", async () => {
      const { app } = build();
      const headers = { authorization: "Bearer token-user-a" };
      const consent = await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers,
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        },
      });
      const base = {
        schemaVersion: 2,
        recordedAt: new Date().toISOString(),
        sessionId: "22222222-2222-4222-8222-222222222222",
        sequence: 0,
        platform: "ios",
        appVersion: "1.0.6",
      };
      const ingest = await app.inject({
        method: "POST",
        url: "/v1/analytics/events",
        headers,
        payload: {
          consentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
          epoch: consent.json().epoch,
          events: [
            {
              ...base,
              id: "33333333-3333-4333-8333-333333333333",
              name: "onboarding_step_completed",
              properties: { step: "welcome" },
            },
            {
              ...base,
              id: "44444444-4444-4444-8444-444444444444",
              sequence: 1,
              name: "dashboard_control_clicked",
              properties: { control: "nutrition_card" },
            },
            {
              ...base,
              id: "55555555-5555-4555-8555-555555555555",
              sequence: 2,
              name: "onboarding_step_completed",
              properties: { step: "baseline_weight" },
            },
            {
              ...base,
              id: "66666666-6666-4666-8666-666666666666",
              sequence: 3,
              name: "onboarding_failed",
              properties: { step: "energy_profile", reason: "network" },
            },
            {
              ...base,
              id: "77777777-7777-4777-8777-777777777777",
              sequence: 4,
              name: "onboarding_exited",
              properties: {
                step: "units",
                duration: "under_30_seconds",
                exit: "cancel",
              },
            },
          ],
        },
      });
      expect(ingest.statusCode).toBe(200);
      const legacy = await app.inject({
        method: "GET",
        url: "/v1/analytics/events",
        headers,
      });
      expect(legacy.statusCode).toBe(200);
      expect(
        legacy.json().events.map((event: { name: string }) => event.name),
      ).toEqual(["onboarding_step_completed"]);
      expect(
        legacyAnalyticsEventsListResponseSchema.safeParse(legacy.json())
          .success,
      ).toBe(true);
      const upgraded = await app.inject({
        method: "GET",
        url: "/v1/analytics/events?catalog=dashboard-v1",
        headers,
      });
      expect(upgraded.statusCode).toBe(200);
      expect(
        analyticsEventsListResponseSchema.safeParse(upgraded.json()).success,
      ).toBe(true);
      expect(upgraded.json().events).toHaveLength(5);
      expect(
        legacyAnalyticsEventsListResponseSchema.safeParse(upgraded.json())
          .success,
      ).toBe(false);
    });

    it.each([
      "catalog=unknown",
      "private=search",
      "catalog=dashboard-v1&catalog=dashboard-v1",
    ])("rejects unsupported or malformed query %s", async (query) => {
      const { app } = build();
      const result = await app.inject({
        method: "GET",
        url: `/v1/analytics/events?${query}`,
        headers: { authorization: "Bearer token-user-a" },
      });
      expect(result.statusCode).toBe(422);
      expect(result.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("lists retained events for the user", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));
      // Grant consent
      const consentRes = await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        },
      });
      const { epoch } = JSON.parse(consentRes.body);

      // Ingest event
      await app.inject({
        method: "POST",
        url: "/v1/analytics/events",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          consentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
          epoch,
          events: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              schemaVersion: 2,
              recordedAt: new Date().toISOString(),
              sessionId: "66666666-6666-4666-8666-666666666666",
              sequence: 0,
              platform: "ios",
              appVersion: "1.0.0",
              name: "screen_viewed",
              properties: { screen: "dashboard" },
            },
          ],
        },
      });

      const res = await app.inject({
        method: "GET",
        url: "/v1/analytics/events",
        headers: { authorization: "Bearer token-user-a" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].id).toBe("55555555-5555-4555-8555-555555555555");
    });
  });

  describe("User Isolation", () => {
    it("ensures User B cannot see User A's retained events or consent", async () => {
      const { app } = build(tokenVerifierFor(null));
      // Grant consent for User A
      const consentA = await app.inject({
        method: "PUT",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          version: CURRENT_ANALYTICS_CONSENT_VERSION,
          granted: true,
          expectedRevision: 0,
          operationId: "11111111-1111-4111-8111-111111111111",
        },
      });
      const { epoch: epochA } = JSON.parse(consentA.body);

      // Ingest event for User A
      await app.inject({
        method: "POST",
        url: "/v1/analytics/events",
        headers: { authorization: "Bearer token-user-a" },
        payload: {
          consentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
          epoch: epochA,
          events: [
            {
              id: "77777777-7777-4777-8777-777777777777",
              schemaVersion: 2,
              recordedAt: new Date().toISOString(),
              sessionId: "88888888-8888-4888-8888-888888888888",
              sequence: 0,
              platform: "ios",
              appVersion: "1.0.0",
              name: "screen_viewed",
              properties: { screen: "coach" },
            },
          ],
        },
      });

      // User B checks their events
      const resB = await app.inject({
        method: "GET",
        url: "/v1/analytics/events",
        headers: { authorization: "Bearer token-user-b" },
      });
      expect(resB.statusCode).toBe(200);
      expect(JSON.parse(resB.body).events).toHaveLength(0);

      // User B checks their consent
      const consentB = await app.inject({
        method: "GET",
        url: "/v1/analytics/consent",
        headers: { authorization: "Bearer token-user-b" },
      });
      expect(consentB.statusCode).toBe(200);
      expect(JSON.parse(consentB.body).granted).toBe(false);
    });
  });
});
