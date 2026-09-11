import type { AgentGroundingItem } from "@mizyun/agent-runtime";
import {
  buildCoachingPlan,
  computeEnergy,
  summariseFoodEntries,
  summariseWeightTrend,
  type BodyMeasurementRepository,
  type FoodEntryRepository,
  type GoalRepository,
  type ProfileRepository,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";
import type { MemoryStore } from "@mizyun/memory";
import { isAvailableRoutine, toRoutineSummary } from "./routines.js";

export interface CoachGroundingDependencies {
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  /**
   * Optional. When provided, MEM-001 active memories surface as
   * `kind: "memory"` grounding items. The route filters this kind
   * out of the response's `evidenceKinds` because memory text is
   * user-edited and may contain untrusted content.
   */
  readonly memoryStore?: MemoryStore;
}

const dayIso = (date: Date): string => date.toISOString().slice(0, 10);

export const buildCoachGrounding = async (
  dependencies: CoachGroundingDependencies,
  userId: UserId,
  accessToken: string,
  now: Date,
): Promise<readonly AgentGroundingItem[]> => {
  const since = new Date(now.getTime() - 28 * 86_400_000);
  const [
    profile,
    goal,
    foodEntries,
    workouts,
    measurements,
    uncompletedWorkouts,
  ] = await Promise.all([
    dependencies.profileRepository.getOrCreate(userId, { now, accessToken }),
    dependencies.goalRepository.getActive(userId, { accessToken }),
    dependencies.foodEntryRepository.list(userId, {
      from: since,
      to: now,
      limit: 500,
      accessToken,
    }),
    dependencies.workoutRepository.list(userId, {
      from: since,
      to: now,
      limit: 100,
      accessToken,
    }),
    dependencies.bodyMeasurementRepository.list(userId, {
      from: since,
      to: now,
      limit: 100,
      accessToken,
    }),
    dependencies.workoutRepository.list(userId, {
      from: null,
      to: null,
      limit: 50,
      accessToken,
    }),
  ]);
  const todayEntries = foodEntries.filter(
    (entry) => dayIso(entry.consumedAt) === dayIso(now),
  );
  const today = dayIso(now);
  const todayNutrition = summariseFoodEntries(todayEntries, {
    from: today,
    to: today,
  })[0];

  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const recentWorkouts7Days = workouts.filter(
    (workout) =>
      workout.startedAt >= sevenDaysAgo && workout.completedAt !== null,
  );
  const recentFoodEntries7Days = foodEntries.filter(
    (entry) => entry.consumedAt >= sevenDaysAgo,
  );
  const sevenDaysNutrition = summariseFoodEntries(recentFoodEntries7Days, {
    from: dayIso(sevenDaysAgo),
    to: today,
  }).filter((day) => day.entryCount > 0);

  const totalCalories7d = sevenDaysNutrition
    .map((day) => day.caloriesKcal)
    .filter((v): v is number => v !== null);
  const totalProtein7d = sevenDaysNutrition
    .map((day) => day.proteinG)
    .filter((v): v is number => v !== null);
  const avgCalories7d =
    totalCalories7d.length > 0
      ? Math.round(
          totalCalories7d.reduce((sum, val) => sum + val, 0) /
            totalCalories7d.length,
        )
      : null;
  const avgProtein7d =
    totalProtein7d.length > 0
      ? Math.round(
          totalProtein7d.reduce((sum, val) => sum + val, 0) /
            totalProtein7d.length,
        )
      : null;

  let totalSets = 0;
  for (const workout of workouts) {
    const sets = await dependencies.workoutSetRepository.listForWorkout(
      workout.id,
      { accessToken },
    );
    totalSets += sets.length;
  }
  const bodyTrend = summariseWeightTrend(measurements);

  const isPositiveCm = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;

  const extractCircumferences = (
    raw: Readonly<Record<string, unknown>> | undefined,
  ) => {
    if (!raw || typeof raw !== "object") return null;
    const waist = raw.waist_cm ?? raw.waistCm;
    const chest = raw.chest_cm ?? raw.chestCm;
    const hips = raw.hips_cm ?? raw.hipsCm;
    const neck = raw.neck_cm ?? raw.neckCm;
    const biceps = raw.biceps_cm ?? raw.bicepsCm;
    const thighs = raw.thighs_cm ?? raw.thighsCm;
    const hasAny = [waist, chest, hips, neck, biceps, thighs].some(
      isPositiveCm,
    );
    if (!hasAny) return null;
    return {
      waistCm: isPositiveCm(waist) ? waist : null,
      chestCm: isPositiveCm(chest) ? chest : null,
      hipsCm: isPositiveCm(hips) ? hips : null,
      neckCm: isPositiveCm(neck) ? neck : null,
      bicepsCm: isPositiveCm(biceps) ? biceps : null,
      thighsCm: isPositiveCm(thighs) ? thighs : null,
    };
  };

  const latestWithCircumferences = measurements.find(
    (m) => extractCircumferences(m.measurements) !== null,
  );
  const latestCircumferences = latestWithCircumferences
    ? {
        measuredAt: latestWithCircumferences.measuredAt.toISOString(),
        ...extractCircumferences(latestWithCircumferences.measurements)!,
      }
    : null;

  const availableRoutines = uncompletedWorkouts
    .filter(isAvailableRoutine)
    .slice(0, 10)
    .map(toRoutineSummary);

  const recentWorkoutDays = new Set(
    workouts
      .filter((workout) => workout.completedAt !== null)
      .map((workout) => dayIso(workout.completedAt as Date)),
  );
  const energyResult = computeEnergy(
    {
      profile,
      latestBodyMeasurement: measurements[0] ?? null,
      activeGoal: goal,
      activityLevel: profile.activityLevel,
      sexAtBirth: profile.sexAtBirth,
      recentWorkouts: workouts,
      recentWorkoutsDayCount: recentWorkoutDays.size,
      consumedKcalToday: todayNutrition?.caloriesKcal ?? null,
      now,
    },
    userId,
  );
  const coachingPlan = buildCoachingPlan({
    energy: energyResult.breakdown,
    completedWorkoutsLast7Days: recentWorkouts7Days.length,
  });

  const dailyTargetKcal = coachingPlan.calorie?.targetKcal ?? null;
  const consumedCaloriesKcal = todayNutrition?.caloriesKcal ?? null;
  const remainingCaloriesKcal =
    dailyTargetKcal !== null
      ? Math.max(0, Math.round(dailyTargetKcal - (consumedCaloriesKcal ?? 0)))
      : null;

  const dailyProteinTargetG = coachingPlan.protein?.targetG ?? null;
  const consumedProteinG = todayNutrition?.proteinG ?? null;
  const remainingProteinG =
    dailyProteinTargetG !== null
      ? Math.max(0, Math.round(dailyProteinTargetG - (consumedProteinG ?? 0)))
      : null;

  const loggedMealsToday = todayEntries.slice(0, 20).map((entry) => ({
    id: entry.id,
    name: entry.name,
    caloriesKcal: entry.caloriesKcal,
    proteinG: entry.proteinG,
    carbohydrateG: entry.carbohydrateG,
    fatG: entry.fatG,
    consumedAt: entry.consumedAt.toISOString(),
  }));

  const items: AgentGroundingItem[] = [
    {
      kind: "profile",
      label: "Confirmed profile",
      confirmed: true,
      freshness: profile.updatedAt.toISOString(),
      data: {
        unitSystem: profile.unitSystem,
        timezone: profile.timezone,
        heightCm: profile.heightCm,
        activityLevel: profile.activityLevel,
        coachingPreferences: profile.coachingPreferences,
      },
    },
    {
      kind: "energy",
      label: "Deterministic daily energy target and metabolic breakdown",
      confirmed: true,
      freshness: now.toISOString(),
      data: {
        complete: energyResult.breakdown.complete,
        bmrKcal: energyResult.breakdown.bmrKcal,
        tdeeKcal: energyResult.breakdown.tdeeKcal,
        dailyTargetKcal: energyResult.breakdown.dailyTargetKcal,
        goalAdjustmentKcal: energyResult.breakdown.goalAdjustmentKcal,
        formulaVersion: energyResult.breakdown.formulaVersion,
      },
    },
    {
      kind: "nutrition",
      label: "Confirmed nutrition logged today and last 7 days",
      confirmed: true,
      freshness: now.toISOString(),
      data: {
        entryCount: todayNutrition?.entryCount ?? 0,
        caloriesKcal: todayNutrition?.caloriesKcal ?? null,
        targetCaloriesKcal: dailyTargetKcal,
        remainingCaloriesKcal,
        proteinG: todayNutrition?.proteinG ?? null,
        targetProteinG: dailyProteinTargetG,
        remainingProteinG,
        carbohydrateG: todayNutrition?.carbohydrateG ?? null,
        fatG: todayNutrition?.fatG ?? null,
        loggedMealsToday,
        today: {
          entryCount: todayNutrition?.entryCount ?? 0,
          consumedCaloriesKcal: consumedCaloriesKcal ?? 0,
          targetCaloriesKcal: dailyTargetKcal,
          remainingCaloriesKcal,
          consumedProteinG: consumedProteinG ?? 0,
          targetProteinG: dailyProteinTargetG,
          remainingProteinG,
          consumedCarbohydrateG: todayNutrition?.carbohydrateG ?? null,
          consumedFatG: todayNutrition?.fatG ?? null,
          loggedMeals: loggedMealsToday,
        },
        last7Days: {
          loggedDaysCount: sevenDaysNutrition.length,
          averageCaloriesKcal: avgCalories7d,
          averageProteinG: avgProtein7d,
        },
      },
    },
    {
      kind: "training",
      label: "Confirmed training in the last 28 days and last 7 days",
      confirmed: true,
      freshness: now.toISOString(),
      data: {
        workoutCount: workouts.length,
        completedWorkoutCount: workouts.filter(
          (workout) => workout.completedAt !== null,
        ).length,
        totalSets,
        latestWorkoutAt: workouts[0]?.startedAt.toISOString() ?? null,
        last7Days: {
          completedWorkoutCount: recentWorkouts7Days.length,
          completedWorkouts: recentWorkouts7Days.map((workout) => ({
            name: workout.name,
            startedAt: workout.startedAt.toISOString(),
          })),
        },
        availableRoutines,
      },
    },
    {
      kind: "body",
      label: "Deterministic weight trend from confirmed measurements",
      confirmed: true,
      freshness: measurements[0]?.measuredAt.toISOString() ?? now.toISOString(),
      data: {
        status: bodyTrend.status,
        latestWeightKg: bodyTrend.latestWeightKg,
        smoothedWeightKg: bodyTrend.smoothedWeightKg,
        weeklyChangeKg: bodyTrend.weeklyChangeKg,
        observationCount: bodyTrend.observationCount,
        latestCircumferences,
      },
    },
  ];
  if (goal !== null) {
    items.push({
      kind: "goal",
      label: "Confirmed active goal",
      confirmed: true,
      freshness: goal.updatedAt.toISOString(),
      data: {
        kind: goal.kind,
        pace: goal.pace,
        target: goal.target,
        targetDate: goal.targetDate,
      },
    });
  }

  // MEM-001 — surface active memories as `kind: "memory"`. The
  // Gemini provider already wraps memory text as untrusted data
  // inside the groundingMessage envelope, so the model treats
  // these as facts-not-instructions. The route filters
  // `kind: "memory"` out of the response's `evidenceKinds`
  // because memory text is user-edited and may be untrusted.
  if (dependencies.memoryStore !== undefined) {
    const memories = await dependencies.memoryStore.search({
      userId,
      accessToken,
      text: "",
      limit: 12,
      asOf: now,
    });
    for (const memory of memories) {
      items.push({
        kind: "memory",
        label: `Confirmed memory (${memory.kind})`,
        confirmed: true,
        freshness: memory.updatedAt.toISOString(),
        data: {
          id: memory.id,
          kind: memory.kind,
          source: memory.source,
          content: memory.content,
          confidence: memory.confidence,
          importance: memory.importance,
        },
      });
    }
  }

  return items;
};
