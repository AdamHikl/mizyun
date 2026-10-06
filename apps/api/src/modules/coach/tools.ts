/**
 * AI-002 — Read-only CoachTools.
 *
 * Tools the model can call to pull additional confirmed
 * Mizyun context before producing the final answer. Every tool:
 *
 *   - validates its own args with a Zod schema (the runtime
 *     already strips `userId` from the model-visible surface);
 *   - reads through existing repository ports (`GoalRepository`,
 *     `WorkoutRepository`, etc.), never direct SQL;
 *   - returns aggregate-only data — no notes, no free text;
 *   - clamps `days_back` to 1..28 so the model cannot widen
 *     the window past the static grounding's 28-day budget.
 *
 * All four tools share `MAX_DAYS_BACK = 28` and `ACCESS_TOKEN`
 * from the verified principal. The runtime injects the principal's
 * userId, so the model cannot switch users.
 */

import {
  createAgentToolRegistryFromList,
  type AgentGroundingItem,
  type AgentTool,
  type AgentToolRegistry,
} from "@mizyun/agent-runtime";
import {
  buildCoachingPlan,
  buildDailyActionPlan,
  buildWeeklyAdaptation,
  buildTrainingPrescription,
  computeEnergy,
  findCatalogExercise,
  searchExerciseCatalog,
  summariseFoodEntries,
  summariseWeightTrend,
  systemClock,
  EQUIPMENT_OPTIONS,
  TRAINING_LIMITATION_OPTIONS,
  type BodyMeasurementRepository,
  type Clock,
  type CoachingPreferences,
  type EquipmentOption,
  type FoodEntryRepository,
  type GoalRepository,
  type MovementPattern,
  type ProfileRepository,
  type SessionFocus,
  type TrainingFocusPreference,
  type TrainingLimitation,
  type UserId,
  type WorkoutRepository,
  type RunRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";
import {
  coachActionProposalSchema,
  coachMultiWorkoutPlanProposalSchema,
  coachingPlanSchema,
  trainingPrescriptionSchema,
  type CoachActionProposal,
  type CoachMultiWorkoutPlanProposal,
  type TrainingPrescriptionResponse,
} from "@mizyun/contracts";
import { isAvailableRoutine, toRoutineSummary } from "./routines.js";
import { buildGetMealHistoryTool } from "./meal-history.js";
import { buildGetExerciseHistoryTool } from "./exercise-history.js";

export { buildGetMealHistoryTool } from "./meal-history.js";
export { buildGetExerciseHistoryTool } from "./exercise-history.js";

const MAX_DAYS_BACK = 28;
const DEFAULT_DAYS_BACK = 7;

const clampDaysBack = (raw: unknown): number => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_DAYS_BACK;
  }
  const floored = Math.floor(raw);
  if (floored < 1) return 1;
  if (floored > MAX_DAYS_BACK) return MAX_DAYS_BACK;
  return floored;
};

const extractDaysBack = (args: unknown): number => {
  if (typeof args !== "object" || args === null) return DEFAULT_DAYS_BACK;
  const raw = (args as { days_back?: unknown }).days_back;
  if (raw === undefined) return DEFAULT_DAYS_BACK;
  return clampDaysBack(raw);
};

const dayIso = (date: Date): string => date.toISOString().slice(0, 10);

const localDayIso = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const freshnessOf = (now: Date): string => now.toISOString();

interface CoachToolDeps {
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly runRepository?: RunRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  readonly clock?: Clock;
}

const resolveClock = (deps: CoachToolDeps, override?: Clock): Clock =>
  override ?? deps.clock ?? systemClock;

const loadEnergyContext = async (
  deps: CoachToolDeps,
  userId: UserId,
  accessToken: string,
  now: Date,
) => {
  const from = new Date(now.getTime() - MAX_DAYS_BACK * 86_400_000);
  const [profile, activeGoal, measurements, workouts] = await Promise.all([
    deps.profileRepository.getOrCreate(userId, { now, accessToken }),
    deps.goalRepository.getActive(userId, { accessToken }),
    deps.bodyMeasurementRepository.list(userId, {
      from,
      to: now,
      limit: 100,
      accessToken,
    }),
    deps.workoutRepository.list(userId, {
      excludeRunning: true,
      from,
      to: now,
      limit: 100,
      accessToken,
    }),
  ]);
  const recentWorkoutDays = new Set(
    workouts
      .filter((workout) => workout.completedAt !== null)
      .map((workout) => dayIso(workout.completedAt as Date)),
  );
  const breakdown = computeEnergy(
    {
      profile,
      latestBodyMeasurement: measurements[0] ?? null,
      activeGoal,
      activityLevel: profile.activityLevel,
      sexAtBirth: profile.sexAtBirth,
      recentWorkouts: workouts,
      recentWorkoutsDayCount: recentWorkoutDays.size,
      consumedKcalToday: null,
      now,
    },
    userId,
  ).breakdown;

  return { breakdown, workouts, profile, activeGoal, measurements };
};

const energyData = (
  breakdown: Awaited<ReturnType<typeof loadEnergyContext>>["breakdown"],
) => ({
  formulaVersion: breakdown.formulaVersion,
  computedAt: breakdown.computedAt.toISOString(),
  complete: breakdown.complete,
  incompleteReason: breakdown.incompleteReason,
  ageYears: breakdown.ageYears,
  bmrKcal: breakdown.bmrKcal,
  activityMultiplier: breakdown.activityMultiplier,
  tdeeKcal: breakdown.tdeeKcal,
  exerciseKcal: breakdown.exerciseKcal,
  goalAdjustmentKcal: breakdown.goalAdjustmentKcal,
  dailyTargetKcal: breakdown.dailyTargetKcal,
  inputs: breakdown.inputs,
});

