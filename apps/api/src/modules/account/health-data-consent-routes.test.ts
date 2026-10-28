import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import {
  API_COMPAT_HEADER,
  API_COMPAT_VERSION,
  CURRENT_HEALTH_DATA_CONSENT_VERSION,
  latestAdultBirthYear,
} from "@mizyun/contracts";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { InMemoryAiConsentRepository } from "../../ai-consent-repository.js";
import { buildApp } from "../../app.js";
import { InMemoryHealthDataConsentRepository } from "../../health-data-consent-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";

const userA = "00000000-0000-4000-8000-0000000000a1" as UserId;
const currentClient = {
  authorization: "Bearer valid",
  [API_COMPAT_HEADER]: API_COMPAT_VERSION,
};
const storeBuild9 = { authorization: "Bearer valid" };
const previousBuild = {
  authorization: "Bearer valid",
  [API_COMPAT_HEADER]: "2026-10-21",
};

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifier: AccessTokenVerifier = {
  verify: async (token) =>
    token === "valid"
      ? { userId: userA, role: "authenticated", accessToken: "test-token" }
      : null,
};

const build = () => {
  const profileRepository = new InMemoryProfileRepository({
    defaultBirthYear: null,
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
  });
  const healthDataConsentRepository = new InMemoryHealthDataConsentRepository();
  const aiConsentRepository = new InMemoryAiConsentRepository();
  const memoryStore = new InMemoryMemoryStore();
  const app = buildApp({
    tokenVerifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: memoryStore,
    }),
    memories: memoryStore,
    profileRepository,
    healthDataConsentRepository,
    aiConsentRepository,
  });
  apps.push(app);
  return { app, profileRepository, healthDataConsentRepository };
};

const putConsent = (
  app: ReturnType<typeof buildApp>,
  granted: boolean,
  consentVersion = CURRENT_HEALTH_DATA_CONSENT_VERSION,
) =>
  app.inject({
    method: "PUT",
    url: "/v1/account/health-data-consent",
    headers: currentClient,
    payload: { granted, consentVersion },
  });

const healthPatch = { birthYear: 1990, heightCm: 172, sexAtBirth: "female" };

