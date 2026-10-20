import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
  StubVisionProvider,
} from "@mizyun/agent-runtime";
import {
  CURRENT_AI_CONSENT_VERSION,
  LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
} from "@mizyun/contracts";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { InMemoryAiConsentRepository } from "../../ai-consent-repository.js";
import { buildApp } from "../../app.js";
import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";
import { InMemoryExerciseRepository } from "../../exercise-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";

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

interface BuildTestContextOptions {
  readonly defaultConsentGranted?: boolean;
  readonly birthYear?: number | null;
  readonly aiConsentAcceptedVersions?: readonly string[];
}

const build = (options: BuildTestContextOptions = {}) => {
  const profileRepository = new InMemoryProfileRepository({
    defaultBirthYear:
      options.birthYear !== undefined ? options.birthYear : 1990,
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
  });
  const aiConsentRepository = new InMemoryAiConsentRepository({
    defaultGranted: options.defaultConsentGranted ?? false,
  });
  const goalRepository = new InMemoryGoalRepository();
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const exerciseRepository = new InMemoryExerciseRepository();
  const workoutRepository = new InMemoryWorkoutRepository();
  const workoutSetRepository = new InMemoryWorkoutSetRepository();
  const bodyMeasurementRepository = new InMemoryBodyMeasurementRepository();
  const memoryStore = new InMemoryMemoryStore();

  const visionProvider = new StubVisionProvider();
  const generateTextDraft = vi.spyOn(visionProvider, "generateTextDraft");
  const app = buildApp({
    tokenVerifier: tokenVerifierFor({ userId: userA }),
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: memoryStore,
    }),
    profileRepository,
    aiConsentRepository,
    goalRepository,
    foodEntryRepository,
    exerciseRepository,
    workoutRepository,
    workoutSetRepository,
    bodyMeasurementRepository,
    memories: memoryStore,
    aiAllowedEmails: ["previous-tester@example.test"],
    coachControls: { visionProvider },
    ...(options.aiConsentAcceptedVersions
      ? { aiConsentAcceptedVersions: options.aiConsentAcceptedVersions }
      : {}),
  });
  apps.push(app);

  return {
    app,
    profileRepository,
    aiConsentRepository,
    generateTextDraft,
  };
};