export const buildTrainingPrescriptionForUser = async (
  deps: Pick<
    CoachToolDeps,
    | "profileRepository"
    | "goalRepository"
    | "workoutRepository"
    | "workoutSetRepository"
  >,
  userId: UserId,
  accessToken: string,
  now: Date,
  options?: {
    readonly preferenceOverride?: Partial<CoachingPreferences>;
    /**
     * Optional per-session focus distribution. When supplied, the
     * engine filters movement patterns to upper or lower body per
     * session and labels each session accordingly. See
     * `extractSessionDistribution` in `multi-workout-action.ts`.
     */
    readonly sessionDistribution?: readonly SessionFocus[];
  },
) => {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const [profile, goal, workouts] = await Promise.all([
    deps.profileRepository.getOrCreate(userId, { now, accessToken }),
    deps.goalRepository.getActive(userId, { accessToken }),
    deps.workoutRepository.list(userId, {
      excludeRunning: true,
      from,
      to: now,
      limit: 100,
      accessToken,
    }),
  ]);
  const completedWorkouts = workouts.filter(
    (workout) => workout.completedAt !== null,
  );
  const sets = (
    await Promise.all(
      completedWorkouts.map((workout) =>
        deps.workoutSetRepository.listForWorkout(workout.id, {
          accessToken,
        }),
      ),
    )
  ).flat();
  const rpeValues = sets
    .map((set) => set.perceivedExertion)
    .filter((value): value is number => value !== null);
  const averageRpeLast7Days =
    rpeValues.length === 0
      ? null
      : Math.round(
          (rpeValues.reduce((total, value) => total + value, 0) /
            rpeValues.length) *
            10,
        ) / 10;
  const preferences: CoachingPreferences = {
    ...profile.coachingPreferences,
    ...(options?.preferenceOverride ?? {}),
  };
  const prescription = buildTrainingPrescription({
    goalKind: goal?.kind ?? null,
    preferences,
    completedSessionsLast7Days: completedWorkouts.length,
    completedSetsLast7Days: sets.length,
    averageRpeLast7Days,
    now,
    ...(options?.sessionDistribution === undefined
      ? {}
      : { sessionDistribution: options.sessionDistribution }),
  });
  return trainingPrescriptionSchema.parse({
    ...prescription,
    computedAt: prescription.computedAt.toISOString(),
    sessions: prescription.sessions.map((session) => ({
      ...session,
      exercises: session.exercises.map((exercise) => ({
        ...exercise,
        equipment: [...exercise.equipment],
      })),
    })),
  });
};

export const buildDailyActionPlanForUser = async (
  deps: CoachToolDeps,
  userId: UserId,
  accessToken: string,
  now: Date,
) => {
  const { breakdown, workouts, profile } = await loadEnergyContext(
    deps,
    userId,
    accessToken,
    now,
  );
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const completedWorkouts = workouts.filter(
    (workout) =>
      workout.completedAt !== null &&
      workout.completedAt >= sevenDaysAgo &&
      workout.completedAt <= now,
  );
  const coachingPlan = buildCoachingPlan({
    energy: breakdown,
    completedWorkoutsLast7Days: completedWorkouts.length,
  });
  const today = localDayIso(now, profile.timezone);
  const entries = await deps.foodEntryRepository.list(userId, {
    from: new Date(now.getTime() - 36 * 3_600_000),
    to: now,
    limit: 500,
    accessToken,
  });
  const summary = summariseFoodEntries(
    entries.filter(
      (entry) => localDayIso(entry.consumedAt, profile.timezone) === today,
    ),
    { from: today, to: today },
  )[0];
  const daily = buildDailyActionPlan({
    plan: coachingPlan,
    date: today,
    consumedKcal: summary?.caloriesKcal ?? null,
    consumedProteinG: summary?.proteinG ?? null,
    completedWorkoutToday: completedWorkouts.some(
      (workout) =>
        workout.completedAt !== null &&
        localDayIso(workout.completedAt, profile.timezone) === today,
    ),
  });
  const { computedAt: _computedAt, ...proposal } = daily;
  return proposal;
};

export const buildWeeklyAdaptationForUser = async (
  deps: CoachToolDeps,
  userId: UserId,
  accessToken: string,
  now: Date,
) => {
  const { breakdown, profile, activeGoal, measurements } =
    await loadEnergyContext(deps, userId, accessToken, now);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const workoutsLast7Days = await deps.workoutRepository.list(userId, {
    excludeRunning: true,
    from: sevenDaysAgo,
    to: now,
    limit: 50,
    accessToken,
  });
  const completedWorkoutsLast7Days = workoutsLast7Days.filter(
    (w) => w.completedAt !== null,
  ).length;
  const coachingPlan = buildCoachingPlan({
    energy: breakdown,
    completedWorkoutsLast7Days,
  });
  const prescription = await buildTrainingPrescriptionForUser(
    deps,
    userId,
    accessToken,
    now,
  );
  const entries = await deps.foodEntryRepository.list(userId, {
    from: new Date(now.getTime() - 8 * 86_400_000),
    to: now,
    limit: 500,
    accessToken,
  });
  const today = localDayIso(now, profile.timezone);
  const firstDay = localDayIso(
    new Date(now.getTime() - 7 * 86_400_000),
    profile.timezone,
  );
  const buckets = new Map<string, typeof entries>();
  for (const entry of entries) {
    const date = localDayIso(entry.consumedAt, profile.timezone);
    if (date < firstDay || date >= today) continue;
    buckets.set(date, [...(buckets.get(date) ?? []), entry]);
  }
  const sum = (values: readonly (number | null)[]): number | null =>
    values.length === 0 || values.some((value) => value === null)
      ? null
      : Math.round(
          values.reduce<number>((total, value) => total + (value ?? 0), 0) *
            100,
        ) / 100;
  const nutritionDays = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dayEntries]) => ({
      date,
      entryCount: dayEntries.length,
      caloriesKcal: sum(dayEntries.map((entry) => entry.caloriesKcal)),
      proteinG: sum(dayEntries.map((entry) => entry.proteinG)),
      carbohydrateG: sum(dayEntries.map((entry) => entry.carbohydrateG)),
      fatG: sum(dayEntries.map((entry) => entry.fatG)),
    }));
  const adaptation = buildWeeklyAdaptation({
    goalKind: activeGoal?.kind ?? null,
    currentPace: activeGoal?.pace ?? null,
    targetKcal: coachingPlan.calorie?.targetKcal ?? null,
    targetProteinG: coachingPlan.protein?.targetG ?? null,
    nutritionDays,
    weightTrend: summariseWeightTrend(measurements),
    trainingVolumeAction: prescription.volumeAction,
    completedWorkoutsLast7Days,
    now,
  });
  const { computedAt: _computedAt, ...proposal } = adaptation;
  return {
    ...proposal,
    goalId: activeGoal?.id ?? null,
  };
};

