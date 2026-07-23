import type { AgentGroundingItem } from "@mizyun/agent-runtime";
import {
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

export interface CoachGroundingDependencies {
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
}

const dayIso = (date: Date): string => date.toISOString().slice(0, 10);

export const buildCoachGrounding = async (
  dependencies: CoachGroundingDependencies,
  userId: UserId,
  accessToken: string,
  now: Date,
): Promise<readonly AgentGroundingItem[]> => {
  const since = new Date(now.getTime() - 28 * 86_400_000);
  const [profile, goal, foodEntries, workouts, measurements] =
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
    ]);
  const todayEntries = foodEntries.filter(
    (entry) => dayIso(entry.consumedAt) === dayIso(now),
  );
  const today = dayIso(now);
  const todayNutrition = summariseFoodEntries(todayEntries, {
    from: today,
    to: today,
  })[0];
  let totalSets = 0;
  for (const workout of workouts) {
    const sets = await dependencies.workoutSetRepository.listForWorkout(
      workout.id,
      { accessToken },
    );
    totalSets += sets.length;
  }
  const bodyTrend = summariseWeightTrend(measurements);

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
      },
    },
    {
      kind: "nutrition",
      label: "Confirmed nutrition logged today",
      confirmed: true,
      freshness: now.toISOString(),
      data: {
        entryCount: todayNutrition?.entryCount ?? 0,
        caloriesKcal: todayNutrition?.caloriesKcal ?? null,
        proteinG: todayNutrition?.proteinG ?? null,
        carbohydrateG: todayNutrition?.carbohydrateG ?? null,
        fatG: todayNutrition?.fatG ?? null,
      },
    },
    {
      kind: "training",
      label: "Confirmed training in the last 28 days",
      confirmed: true,
      freshness: now.toISOString(),
      data: {
        workoutCount: workouts.length,
        completedWorkoutCount: workouts.filter(
          (workout) => workout.completedAt !== null,
        ).length,
        totalSets,
        latestWorkoutAt: workouts[0]?.startedAt.toISOString() ?? null,
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
  return items;
};
