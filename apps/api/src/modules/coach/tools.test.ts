import { describe, expect, it } from "vitest";
import type {
  BodyMeasurementRepository,
  FoodEntryRepository,
  GoalRepository,
  UserId,
  WorkoutRepository,
  WorkoutSetRepository,
} from "@mizyun/core";

import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";
import {
  buildCoachToolRegistry,
  buildComputeEnergyTool,
  buildGetActiveGoalTool,
  buildGetRecentFoodEntriesTool,
  buildGetRecentMeasurementsTool,
  buildGetRecentWorkoutsTool,
  buildGetCoachingPlanTool,
  buildGetTrainingPrescriptionTool,
} from "./tools.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const otherUserId = "00000000-0000-4000-8000-000000000002" as UserId;
const clock = () => new Date("2026-07-23T10:00:00.000Z");

const buildDeps = () => {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "Europe/Bratislava",
    defaultUnitSystem: "metric",
    clock: { now: clock },
  });
  const goalRepository = new InMemoryGoalRepository();
  const workoutRepository = new InMemoryWorkoutRepository();
  const workoutSetRepository = new InMemoryWorkoutSetRepository();
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const bodyMeasurementRepository = new InMemoryBodyMeasurementRepository();
  return {
    profileRepository,
    goalRepository,
    workoutRepository,
    workoutSetRepository,
    foodEntryRepository,
    bodyMeasurementRepository,
  };
};

describe("CoachTools — registry", () => {
  it("exposes the eight expected tool names", () => {
    const deps = buildDeps();
    const registry = buildCoachToolRegistry(deps);
    const names = registry.list().map((tool) => tool.name);
    expect(names).toEqual([
      "get_active_goal",
      "get_recent_workouts",
      "get_recent_measurements",
      "get_recent_food_entries",
      "compute_energy",
      "get_coaching_plan",
      "get_training_prescription",
    ]);
  });

  it("rejects unknown tool names with UnknownAgentToolError", async () => {
    const deps = buildDeps();
    const registry = buildCoachToolRegistry(deps);
    await expect(
      registry.execute({
        principalUserId: userId,
        calls: [{ name: "made_up_tool", args: {} }],
        accessToken: "token",
        clock: { now: clock },
      }),
    ).rejects.toThrow(/Unknown agent tool/);
  });
});

const seedCompletePlanningContext = (deps: ReturnType<typeof buildDeps>) => {
  deps.profileRepository.__seedForTest({
    userId,
    displayName: "Ada",
    unitSystem: "metric",
    timezone: "Europe/Bratislava",
    birthYear: 1992,
    heightCm: 180,
    activityLevel: "lightly_active",
    sexAtBirth: "female",
    coachingPreferences: {
      experienceLevel: "intermediate",
      trainingDaysPerWeek: 4,
      sessionDurationMinutes: 60,
      trainingFocus: "hypertrophy",
      availableEquipment: ["full_gym"],
      dietaryPreferences: ["omnivore"],
      trainingLimitations: [],
    },
    planTier: "free",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-20T00:00:00Z"),
  });
  deps.goalRepository.__seedForTest({
    id: "00000000-0000-4000-8000-000000000011",
    userId,
    kind: "bulk",
    pace: "gradual",
    target: { weightKg: 85 },
    startsOn: "2026-07-01",
    targetDate: "2026-12-31",
    status: "active",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-20T00:00:00Z"),
  });
  deps.bodyMeasurementRepository.__seedForTest({
    id: "00000000-0000-4000-8000-000000000012",
    userId,
    measuredAt: new Date("2026-07-22T08:00:00Z"),
    weightKg: 80,
    measurements: {},
    source: "manual",
    createdAt: new Date("2026-07-22T08:00:00Z"),
  });
};

