import { describe, expect, it } from "vitest";
import type { UserId } from "@mizyun/core";

import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";
import { buildCoachGrounding } from "./grounding.js";

const USER_ID = "00000000-0000-4000-8000-000000000001" as UserId;
const NOW = new Date("2026-09-10T12:00:00.000Z");

const buildDeps = () => {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "Europe/Bratislava",
    defaultUnitSystem: "metric",
    clock: { now: () => NOW },
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

describe("buildCoachGrounding — remaining calories and macro targets", () => {
  it("surfaces deterministic target and remaining calories & protein in nutrition grounding", async () => {
    const deps = buildDeps();

    // 1. Setup profile (male, 180cm, born 1990)
    const stored = await deps.profileRepository.getOrCreate(USER_ID, {
      now: NOW,
      accessToken: "token",
    });
    await deps.profileRepository.update(
      USER_ID,
      {
        ...stored,
        sexAtBirth: "male",
        heightCm: 180,
        birthYear: 1990,
        activityLevel: "moderately_active",
      },
      { accessToken: "token" },
    );

    // 2. Setup active goal (maintain)
    await deps.goalRepository.create(
      USER_ID,
      {
        id: "goal-1",
        userId: USER_ID,
        kind: "maintain",
        pace: "steady",
        target: { weightKg: 80 },
        startsOn: "2026-09-01",
        targetDate: "2026-12-31",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
      { accessToken: "token" },
    );

    // 3. Setup body measurement (80kg)
    await deps.bodyMeasurementRepository.create(
      USER_ID,
      {
        id: "bm-1",
        userId: USER_ID,
        weightKg: 80,
        measurements: {},
        source: "manual",
        measuredAt: NOW,
        createdAt: NOW,
      },
      { accessToken: "token" },
    );

    // 4. Setup food entries today: 1200 kcal, 80g protein
    await deps.foodEntryRepository.create(
      USER_ID,
      {
        id: "fe-1",
        userId: USER_ID,
        name: "Chicken and rice",
        caloriesKcal: 1200,
        proteinG: 80,
        carbohydrateG: 120,
        fatG: 20,
        details: {},
        source: "manual",
        confidence: null,
        confirmedByUser: true,
        consumedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
      { accessToken: "token" },
    );

    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);

    // Check kind: "nutrition" item
    const nutritionItem = items.find((i) => i.kind === "nutrition");
    expect(nutritionItem).toBeDefined();
    expect(nutritionItem?.confirmed).toBe(true);

    const nutritionData = nutritionItem?.data as Record<string, unknown>;
    expect(nutritionData.caloriesKcal).toBe(1200);
    expect(nutritionData.proteinG).toBe(80);
    expect(nutritionData.targetCaloriesKcal).toBeTypeOf("number");
    expect(nutritionData.remainingCaloriesKcal).toBeTypeOf("number");
    expect(nutritionData.targetProteinG).toBeTypeOf("number");
    expect(nutritionData.remainingProteinG).toBeTypeOf("number");

    const targetKcal = nutritionData.targetCaloriesKcal as number;
    const remainingKcal = nutritionData.remainingCaloriesKcal as number;
    expect(remainingKcal).toBe(Math.max(0, targetKcal - 1200));

    const targetProtein = nutritionData.targetProteinG as number;
    const remainingProtein = nutritionData.remainingProteinG as number;
    expect(remainingProtein).toBe(Math.max(0, targetProtein - 80));

    expect(nutritionData.loggedMealsToday).toEqual([
      expect.objectContaining({
        name: "Chicken and rice",
        caloriesKcal: 1200,
        proteinG: 80,
      }),
    ]);

    // Check kind: "energy" item
    const energyItem = items.find((i) => i.kind === "energy");
    expect(energyItem).toBeDefined();
    expect(energyItem?.confirmed).toBe(true);
    const energyData = energyItem?.data as Record<string, unknown>;
    expect(energyData.complete).toBe(true);
    expect(energyData.dailyTargetKcal).toBe(targetKcal);
  });

  it("handles day with 0 logged food: remaining equals full target", async () => {
    const deps = buildDeps();

    const stored = await deps.profileRepository.getOrCreate(USER_ID, {
      now: NOW,
      accessToken: "token",
    });
    await deps.profileRepository.update(
      USER_ID,
      {
        ...stored,
        sexAtBirth: "male",
        heightCm: 180,
        birthYear: 1990,
        activityLevel: "moderately_active",
      },
      { accessToken: "token" },
    );

    await deps.goalRepository.create(
      USER_ID,
      {
        id: "goal-2",
        userId: USER_ID,
        kind: "maintain",
        pace: "steady",
        target: { weightKg: 80 },
        startsOn: "2026-09-01",
        targetDate: "2026-12-31",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
      { accessToken: "token" },
    );

    await deps.bodyMeasurementRepository.create(
      USER_ID,
      {
        id: "bm-1",
        userId: USER_ID,
        weightKg: 80,
        measurements: {},
        source: "manual",
        measuredAt: NOW,
        createdAt: NOW,
      },
      { accessToken: "token" },
    );

    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);
    const nutritionItem = items.find((i) => i.kind === "nutrition");
    const data = nutritionItem?.data as Record<string, unknown>;

    expect(data.entryCount).toBe(0);
    expect(data.caloriesKcal).toBeNull();
    expect(data.remainingCaloriesKcal).toBe(data.targetCaloriesKcal);
    expect(data.remainingProteinG).toBe(data.targetProteinG);
  });

  it("floors remaining calories and protein at 0 when consumed exceeds target", async () => {
    const deps = buildDeps();

    const stored = await deps.profileRepository.getOrCreate(USER_ID, {
      now: NOW,
      accessToken: "token",
    });
    await deps.profileRepository.update(
      USER_ID,
      {
        ...stored,
        sexAtBirth: "female",
        heightCm: 160,
        birthYear: 1995,
        activityLevel: "sedentary",
      },
      { accessToken: "token" },
    );

    await deps.goalRepository.create(
      USER_ID,
      {
        id: "goal-3",
        userId: USER_ID,
        kind: "cut",
        pace: "steady",
        target: { weightKg: 55 },
        startsOn: "2026-09-01",
        targetDate: "2026-12-31",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
      { accessToken: "token" },
    );

    await deps.bodyMeasurementRepository.create(
      USER_ID,
      {
        id: "bm-1",
        userId: USER_ID,
        weightKg: 65,
        measurements: {},
        source: "manual",
        measuredAt: NOW,
        createdAt: NOW,
      },
      { accessToken: "token" },
    );

    // Log massive surplus
    await deps.foodEntryRepository.create(
      USER_ID,
      {
        id: "fe-1",
        userId: USER_ID,
        name: "Feast",
        caloriesKcal: 5000,
        proteinG: 300,
        carbohydrateG: 500,
        fatG: 150,
        details: {},
        source: "manual",
        confidence: null,
        confirmedByUser: true,
        consumedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
      { accessToken: "token" },
    );

    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);
    const nutritionItem = items.find((i) => i.kind === "nutrition");
    const data = nutritionItem?.data as Record<string, unknown>;

    expect(data.remainingCaloriesKcal).toBe(0);
    expect(data.remainingProteinG).toBe(0);
  });

  it("surfaces null remaining values gracefully when profile/goal inputs are missing", async () => {
    const deps = buildDeps();
    // Empty profile with no goal or measurements
    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);
    const nutritionItem = items.find((i) => i.kind === "nutrition");
    const data = nutritionItem?.data as Record<string, unknown>;

    expect(data.targetCaloriesKcal).toBeNull();
    expect(data.remainingCaloriesKcal).toBeNull();
    expect(data.targetProteinG).toBeNull();
    expect(data.remainingProteinG).toBeNull();
  });

  it("includes available planned routines in training grounding", async () => {
    const deps = buildDeps();

    await deps.workoutRepository.create(
      USER_ID,
      {
        id: "w-routine-1",
        userId: USER_ID,
        name: "Push Day 1",
        source: "manual",
        startedAt: NOW,
        completedAt: null,
        notes: null,
        details: {
          coachPlan: {
            exercises: [
              {
                name: "Barbell Bench Press",
                targetSets: 4,
                targetReps: "8-10",
                targetLoad: "80kg",
              },
            ],
          },
        },
        createdAt: NOW,
        updatedAt: NOW,
      },
      { accessToken: "token" },
    );

    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);
    const trainingItem = items.find((i) => i.kind === "training");
    const data = trainingItem?.data as Record<string, unknown>;

    expect(data.availableRoutines).toEqual([
      expect.objectContaining({
        name: "Push Day 1",
        exerciseCount: 1,
        exercises: [
          expect.objectContaining({
            name: "Barbell Bench Press",
            targetSets: 4,
            targetReps: "8-10",
            targetLoad: "80kg",
          }),
        ],
      }),
    ]);
  });

  it("caps itemized logged meals in static grounding at 20 entries", async () => {
    const deps = buildDeps();

    for (let i = 1; i <= 25; i++) {
      await deps.foodEntryRepository.create(
        USER_ID,
        {
          id: `meal-${i}`,
          userId: USER_ID,
          name: `Meal Item ${i}`,
          consumedAt: NOW,
          caloriesKcal: 100,
          proteinG: 10,
          carbohydrateG: 10,
          fatG: 2,
          details: {},
          source: "manual",
          confidence: null,
          confirmedByUser: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
        { accessToken: "token" },
      );
    }

    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);
    const nutritionItem = items.find((i) => i.kind === "nutrition");
    const data = nutritionItem?.data as Record<string, unknown>;

    expect(data.entryCount).toBe(25);
    const loggedMealsToday = data.loggedMealsToday as unknown[];
    expect(loggedMealsToday).toHaveLength(20);

    const today = data.today as Record<string, unknown>;
    const todayLoggedMeals = today.loggedMeals as unknown[];
    expect(todayLoggedMeals).toHaveLength(20);
  });

  it("surfaces latestCircumferences under kind: 'body' when tape measurements are logged", async () => {
    const deps = buildDeps();

    // 1. Seed body measurement with tape circumferences
    await deps.bodyMeasurementRepository.create(
      USER_ID,
      {
        id: "meas-1",
        userId: USER_ID,
        measuredAt: NOW,
        weightKg: 80.5,
        measurements: {
          waist_cm: 82.5,
          chest_cm: 104,
          hips_cm: 98,
        },
        source: "manual",
        createdAt: NOW,
      },
      { accessToken: "token" },
    );

    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);
    const bodyItem = items.find((i) => i.kind === "body");
    expect(bodyItem).toBeDefined();
    expect(bodyItem?.confirmed).toBe(true);

    const data = bodyItem?.data as Record<string, unknown>;
    expect(data.latestWeightKg).toBe(80.5);
    expect(data.latestCircumferences).toEqual({
      measuredAt: NOW.toISOString(),
      waistCm: 82.5,
      chestCm: 104,
      hipsCm: 98,
      neckCm: null,
      bicepsCm: null,
      thighsCm: null,
    });
  });

  it("surfaces completed workouts in last7Days under kind: 'training'", async () => {
    const deps = buildDeps();
    const workoutTime = new Date(NOW.getTime() - 2 * 86_400_000); // 2 days ago

    await deps.workoutRepository.create(
      USER_ID,
      {
        id: "w-completed-1",
        userId: USER_ID,
        name: "Leg Day Squats",
        source: "manual",
        startedAt: workoutTime,
        completedAt: new Date(workoutTime.getTime() + 3_600_000),
        notes: "Great leg pump",
        details: {},
        createdAt: workoutTime,
        updatedAt: workoutTime,
      },
      { accessToken: "token" },
    );

    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);
    const trainingItem = items.find((i) => i.kind === "training");
    expect(trainingItem).toBeDefined();

    const data = trainingItem?.data as Record<string, unknown>;
    const last7Days = data.last7Days as Record<string, unknown>;
    expect(last7Days.completedWorkouts).toEqual([
      {
        name: "Leg Day Squats",
        startedAt: workoutTime.toISOString(),
      },
    ]);
  });
});