/**
 * Tool: get_active_goal
 *
 * Returns the user's current active goal, if any. Aggregates the
 * kind, pace, target, and target date — never the notes or free
 * text.
 */
export const buildGetActiveGoalTool = (
  deps: CoachToolDeps,
): AgentTool<Record<string, never>> => ({
  name: "get_active_goal",
  description:
    "Return the user's current active goal as aggregate fields (kind, pace, target, target_date). Returns null fields when no goal is active.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  execute: async ({ principalUserId, accessToken }) => {
    const goal = await deps.goalRepository.getActive(principalUserId, {
      accessToken,
    });
    if (goal === null) {
      return {
        kind: "goal",
        label: "Confirmed active goal",
        confirmed: true,
        freshness: freshnessOf(new Date()),
        data: {
          active: false,
        },
      };
    }
    return {
      kind: "goal",
      label: "Confirmed active goal",
      confirmed: true,
      freshness: freshnessOf(goal.updatedAt),
      data: {
        active: true,
        kind: goal.kind,
        pace: goal.pace,
        target: goal.target,
        targetDate: goal.targetDate,
        updatedAt: goal.updatedAt.toISOString(),
      },
    } satisfies AgentGroundingItem;
  },
});

/**
 * Tool: get_recent_workouts(days_back)
 *
 * Returns daily aggregate counts of completed workouts and total
 * sets in the window. `days_back` is clamped to 1..28.
 */
export const buildGetRecentWorkoutsTool = (
  deps: CoachToolDeps,
): AgentTool<{ days_back?: number | undefined }> => {
  return {
    name: "get_recent_workouts",
    description:
      "Return training activity (completed workouts, session names, duration, and set counts) within the last days_back days (1..28).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        days_back: {
          type: "integer",
          minimum: 1,
          maximum: MAX_DAYS_BACK,
          default: DEFAULT_DAYS_BACK,
          description:
            "Number of days to look back. Clamped to 1..28; default 7.",
        },
      },
    },
    execute: async ({ principalUserId, args, accessToken, clock }) => {
      const daysBack = extractDaysBack(args);
      const now = resolveClock(deps, clock).now();
      const from = new Date(now.getTime() - daysBack * 86_400_000);
      const workouts = await deps.workoutRepository.list(principalUserId, {
        excludeRunning: true,
        from,
        to: now,
        limit: 100,
        accessToken,
      });
      let totalSets = 0;
      for (const workout of workouts) {
        const sets = await deps.workoutSetRepository.listForWorkout(
          workout.id,
          { accessToken },
        );
        totalSets += sets.length;
      }
      const dailyCounts = new Map<string, number>();
      for (const workout of workouts) {
        if (workout.completedAt === null) continue;
        const key = dayIso(workout.completedAt);
        dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
      }
      const dailyWorkouts = [...dailyCounts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([day, count]) => ({ day, completedCount: count }));

      const recentCompletedWorkouts = workouts
        .filter((w) => w.completedAt !== null)
        .slice(0, 20)
        .map((w) => ({
          id: w.id,
          name: w.name,
          startedAt: w.startedAt.toISOString(),
          completedAt: (w.completedAt as Date).toISOString(),
          durationMinutes: Math.max(
            0,
            Math.round(
              ((w.completedAt as Date).getTime() - w.startedAt.getTime()) /
                60_000,
            ),
          ),
        }));

      return {
        kind: "training",
        label: "Confirmed training in the window",
        confirmed: true,
        freshness: freshnessOf(now),
        data: {
          daysBack,
          windowStart: from.toISOString(),
          windowEnd: now.toISOString(),
          completedWorkouts: workouts.filter((w) => w.completedAt !== null)
            .length,
          totalWorkouts: workouts.length,
          totalSets,
          dailyWorkouts,
          recentCompletedWorkouts,
        },
      } satisfies AgentGroundingItem;
    },
  };
};

/**
 * Tool: get_available_routines(routine_name)
 *
 * Returns the user's saved/available workout routines and planned sessions
 * (uncompleted workouts with planned exercises in details).
 */
export const buildGetAvailableRoutinesTool = (
  deps: CoachToolDeps,
): AgentTool<{ routine_name?: string | undefined }> => {
  return {
    name: "get_available_routines",
    description:
      "Retrieve the user's saved or available workout routines and planned exercise sessions (e.g. Push, Pull, Legs, Upper, Lower), including exercise names, target sets, reps, target loads, and rest periods.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        routine_name: {
          type: "string",
          description:
            "Optional case-insensitive routine name to filter by (e.g. 'Push 1', 'Upper', 'Legs'). If omitted, all available routines are returned.",
        },
      },
    },
    execute: async ({ principalUserId, args, accessToken, clock }) => {
      const now = resolveClock(deps, clock).now();
      const workouts = await deps.workoutRepository.list(principalUserId, {
        excludeRunning: true,
        from: null,
        to: null,
        limit: 100,
        kind: "routine",
        accessToken,
      });

      const filterName =
        typeof args === "object" &&
        args !== null &&
        typeof (args as { routine_name?: unknown }).routine_name === "string"
          ? (args as { routine_name: string }).routine_name.trim().toLowerCase()
          : null;

      let routines = workouts.filter(isAvailableRoutine).map(toRoutineSummary);

      if (filterName !== null && filterName.length > 0) {
        routines = routines.filter((r) =>
          r.name.toLowerCase().includes(filterName),
        );
      }

      return {
        kind: "training",
        label: "User's saved workout routines in Available Routines",
        confirmed: true,
        freshness: freshnessOf(now),
        data: {
          routineCount: routines.length,
          routines,
        },
      } satisfies AgentGroundingItem;
    },
  };
};

/**
 * Tool: get_recent_measurements(days_back)
 *
 * Returns daily weight measurements (in kg) within the window.
 * The user's `unitSystem` lives on the profile, which is fetched
 * by the route and passed in via `principalUserId` lookups; the
 * tool reports canonical kg regardless.
 */
