import type { AgentGroundingItem } from "@mizyun/agent-runtime";
import {
  buildCoachingPlan,
  computeEnergy,
  readRunSummary,
  runningDate,
  summarizeRuns,
  type RunRepository,
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
import {
  localDayIso,
  localIsoWithOffset,
  summariseFoodEntriesByLocalDay,
} from "./local-time.js";
import { isAvailableRoutine, toRoutineSummary } from "./routines.js";

export interface CoachGroundingDependencies {
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly runRepository?: RunRepository;
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

// Workout day counts stay on UTC days to match GET /v1/energy/summary.
const dayIso = (date: Date): string => date.toISOString().slice(0, 10);

export const buildCoachGrounding = async (
  dependencies: CoachGroundingDependencies,
  userId: UserId,
  accessToken: string,
  now: Date,
): Promise<readonly AgentGroundingItem[]> => {
  const since = new Date(now.getTime() - 28 * 86_400_000);
  const [profile, goal, foodEntries, workouts, weightHistory, routineWorkouts] =
    await Promise.all([
      dependencies.profileRepository.getOrCreate(userId, { now, accessToken }),
      dependencies.goalRepository.getActive(userId, { accessToken }),
      dependencies.foodEntryRepository.list(userId, {
        from: since,
        to: now,
        limit: 500,
        accessToken,
      }),
      dependencies.workoutRepository.list(userId, {
        excludeNonStrength: true,
        from: since,
        to: now,
        limit: 100,
        accessToken,
      }),
      // 60 days: the energy summary's weight-trend window (ENG-07).
      dependencies.bodyMeasurementRepository.list(userId, {
        from: new Date(now.getTime() - 60 * 86_400_000),
        to: now,
        limit: 500,
        accessToken,
      }),
      dependencies.workoutRepository.list(userId, {
        excludeNonStrength: true,
        from: null,
        to: null,
        limit: 100,
        kind: "routine",
        accessToken,
      }),
    ]);
  const measurements = weightHistory
    .filter((measurement) => measurement.measuredAt >= since)
    .slice(0, 100);
  // Run dates are authoritative calendar days; transport noon is never an observation.
  const runFrom = runningDate(since, profile.timezone);
  const runTo = runningDate(now, profile.timezone);
  const runRows = dependencies.runRepository
    ? await dependencies.runRepository.list(userId, {
        from: runFrom,
        to: runTo,
        limit: 101,
        accessToken,
      })
    : [];
  // Imported Health runs are excluded from AI grounding pending a product decision;
  // the list omits them by default and this filter keeps that boundary local.
  const runs = runRows.slice(0, 100).flatMap((row) => {
    const summary = readRunSummary(row.details);
    return summary?.origin.kind === "manual" ? [{ summary }] : [];
  });
  const runLast7Days = summarizeRuns(
    runs,
    runningDate(new Date(now.getTime() - 6 * 86_400_000), profile.timezone),
    runTo,
  );
  // #310/#316: "today" is the user's calendar day, as on Home.
  const today = localDayIso(now, profile.timezone);
  const todayEntries = foodEntries.filter(
    (entry) => localDayIso(entry.consumedAt, profile.timezone) === today,
  );
  const todayNutrition = summariseFoodEntriesByLocalDay(todayEntries, {
    from: today,
    to: today,
    timeZone: profile.timezone,
  })[0];

  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const recentWorkouts7Days = workouts.filter(
    (workout) =>
      workout.startedAt >= sevenDaysAgo && workout.completedAt !== null,
  );
  const recentFoodEntries7Days = foodEntries.filter(
    (entry) => entry.consumedAt >= sevenDaysAgo,
  );
  const sevenDaysNutrition = summariseFoodEntriesByLocalDay(
    recentFoodEntries7Days,
    {
      from: localDayIso(sevenDaysAgo, profile.timezone),
      to: today,
      timeZone: profile.timezone,
    },
  ).filter((day) => day.entryCount > 0);

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

  const availableRoutines = routineWorkouts
    .filter(isAvailableRoutine)
    .slice(0, 10)
    .map(toRoutineSummary);

  const recentWorkoutDays = new Set(
    workouts
      .filter((workout) => workout.completedAt !== null)
      .map((workout) => dayIso(workout.completedAt as Date)),
  );
  // Same fallback as GET /v1/energy/summary: an older single reading
  // still feeds BMR when nothing falls inside the 60-day trend window.
  const latestMeasurement =
    weightHistory[0] ??
    (
      await dependencies.bodyMeasurementRepository.list(userId, {
        from: null,
        to: null,
        limit: 1,
        accessToken,
      })
    )[0] ??
    null;
  const energyResult = computeEnergy(
    {
      profile,
      latestBodyMeasurement: latestMeasurement,
      activeGoal: goal,
      activityLevel: profile.activityLevel,
      sexAtBirth: profile.sexAtBirth,
      recentWorkouts: workouts,
      recentWorkoutsDayCount: recentWorkoutDays.size,
      consumedKcalToday: todayNutrition?.caloriesKcal ?? null,
      now,
      weightTrend: summariseWeightTrend(weightHistory),
      calorieCalibrationKcal: goal?.calorieCalibrationKcal ?? 0,
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
    consumedAt: localIsoWithOffset(entry.consumedAt, profile.timezone),
  }));

  const items: AgentGroundingItem[] = [
    {
      kind: "profile",
      label: "Confirmed profile",
      confirmed: true,
      freshness: profile.updatedAt.toISOString(),
      data: {
        unitSystem: profile.unitSystem,
        // REL-01: no zone name (coarse location) for the provider; meal
        // times carry the local offset.
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
        running: {
          source: "user_logged_manual",
          windowFrom: runFrom,
          windowTo: runTo,
          completeness: runRows.length > 100 ? "partial" : "complete",
          last7Days: runLast7Days,
          recentRuns: runs.slice(0, 20).map(({ summary }) => ({
            activityDate: summary.activityDate,
            recordingTimezone: summary.recordingTimezone,
            timePrecision: summary.timePrecision,
            durationSeconds: summary.durationSeconds,
            distanceMeters: summary.distanceMeters,
            environment: summary.environment,
            perceivedExertion: summary.perceivedExertion,
          })),
          calorieCredit: "none",
          adviceBoundary:
            "Use running context separately from resistance progression. Do not infer start times, calories, race readiness, injury diagnosis, or medical clearance.",
        },
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
