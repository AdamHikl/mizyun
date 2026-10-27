import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { ProfileRepository, UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";

const userA: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userB: UserId = "00000000-0000-4000-8000-000000000002" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (
  principal: { readonly userId: UserId; readonly email?: string } | null,
): AccessTokenVerifier => ({
  verify: async (token) =>
    token === "valid"
      ? {
          userId: principal!.userId,
          ...(principal!.email ? { email: principal!.email } : {}),
          role: "authenticated",
          accessToken: "test-token",
        }
      : null,
});

const build = (verifier: AccessTokenVerifier) => {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
  });
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    profileRepository,
  });
  apps.push(app);
  return { app, profileRepository };
};

describe("GET /v1/profile", () => {
  it("returns a default profile on first read (auto-create)", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.profile.userId).toBe(userA);
    expect(body.profile.unitSystem).toBe("metric");
    expect(body.profile.timezone).toBe("UTC");
    expect(body.profile.displayName).toBeNull();
    expect(body.profile.birthYear).toBeNull();
    expect(body.profile.heightCm).toBeNull();
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({ method: "GET", url: "/v1/profile" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it("returns 401 when the bearer token is invalid", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: { authorization: "Bearer wrong" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ACCESS_TOKEN" },
    });
  });

  it("returns the stored planTier (e.g. paid tier)", async () => {
    const { app, profileRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    profileRepository.__seedForTest({
      userId: userA,
      displayName: "User A",
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
      planTier: "paid",
      aiProvider: "gemini",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().profile.planTier).toBe("paid");
  });

  it("does not return another user's profile (envelope only)", async () => {
    const { app, profileRepository } = build(
      tokenVerifierFor({ userId: userB }),
    );
    // Seed user A; user B should never see it.
    profileRepository.__seedForTest({
      userId: userA,
      displayName: "User A",
      unitSystem: "imperial",
      timezone: "America/Los_Angeles",
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
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    // User B gets their own auto-created profile, not user A's seeded one.
    expect(body.profile.userId).toBe(userB);
    expect(body.profile.unitSystem).toBe("metric");
    expect(body.profile.timezone).toBe("UTC");
  });
});

describe("PUT /v1/profile", () => {
  it("applies a single-field patch and persists it", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const patch = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { timezone: "Europe/Paris" },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.profile.timezone).toBe("Europe/Paris");

    const read = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: { authorization: "Bearer valid" },
    });
    expect(read.json().profile.timezone).toBe("Europe/Paris");
  });

  it("does not overwrite a concurrent settings save with a background timezone save (REL-01)", async () => {
    const inner = new InMemoryProfileRepository({
      defaultTimezone: "UTC",
      defaultUnitSystem: "metric",
    });
    // Hold the first read (the timezone PUT) until the other PUT has saved.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    const profileRepository: ProfileRepository = {
      getOrCreate: async (userId, defaults) => {
        const profile = await inner.getOrCreate(userId, defaults);
        if (++reads === 1) await gate;
        return profile;
      },
      update: (userId, next, options) => inner.update(userId, next, options),
    };
    const app = buildApp({
      tokenVerifier: tokenVerifierFor({ userId: userA }),
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
      profileRepository,
    });
    apps.push(app);
    const put = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PUT",
        url: "/v1/profile",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        payload,
      });
    const timezone = put({ timezone: "America/Los_Angeles" });
    while (reads === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    expect((await put({ unitSystem: "imperial" })).statusCode).toBe(200);
    release();
    expect((await timezone).statusCode).toBe(200);
    const stored = await inner.getOrCreate(userA, {
      now: new Date(),
      accessToken: "test-token",
    });
    expect(stored).toMatchObject({
      timezone: "America/Los_Angeles",
      unitSystem: "imperial",
    });
  });

  it("rejects a timezone that is not a named IANA zone (REL-01)", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { timezone: "Mars/Olympus_Mons" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    const read = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: { authorization: "Bearer valid" },
    });
    expect(read.json().profile.timezone).toBe("UTC");
  });

  it("rejects an empty patch with a 422 VALIDATION_ERROR", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects an out-of-range height with a 422 VALIDATION_ERROR", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { heightCm: 30 },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects an unknown field with a 422 VALIDATION_ERROR", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { timezone: "UTC", mysteryField: "x" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects an invalid unit system with a 422 VALIDATION_ERROR", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { unitSystem: "furlongs" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("clears nullable fields when the patch sets them to null", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    // Set displayName first
    await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { displayName: "Adam" },
    });
    // Clear it
    const clear = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { displayName: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().profile.displayName).toBeNull();
  });

  it("accepts an activityLevel patch and echoes it back", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { activityLevel: "moderately_active" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().profile.activityLevel).toBe("moderately_active");
  });

  it("accepts a sexAtBirth patch and echoes it back", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { sexAtBirth: "female" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().profile.sexAtBirth).toBe("female");
  });

  it("persists strict user-controlled coaching preferences", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const coachingPreferences = {
      experienceLevel: "intermediate",
      trainingDaysPerWeek: 4,
      sessionDurationMinutes: 60,
      trainingFocus: "hypertrophy",
      availableEquipment: ["dumbbells", "bench"],
      dietaryPreferences: ["vegetarian"],
      trainingLimitations: ["no_running"],
    };
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { coachingPreferences },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().profile.coachingPreferences).toEqual(
      coachingPreferences,
    );
  });

  it("rejects unknown or duplicate coaching preference values", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        coachingPreferences: {
          experienceLevel: "expert",
          trainingDaysPerWeek: 9,
          sessionDurationMinutes: 60,
          trainingFocus: "strength",
          availableEquipment: ["barbell", "barbell"],
          dietaryPreferences: [],
          trainingLimitations: [],
        },
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects an invalid activityLevel with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { activityLevel: "vigorously_active" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects an invalid sexAtBirth with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { sexAtBirth: "other" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("clears activityLevel and sexAtBirth when the patch sets null", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    // Set them first.
    await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { activityLevel: "moderately_active", sexAtBirth: "male" },
    });
    // Clear them.
    const cleared = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { activityLevel: null, sexAtBirth: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().profile.activityLevel).toBeNull();
    expect(cleared.json().profile.sexAtBirth).toBeNull();
  });

  it("includes the new fields in the auto-create default shape", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().profile.activityLevel).toBeNull();
    expect(response.json().profile.sexAtBirth).toBeNull();
    expect(response.json().profile.coachingPreferences).toEqual({
      experienceLevel: null,
      trainingDaysPerWeek: null,
      sessionDurationMinutes: null,
      trainingFocus: null,
      availableEquipment: [],
      dietaryPreferences: [],
      trainingLimitations: [],
    });
    expect(response.json().profile.aiProvider).toBe("gemini");
  });

  it("updates aiProvider when gemini is supplied", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { aiProvider: "gemini" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().profile.aiProvider).toBe("gemini");
  });

  it("rejects mistral or an invalid aiProvider value", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const responseMistral = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { aiProvider: "mistral" },
    });
    expect(responseMistral.statusCode).toBe(422);

    const responseUnsupported = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { aiProvider: "unsupported_provider" },
    });
    expect(responseUnsupported.statusCode).toBe(422);
  });
});