export const buildGetRecentMeasurementsTool = (
  deps: CoachToolDeps,
): AgentTool<{ days_back?: number | undefined }> => {
  return {
    name: "get_recent_measurements",
    description:
      "Return daily weight (canonical kilograms) and body circumference measurements (waist, chest, hips in cm) within the last days_back days (1..28). Excludes notes and free text.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        days_back: {
          type: "integer",
          minimum: 1,
          maximum: MAX_DAYS_BACK,
          default: DEFAULT_DAYS_BACK,
          description:
            "Number of days to look back. Clamped to 1..28; default 7.",
        },
      },
    },
    execute: async ({ principalUserId, args, accessToken, clock }) => {
      const daysBack = extractDaysBack(args);
      const now = resolveClock(deps, clock).now();
      const from = new Date(now.getTime() - daysBack * 86_400_000);
      const measurements = await deps.bodyMeasurementRepository.list(
        principalUserId,
        { from, to: now, limit: 100, accessToken },
      );

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

      const daily = measurements
        .filter(
          (m) =>
            typeof m.weightKg === "number" ||
            extractCircumferences(m.measurements) !== null,
        )
        .map((m) => ({
          day: dayIso(m.measuredAt),
          weightKg: m.weightKg,
          circumferences: extractCircumferences(m.measurements),
        }));

      const latestWithCircumferences = measurements.find(
        (m) => extractCircumferences(m.measurements) !== null,
      );
      const latestCircumferences = latestWithCircumferences
        ? {
            measuredAt: latestWithCircumferences.measuredAt.toISOString(),
            ...extractCircumferences(latestWithCircumferences.measurements)!,
          }
        : null;

      const summary = summariseWeightTrend(measurements);
      return {
        kind: "body",
        label: "Confirmed weight and circumference measurements in the window",
        confirmed: true,
        freshness: freshnessOf(now),
        data: {
          daysBack,
          windowStart: from.toISOString(),
          windowEnd: now.toISOString(),
          observationCount: summary.observationCount,
          latestWeightKg: summary.latestWeightKg,
          smoothedWeightKg: summary.smoothedWeightKg,
          weeklyChangeKg: summary.weeklyChangeKg,
          status: summary.status,
          latestCircumferences,
          measurements: daily,
        },
      } satisfies AgentGroundingItem;
    },
  };
};

/**
 * Tool: get_recent_food_entries(days_back)
 *
 * Returns daily food totals (calories, protein, carbs, fat) and
 * entry counts within the window. Excludes notes and free text.
 */
export const buildGetRecentFoodEntriesTool = (
  deps: CoachToolDeps,
): AgentTool<{ days_back?: number | undefined }> => {
  return {
    name: "get_recent_food_entries",
    description:
      "Return daily food totals (calories, protein, carbs, fat) and entry counts within the last days_back days (1..28). Excludes notes and free text.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        days_back: {
          type: "integer",
          minimum: 1,
          maximum: MAX_DAYS_BACK,
          default: DEFAULT_DAYS_BACK,
          description:
            "Number of days to look back. Clamped to 1..28; default 7.",
        },
      },
    },
    execute: async ({ principalUserId, args, accessToken, clock }) => {
      const daysBack = extractDaysBack(args);
      const now = resolveClock(deps, clock).now();
      const from = new Date(now.getTime() - daysBack * 86_400_000);
      const entries = await deps.foodEntryRepository.list(principalUserId, {
        from,
        to: now,
        limit: 500,
        accessToken,
      });
      const dailyMap = new Map<
        string,
        {
          entryCount: number;
          caloriesKcal: number;
          proteinG: number;
          carbohydrateG: number;
          fatG: number;
        }
      >();
      for (const entry of entries) {
        const key = dayIso(entry.consumedAt);
        const existing = dailyMap.get(key) ?? {
          entryCount: 0,
          caloriesKcal: 0,
          proteinG: 0,
          carbohydrateG: 0,
          fatG: 0,
        };
        existing.entryCount += 1;
        if (entry.caloriesKcal !== null) {
          existing.caloriesKcal += entry.caloriesKcal;
        }
        if (entry.proteinG !== null) existing.proteinG += entry.proteinG;
        if (entry.carbohydrateG !== null)
          existing.carbohydrateG += entry.carbohydrateG;
        if (entry.fatG !== null) existing.fatG += entry.fatG;
        dailyMap.set(key, existing);
      }
      const today = dayIso(now);
      const todaysSummary =
        summariseFoodEntries(entries, { from: today, to: today })[0] ?? null;
      const daily = [...dailyMap.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([day, totals]) => ({ day, ...totals }));
      return {
        kind: "nutrition",
        label: "Confirmed nutrition in the window",
        confirmed: true,
        freshness: freshnessOf(now),
        data: {
          daysBack,
          windowStart: from.toISOString(),
          windowEnd: now.toISOString(),
          totalEntries: entries.length,
          daily,
          today:
            todaysSummary === null
              ? null
              : {
                  day: todaysSummary.date,
                  entryCount: todaysSummary.entryCount,
                  caloriesKcal: todaysSummary.caloriesKcal,
                  proteinG: todaysSummary.proteinG,
                  carbohydrateG: todaysSummary.carbohydrateG,
                  fatG: todaysSummary.fatG,
                },
        },
      } satisfies AgentGroundingItem;
    },
  };
};

/**
 * Tool: compute_energy
 *
 * Returns the deterministic Mifflin-St Jeor energy breakdown.
 * The application service loads confirmed records, then delegates
 * all arithmetic to the pure core function.
 */
export const buildComputeEnergyTool = (
  deps: CoachToolDeps,
): AgentTool<Record<string, never>> => ({
  name: "compute_energy",
  description:
    "Return a deterministic energy breakdown (BMR, TDEE, goal adjustment, and daily target) calculated from the user's confirmed profile, measurement, and active goal. Returns null fields when inputs are missing.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  execute: async ({ principalUserId, accessToken, clock }) => {
    const now = resolveClock(deps, clock).now();
    const { breakdown } = await loadEnergyContext(
      deps,
      principalUserId,
      accessToken,
      now,
    );
    return {
      kind: "energy",
      label: "Deterministic energy breakdown",
      confirmed: true,
      freshness: freshnessOf(now),
      data: energyData(breakdown),
    } satisfies AgentGroundingItem;
  },
});