describe("AI Consent Endpoints & Authorization Boundary", () => {
  it("permits an authenticated adult immediately after consent without email enrollment, and denies again after revocation", async () => {
    const { app, generateTextDraft } = build({ defaultConsentGranted: false });
    const draft = () =>
      app.inject({
        method: "POST",
        url: "/v1/food-entries/draft/text",
        headers: { authorization: "Bearer valid" },
        payload: { description: "2 scrambled eggs and toast" },
      });
    const deniedBefore = await draft();
    expect(deniedBefore.statusCode).toBe(403);
    expect(deniedBefore.json()).toMatchObject({
      error: { code: "AI_CONSENT_REQUIRED" },
    });
    const consent = (granted: boolean) =>
      app.inject({
        method: "PUT",
        url: "/v1/account/ai-consent",
        headers: { authorization: "Bearer valid" },
        payload: {
          granted,
          confirmedAdult: true,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
        },
      });
    expect(generateTextDraft).not.toHaveBeenCalled();
    expect((await consent(true)).statusCode).toBe(200);
    expect((await draft()).statusCode).toBe(200);
    expect(generateTextDraft).toHaveBeenCalledTimes(1);
    expect((await consent(false)).statusCode).toBe(200);
    const deniedAfter = await draft();
    expect(deniedAfter.statusCode).toBe(403);
    expect(deniedAfter.json()).toMatchObject({
      error: { code: "AI_CONSENT_REQUIRED" },
    });
    expect(generateTextDraft).toHaveBeenCalledTimes(1);
  });
  describe("GET /v1/account/ai-consent", () => {
    it("returns ungranted consent by default when no row exists", async () => {
      const { app } = build({ defaultConsentGranted: false });
      const response = await app.inject({
        method: "GET",
        url: "/v1/account/ai-consent",
        headers: { authorization: "Bearer valid" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        consent: {
          granted: false,
          confirmedAdult: false,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
          consentedAt: null,
          revokedAt: null,
        },
      });
    });
  });

  describe("PUT /v1/account/ai-consent", () => {
    it("rejects when granting without confirming adult status", async () => {
      const { app } = build({ defaultConsentGranted: false });
      const response = await app.inject({
        method: "PUT",
        url: "/v1/account/ai-consent",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: {
          granted: true,
          confirmedAdult: false,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: {
          code: "AI_AGE_RESTRICTED",
        },
      });
    });

    it("rejects when profile birthYear indicates a minor (< 18)", async () => {
      const currentYear = new Date().getUTCFullYear();
      const { app } = build({
        defaultConsentGranted: false,
        birthYear: currentYear - 15, // 15 years old
      });
      const response = await app.inject({
        method: "PUT",
        url: "/v1/account/ai-consent",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: {
          granted: true,
          confirmedAdult: true,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: {
          code: "AI_AGE_RESTRICTED",
        },
      });
    });

    it("rejects when profile birthYear is null and no birthYear is provided in payload", async () => {
      const { app } = build({
        defaultConsentGranted: false,
        birthYear: null,
      });
      const response = await app.inject({
        method: "PUT",
        url: "/v1/account/ai-consent",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: {
          granted: true,
          confirmedAdult: true,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: {
          code: "AI_AGE_RESTRICTED",
          message:
            "Mizyun AI features require confirmed adult status (18+). Please specify your birth year.",
        },
      });
    });

    it("updates profile birthYear and grants consent when adult birthYear is provided in payload", async () => {
      const { app, profileRepository } = build({
        defaultConsentGranted: false,
        birthYear: null,
      });
      const response = await app.inject({
        method: "PUT",
        url: "/v1/account/ai-consent",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: {
          granted: true,
          confirmedAdult: true,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
          birthYear: 1995,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        consent: {
          granted: true,
          confirmedAdult: true,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
        },
      });

      const updatedProfile = await profileRepository.getOrCreate(userA, {
        now: new Date(),
        accessToken: "valid",
      });
      expect(updatedProfile.birthYear).toBe(1995);
    });

    it("records valid granted consent and makes it queryable via GET", async () => {
      const { app } = build({ defaultConsentGranted: false });
      const putRes = await app.inject({
        method: "PUT",
        url: "/v1/account/ai-consent",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: {
          granted: true,
          confirmedAdult: true,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
        },
      });
      expect(putRes.statusCode).toBe(200);
      const putBody = putRes.json();
      expect(putBody.consent.granted).toBe(true);
      expect(putBody.consent.confirmedAdult).toBe(true);
      expect(putBody.consent.consentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
      expect(putBody.consent.consentedAt).toBeTruthy();
      expect(putBody.consent.revokedAt).toBeNull();

      // Verify GET returns the same state
      const getRes = await app.inject({
        method: "GET",
        url: "/v1/account/ai-consent",
        headers: { authorization: "Bearer valid" },
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json()).toEqual(putBody);
    });

    it("records revocation and sets revokedAt", async () => {
      const { app } = build({ defaultConsentGranted: true });
      const revokeRes = await app.inject({
        method: "PUT",
        url: "/v1/account/ai-consent",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: {
          granted: false,
          confirmedAdult: true,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
        },
      });
      expect(revokeRes.statusCode).toBe(200);
      const body = revokeRes.json();
      expect(body.consent.granted).toBe(false);
      expect(body.consent.revokedAt).toBeTruthy();
      expect(body.consent.consentedAt).toBeNull();
    });
  });

  describe("Server Authorization Boundary enforcement", () => {
    it("rejects POST /v1/coach/conversations/:id/messages with 403 AI_CONSENT_REQUIRED when consent is ungranted", async () => {
      const { app } = build({ defaultConsentGranted: false });
      // 1. Create a conversation
      const convRes = await app.inject({
        method: "POST",
        url: "/v1/coach/conversations",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: { title: "Test conversation" },
      });
      expect(convRes.statusCode).toBe(201);
      const conversationId = convRes.json().conversation.id;

      // 2. Attempt to send a message without consent
      const res = await app.inject({
        method: "POST",
        url: `/v1/coach/conversations/${conversationId}/messages`,
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
          "idempotency-key": "idemp-key-12345678",
        },
        payload: {
          text: "What should I eat for dinner?",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        error: {
          code: "AI_CONSENT_REQUIRED",
        },
      });
    });

    it("rejects POST /v1/food-entries/draft/text with 403 AI_CONSENT_REQUIRED when consent is ungranted", async () => {
      const { app } = build({ defaultConsentGranted: false });
      const res = await app.inject({
        method: "POST",
        url: "/v1/food-entries/draft/text",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: {
          description: "2 scrambled eggs and toast",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        error: {
          code: "AI_CONSENT_REQUIRED",
        },
      });
    });

    it("rejects POST /v1/coach/conversations/:id/messages when user is underage even if consent row says granted", async () => {
      const currentYear = new Date().getUTCFullYear();
      const { app, aiConsentRepository } = build({
        defaultConsentGranted: true,
        birthYear: currentYear - 16, // 16 years old
      });
      // Force an explicit granted row in repo to test the server boundary defense-in-depth
      await aiConsentRepository.saveConsent(userA, {
        granted: true,
        confirmedAdult: true,
        consentVersion: CURRENT_AI_CONSENT_VERSION,
      });

      const convRes = await app.inject({
        method: "POST",
        url: "/v1/coach/conversations",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload: { title: "Test conversation" },
      });
      const conversationId = convRes.json().conversation.id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/coach/conversations/${conversationId}/messages`,
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
          "idempotency-key": "idemp-key-underage-1234",
        },
        payload: {
          text: "Help me program squats",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        error: {
          code: "AI_AGE_RESTRICTED",
        },
      });
    });
  });
});

describe("accepted AI consent versions", () => {
  const auth = { authorization: "Bearer valid" };
  const put = (
    app: ReturnType<typeof buildApp>,
    granted: boolean,
    consentVersion: string,
  ) =>
    app.inject({
      method: "PUT",
      url: "/v1/account/ai-consent",
      headers: auth,
      payload: { granted, confirmedAdult: granted, consentVersion },
    });
  const draft = (app: ReturnType<typeof buildApp>) =>
    app.inject({
      method: "POST",
      url: "/v1/food-entries/draft/text",
      headers: auth,
      payload: { description: "2 scrambled eggs and toast" },
    });
  const getConsent = async (app: ReturnType<typeof buildApp>) =>
    (
      await app.inject({
        method: "GET",
        url: "/v1/account/ai-consent",
        headers: auth,
      })
    ).json().consent;

  it("by default keeps an installed Gemini-only build working and accepts the new disclosure", async () => {
    const { app } = build();
    expect(
      (await put(app, true, LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY)).statusCode,
    ).toBe(200);
    expect((await draft(app)).statusCode).toBe(200);
    expect(await getConsent(app)).toMatchObject({
      granted: true,
      consentVersion: LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
    });
    expect((await put(app, true, CURRENT_AI_CONSENT_VERSION)).statusCode).toBe(
      200,
    );
    expect(await getConsent(app)).toMatchObject({
      granted: true,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
    });
  });

  it("refuses an unknown disclosure version by default", async () => {
    const { app } = build();
    const response = await put(app, true, "2025-01-01");
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "CONFLICT",
        message:
          "This version of Mizyun shows an older AI disclosure. Update Mizyun to keep using AI features.",
      },
    });
  });

  it("with a Dev-style current-only set, asks again and blocks an old build's grant but not its revocation", async () => {
    const { app, aiConsentRepository } = build({
      aiConsentAcceptedVersions: [CURRENT_AI_CONSENT_VERSION],
    });
    // A tester who consented on an older build before the deploy.
    await aiConsentRepository.saveConsent(userA, {
      granted: true,
      confirmedAdult: true,
      consentVersion: LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
    });
    expect(await getConsent(app)).toMatchObject({
      granted: false,
      consentVersion: LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
    });
    const denied = await draft(app);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: { code: "AI_CONSENT_REQUIRED" },
    });

    const oldGrant = await put(
      app,
      true,
      LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
    );
    expect(oldGrant.statusCode).toBe(409);
    expect(oldGrant.json().error.message).toContain(
      "Update Mizyun to keep using AI features.",
    );
    // The refused grant leaves the stored row untouched.
    expect((await aiConsentRepository.getConsent(userA))?.granted).toBe(true);

    expect(
      (await put(app, false, LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY)).statusCode,
    ).toBe(200);
    expect((await aiConsentRepository.getConsent(userA))?.granted).toBe(false);

    expect((await put(app, true, CURRENT_AI_CONSENT_VERSION)).statusCode).toBe(
      200,
    );
    expect(await getConsent(app)).toMatchObject({
      granted: true,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
    });
    expect((await draft(app)).statusCode).toBe(200);
  });

  it("reads AI_CONSENT_ACCEPTED_VERSIONS from the environment", async () => {
    vi.stubEnv("AI_CONSENT_ACCEPTED_VERSIONS", CURRENT_AI_CONSENT_VERSION);
    try {
      const { app } = build();
      expect(
        (await put(app, true, LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY))
          .statusCode,
      ).toBe(409);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