describe("CoachTools — deterministic planning", () => {
  it("compute_energy returns actual calculations from confirmed data", async () => {
    const deps = buildDeps();
    seedCompletePlanningContext(deps);
    const evidence = await buildComputeEnergyTool(deps).execute({
      principalUserId: userId,
      args: {},
      accessToken: "token",
      clock: { now: clock },
    });

    expect(evidence.kind).toBe("energy");
    expect(evidence.data).toMatchObject({
      complete: true,
      dailyTargetKcal: expect.any(Number),
      inputs: {
        weightKg: 80,
        goalKind: "bulk",
        goalPace: "gradual",
      },
    });
    expect(evidence.data).not.toHaveProperty("userId");
  });

  it("returns a validated calorie, protein, and training plan", async () => {
    const deps = buildDeps();
    seedCompletePlanningContext(deps);
    const evidence = await buildGetCoachingPlanTool(deps).execute({
      principalUserId: userId,
      args: {},
      accessToken: "token",
      clock: { now: clock },
    });

    expect(evidence.kind).toBe("plan");
    expect(evidence.data).toMatchObject({
      complete: true,
      goalKind: "bulk",
      protein: {
        basisWeightKg: 80,
        minG: 128,
        targetG: 144,
        maxG: 160,
      },
      training: {
        focus: "hypertrophy_and_strength",
        resistanceDaysMin: 3,
        resistanceDaysMax: 4,
      },
    });
  });

  it("surfaces typed missing inputs instead of guessing", async () => {
    const evidence = await buildGetCoachingPlanTool(buildDeps()).execute({
      principalUserId: userId,
      args: {},
      accessToken: "token",
      clock: { now: clock },
    });

    expect(evidence.data).toMatchObject({
      complete: false,
      missingInputs: ["active_goal", "body_weight", "energy_target"],
      calorie: null,
      protein: null,
      training: null,
    });
  });

  it("returns a bounded training prescription from confirmed preferences", async () => {
    const deps = buildDeps();
    seedCompletePlanningContext(deps);
    const evidence = await buildGetTrainingPrescriptionTool(deps).execute({
      principalUserId: userId,
      args: {},
      accessToken: "token",
      clock: { now: clock },
    });

    expect(evidence.kind).toBe("plan");
    expect(evidence.data).toMatchObject({
      complete: true,
      goalKind: "bulk",
      requestedDaysPerWeek: 4,
      resistanceDaysPerWeek: 4,
      volumeAction: "hold",
    });
    expect(
      (evidence.data.sessions as Array<{ exercises: unknown[] }>).every(
        (session) => session.exercises.length > 0,
      ),
    ).toBe(true);
  });

  it("uses recent confirmed set exertion to reduce prescribed volume", async () => {
    const deps = buildDeps();
    seedCompletePlanningContext(deps);
    deps.workoutRepository.__seedForTest({
      id: "00000000-0000-4000-8000-000000000021",
      userId,
      name: "Hard session",
      startedAt: new Date("2026-07-22T08:00:00Z"),
      completedAt: new Date("2026-07-22T09:00:00Z"),
      notes: null,
      source: "manual",
      details: {},
      createdAt: new Date("2026-07-22T08:00:00Z"),
      updatedAt: new Date("2026-07-22T09:00:00Z"),
    });
    deps.workoutSetRepository.__seedForTest({
      id: "00000000-0000-4000-8000-000000000022",
      userId,
      workoutId: "00000000-0000-4000-8000-000000000021",
      exerciseId: "00000000-0000-4000-8000-000000000023",
      sequence: 1,
      repetitions: 5,
      loadKg: 100,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: 9,
      completedAt: new Date("2026-07-22T08:10:00Z"),
      createdAt: new Date("2026-07-22T08:10:00Z"),
    });

    const evidence = await buildGetTrainingPrescriptionTool(deps).execute({
      principalUserId: userId,
      args: {},
      accessToken: "token",
      clock: { now: clock },
    });
    expect(evidence.data).toMatchObject({
      recentLoad: {
        completedSessionsLast7Days: 1,
        completedSetsLast7Days: 1,
        averageRpeLast7Days: 9,
      },
      volumeAction: "reduce",
    });
  });
});

describe("CoachTools — get_active_goal", () => {
  it("returns active=false when no goal exists", async () => {
    const tool = buildGetActiveGoalTool(buildDeps());
    const evidence = await tool.execute({
      principalUserId: userId,
      args: {},
      accessToken: "token",
      clock: { now: clock },
    });
    expect(evidence.kind).toBe("goal");
    expect(evidence.data).toEqual({ active: false });
  });

  it("returns the active goal's aggregate fields", async () => {
    const deps = buildDeps();
    const goal = {
      id: "00000000-0000-4000-8000-0000000000g1",
      userId,
      kind: "maintain" as const,
      pace: "steady" as const,
      target: { weightKg: 80 },
      startsOn: "2026-07-01",
      targetDate: "2026-12-31",
      status: "active" as const,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-15T00:00:00Z"),
    };
    deps.goalRepository.__seedForTest(goal);
    const tool = buildGetActiveGoalTool(deps);
    const evidence = await tool.execute({
      principalUserId: userId,
      args: {},
      accessToken: "token",
      clock: { now: clock },
    });
    expect(evidence.data).toMatchObject({
      active: true,
      kind: "maintain",
      pace: "steady",
      targetDate: "2026-12-31",
    });
  });
});