/**
 * Tool: get_coaching_plan
 *
 * Combines the deterministic energy result with conservative
 * protein and training targets. The model explains this result;
 * it does not own the arithmetic.
 */
export const buildGetCoachingPlanTool = (
  deps: CoachToolDeps,
): AgentTool<Record<string, never>> => ({
  name: "get_coaching_plan",
  description:
    "Return the user's deterministic calorie target, protein range and target, and goal-specific base training focus from confirmed profile, measurement, goal, and workout data. Returns typed missing inputs rather than guessing.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  execute: async ({ principalUserId, accessToken, clock }) => {
    const now = resolveClock(deps, clock).now();
    const { breakdown, workouts } = await loadEnergyContext(
      deps,
      principalUserId,
      accessToken,
      now,
    );
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const completedWorkoutsLast7Days = workouts.filter(
      (workout) =>
        workout.completedAt !== null &&
        workout.completedAt >= sevenDaysAgo &&
        workout.completedAt <= now,
    ).length;
    const plan = buildCoachingPlan({
      energy: breakdown,
      completedWorkoutsLast7Days,
    });
    const data = coachingPlanSchema.parse({
      ...plan,
      computedAt: plan.computedAt.toISOString(),
    });
    return {
      kind: "plan",
      label: "Deterministic calorie, protein, and training plan",
      confirmed: true,
      freshness: freshnessOf(now),
      data,
    } satisfies AgentGroundingItem;
  },
});

export const buildMultiWorkoutProposalFromPrescription = (
  prescription: TrainingPrescriptionResponse["prescription"],
  now: Date,
  options?: {
    readonly requestedSessions?: number;
    readonly sessionMinutes?: number;
    readonly focus?: string | null;
    readonly sessionDistribution?: readonly SessionFocus[] | null;
  },
): CoachMultiWorkoutPlanProposal => {
  const requestedSessions = Math.min(
    Math.max(1, options?.requestedSessions ?? prescription.sessions.length),
    7,
  );
  const sessionsToReturn = prescription.sessions.slice(0, requestedSessions);
  const startDay = new Date(now.getTime());
  const stepDays = Math.max(
    1,
    Math.floor(7 / Math.max(sessionsToReturn.length, 1)),
  );
  const sessionsWithDays = sessionsToReturn.map((session, idx) => {
    const day = new Date(startDay.getTime() + idx * stepDays * 86_400_000);
    const targetDay = day.toISOString().slice(0, 10);
    const sessionFocus =
      options?.sessionDistribution?.[idx] ?? options?.focus ?? null;
    return {
      ...session,
      focus: sessionFocus,
      targetDay,
    };
  });
  const endDay =
    sessionsWithDays[sessionsWithDays.length - 1]?.targetDay ??
    startDay.toISOString().slice(0, 10);
  const sessionMinutes =
    options?.sessionMinutes ?? sessionsToReturn[0]?.estimatedMinutes ?? 60;
  return coachMultiWorkoutPlanProposalSchema.parse({
    id: crypto.randomUUID(),
    kind: "multi_workout_plan",
    prescriptionVersion: prescription.version,
    volumeAction: prescription.volumeAction,
    focus: options?.focus ?? null,
    requestedSessions: sessionsToReturn.length,
    sessionMinutes,
    rationale:
      prescription.assumptions[0] ??
      `Built ${sessionsToReturn.length} sessions of about ${sessionMinutes} minutes from your confirmed goal, equipment, and recent load.`,
    sessions: sessionsWithDays,
    startDay: startDay.toISOString().slice(0, 10),
    endDay,
  });
};

export interface GetTrainingPrescriptionArgs {
  readonly days_per_week?: number;
  readonly session_duration_minutes?: number;
  readonly session_distribution?: readonly SessionFocus[];
  readonly training_focus?: TrainingFocusPreference;
  readonly available_equipment?: readonly EquipmentOption[];
  readonly limitations?: readonly TrainingLimitation[];
}

const normalizeEquipmentItem = (raw: unknown): EquipmentOption | null => {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim();
  if (s === "dumbbell" || s === "dumbbells") return "dumbbells";
  if (s === "barbell" || s === "barbells") return "barbell";
  if (s === "bench" || s === "workout bench") return "bench";
  if (s === "rack" || s === "squat rack" || s === "power rack") return "rack";
  if (
    s === "cable" ||
    s === "cables" ||
    s === "cable_machine" ||
    s === "cable machine"
  )
    return "cable_machine";
  if (
    s === "band" ||
    s === "bands" ||
    s === "resistance_bands" ||
    s === "resistance bands"
  )
    return "resistance_bands";
  if (
    s === "pullup_bar" ||
    s === "pull up bar" ||
    s === "pull-up bar" ||
    s === "pullup bar"
  )
    return "pullup_bar";
  if (
    s === "cardio_machine" ||
    s === "cardio machine" ||
    s === "treadmill" ||
    s === "bike"
  )
    return "cardio_machine";
  if (s === "full_gym" || s === "gym") return "full_gym";
  if (s === "bodyweight") return "bodyweight";
  return (EQUIPMENT_OPTIONS as readonly string[]).includes(s)
    ? (s as EquipmentOption)
    : null;
};

const normalizeFocusPreference = (
  raw: unknown,
): TrainingFocusPreference | null => {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim();
  if (
    s.includes("hypertrophy") ||
    s.includes("v-shape") ||
    s.includes("v shape") ||
    s.includes("muscle") ||
    s.includes("bulk")
  ) {
    return "hypertrophy";
  }
  if (s.includes("strength") || s.includes("power")) {
    return "strength";
  }
  if (
    s.includes("endurance") ||
    s.includes("stamina") ||
    s.includes("cardio")
  ) {
    return "endurance";
  }
  if (s.includes("balanced") || s.includes("general")) {
    return "balanced";
  }
  return null;
};

