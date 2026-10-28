import { describe, expect, it } from "vitest";
import {
  createImportedRunSummary,
  createRunSummary,
  type RunListOptions,
  type UserId,
} from "@mizyun/core";

import { InMemoryBodyMeasurementRepository } from "../../body-measurement-repository.js";
import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { InMemoryGoalRepository } from "../../goal-repository.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryWorkoutSetRepository } from "../../workout-set-repository.js";
import { InMemoryRunRepository } from "../../run-repository.js";
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
    runRepository: new InMemoryRunRepository(workoutRepository),
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

  // #310: UTC times made Haiku read a 12:30 local lunch as 10:30.
  it("gives logged meal times in the user's time zone with the offset", async () => {
    const deps = buildDeps();
    const stored = await deps.profileRepository.getOrCreate(USER_ID, {
      now: NOW,
      accessToken: "token",
    });
    await deps.profileRepository.update(
      USER_ID,
      { ...stored, timezone: "Europe/Bratislava" },
      { accessToken: "token" },
    );
    await deps.foodEntryRepository.create(
      USER_ID,
      {
        id: "fe-lunch",
        userId: USER_ID,
        name: "Chicken burrito bowl",
        caloriesKcal: 720,
        proteinG: 48,
        carbohydrateG: 78,
        fatG: 22,
        details: {},
        source: "manual",
        confidence: null,
        confirmedByUser: true,
        consumedAt: new Date("2026-09-10T10:30:00.000Z"),
        createdAt: NOW,
        updatedAt: NOW,
      },
      { accessToken: "token" },
    );

    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);
    const nutrition = items.find((i) => i.kind === "nutrition")?.data as
      Record<string, unknown> | undefined;
    expect(nutrition?.loggedMealsToday).toEqual([
      expect.objectContaining({
        name: "Chicken burrito bowl",
        consumedAt: "2026-09-10T12:30:00+02:00",
      }),
    ]);
  });

  it.each([
    ["UTC", "2026-12-10T10:30:00.000Z", "2026-12-10T10:30:00+00:00"],
    // Winter time: Bratislava is UTC+1 after the October change.
    [
      "Europe/Bratislava",
      "2026-12-10T10:30:00.000Z",
      "2026-12-10T11:30:00+01:00",
    ],
  ])("formats meal times in %s", async (timezone, consumedAt, expected) => {
    const now = new Date("2026-12-10T12:00:00.000Z");
    const deps = buildDeps();
    const stored = await deps.profileRepository.getOrCreate(USER_ID, {
      now,
      accessToken: "token",
    });
    await deps.profileRepository.update(
      USER_ID,
      { ...stored, timezone },
      { accessToken: "token" },
    );
    await deps.foodEntryRepository.create(
      USER_ID,
      {
        id: `fe-${timezone}`,
        userId: USER_ID,
        name: "Porridge",
        caloriesKcal: 300,
        proteinG: 10,
        carbohydrateG: 50,
        fatG: 5,
        details: {},
        source: "manual",
        confidence: null,
        confirmedByUser: true,
        consumedAt: new Date(consumedAt),
        createdAt: now,
        updatedAt: now,
      },
      { accessToken: "token" },
    );
    const items = await buildCoachGrounding(deps, USER_ID, "token", now);
    const nutrition = items.find((i) => i.kind === "nutrition")?.data as
      Record<string, unknown> | undefined;
    expect(nutrition?.loggedMealsToday).toEqual([
      expect.objectContaining({ consumedAt: expected }),
    ]);
  });

  // #310/#316: "today" is the user's calendar day. 00:30 on 10 Sept in
  // Bratislava is 22:30 UTC on 9 Sept; 23:30 on 9 Sept local is yesterday.
  it("counts today's meals by the user's calendar day", async () => {
    const deps = buildDeps();
    const now = new Date("2026-09-10T06:00:00.000Z");
    const base = {
      userId: USER_ID,
      proteinG: 10,
      carbohydrateG: 20,
      fatG: 5,
      details: {},
      source: "manual" as const,
      confidence: null,
      confirmedByUser: true,
      createdAt: now,
      updatedAt: now,
    };
    await deps.foodEntryRepository.create(
      USER_ID,
      {
        ...base,
        id: "fe-after-midnight",
        name: "Toast",
        caloriesKcal: 200,
        consumedAt: new Date("2026-09-09T22:30:00.000Z"),
      },
      { accessToken: "token" },
    );
    await deps.foodEntryRepository.create(
      USER_ID,
      {
        ...base,
        id: "fe-yesterday",
        name: "Pasta",
        caloriesKcal: 700,
        consumedAt: new Date("2026-09-09T21:30:00.000Z"),
      },
      { accessToken: "token" },
    );
    const items = await buildCoachGrounding(deps, USER_ID, "token", now);
    const nutrition = items.find((i) => i.kind === "nutrition")?.data as
      Record<string, unknown> | undefined;
    expect(nutrition?.loggedMealsToday).toEqual([
      expect.objectContaining({
        name: "Toast",
        consumedAt: "2026-09-10T00:30:00+02:00",
      }),
    ]);
    expect(nutrition).toMatchObject({ entryCount: 1, caloriesKcal: 200 });
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

    // Today's meals are listed once, without row ids (token cost).
    expect(data).not.toHaveProperty("today");
    expect(loggedMealsToday[0]).not.toHaveProperty("id");
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

describe("running grounding boundaries", () => {
  it("uses the entered local date and duration while keeping resistance and calorie observations separate", async () => {
    const deps = buildDeps();
    await deps.runRepository.create(
      USER_ID,
      {
        clientOperationId: "f2160000-0000-4000-8000-000000000003",
        name: "Run",
        notes: "private notes",
        summary: createRunSummary({
          activityDate: "2026-09-10",
          recordingTimezone: "Pacific/Kiritimati",
          startedAt: null,
          durationSeconds: 5400,
          distanceMeters: null,
          environment: "outdoor",
          perceivedExertion: 5,
        }),
      },
      { accessToken: "token" },
    );
    const items = await buildCoachGrounding(deps, USER_ID, "token", NOW);
    const training = items.find((item) => item.kind === "training")!
      .data as any;
    expect(training.completedWorkoutCount).toBe(0);
    expect(training.totalSets).toBe(0);
    expect(training.running.last7Days).toEqual({
      count: 1,
      durationSeconds: 5400,
      distanceMeters: 0,
      missingDistanceCount: 1,
    });
    expect(training.running.recentRuns[0]).toMatchObject({
      activityDate: "2026-09-10",
      timePrecision: "day",
      durationSeconds: 5400,
      distanceMeters: null,
    });
    expect(JSON.stringify(training.running)).not.toContain("private notes");
    expect(training.running.calorieCredit).toBe("none");
  });
  it("excludes imported Health runs from Coach grounding", async () => {
    const deps = buildDeps();
    const imported = await deps.runRepository.importRun(
      USER_ID,
      {
        clientOperationId: "f2160000-0000-4000-8000-000000000004",
        name: "Run",
        notes: null,
        summary: createImportedRunSummary({
          provider: "apple_health",
          sourceAppId: "com.apple.health.watch",
          sourceAppName: "Apple Watch",
          externalId: "HK-private-id",
          startedAt: "2026-09-09T06:00:00Z",
          recordingTimezone: "Europe/Bratislava",
          durationSeconds: 2400,
          durationBasis: "active",
          distanceMeters: 6000,
          environment: "outdoor",
        }),
      },
      { accessToken: "token" },
    );
    expect(imported.created).toBe(true);
    const seen: RunListOptions[] = [];
    const runRepository = Object.assign(
      Object.create(Object.getPrototypeOf(deps.runRepository)),
      deps.runRepository,
      {
        // A repository that ignores the opt-in still cannot leak imports.
        list: (userId: UserId, options: RunListOptions) => {
          seen.push(options);
          return deps.runRepository.list(userId, {
            ...options,
            includeImports: true,
          });
        },
      },
    );
    for (const repo of [deps.runRepository, runRepository]) {
      const items = await buildCoachGrounding(
        { ...deps, runRepository: repo },
        USER_ID,
        "token",
        NOW,
      );
      const training = items.find((item) => item.kind === "training")!
        .data as any;
      expect(training.running.last7Days.count).toBe(0);
      expect(training.running.recentRuns).toEqual([]);
      expect(JSON.stringify(items)).not.toContain("HK-private-id");
    }
    expect(seen[0]?.includeImports).toBeUndefined();
  });
});