describe("health data consent (PRIV-01)", () => {
  it("reports no consent for a user who has never answered", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/account/health-data-consent",
      headers: currentClient,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      consent: {
        granted: false,
        consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION,
        consentedAt: null,
        revokedAt: null,
      },
    });
  });

  it("requires consent before a current client stores health data, then allows it", async () => {
    const { app, profileRepository } = build();
    const denied = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: currentClient,
      payload: healthPatch,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: { code: "HEALTH_DATA_CONSENT_REQUIRED" },
    });
    const untouched = await profileRepository.getOrCreate(userA, {
      now: new Date(),
      accessToken: "test-token",
    });
    expect(untouched.heightCm).toBeNull();
    expect(untouched.birthYear).toBeNull();

    const granted = await putConsent(app, true);
    expect(granted.statusCode).toBe(200);
    expect(granted.json().consent).toMatchObject({
      granted: true,
      revokedAt: null,
    });
    expect(granted.json().consent.consentedAt).toEqual(expect.any(String));

    const saved = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: currentClient,
      payload: healthPatch,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().profile).toMatchObject(healthPatch);
  });

  it("still lets a user without consent save non-health settings and clear values", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: currentClient,
      payload: { displayName: "Sam", unitSystem: "imperial", heightCm: null },
    });
    expect(response.statusCode).toBe(200);
  });

  it("blocks new health data again after withdrawal and records the time", async () => {
    const { app } = build();
    await putConsent(app, true);
    const withdrawn = await putConsent(app, false);
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().consent).toMatchObject({
      granted: false,
      consentedAt: null,
    });
    expect(withdrawn.json().consent.revokedAt).toEqual(expect.any(String));
    const denied = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: currentClient,
      payload: { heightCm: 180 },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("refuses a grant for an outdated explanation but always accepts withdrawal", async () => {
    const { app } = build();
    const stale = await putConsent(app, true, "2026-01-01");
    expect(stale.statusCode).toBe(409);
    const withdrawal = await putConsent(app, false, "2026-01-01");
    expect(withdrawal.statusCode).toBe(200);
  });

  it("rejects unknown fields in the consent body", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/account/health-data-consent",
      headers: currentClient,
      payload: {
        granted: true,
        consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION,
        userId: "00000000-0000-4000-8000-0000000000b2",
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("does not require consent from builds that never ask for it", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: previousBuild,
      payload: healthPatch,
    });
    expect(response.statusCode).toBe(200);
  });

  it("does not require consent from a build without the compat header", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: storeBuild9,
      payload: healthPatch,
    });
    expect(response.statusCode).toBe(200);
  });

  it("refuses health data from every build after a recorded withdrawal", async () => {
    const { app } = build();
    await putConsent(app, true);
    await putConsent(app, false);
    for (const headers of [storeBuild9, previousBuild, currentClient]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/profile",
        headers,
        payload: { heightCm: 181 },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("still lets an older build re-send unchanged values after a withdrawal", async () => {
    const { app } = build();
    await putConsent(app, true);
    await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: currentClient,
      payload: healthPatch,
    });
    await putConsent(app, false);
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: previousBuild,
      payload: { ...healthPatch, heightCm: 172.01, displayName: "New name" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().profile.displayName).toBe("New name");
    const changed = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: previousBuild,
      payload: { heightCm: 180 },
    });
    expect(changed.statusCode).toBe(403);
  });

  it("keeps the original consent time when the user agrees again", async () => {
    const { app } = build();
    const first = (await putConsent(app, true)).json().consent.consentedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = (await putConsent(app, true)).json().consent.consentedAt;
    expect(again).toBe(first);
  });

  it("does not store a birth year sent with AI consent while health consent is missing", async () => {
    const { app, profileRepository } = build();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/account/ai-consent",
      headers: currentClient,
      payload: { granted: true, confirmedAdult: true, birthYear: 1990 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "HEALTH_DATA_CONSENT_REQUIRED" },
    });
    const stored = await profileRepository.getOrCreate(userA, {
      now: new Date(),
      accessToken: "test-token",
    });
    expect(stored.birthYear).toBeNull();
  });

  it("includes the consent record in the account export", async () => {
    const { app } = build();
    await putConsent(app, true);
    const response = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: currentClient,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().export.healthDataConsent).toMatchObject({
      granted: true,
      consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION,
    });
  });
});

describe("adults only (PRIV-02)", () => {
  it("refuses an under-18 birth year on profile writes from every client and saves nothing", async () => {
    const { app, profileRepository } = build();
    await putConsent(app, true);
    const minorYear = latestAdultBirthYear() + 1;
    for (const headers of [currentClient, previousBuild]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/profile",
        headers,
        payload: { birthYear: minorYear, heightCm: 160 },
      });
      expect(response.statusCode).toBe(422);
    }
    const stored = await profileRepository.getOrCreate(userA, {
      now: new Date(),
      accessToken: "test-token",
    });
    expect(stored.birthYear).toBeNull();
    expect(stored.heightCm).toBeNull();
  });

  it("accepts the latest adult birth year", async () => {
    const { app } = build();
    await putConsent(app, true);
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: currentClient,
      payload: { birthYear: latestAdultBirthYear() },
    });
    expect(response.statusCode).toBe(200);
  });

  it("does not store an under-18 birth year sent with an AI consent grant", async () => {
    const { app, profileRepository } = build();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/account/ai-consent",
      headers: currentClient,
      payload: {
        granted: true,
        confirmedAdult: true,
        birthYear: latestAdultBirthYear() + 1,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "AI_AGE_RESTRICTED" },
    });
    const stored = await profileRepository.getOrCreate(userA, {
      now: new Date(),
      accessToken: "test-token",
    });
    expect(stored.birthYear).toBeNull();
  });
});