const normalizeSessionDistributionItem = (
  raw: unknown,
): SessionFocus | null => {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim();
  if (s.includes("upper")) return "upper";
  if (s.includes("lower") || s.includes("leg")) return "lower";
  if (s.includes("full")) return "full";
  return null;
};

const normalizeLimitation = (raw: unknown): TrainingLimitation | null => {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim();
  return ((TRAINING_LIMITATION_OPTIONS as readonly string[]).find(
    (v) => v === s,
  ) ?? null) as TrainingLimitation | null;
};

export const buildGetTrainingPrescriptionTool = (
  deps: CoachToolDeps,
): AgentTool<GetTrainingPrescriptionArgs> => ({
  name: "get_training_prescription",
  description:
    "Build and return a deterministic, safe exercise prescription using the user's confirmed goal, experience, schedule, equipment, movement constraints, and recent session/set/RPE load. Pass explicit parameters (days_per_week, session_duration_minutes, session_distribution, training_focus, available_equipment, limitations) when requested by the user.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      days_per_week: {
        type: "integer",
        minimum: 1,
        maximum: 7,
        description:
          "Target number of training sessions or days per week (1 to 7).",
      },
      session_duration_minutes: {
        type: "integer",
        minimum: 15,
        maximum: 180,
        description:
          "Target duration per workout session in minutes (e.g. 30, 45, 60, 90, 120, 150).",
      },
      session_distribution: {
        type: "array",
        items: {
          type: "string",
          enum: ["upper", "lower", "full"],
        },
        description:
          "Per-session focus distribution across days (e.g. ['upper', 'upper', 'lower'] for two upper and one lower body day).",
      },
      training_focus: {
        type: "string",
        enum: ["balanced", "strength", "hypertrophy", "endurance"],
        description:
          "Target training style / focus (use 'hypertrophy' for muscle building / V-shape, 'strength', 'endurance', 'balanced').",
      },
      available_equipment: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "bodyweight",
            "dumbbells",
            "barbell",
            "bench",
            "rack",
            "cable_machine",
            "resistance_bands",
            "pullup_bar",
            "cardio_machine",
            "full_gym",
          ],
        },
        description:
          "Available equipment for the plan (e.g. ['dumbbells', 'barbell', 'cable_machine', 'bench', 'pullup_bar']).",
      },
      limitations: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "low_impact_only",
            "no_overhead_work",
            "no_running",
            "no_jumping",
            "limited_knee_flexion",
            "limited_spinal_loading",
          ],
        },
        description: "Movement limitations or constraints to avoid.",
      },
    },
  },
  execute: async ({ principalUserId, args, accessToken, clock }) => {
    const now = resolveClock(deps, clock).now();
    const typedArgs = (args ?? {}) as Partial<GetTrainingPrescriptionArgs>;

    const preferenceOverride: {
      trainingDaysPerWeek?: number;
      sessionDurationMinutes?: number;
      trainingFocus?: TrainingFocusPreference;
      availableEquipment?: readonly EquipmentOption[];
      trainingLimitations?: readonly TrainingLimitation[];
    } = {};
    if (typeof typedArgs.days_per_week === "number") {
      preferenceOverride.trainingDaysPerWeek = Math.max(
        1,
        Math.min(7, Math.round(typedArgs.days_per_week)),
      );
    }
    if (typeof typedArgs.session_duration_minutes === "number") {
      preferenceOverride.sessionDurationMinutes = Math.max(
        15,
        Math.min(180, Math.round(typedArgs.session_duration_minutes)),
      );
    }
    if (typedArgs.training_focus !== undefined) {
      const focus = normalizeFocusPreference(typedArgs.training_focus);
      if (focus !== null) {
        preferenceOverride.trainingFocus = focus;
      }
    }
    if (Array.isArray(typedArgs.available_equipment)) {
      const normalizedEquipment = typedArgs.available_equipment
        .map(normalizeEquipmentItem)
        .filter((eq): eq is EquipmentOption => eq !== null);
      if (normalizedEquipment.length > 0) {
        preferenceOverride.availableEquipment = Array.from(
          new Set(normalizedEquipment),
        );
      }
    }
    if (Array.isArray(typedArgs.limitations)) {
      const normalizedLimitations = typedArgs.limitations
        .map(normalizeLimitation)
        .filter((lim): lim is TrainingLimitation => lim !== null);
      if (normalizedLimitations.length > 0) {
        preferenceOverride.trainingLimitations = Array.from(
          new Set(normalizedLimitations),
        );
      }
    }

    const sessionDistribution = Array.isArray(typedArgs.session_distribution)
      ? typedArgs.session_distribution
          .map(normalizeSessionDistributionItem)
          .filter((dist): dist is SessionFocus => dist !== null)
      : undefined;

    const data = await buildTrainingPrescriptionForUser(
      deps,
      principalUserId,
      accessToken,
      now,
      {
        preferenceOverride,
        ...(sessionDistribution && sessionDistribution.length > 0
          ? { sessionDistribution }
          : {}),
      },
    );

    let actionProposal: CoachActionProposal | null = null;
    if (data.sessions.length > 0) {
      if (data.sessions.length === 1 && typedArgs.days_per_week === 1) {
        actionProposal = coachActionProposalSchema.parse({
          id: crypto.randomUUID(),
          kind: "workout_start",
          prescriptionVersion: data.version,
          volumeAction: data.volumeAction,
          session: data.sessions[0],
        });
      } else {
        const proposal = buildMultiWorkoutProposalFromPrescription(data, now, {
          requestedSessions: typedArgs.days_per_week ?? data.sessions.length,
          sessionMinutes:
            typedArgs.session_duration_minutes ??
            data.sessions[0]?.estimatedMinutes ??
            60,
          focus: typedArgs.training_focus ?? null,
          sessionDistribution: sessionDistribution ?? null,
        });
        actionProposal = proposal;
      }
    }

    return {
      kind: "plan",
      label: "Deterministic weekly training prescription",
      confirmed: true,
      freshness: freshnessOf(now),
      data: {
        ...data,
        actionProposal,
      },
    } satisfies AgentGroundingItem;
  },
});

export interface SearchExercisesArgs {
  readonly query?: string;
  readonly movement_pattern?: string;
  readonly category?: string;
  readonly limit?: number;
}

