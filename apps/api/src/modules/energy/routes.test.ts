import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  goalAdjustmentKcalFor,
  goalModeFor,
  REVIEW_DEFAULT_SAFETY_FLOOR_KCAL,
} from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { buildWeeklyReview, loadEnergyRouteContext } from "./routes.js";
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
    // v2: rate-based standard cut at the 70 kg reading (ENG-07).
    expect(body.goalAdjustmentKcal).toBe(
      goalAdjustmentKcalFor(goalModeFor("cut", "steady"), 70),
    );
    expect(body.dailyTargetKcal).toBeGreaterThan(0);
    expect(body.targetProteinG).toBeGreaterThan(0);
    expect(body.targetCarbohydrateG).toBeGreaterThan(0);
    expect(body.targetFatG).toBeGreaterThan(0);
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

describe("ENG-07/ENG-08 rate-based summary and weekly calorie review", () => {
  const NOW = new Date("2026-10-15T12:00:00Z");
  const TODAY = "2026-10-15";
  const WEEK_START = "2026-10-12";

  const multiUserVerifier: AccessTokenVerifier = {
    verify: async (token) =>
      token === "valid" || token === "valid-b"
        ? {
            userId: token === "valid" ? userA : userB,
            role: "authenticated",
            accessToken: `test-token-${token}`,
          }
        : null,
  };

  const dayIso = (back: number): string =>
    new Date(Date.parse(`${TODAY}T00:00:00Z`) - back * 86_400_000)
      .toISOString()
      .slice(0, 10);

  const uuid = (prefix: string, n: number): string =>
    `00000000-0000-4000-8000-${prefix}${n.toString().padStart(12 - prefix.length, "0")}`;

  /** Daily weights for the last 28 days; `weeklyKg` is the slope. */
  const seedWeights = (
    repo: InMemoryBodyMeasurementRepository,
    weeklyKg: number,
  ) => {
    for (let back = 27; back >= 0; back -= 1) {
      const measuredAt = new Date(`${dayIso(back)}T07:00:00Z`);
      seedMeasurement(repo, {
        id: uuid("a", back + 1),
        measuredAt,
        createdAt: measuredAt,
        weightKg: Math.round((80 - (weeklyKg * back) / 7) * 1000) / 1000,
      });
    }
  };

  const seedIntake = (
    repo: InMemoryFoodEntryRepository,
    days: number,
    kcal: number,
  ) => {
    for (let back = 1; back <= days; back += 1) {
      const consumedAt = new Date(`${dayIso(back)}T12:00:00Z`);
      seedFoodEntry(repo, {
        id: uuid("e", back),
        consumedAt,
        createdAt: consumedAt,
        updatedAt: consumedAt,
        caloriesKcal: kcal,
      });
    }
  };

  const setup = (options: { weeklyKg: number; goalStartsOn?: string }) => {
    const built = build(multiUserVerifier);
    seedProfile(built.profileRepository, {
      activityLevel: "lightly_active",
      sexAtBirth: "male",
    });
    seedWeights(built.bodyMeasurementRepository, options.weeklyKg);
    seedGoal(built.goalRepository, {
      startsOn: options.goalStartsOn ?? "2026-09-01",
      targetDate: "2027-03-01",
      target: { weightKg: 72 },
    });
    return built;
  };

  const get = (
    app: ReturnType<typeof buildApp>,
    url: string,
    token = "valid",
  ) =>
    app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${token}` },
    });

  const decide = (
    app: ReturnType<typeof buildApp>,
    id: string,
    decision: string,
    token = "valid",
  ) =>
    app.inject({
      method: "POST",
      url: `/v1/energy/weekly-review/${id}/decision`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { decision },
    });

  const target = async (app: ReturnType<typeof buildApp>) =>
    (await get(app, "/v1/energy/summary")).json().summary;

  /** Flat weight on a cut with on-target intake: the review says adjust. */
  const adjustScenario = async () => {
    const built = setup({ weeklyKg: 0 });
    const summary = await target(built.app);
    seedIntake(
      built.foodEntryRepository,
      7,
      Math.round(summary.dailyTargetKcal as number),
    );
    return { ...built, summary };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes goal mode, trend weight, calibration and adaptive maintenance", async () => {
    const { app, foodEntryRepository } = setup({ weeklyKg: 0 });
    seedIntake(foodEntryRepository, 20, 2400);
    const summary = await target(app);
    expect(summary.formulaVersion).toBe(ENERGY_FORMULA_VERSION);
    expect(summary.goalMode).toMatchObject({
      id: "standard_cut",
      minWeeklyPercent: -0.75,
      maxWeeklyPercent: -0.5,
    });
    expect(summary.weightSource).toBe("trend");
    expect(summary.calibrationKcal).toBe(0);
    expect(summary.targetWeeklyChangeKg).toBeLessThan(0);
    expect(summary.projection).not.toBeNull();
    // Flat weight over 28 days with 20 logged days of 2,400 kcal.
    expect(summary.adaptiveMaintenance).toMatchObject({
      status: "ready",
      maintenanceKcal: 2400,
      loggedDays: 20,
      windowDays: 28,
    });
  });

  it("marks a day with an uncalculated entry incomplete for adaptive maintenance", async () => {
    const { app, foodEntryRepository } = setup({ weeklyKg: 0 });
    seedIntake(foodEntryRepository, 14, 2400);
    seedFoodEntry(foodEntryRepository, {
      id: uuid("f", 1),
      consumedAt: new Date(`${dayIso(3)}T18:00:00Z`),
      caloriesKcal: null,
    });
    const summary = await target(app);
    expect(summary.adaptiveMaintenance).toMatchObject({
      status: "insufficient",
      reason: "too_few_logged_days",
      loggedDays: 13,
    });
  });

  it("returns a null review and proposal without an active goal", async () => {
    const { app, profileRepository } = build(multiUserVerifier);
    seedProfile(profileRepository);
    const response = await get(app, "/v1/energy/weekly-review");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ review: null, proposal: null });
  });

  it("reports insufficient data for a goal younger than two weeks", async () => {
    const { app } = setup({ weeklyKg: 0, goalStartsOn: dayIso(3) });
    const body = (await get(app, "/v1/energy/weekly-review")).json();
    expect(body.review.status).toBe("insufficient_data");
    expect(body.review.reasons[0]).toBe("goal_too_new");
    expect(body.proposal).toBeNull();
  });

  it("holds when the observed rate is inside the mode's band", async () => {
    const built = setup({ weeklyKg: -0.5 });
    // A sloped series gives a 3-decimal smoothed weight; the summary must
    // still satisfy the 0.01 kg wire contract (regression: was a 500).
    const raw = await get(built.app, "/v1/energy/summary");
    expect(raw.statusCode).toBe(200);
    const summary = raw.json().summary;
    seedIntake(
      built.foodEntryRepository,
      7,
      Math.round(summary.dailyTargetKcal as number),
    );
    const body = (await get(built.app, "/v1/energy/weekly-review")).json();
    expect(body.review.status).toBe("hold");
    expect(body.review.reasons).toEqual(["within_band"]);
    expect(body.proposal).toBeNull();
  });

  it("creates one pending proposal per goal and week, also under concurrent requests", async () => {
    const { app } = await adjustScenario();
    const [first, concurrent] = await Promise.all([
      get(app, "/v1/energy/weekly-review"),
      get(app, "/v1/energy/weekly-review"),
    ]);
    const body = first.json();
    expect(body.review.status).toBe("adjust");
    expect(body.review.reasons[0]).toBe("above_band");
    expect(body.review.deltaKcal).toBeLessThan(0);
    // Without the floor clamp the visible change equals the calibration change.
    expect(body.review.targetChangeKcal).toBe(body.review.deltaKcal);
    expect(body.proposal.review.targetChangeKcal).toBe(body.review.deltaKcal);
    expect(body.proposal).toMatchObject({
      status: "pending",
      weekStart: WEEK_START,
      decidedAt: null,
    });
    expect(body.proposal.review.deltaKcal).toBe(body.review.deltaKcal);
    expect(concurrent.json().proposal.id).toBe(body.proposal.id);
    const repeat = (await get(app, "/v1/energy/weekly-review")).json();
    expect(repeat.proposal.id).toBe(body.proposal.id);
  });

  it("accepting moves the next summary target by exactly the delta; a lost-response retry gets 409", async () => {
    const { app, summary: before } = await adjustScenario();
    const proposal = (await get(app, "/v1/energy/weekly-review")).json()
      .proposal;
    const delta = proposal.review.deltaKcal as number;

    const accepted = await decide(app, proposal.id, "accept");
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().proposal).toMatchObject({
      id: proposal.id,
      status: "accepted",
    });
    expect(accepted.json().proposal.decidedAt).not.toBeNull();

    // Client lost the response and retries: no double application.
    const retry = await decide(app, proposal.id, "accept");
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe("CALORIE_ADJUSTMENT_ALREADY_DECIDED");

    const after = await target(app);
    expect(after.calibrationKcal).toBe(delta);
    expect(after.dailyTargetKcal).toBeCloseTo(
      (before.dailyTargetKcal as number) + delta,
      2,
    );
    const goal = await app.inject({
      method: "GET",
      url: "/v1/goals/active",
      headers: { authorization: "Bearer valid" },
    });
    expect(goal.statusCode).toBe(200);
    expect(goal.json().goal.calorieCalibrationKcal).toBe(delta);
    // The stored proposal stays visible for the week, now accepted.
    const again = (await get(app, "/v1/energy/weekly-review")).json();
    expect(again.proposal).toMatchObject({
      id: proposal.id,
      status: "accepted",
    });
  });

  it("declining keeps the target and a second decision conflicts", async () => {
    const { app, summary: before } = await adjustScenario();
    const proposal = (await get(app, "/v1/energy/weekly-review")).json()
      .proposal;
    const declined = await decide(app, proposal.id, "decline");
    expect(declined.statusCode).toBe(200);
    expect(declined.json().proposal.status).toBe("declined");
    const second = await decide(app, proposal.id, "accept");
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CALORIE_ADJUSTMENT_ALREADY_DECIDED");
    const after = await target(app);
    expect(after.calibrationKcal).toBe(0);
    expect(after.dailyTargetKcal).toBe(before.dailyTargetKcal);
  });

  it("supersedes a stale proposal when the calibration changed since the review", async () => {
    const { app, goalRepository, summary: before } = await adjustScenario();
    const proposal = (await get(app, "/v1/energy/weekly-review")).json()
      .proposal;
    const goal = await goalRepository.getActive(userA, {
      accessToken: "test-token-valid",
    });
    await goalRepository.update(
      userA,
      { ...goal!, calorieCalibrationKcal: 100 },
      { accessToken: "test-token-valid" },
    );
    const stale = await decide(app, proposal.id, "accept");
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CALORIE_ADJUSTMENT_STALE");
    const after = await target(app);
    expect(after.calibrationKcal).toBe(100);
    expect(after.dailyTargetKcal).toBeCloseTo(
      (before.dailyTargetKcal as number) + 100,
      2,
    );
    // The superseded row no longer occupies the week: a fresh proposal is
    // computed against the current calibration.
    const again = (await get(app, "/v1/energy/weekly-review")).json();
    expect(again.proposal.id).not.toBe(proposal.id);
    expect(again.proposal.status).toBe("pending");
    expect(again.proposal.review.calibrationBeforeKcal).toBe(100);
  });

  it("enforces the 14-day cooldown after an acceptance, also into the next week", async () => {
    const { app } = await adjustScenario();
    const proposal = (await get(app, "/v1/energy/weekly-review")).json()
      .proposal;
    expect((await decide(app, proposal.id, "accept")).statusCode).toBe(200);

    const sameWeek = (await get(app, "/v1/energy/weekly-review")).json();
    expect(sameWeek.review.status).toBe("insufficient_data");
    expect(sameWeek.review.reasons).toEqual(["recent_adjustment"]);
    expect(sameWeek.proposal).toMatchObject({
      id: proposal.id,
      status: "accepted",
    });

    vi.setSystemTime(new Date(NOW.getTime() + 7 * 86_400_000));
    const nextWeek = (await get(app, "/v1/energy/weekly-review")).json();
    expect(nextWeek.review.reasons).toEqual(["recent_adjustment"]);
    expect(nextWeek.proposal).toBeNull();
  });

  it("supersedes a proposal after a pace change and offers a fresh one", async () => {
    const { app, goalRepository } = await adjustScenario();
    const proposal = (await get(app, "/v1/energy/weekly-review")).json()
      .proposal;
    const goal = await goalRepository.getActive(userA, {
      accessToken: "test-token-valid",
    });
    const patched = await app.inject({
      method: "PUT",
      url: `/v1/goals/${goal!.id}`,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { pace: "gradual" },
    });
    expect(patched.statusCode).toBe(200);

    const stale = await decide(app, proposal.id, "accept");
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CALORIE_ADJUSTMENT_STALE");
    expect((await target(app)).calibrationKcal).toBe(0);

    const fresh = (await get(app, "/v1/energy/weekly-review")).json();
    expect(fresh.review.goalMode.id).toBe("gradual_cut");
    expect(fresh.proposal.id).not.toBe(proposal.id);
    expect(fresh.proposal.status).toBe("pending");
    const accepted = await decide(app, fresh.proposal.id, "accept");
    expect(accepted.statusCode).toBe(200);
  });

  it("applies the default safety floor when sex at birth is unknown", async () => {
    const built = setup({ weeklyKg: 0 });
    seedIntake(built.foodEntryRepository, 7, 1300);
    const context = await loadEnergyRouteContext(
      {
        profileRepository: built.profileRepository,
        goalRepository: built.goalRepository,
        bodyMeasurementRepository: built.bodyMeasurementRepository,
        workoutRepository: built.workoutRepository,
        workoutSetRepository: built.workoutSetRepository,
        foodEntryRepository: built.foodEntryRepository,
      },
      userA,
      "test-token-valid",
      { activityLevel: null, sexAtBirth: null, utcOffsetMinutes: 0 },
      NOW,
    );
    const review = buildWeeklyReview(
      {
        ...context,
        sexAtBirth: null,
        breakdown: { ...context.breakdown, dailyTargetKcal: 1300 },
      },
      NOW,
    );
    expect(review?.status).toBe("adjust");
    expect(review?.reasons).toContain("safety_floor");
    expect(review?.proposedTargetKcal).toBe(REVIEW_DEFAULT_SAFETY_FLOOR_KCAL);
  });

  it("hides another user's proposal and validates the request", async () => {
    const { app } = await adjustScenario();
    const proposal = (await get(app, "/v1/energy/weekly-review")).json()
      .proposal;
    const foreign = await decide(app, proposal.id, "accept", "valid-b");
    expect(foreign.statusCode).toBe(404);
    const unknownId = await decide(app, "not-a-uuid", "accept");
    expect(unknownId.statusCode).toBe(404);
    const invalid = await decide(app, proposal.id, "maybe");
    expect(invalid.statusCode).toBe(422);
    const anonymous = await app.inject({
      method: "POST",
      url: `/v1/energy/weekly-review/${proposal.id}/decision`,
      payload: { decision: "accept" },
    });
    expect(anonymous.statusCode).toBe(401);
    // The owner's proposal is untouched by the rejected attempts.
    const accepted = await decide(app, proposal.id, "accept");
    expect(accepted.statusCode).toBe(200);
  });
});
