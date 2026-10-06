import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import type { AppleAuthClient } from "@mizyun/adapter-apple-auth";
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { ServerAppleAuthConfiguration } from "@mizyun/config";
import type { MemoryId, UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";
import { InMemoryExerciseRepository } from "../../exercise-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";
import { InMemoryRunRepository } from "../../run-repository.js";
import { InMemoryAccountRepository } from "../../account-repository.js";
import { InMemoryProductAnalyticsRepository } from "../../product-analytics-repository.js";
import {
  CURRENT_ANALYTICS_CONSENT_VERSION,
  accountExportResponseSchema,
  legacyAccountExportResponseSchema,
} from "@mizyun/contracts";

const userA: UserId = "00000000-0000-4000-8000-000000000001" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (
  principal: { readonly userId: UserId } | null,
): AccessTokenVerifier => ({
  verify: async (token) =>
    token === "valid"
      ? {
          userId: principal!.userId,
          role: "authenticated",
          accessToken: "test-token",
        }
      : null,
});

const build = (
  verifier: AccessTokenVerifier,
  options?: {
    appleAuthConfig?: ServerAppleAuthConfiguration;
    appleAuthClient?: AppleAuthClient;
  },
) => {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
  });
  const goalRepository = new InMemoryGoalRepository();
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const exerciseRepository = new InMemoryExerciseRepository();
  const workoutRepository = new InMemoryWorkoutRepository();
  const runRepository = new InMemoryRunRepository(workoutRepository);
  const workoutSetRepository = new InMemoryWorkoutSetRepository();
  const bodyMeasurementRepository = new InMemoryBodyMeasurementRepository();
  const memoryStore = new InMemoryMemoryStore();
  const productAnalyticsRepository = new InMemoryProductAnalyticsRepository();
  const accountRepository = new InMemoryAccountRepository({
    profileRepository,
    goalRepository,
    foodEntryRepository,
    exerciseRepository,
    workoutRepository,
    runRepository,
    workoutSetRepository,
    bodyMeasurementRepository,
    memoryStore,
    productAnalyticsRepository,
  });
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: memoryStore,
    }),
    profileRepository,
    goalRepository,
    foodEntryRepository,
    exerciseRepository,
    workoutRepository,
    runRepository,
    workoutSetRepository,
    bodyMeasurementRepository,
    accountRepository,
    productAnalyticsRepository,
    memories: memoryStore,
    appleAuthConfig: options?.appleAuthConfig,
    appleAuthClient: options?.appleAuthClient,
  });
  apps.push(app);
  return {
    app,
    profileRepository,
    exerciseRepository,
    workoutRepository,
    runRepository,
    memoryStore,
  };
};