export const buildSearchExercisesTool = (
  deps: CoachToolDeps,
): AgentTool<SearchExercisesArgs> => ({
  name: "search_exercises",
  description:
    "Search through the 888 verified exercises in the Mizyun library by name, keyword (e.g. 'incline bench', 'cable fly', 'lateral raise', 'curl', 'squat', 'romanian deadlift', 'pullup', 'tricep pushdown', 'bicep', 'quads'), movement pattern, or category.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description:
          "Keywords or exercise name to search for (e.g. 'incline dumbbell', 'lateral raise', 'cable', 'romanian deadlift', 'hammer curl').",
      },
      movement_pattern: {
        type: "string",
        enum: [
          "knee_dominant",
          "hip_hinge",
          "horizontal_push",
          "horizontal_pull",
          "vertical_push",
          "vertical_pull",
          "core",
          "aerobic",
          "mobility",
        ],
        description: "Filter by movement pattern category.",
      },
      category: {
        type: "string",
        description:
          "Filter by category (e.g. 'strength', 'stretching', 'cardio', 'plyometrics', 'powerlifting', 'strongman').",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 25,
        description:
          "Maximum number of exercise results to return (default 10).",
      },
    },
  },
  execute: async ({ clock, args }) => {
    const now = resolveClock(deps, clock).now();
    const typedArgs = (args ?? {}) as Partial<SearchExercisesArgs>;
    const exercises = searchExerciseCatalog({
      query: typedArgs.query,
      movementPattern: typedArgs.movement_pattern as
        MovementPattern | undefined,
      category: typedArgs.category,
      limit: Math.min(25, typedArgs.limit ?? 10),
    });
    return {
      kind: "training",
      label: "Exercise library search results",
      confirmed: true,
      freshness: freshnessOf(now),
      data: {
        count: exercises.length,
        exercises: exercises.map((ex) => ({
          id: ex.id,
          name: ex.name,
          movementPattern: ex.movementPattern,
          equipment: ex.equipment,
          primaryMuscles: ex.primaryMuscles,
          instructions: ex.instructions.slice(0, 3),
        })),
      },
    } satisfies AgentGroundingItem;
  },
});

export interface ProposeWorkoutPlanExerciseInput {
  readonly name: string;
  readonly sets?: number;
  readonly reps_min?: number | null;
  readonly reps_max?: number | null;
  readonly duration_minutes?: number | null;
  readonly rest_seconds?: number;
  readonly notes?: string | null;
}

export interface ProposeWorkoutPlanSessionInput {
  readonly label: string;
  readonly focus?: string | null;
  readonly estimated_minutes?: number;
  readonly exercises: readonly ProposeWorkoutPlanExerciseInput[];
}

export interface ProposeWorkoutPlanArgs {
  readonly rationale: string;
  readonly sessions: readonly ProposeWorkoutPlanSessionInput[];
  readonly volume_action?: "build" | "hold" | "reduce";
}

const resolveProposedExercise = (
  input: ProposeWorkoutPlanExerciseInput,
): {
  catalogId: string;
  name: string;
  movementPattern: MovementPattern;
  equipment: EquipmentOption[];
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  durationMinutes: number | null;
  restSeconds: number;
  progression: "double_progression" | "time_progression";
} => {
  const matched = findCatalogExercise(input.name);
  const catalogId =
    matched?.id ??
    input.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-");
  const name = matched?.name ?? input.name.trim();
  const movementPattern = matched?.movementPattern ?? "horizontal_push";
  const equipment =
    matched?.equipment && matched.equipment.length > 0
      ? [...matched.equipment]
      : (["dumbbells"] as EquipmentOption[]);

  const sets = Math.min(5, Math.max(1, Math.round(input.sets ?? 3)));
  const durationMinutes =
    typeof input.duration_minutes === "number" && input.duration_minutes > 0
      ? Math.round(input.duration_minutes)
      : null;
  const repsMin =
    durationMinutes !== null
      ? null
      : typeof input.reps_min === "number"
        ? Math.max(1, Math.min(100, Math.round(input.reps_min)))
        : 8;
  const repsMax =
    durationMinutes !== null
      ? null
      : typeof input.reps_max === "number"
        ? Math.max(1, Math.min(100, Math.round(input.reps_max)))
        : repsMin !== null
          ? Math.max(repsMin, repsMin + 2)
          : 12;
  const restSeconds =
    typeof input.rest_seconds === "number"
      ? Math.max(0, Math.min(600, Math.round(input.rest_seconds)))
      : repsMin !== null && repsMin <= 5
        ? 150
        : 90;
  const progression =
    durationMinutes !== null ? "time_progression" : "double_progression";

  return {
    catalogId,
    name,
    movementPattern,
    equipment,
    sets,
    repsMin,
    repsMax,
    durationMinutes,
    restSeconds,
    progression,
  };
};

