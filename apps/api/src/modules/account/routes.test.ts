import { afterEach, describe, expect, it } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
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
import { InMemoryAccountRepository } from "../../account-repository.js";

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

const build = (verifier: AccessTokenVerifier) => {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
  });
  const goalRepository = new InMemoryGoalRepository();
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const exerciseRepository = new InMemoryExerciseRepository();
  const workoutRepository = new InMemoryWorkoutRepository();
  const workoutSetRepository = new InMemoryWorkoutSetRepository();
  const bodyMeasurementRepository = new InMemoryBodyMeasurementRepository();
  const memoryStore = new InMemoryMemoryStore();
  const accountRepository = new InMemoryAccountRepository({
    profileRepository,
    goalRepository,
    foodEntryRepository,
    exerciseRepository,
    workoutRepository,
    workoutSetRepository,
    bodyMeasurementRepository,
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
    workoutSetRepository,
    bodyMeasurementRepository,
    accountRepository,
    memories: memoryStore,
  });
  apps.push(app);
  return {
    app,
    profileRepository,
    exerciseRepository,
    workoutRepository,
    memoryStore,
  };
};

describe("GET /v1/account/export", () => {
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

  it("rejects reuse of an already-consumed challenge", async () => {
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
    const second = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { confirmationToken: token },
    });
    expect(second.statusCode).toBe(409);
  });
});
