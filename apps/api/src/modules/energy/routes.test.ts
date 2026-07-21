import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import {
  type BodyMeasurementSource,
  type FoodSource,
  type StoredBodyMeasurement,
  type StoredFoodEntry,
  type StoredGoal,
  type StoredProfile,
  type StoredWorkout,
  type UserId,
  type WorkoutSource,
  ENERGY_FORMULA_VERSION,
} from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";

const userA: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userB: UserId = "00000000-0000-4000-8000-000000000002" as UserId;

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
  const bodyMeasurementRepository = new InMemoryBodyMeasurementRepository();
  const workoutRepository = new InMemoryWorkoutRepository();
  const workoutSetRepository = new InMemoryWorkoutSetRepository();
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    profileRepository,
    goalRepository,
    bodyMeasurementRepository,
    workoutRepository,
    workoutSetRepository,
    foodEntryRepository,
  });
  apps.push(app);
  return {
    app,
    profileRepository,
    goalRepository,
    bodyMeasurementRepository,
    workoutRepository,
    workoutSetRepository,
    foodEntryRepository,
  };
};

const seedProfile = (
  repo: InMemoryProfileRepository,
  overrides: Partial<StoredProfile> = {},
): StoredProfile => {
  const profile: StoredProfile = {
    userId: userA,
    displayName: "Tester",
    unitSystem: "metric",
    timezone: "UTC",
    birthYear: 1990,
    heightCm: 175,
    activityLevel: null,
    sexAtBirth: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(profile);
  return profile;
};

const seedMeasurement = (
  repo: InMemoryBodyMeasurementRepository,
  overrides: Partial<StoredBodyMeasurement> = {},
): StoredBodyMeasurement => {
  const m: StoredBodyMeasurement = {
    id: "00000000-0000-4000-8000-00000000a001",
    userId: userA,
    measuredAt: new Date("2026-07-15T08:00:00Z"),
    weightKg: 70,
    measurements: {},
    source: "manual" as BodyMeasurementSource,
    createdAt: new Date("2026-07-15T08:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(m);
  return m;
};

const seedGoal = (
  repo: InMemoryGoalRepository,
  overrides: Partial<StoredGoal> = {},
): StoredGoal => {
  const goal: StoredGoal = {
    id: "00000000-0000-4000-8000-00000000b001",
    userId: userA,
    kind: "cut",
    status: "active",
    pace: "steady",
    target: { weightKg: 78 },
    startsOn: "2026-01-01",
    targetDate: "2026-04-01",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(goal);
  return goal;
};

const seedWorkout = (
  repo: InMemoryWorkoutRepository,
  overrides: Partial<StoredWorkout> = {},
): StoredWorkout => {
  const w: StoredWorkout = {
    id: "00000000-0000-4000-8000-00000000c001",
    userId: userA,
    name: "Leg day",
    startedAt: new Date("2026-07-15T08:00:00Z"),
    completedAt: new Date("2026-07-15T09:00:00Z"),
    notes: null,
    source: "manual" as WorkoutSource,
    details: {},
    createdAt: new Date("2026-07-15T08:00:00Z"),
    updatedAt: new Date("2026-07-15T08:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(w);
  return w;
};

const seedFoodEntry = (
  repo: InMemoryFoodEntryRepository,
  overrides: Partial<StoredFoodEntry> = {},
): StoredFoodEntry => {
  const e: StoredFoodEntry = {
    id: "00000000-0000-4000-8000-00000000e001",
    userId: userA,
    source: "manual" as FoodSource,
    confidence: null,
    confirmedByUser: true,
    name: "Toast",
    consumedAt: new Date("2026-07-15T08:00:00Z"),
    caloriesKcal: 200,
    proteinG: 5,
    carbohydrateG: 30,
    fatG: 4,
    details: {},
    createdAt: new Date("2026-07-15T08:00:00Z"),
    updatedAt: new Date("2026-07-15T08:00:00Z"),
    ...overrides,
  };
  repo.__seedForTest(e);
  return e;
};

describe("GET /v1/energy/summary", () => {
  it("returns a complete breakdown for a fully-specified user", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository);
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=moderately_active&sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().summary;
    expect(body.formulaVersion).toBe(ENERGY_FORMULA_VERSION);
    expect(body.complete).toBe(true);
    expect(body.incompleteReason).toBeNull();
    expect(body.ageYears).toBeGreaterThan(0);
    expect(body.bmrKcal).toBeGreaterThan(0);
    expect(body.activityMultiplier).toBe(1.6);
    expect(body.tdeeKcal).toBeGreaterThan(0);
    expect(body.goalAdjustmentKcal).toBe(-500);
    expect(body.dailyTargetKcal).toBeGreaterThan(0);
  });

  it("echoes the formula version so the UI can render it (ENG-02)", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository);
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=lightly_active&sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.formulaVersion).toBe(ENERGY_FORMULA_VERSION);
  });

  it("reports incompleteReason 'no_active_goal' when the user has no goal", async () => {
    const { app, profileRepository, bodyMeasurementRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedProfile(profileRepository);
    seedMeasurement(bodyMeasurementRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=lightly_active&sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.complete).toBe(false);
    expect(response.json().summary.incompleteReason).toBe("no_active_goal");
    expect(response.json().summary.goalAdjustmentKcal).toBeNull();
    expect(response.json().summary.dailyTargetKcal).toBeNull();
  });

  it("reports incompleteReason 'activity_unset' when activityLevel is omitted", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository);
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.complete).toBe(false);
    expect(response.json().summary.incompleteReason).toBe("activity_unset");
  });

  it("reports incompleteReason 'sex_missing' when sexAtBirth is omitted", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository);
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=lightly_active",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.complete).toBe(false);
    expect(response.json().summary.incompleteReason).toBe("sex_missing");
  });

  it("echoes inputs in the breakdown so the UI can render the audit trail", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository);
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=sedentary&sexAtBirth=female",
      headers: { authorization: "Bearer valid" },
    });
    const inputs = response.json().summary.inputs;
    expect(inputs.weightKg).toBe(70);
    expect(inputs.heightCm).toBe(175);
    expect(inputs.birthYear).toBe(1990);
    expect(inputs.sexAtBirth).toBe("female");
    expect(inputs.activityLevel).toBe("sedentary");
    expect(inputs.goalKind).toBe("cut");
    expect(inputs.goalPace).toBe("steady");
  });

  it("never returns another user's data", async () => {
    const { app, profileRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedProfile(profileRepository, { userId: userB, displayName: "Other" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=lightly_active&sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.userId).toBe(userA);
    expect(response.json().summary.inputs.weightKg).toBeNull();
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=lightly_active&sexAtBirth=male",
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an unknown query param with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?mystery=x",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns balanceKcal null when today's consumption is missing", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository);
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=lightly_active&sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.balanceKcal).toBeNull();
  });

  it("returns balanceKcal when today's consumption is available", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
      foodEntryRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository);
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    // Seed entries consumed "today" (UTC) so the route's
    // now-window picks them up.
    const today = new Date();
    const isoToday = `${today.getUTCFullYear()}-${(today.getUTCMonth() + 1)
      .toString()
      .padStart(2, "0")}-${today.getUTCDate().toString().padStart(2, "0")}`;
    seedFoodEntry(foodEntryRepository, {
      consumedAt: new Date(`${isoToday}T08:00:00Z`),
      caloriesKcal: 500,
    });
    seedFoodEntry(foodEntryRepository, {
      id: "00000000-0000-4000-8000-00000000e002",
      consumedAt: new Date(`${isoToday}T18:00:00Z`),
      caloriesKcal: 300,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=lightly_active&sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.balanceKcal).not.toBeNull();
    // balance = consumed (800) - dailyTarget (calculated). Just
    // assert it's a number.
    expect(typeof response.json().summary.balanceKcal).toBe("number");
  });

  it("uses the supplied UTC offset for today's consumption window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
    try {
      const {
        app,
        profileRepository,
        goalRepository,
        bodyMeasurementRepository,
        foodEntryRepository,
      } = build(tokenVerifierFor({ userId: userA }));
      seedProfile(profileRepository, {
        activityLevel: "lightly_active",
        sexAtBirth: "male",
      });
      seedMeasurement(bodyMeasurementRepository);
      seedGoal(goalRepository);
      // UTC-14 is still on July 18 at the fixed instant. Its local day starts
      // at 14:00Z on July 18, so this entry belongs to local "today" even
      // though the server's UTC date is already July 19.
      seedFoodEntry(foodEntryRepository, {
        consumedAt: new Date("2026-07-18T15:00:00Z"),
        caloriesKcal: 500,
      });

      const localResponse = await app.inject({
        method: "GET",
        url: "/v1/energy/summary?utcOffsetMinutes=-840",
        headers: { authorization: "Bearer valid" },
      });
      const utcResponse = await app.inject({
        method: "GET",
        url: "/v1/energy/summary?utcOffsetMinutes=0",
        headers: { authorization: "Bearer valid" },
      });

      expect(localResponse.json().summary.balanceKcal).not.toBeNull();
      expect(utcResponse.json().summary.balanceKcal).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefers profile.activityLevel over the query string (PROF-001 follow-up)", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository, { activityLevel: "extra_active" });
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    // The query string says moderately_active; profile says
    // extra_active. The route should use the profile value.
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=moderately_active&sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.activityMultiplier).toBe(2.0);
    expect(response.json().summary.inputs.activityLevel).toBe("extra_active");
  });

  it("falls back to the query string when profile values are null", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository, {
      activityLevel: null,
      sexAtBirth: null,
    });
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=lightly_active&sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.activityMultiplier).toBe(1.5);
    expect(response.json().summary.inputs.activityLevel).toBe("lightly_active");
  });

  it("prefers profile.sexAtBirth over the query string", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    seedProfile(profileRepository, { sexAtBirth: "female" });
    seedMeasurement(bodyMeasurementRepository);
    seedGoal(goalRepository);
    // The query string says male; profile says female. The
    // female formula subtracts 161; the male formula adds 5.
    // Both produce different BMRs for the same body.
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary?activityLevel=lightly_active&sexAtBirth=male",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.inputs.sexAtBirth).toBe("female");
  });

  it("round-trips activityLevel through PUT /v1/profile so the energy route reads it", async () => {
    const {
      app,
      profileRepository,
      goalRepository,
      bodyMeasurementRepository,
    } = build(tokenVerifierFor({ userId: userA }));
    // Pre-seed a fully-specified profile so the energy
    // summary can be complete after the activityLevel patch.
    seedProfile(profileRepository, {
      heightCm: 175,
      birthYear: 1990,
      sexAtBirth: "male",
    });
    seedMeasurement(bodyMeasurementRepository, { weightKg: 70 });
    seedGoal(goalRepository);
    // Set activityLevel on the profile.
    await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { activityLevel: "very_active" },
    });
    // The energy summary should pick it up without a query param.
    const response = await app.inject({
      method: "GET",
      url: "/v1/energy/summary",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().summary.activityMultiplier).toBe(1.75);
    expect(response.json().summary.complete).toBe(true);
  });
});