export const buildProposeWorkoutPlanTool = (
  deps: CoachToolDeps,
): AgentTool<ProposeWorkoutPlanArgs> => ({
  name: "propose_workout_plan",
  description:
    "Propose a customized, specific workout routine (single workout or multi-day split like PPL, Upper/Lower, Full Body, Chest & Triceps, Back & Biceps, Legs) tailored to the user's explicit request, target muscles, equipment, and fitness level using the 888-exercise library. Attaches an interactive action proposal card to the chat allowing the user to review and save the plan with 1 tap.",
  parameters: {
    type: "object",
    required: ["rationale", "sessions"],
    additionalProperties: false,
    properties: {
      rationale: {
        type: "string",
        description:
          "Summary explaining why this custom routine and exercise selection fits the user's specific request and training goals.",
      },
      volume_action: {
        type: "string",
        enum: ["build", "hold", "reduce"],
        description:
          "Training volume directive (default 'hold', or 'build' when progressing).",
      },
      sessions: {
        type: "array",
        minItems: 1,
        maxItems: 7,
        description: "List of 1 to 7 workout sessions in the routine.",
        items: {
          type: "object",
          required: ["label", "exercises"],
          additionalProperties: false,
          properties: {
            label: {
              type: "string",
              description:
                "Name of the session (e.g. 'Push: Chest, Shoulders & Triceps', 'Pull: Back & Biceps', 'Legs & Core', 'Upper Body Hypertrophy').",
            },
            focus: {
              type: "string",
              description:
                "Primary focus tag (e.g. 'push', 'pull', 'legs', 'upper', 'lower', 'chest_triceps', 'full_body').",
            },
            estimated_minutes: {
              type: "integer",
              minimum: 15,
              maximum: 180,
              description:
                "Estimated session duration in minutes (e.g. 45, 60, 75, 90).",
            },
            exercises: {
              type: "array",
              minItems: 1,
              maxItems: 15,
              description: "List of exercises in this session.",
              items: {
                type: "object",
                required: ["name"],
                additionalProperties: false,
                properties: {
                  name: {
                    type: "string",
                    description:
                      "Name of the exercise (e.g. 'Incline dumbbell press', 'Cable crossover', 'Side lateral raise', 'Barbell deadlift', 'Bulgarian split squat', 'Triceps pushdown').",
                  },
                  sets: {
                    type: "integer",
                    minimum: 1,
                    maximum: 10,
                    description: "Target number of sets (typically 3 to 4).",
                  },
                  reps_min: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    description: "Minimum target repetitions (e.g. 8).",
                  },
                  reps_max: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    description: "Maximum target repetitions (e.g. 12).",
                  },
                  duration_minutes: {
                    type: "integer",
                    minimum: 1,
                    maximum: 180,
                    description:
                      "Duration in minutes (for aerobic/mobility exercises).",
                  },
                  rest_seconds: {
                    type: "integer",
                    minimum: 0,
                    maximum: 600,
                    description:
                      "Target rest time in seconds between sets (e.g. 90, 120, 150).",
                  },
                  notes: {
                    type: "string",
                    description:
                      "Form cues or coaching notes for this exercise.",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  execute: async ({ clock, args }) => {
    const now = resolveClock(deps, clock).now();
    const typedArgs = (args ?? {}) as Partial<ProposeWorkoutPlanArgs>;
    const sessions = typedArgs.sessions ?? [];
    if (sessions.length === 0) {
      return {
        kind: "plan",
        label: "Empty workout proposal",
        confirmed: false,
        freshness: freshnessOf(now),
        data: { error: "No sessions provided" },
      } satisfies AgentGroundingItem;
    }

    let actionProposal: CoachActionProposal | null = null;
    if (sessions.length === 1) {
      const session = sessions[0]!;
      const resolvedExercises = session.exercises.map(resolveProposedExercise);
      actionProposal = coachActionProposalSchema.parse({
        id: crypto.randomUUID(),
        kind: "workout_start",
        prescriptionVersion: "v1-llm-custom-2026-08",
        volumeAction: typedArgs.volume_action ?? "hold",
        session: {
          index: 1,
          label: session.label.trim(),
          estimatedMinutes: Math.min(
            180,
            Math.max(15, session.estimated_minutes ?? 60),
          ),
          exercises: resolvedExercises,
        },
      });
    } else {
      const startDay = new Date(now.getTime());
      const stepDays = Math.max(
        1,
        Math.floor(7 / Math.max(sessions.length, 1)),
      );
      const sessionsWithDays = sessions.map((session, idx) => {
        const day = new Date(startDay.getTime() + idx * stepDays * 86_400_000);
        const targetDay = day.toISOString().slice(0, 10);
        const resolvedExercises = session.exercises.map(
          resolveProposedExercise,
        );
        return {
          index: idx + 1,
          label: session.label.trim(),
          estimatedMinutes: Math.min(
            180,
            Math.max(15, session.estimated_minutes ?? 60),
          ),
          focus: session.focus ?? null,
          targetDay,
          exercises: resolvedExercises,
        };
      });
      const endDay =
        sessionsWithDays[sessionsWithDays.length - 1]?.targetDay ??
        startDay.toISOString().slice(0, 10);
      actionProposal = coachMultiWorkoutPlanProposalSchema.parse({
        id: crypto.randomUUID(),
        kind: "multi_workout_plan",
        prescriptionVersion: "v1-llm-custom-2026-08",
        volumeAction: typedArgs.volume_action ?? "hold",
        focus: sessions[0]?.focus ?? null,
        requestedSessions: sessions.length,
        sessionMinutes: sessions[0]?.estimated_minutes ?? 60,
        rationale: (
          typedArgs.rationale ?? "Custom workout plan designed for your goals."
        ).trim(),
        sessions: sessionsWithDays,
        startDay: startDay.toISOString().slice(0, 10),
        endDay,
      });
    }

    return {
      kind: "plan",
      label: "Custom Coach Workout Plan Proposal",
      confirmed: true,
      freshness: freshnessOf(now),
      data: {
        actionProposal,
        sessions: sessions.length,
        rationale: typedArgs.rationale,
      },
    } satisfies AgentGroundingItem;
  },
});

/**
 * Build the full registry for the Coach route. Exposed for tests
 * + composition root. Returns an `AgentToolRegistry` that the
 * orchestrator consumes directly.
 */
export const buildCoachToolRegistry = (
  deps: CoachToolDeps,
): AgentToolRegistry =>
  createAgentToolRegistryFromList([
    buildGetActiveGoalTool(deps),
    buildGetRecentWorkoutsTool(deps),
    buildGetAvailableRoutinesTool(deps),
    buildGetRecentMeasurementsTool(deps),
    buildGetRecentFoodEntriesTool(deps),
    buildGetMealHistoryTool(deps),
    buildGetExerciseHistoryTool(deps),
    buildComputeEnergyTool(deps),
    buildGetCoachingPlanTool(deps),
    buildGetTrainingPrescriptionTool(deps),
    buildSearchExercisesTool(deps),
    buildProposeWorkoutPlanTool(deps),
  ]);

export type CoachToolRegistrySet = ReturnType<typeof buildCoachToolRegistry>;

export interface CoachToolsForRegistry {
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly runRepository?: RunRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  readonly clock?: Clock;
}

/**
 * Re-export `ConversationId` so callers can compile against this
 * module without re-importing core.
 */
export type { ConversationId } from "@mizyun/core";