describe("GET /v1/account/export", () => {
  it("negotiates analytics events without dropping health records or claiming a filtered export is complete", async () => {
    const { app, exerciseRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    exerciseRepository.__seedForTest({
      id: "00000000-0000-4000-8000-00000000c001",
      userId: userA,
      name: "Private exercise",
      instructions: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const headers = { authorization: "Bearer valid" };
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
    expect(consent.statusCode).toBe(200);
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
            name: "onboarding_exited",
            properties: {
              step: "primary_goal",
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
      url: "/v1/account/export",
      headers,
    });
    const upgraded = await app.inject({
      method: "GET",
      url: "/v1/account/export?catalog=dashboard-v1",
      headers,
    });
    expect(legacy.statusCode).toBe(200);
    expect(upgraded.statusCode).toBe(200);
    expect(
      legacyAccountExportResponseSchema.safeParse(legacy.json()).success,
    ).toBe(true);
    expect(legacy.json().export.productAnalytics).toMatchObject({
      catalog: "legacy-v2",
      omittedEventCount: 3,
      events: [
        { name: "onboarding_step_completed", properties: { step: "welcome" } },
      ],
    });
    expect(legacy.json().export.manifest).toMatchObject({
      completeness: "partial",
      counts: { productAnalyticsEvents: 1 },
    });
    expect(accountExportResponseSchema.safeParse(upgraded.json()).success).toBe(
      true,
    );
    expect(upgraded.json().export.productAnalytics).toMatchObject({
      catalog: "dashboard-v1",
      omittedEventCount: 0,
    });
    expect(upgraded.json().export.productAnalytics.events).toHaveLength(4);
    expect(upgraded.json().export.manifest).toMatchObject({
      completeness: "complete",
      counts: { productAnalyticsEvents: 4 },
    });
    expect(upgraded.json().export.exercises).toEqual(
      legacy.json().export.exercises,
    );
    expect(upgraded.json().export.exercises[0].name).toBe("Private exercise");
    expect(
      legacyAccountExportResponseSchema.safeParse(upgraded.json()).success,
    ).toBe(false);
  });
  it.each([
    "catalog=unknown",
    "private=search",
    "catalog=dashboard-v1&catalog=dashboard-v1",
  ])("rejects invalid export query %s", async (query) => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const result = await app.inject({
      method: "GET",
      url: `/v1/account/export?${query}`,
      headers: { authorization: "Bearer valid" },
    });
    expect(result.statusCode).toBe(422);
    expect(result.json().error.code).toBe("VALIDATION_ERROR");
  });
  it("returns a fresh-user envelope with empty arrays", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.export.userId).toBe(userA);
    expect(body.export.profile.userId).toBe(userA);
    expect(body.export.profile.coachingPreferences).toEqual({
      experienceLevel: null,
      trainingDaysPerWeek: null,
      sessionDurationMinutes: null,
      trainingFocus: null,
      availableEquipment: [],
      dietaryPreferences: [],
      trainingLimitations: [],
    });
    expect(body.export.goals).toEqual([]);
    expect(body.export.foodEntries).toEqual([]);
    expect(body.export.exercises).toEqual([]);
    expect(body.export.workouts).toEqual([]);
    expect(body.export.workoutSets).toEqual([]);
    expect(body.export.bodyMeasurements).toEqual([]);
    expect(body.export.conversations).toEqual([]);
    expect(body.export.memories).toEqual([]);
    expect(body.export.privateMedia).toEqual([]);
    expect(body.export.manifest).toMatchObject({
      schemaVersion: "2026-09-08",
      completeness: "complete",
      counts: {
        profiles: 1,
        goals: 0,
        foodEntries: 0,
        exercises: 0,
        workouts: 0,
        workoutSets: 0,
        bodyMeasurements: 0,
        conversations: 0,
        messages: 0,
        memories: 0,
        privateMedia: 0,
        feedback: 0,
      },
    });
  });

  it("includes seeded records and the complete memory audit trail", async () => {
    const { app, exerciseRepository, memoryStore } = build(
      tokenVerifierFor({ userId: userA }),
    );
    exerciseRepository.__seedForTest({
      id: "00000000-0000-4000-8000-00000000c001",
      userId: userA,
      name: "Back squat",
      instructions: null,
      metadata: {},
      createdAt: new Date("2026-07-10T08:00:00Z"),
      updatedAt: new Date("2026-07-10T08:00:00Z"),
    });
    await memoryStore.save(
      {
        id: "00000000-0000-4000-8000-00000000d001" as MemoryId,
        userId: userA,
        kind: "preference",
        content: "Prefers morning training",
        source: "user",
        confidence: 1,
        importance: 5,
        status: "superseded",
      },
      { accessToken: "test-token" },
    );
    const response = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().export.exercises).toHaveLength(1);
    expect(response.json().export.exercises[0].name).toBe("Back squat");
    expect(response.json().export.memories).toHaveLength(1);
    expect(response.json().export.memories[0]).toMatchObject({
      content: "Prefers morning training",
      status: "superseded",
    });
    expect(response.json().export.manifest.counts.exercises).toBe(1);
    expect(response.json().export.manifest.counts.memories).toBe(1);
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/account/export",
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /v1/account/delete/request", () => {
  it("issues a fresh confirmation token with an expiry", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.confirmationToken).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
    // expiresAt is roughly 5 minutes in the future.
    const expiresMs = Date.parse(body.expiresAt);
    expect(Math.abs(expiresMs - Date.now() - 5 * 60 * 1000)).toBeLessThan(
      2_000,
    );
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("DELETE /v1/account", () => {
  it("rejects deletion without a confirmation token (no challenge)", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { confirmationToken: "any-token" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects deletion with a mismatched token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
      headers: { authorization: "Bearer valid" },
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { confirmationToken: "wrong-token" },
    });
    expect(response.statusCode).toBe(409);
  });

  it("deletes every record when the token matches", async () => {
    const {
      app,
      exerciseRepository,
      profileRepository,
      workoutRepository,
      memoryStore,
    } = build(tokenVerifierFor({ userId: userA }));
    exerciseRepository.__seedForTest({
      id: "00000000-0000-4000-8000-00000000c001",
      userId: userA,
      name: "Back squat",
      instructions: null,
      metadata: {},
      createdAt: new Date("2026-07-10T08:00:00Z"),
      updatedAt: new Date("2026-07-10T08:00:00Z"),
    });
    profileRepository.__seedForTest({
      userId: userA,
      displayName: "Adam",
      unitSystem: "metric",
      timezone: "UTC",
      birthYear: 1990,
      heightCm: 180,
      activityLevel: null,
      sexAtBirth: null,
      coachingPreferences: {
        experienceLevel: null,
        trainingDaysPerWeek: null,
        sessionDurationMinutes: null,
        trainingFocus: null,
        availableEquipment: [],
        dietaryPreferences: [],
        trainingLimitations: [],
      },
      planTier: "free",
      aiProvider: "gemini",
      createdAt: new Date("2026-07-10T08:00:00Z"),
      updatedAt: new Date("2026-07-10T08:00:00Z"),
    });
    workoutRepository.__seedForTest({
      id: "00000000-0000-4000-8000-00000000b001",
      userId: userA,
      name: "Leg day",
      startedAt: new Date("2026-07-10T08:00:00Z"),
      completedAt: new Date("2026-07-10T09:00:00Z"),
      notes: null,
      source: "manual",
      details: {},
      createdAt: new Date("2026-07-10T08:00:00Z"),
      updatedAt: new Date("2026-07-10T08:00:00Z"),
    });
    await memoryStore.save(
      {
        id: "00000000-0000-4000-8000-00000000d002" as MemoryId,
        userId: userA,
        kind: "goal",
        content: "Run a 10K",
        source: "user",
        confidence: 1,
        importance: 5,
      },
      { accessToken: "test-token" },
    );
    const challenge = await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
      headers: { authorization: "Bearer valid" },
    });
    const token = challenge.json().confirmationToken as string;
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { confirmationToken: token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true });

    // Confirm via export that the per-feature records are gone.
    // (The export auto-creates a fresh profile row on read, so
    // we only assert that the seeded records are absent.)
    const afterExport = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: { authorization: "Bearer valid" },
    });
    expect(afterExport.json().export.exercises).toEqual([]);
    expect(afterExport.json().export.workouts).toEqual([]);
    expect(afterExport.json().export.memories).toEqual([]);
    expect(afterExport.json().export.profile.displayName).toBeNull();
  });

  it("rejects an empty confirmationToken with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { confirmationToken: "" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("exchanges and revokes Apple authorization code when provided on deletion", async () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const exchangedCodes: string[] = [];
    const revokedTokens: string[] = [];

    const mockAppleClient: AppleAuthClient = {
      exchangeAuthorizationCode: async (params) => {
        exchangedCodes.push(params.code);
        return {
          ok: true,
          value: {
            accessToken: "apple-access-token",
            refreshToken: "apple-refresh-token",
            idToken: "apple-id-token",
            expiresIn: 3600,
          },
        };
      },
      revokeToken: async (params) => {
        revokedTokens.push(params.token);
        return { ok: true, value: undefined };
      },
    };

    const appleAuthConfig: ServerAppleAuthConfiguration = {
      teamId: "TEST_TEAM",
      keyId: "TEST_KEY",
      clientId: "com.mizyun.development",
      privateKey,
    };

    const { app } = build(tokenVerifierFor({ userId: userA }), {
      appleAuthConfig,
      appleAuthClient: mockAppleClient,
    });

    const challenge = await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
      headers: { authorization: "Bearer valid" },
    });
    const token = challenge.json().confirmationToken as string;

    const response = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        confirmationToken: token,
        appleAuthorizationCode: "apple-auth-code-xyz",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true });
    expect(exchangedCodes).toEqual(["apple-auth-code-xyz"]);
    expect(revokedTokens).toEqual(["apple-refresh-token"]);
  });

  it("completes account deletion gracefully even if Apple revocation fails", async () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const mockAppleClient: AppleAuthClient = {
      exchangeAuthorizationCode: async () => ({
        ok: false,
        error: {
          kind: "http_error",
          error: "invalid_grant",
          message: "Code expired",
        },
      }),
      revokeToken: async () => ({ ok: true, value: undefined }),
    };

    const appleAuthConfig: ServerAppleAuthConfiguration = {
      teamId: "TEST_TEAM",
      keyId: "TEST_KEY",
      clientId: "com.mizyun.development",
      privateKey,
    };

    const { app } = build(tokenVerifierFor({ userId: userA }), {
      appleAuthConfig,
      appleAuthClient: mockAppleClient,
    });

    const challenge = await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
      headers: { authorization: "Bearer valid" },
    });
    const token = challenge.json().confirmationToken as string;

    const response = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        confirmationToken: token,
        appleAuthorizationCode: "expired-auth-code",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true });
  });

  it("allows idempotent retry with confirmation token and rejects unknown token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const challenge = await app.inject({
      method: "POST",
      url: "/v1/account/delete/request",
      headers: { authorization: "Bearer valid" },
    });
    const token = challenge.json().confirmationToken as string;
    const first = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { confirmationToken: token },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ deleted: true });

    // Idempotent recovery (e.g. client dropped network connection before receiving 200)
    const second = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { confirmationToken: token },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ deleted: true });

    // An unrelated unknown token is rejected with 409
    const unknownTokenRes = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { confirmationToken: "00000000-0000-4000-8000-999999999999" },
    });
    expect(unknownTokenRes.statusCode).toBe(409);
  });

  it("passes the caller's accessToken to exportForUser and deleteUser", async () => {
    let capturedExportOptions: { readonly accessToken?: string } | undefined;
    let capturedDeleteOptions: { readonly accessToken?: string } | undefined;

    const mockAccountRepo = {
      exportForUser: async (
        _userId: UserId,
        options?: { readonly accessToken?: string },
      ) => {
        capturedExportOptions = options;
        return {
          userId: userA,
          generatedAt: new Date(),
          profile: null,
          goals: [],
          foodEntries: [],
          exercises: [],
          workouts: [],
          workoutSets: [],
          bodyMeasurements: [],
          conversations: [],
          privateMedia: [],
          feedback: [],
        };
      },
      issueDeletionChallenge: async () => "challenge-token-123",
      deleteUser: async (
        _userId: UserId,
        options: { readonly accessToken?: string },
      ) => {
        capturedDeleteOptions = options;
        return { deleted: true as const };
      },
    };

    const app = buildApp({
      tokenVerifier: tokenVerifierFor({ userId: userA }),
      accountRepository: mockAccountRepo,
    });
    apps.push(app);

    const exportRes = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: { authorization: "Bearer valid" },
    });
    expect(exportRes.statusCode).toBe(200);
    expect(capturedExportOptions?.accessToken).toBe("test-token");

    const deleteRes = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { confirmationToken: "challenge-token-123" },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(capturedDeleteOptions?.accessToken).toBe("test-token");
  });

  describe("POST /v1/account/delete/status", () => {
    it("returns deletion status unauthenticated using confirmationToken", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));

      // Request deletion challenge
      const challengeRes = await app.inject({
        method: "POST",
        url: "/v1/account/delete/request",
        headers: { authorization: "Bearer valid" },
      });
      expect(challengeRes.statusCode).toBe(200);
      const { confirmationToken } = challengeRes.json();

      // Check status unauthenticated before deletion
      const statusBefore = await app.inject({
        method: "POST",
        url: "/v1/account/delete/status",
        headers: { "content-type": "application/json" },
        payload: { confirmationToken },
      });
      expect(statusBefore.statusCode).toBe(200);
      expect(statusBefore.json()).toMatchObject({
        status: "challenge_issued",
        stage: "none",
        completedAt: null,
      });

      // Confirm deletion
      const deleteRes = await app.inject({
        method: "DELETE",
        url: "/v1/account",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: { confirmationToken },
      });
      expect(deleteRes.statusCode).toBe(200);

      // Check status unauthenticated after deletion (proves post-auth recovery!)
      const statusAfter = await app.inject({
        method: "POST",
        url: "/v1/account/delete/status",
        headers: { "content-type": "application/json" },
        payload: { confirmationToken },
      });
      expect(statusAfter.statusCode).toBe(200);
      expect(statusAfter.json()).toMatchObject({
        status: "completed",
        stage: "done",
      });
      expect(statusAfter.json().completedAt).not.toBeNull();
    });

    it("returns 404 for unknown confirmation token", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));

      const res = await app.inject({
        method: "POST",
        url: "/v1/account/delete/status",
        headers: { "content-type": "application/json" },
        payload: { confirmationToken: "non-existent-token" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    });

    it("returns 422 for invalid request body", async () => {
      const { app } = build(tokenVerifierFor({ userId: userA }));

      const res = await app.inject({
        method: "POST",
        url: "/v1/account/delete/status",
        headers: { "content-type": "application/json" },
        payload: { confirmationToken: "" },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });
  });
});

describe("running account export", () => {
  it("exports complete run details and deleted receipts without clearing replay protection", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const headers = { authorization: "Bearer valid" };
    const body = {
      clientOperationId: "f2160000-0000-4000-8000-000000000021",
      activityDate: "2026-10-01",
      recordingTimezone: "UTC",
      durationSeconds: 5400,
      distanceMeters: null,
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: body,
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().run.id;
    const live = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers,
    });
    expect(live.json().export.workouts[0].details.runSummary).toMatchObject({
      durationSeconds: 5400,
      distanceMeters: null,
      timePrecision: "day",
    });
    expect(live.json().export.runOperationReceipts).toHaveLength(1);
    await app.inject({ method: "DELETE", url: `/v1/runs/${id}`, headers });
    const removed = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers,
    });
    expect(removed.json().export.runOperationReceipts[0].deleted).toBe(true);
    const stale = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: body,
    });
    expect(stale.statusCode).toBe(409);
  });
});