describe("CoachTools — get_recent_workouts", () => {
  it("clamps days_back to 1..28", async () => {
    const deps = buildDeps();
    const tool = buildGetRecentWorkoutsTool(deps);
    const evidence = await tool.execute({
      principalUserId: userId,
      args: { days_back: 9999 },
      accessToken: "token",
      clock: { now: clock },
    });
    expect(evidence.data).toMatchObject({ daysBack: 28 });
  });

  it("uses default 7 when days_back is omitted or non-numeric", async () => {
    const deps = buildDeps();
    const tool = buildGetRecentWorkoutsTool(deps);
    for (const raw of [undefined, "abc" as unknown as number, NaN]) {
      const evidence = await tool.execute({
        principalUserId: userId,
        args:
          raw === undefined
            ? {}
            : ({ days_back: raw } as unknown as {
                days_back?: number;
              }),
        accessToken: "token",
        clock: { now: clock },
      });
      expect(evidence.data).toMatchObject({ daysBack: 7 });
    }
  });

  it("clamps negative days_back to 1 and over-cap to 28", async () => {
    const deps = buildDeps();
    const tool = buildGetRecentWorkoutsTool(deps);
    const tooLow = await tool.execute({
      principalUserId: userId,
      args: { days_back: -5 } as unknown as { days_back?: number },
      accessToken: "token",
      clock: { now: clock },
    });
    expect(tooLow.data).toMatchObject({ daysBack: 1 });
    const tooHigh = await tool.execute({
      principalUserId: userId,
      args: { days_back: 9999 } as unknown as { days_back?: number },
      accessToken: "token",
      clock: { now: clock },
    });
    expect(tooHigh.data).toMatchObject({ daysBack: 28 });
  });

  it("scopes results to the principal user", async () => {
    const deps = buildDeps();
    // Seed a workout for a different user inside the window — it
    // must not appear in the response.
    deps.workoutRepository.__seedForTest({
      id: "00000000-0000-4000-8000-0000000000w1",
      userId: otherUserId,
      name: "Other user workout",
      startedAt: new Date("2026-07-22T08:00:00Z"),
      completedAt: new Date("2026-07-22T09:00:00Z"),
      notes: null,
      source: "manual",
      details: {},
      createdAt: new Date("2026-07-22T08:00:00Z"),
      updatedAt: new Date("2026-07-22T09:00:00Z"),
    });
    const tool = buildGetRecentWorkoutsTool(deps);
    const evidence = await tool.execute({
      principalUserId: userId,
      args: { days_back: 7 },
      accessToken: "token",
      clock: { now: clock },
    });
    expect(evidence.data).toMatchObject({
      totalWorkouts: 0,
      completedWorkouts: 0,
      totalSets: 0,
    });
  });
});

describe("CoachTools — get_recent_measurements", () => {
  it("returns summary + raw daily weights", async () => {
    const deps = buildDeps();
    deps.bodyMeasurementRepository.__seedForTest({
      id: "00000000-0000-4000-8000-0000000000m1",
      userId,
      measuredAt: new Date("2026-07-22T08:00:00Z"),
      weightKg: 80,
      measurements: {},
      source: "manual",
      createdAt: new Date("2026-07-22T08:00:00Z"),
    });
    const tool = buildGetRecentMeasurementsTool(deps);
    const evidence = await tool.execute({
      principalUserId: userId,
      args: { days_back: 7 },
      accessToken: "token",
      clock: { now: clock },
    });
    expect(evidence.data).toMatchObject({
      observationCount: 1,
      latestWeightKg: 80,
      measurements: [{ day: "2026-07-22", weightKg: 80 }],
    });
  });
});

describe("CoachTools — get_recent_food_entries", () => {
  it("aggregates calories, macros, and entry counts per day", async () => {
    const deps = buildDeps();
    deps.foodEntryRepository.__seedForTest({
      id: "00000000-0000-4000-8000-0000000000f1",
      userId,
      consumedAt: new Date("2026-07-23T08:00:00Z"),
      name: "Oatmeal",
      caloriesKcal: 400,
      proteinG: 15,
      carbohydrateG: 60,
      fatG: 10,
      confirmedByUser: true,
      source: "manual",
      details: {},
      confidence: null,
      createdAt: new Date("2026-07-23T08:00:00Z"),
      updatedAt: new Date("2026-07-23T08:00:00Z"),
    });
    const tool = buildGetRecentFoodEntriesTool(deps);
    const evidence = await tool.execute({
      principalUserId: userId,
      args: { days_back: 7 },
      accessToken: "token",
      clock: { now: clock },
    });
    expect(evidence.data).toMatchObject({
      totalEntries: 1,
      today: {
        day: "2026-07-23",
        caloriesKcal: 400,
        proteinG: 15,
        carbohydrateG: 60,
        fatG: 10,
      },
    });
  });
});

describe("CoachTools — defence in depth", () => {
  it("runs the principal's userId regardless of what the model passes as args", async () => {
    const deps = buildDeps();
    deps.goalRepository.__seedForTest({
      id: "00000000-0000-4000-8000-0000000000g1",
      userId: otherUserId,
      kind: "maintain",
      pace: "steady",
      target: { weightKg: 80 },
      startsOn: "2026-07-01",
      targetDate: "2026-12-31",
      status: "active",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-15T00:00:00Z"),
    });
    const tool = buildGetActiveGoalTool(deps);
    // Model tries to pass a userId override — the registry passes
    // `principalUserId` and ignores whatever the model supplied.
    const evidence = await tool.execute({
      principalUserId: userId,
      args: { userId: otherUserId } as never,
      accessToken: "token",
      clock: { now: clock },
    });
    expect(evidence.data).toEqual({ active: false });
  });
});
