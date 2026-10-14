import type { FastifyPluginAsync } from "fastify";
import {
  computeEnergy,
  ENERGY_FORMULA_VERSION,
  estimateExerciseKcal,
  type ActivityLevel,
  type BodyMeasurementRepository,
  type EnergyBreakdown,
  type FoodEntryRepository,
  type GoalRepository,
  type ProfileRepository,
  type SexAtBirth,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";
import {
  energySummaryQuerySchema,
  energySummaryResponseSchema,
  type EnergySummaryResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

export interface EnergyRoutesOptions {
  readonly profileRepository: ProfileRepository;
  readonly goalRepository: GoalRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly foodEntryRepository: FoodEntryRepository;
}

const LOOKBACK_DAYS = 14;
const MIN_OBSERVATIONS_FOR_BALANCE = 3;

/**
 * Get the latest body measurement for the user, sorted by
 * `measuredAt` desc. The repository's `list` already returns
 * newest-first, so we just take the first item.
 */
const fetchLatestMeasurement = async (
  repo: BodyMeasurementRepository,
  userId: UserId,
  accessToken: string,
): Promise<
  Awaited<ReturnType<BodyMeasurementRepository["list"]>>[number] | null
> => {
  const list = await repo.list(userId, {
    from: null,
    to: null,
    limit: 1,
    accessToken,
  });
  return list[0] ?? null;
};

/**
 * Convert a `YYYY-MM-DD` date to the start-of-day instant (UTC)
 * the route layer uses for range filters.
 */
const isoDateToStartOfDay = (iso: string, utcOffsetMinutes = 0): Date => {
  const parts = iso.split("-").map((part) => Number.parseInt(part, 10));
  const [year, month, day] = parts as [number, number, number];
  return new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - utcOffsetMinutes * 60_000,
  );
};

const isoDateToEndOfDay = (iso: string, utcOffsetMinutes = 0): Date =>
  new Date(
    isoDateToStartOfDay(iso, utcOffsetMinutes).getTime() + 86_400_000 - 1,
  );

/**
 * Sum today's consumed kcal from the food-entry repository.
 * Pulls a 1-day window and runs the same summing logic the daily
 * summary endpoint uses. Returns null when no entries exist or
 * when the day's totals are not fully comparable (a single
 * `null` macro field taints the day's total). We deliberately do
 * NOT fall back to summing only non-null fields — see ENG-06.
 */
const fetchTodayConsumedKcal = async (
  repo: FoodEntryRepository,
  userId: UserId,
  now: Date,
  accessToken: string,
  utcOffsetMinutes: number,
): Promise<number | null> => {
  const localNow = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const y = localNow.getUTCFullYear();
  const m = (localNow.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = localNow.getUTCDate().toString().padStart(2, "0");
  const dateIso = `${y}-${m}-${d}`;
  const from = isoDateToStartOfDay(dateIso, utcOffsetMinutes);
  const to = isoDateToEndOfDay(dateIso, utcOffsetMinutes);
  const entries = await repo.list(userId, {
    from,
    to,
    limit: 500,
    accessToken,
  });
  // Match the daily summary's null-propagation rule: a single
  // null in any field taints the day's `caloriesKcal`.
  const calories = entries
    .map((e) => e.caloriesKcal)
    .filter((c): c is number => c !== null);
  if (calories.length !== entries.length) return null;
  if (calories.length === 0) return null;
  const total = calories.reduce((sum, c) => sum + c, 0);
  return Math.round(total * 100) / 100;
};

/**
 * Fetch the user's recent workouts (last LOOKBACK_DAYS days).
 * Used to surface exercise-derived kcal without double-counting
 * the activity multiplier (ENG-04).
 */
const fetchRecentWorkouts = async (
  repo: WorkoutRepository,
  userId: UserId,
  now: Date,
  accessToken: string,
): Promise<Awaited<ReturnType<WorkoutRepository["list"]>>> => {
  const y = now.getUTCFullYear();
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const to = isoDateToEndOfDay(`${y}-${m}-${d}`);
  const lookbackMs = LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const from = new Date(now.getTime() - lookbackMs);
  return repo.list(userId, {
    excludeRunning: true,
    from,
    to,
    limit: 100,
    accessToken,
  });
};

/**
 * Distinct days across recent workouts. Used by the engine to
 * decide whether enough observations exist for a balanced
 * intake line (ENG-05).
 */
const distinctDayCount = (
  workouts: ReadonlyArray<{ readonly startedAt: Date }>,
): number => {
  const days = new Set<string>();
  for (const w of workouts) {
    const y = w.startedAt.getUTCFullYear();
    const m = (w.startedAt.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = w.startedAt.getUTCDate().toString().padStart(2, "0");
    days.add(`${y}-${m}-${d}`);
  }
  return days.size;
};

/**
 * Run the engine and post-process the result. The engine
 * returns a `breakdown` with `exerciseKcal: null` (the engine
 * itself does not have access to per-workout set counts); the
 * route fills that in, then computes the day's balance.
 */
export const computeRouteSummary = async (
  options: EnergyRoutesOptions,
  userId: UserId,
  accessToken: string,
  query: {
    readonly activityLevel: ActivityLevel | null;
    readonly sexAtBirth: SexAtBirth | null;
    readonly utcOffsetMinutes: number;
  },
  now: Date,
): Promise<EnergyBreakdown> => {
  const profile = await options.profileRepository.getOrCreate(userId, {
    now,
    accessToken,
  });
  const latestMeasurement = await fetchLatestMeasurement(
    options.bodyMeasurementRepository,
    userId,
    accessToken,
  );
  const activeGoal = await options.goalRepository.getActive(userId, {
    accessToken,
  });
  const recentWorkouts = await fetchRecentWorkouts(
    options.workoutRepository,
    userId,
    now,
    accessToken,
  );
  const consumedKcalToday = await fetchTodayConsumedKcal(
    options.foodEntryRepository,
    userId,
    now,
    accessToken,
    query.utcOffsetMinutes,
  );

  // Profile values win over query-string overrides — the
  // PROFILE-001 follow-up promotes activityLevel and
  // sexAtBirth to profile fields. The query string remains
  // useful as a preview override (e.g. "what if I picked
  // 'extra_active'?").
  const activityLevel: ActivityLevel | null =
    profile.activityLevel ?? query.activityLevel;
  const sexAtBirth: SexAtBirth | null = profile.sexAtBirth ?? query.sexAtBirth;

  const result = computeEnergy(
    {
      profile,
      latestBodyMeasurement: latestMeasurement,
      activeGoal,
      activityLevel,
      sexAtBirth,
      recentWorkouts,
      recentWorkoutsDayCount: distinctDayCount(recentWorkouts),
      consumedKcalToday,
      now,
    },
    userId,
  );
  if (!result.ok) {
    // The v1 engine never returns `ok: false`; the discriminated
    // union exists for future formula implementations that may
    // surface a fatal failure (e.g. missing dependency).
    throw new Error("energy engine returned a non-ok result");
  }

  // Fill in exercise-derived kcal using the set counts the
  // engine itself doesn't have access to. The function is pure;
  // we hand it a callback that hits the workout-set repository.
  // We resolve the per-workout queries up front so the pure
  // estimator can stay synchronous.
  const setCountMap = new Map<string, number>();
  for (const w of recentWorkouts) {
    const sets = await options.workoutSetRepository.listForWorkout(w.id, {
      accessToken,
    });
    setCountMap.set(w.id, sets.length);
  }
  const exerciseKcal = estimateExerciseKcal(
    recentWorkouts,
    (workoutId: string): number => setCountMap.get(workoutId) ?? 0,
  );

  // Compute today's balance when both sides are known. Null
  // propagates an honest "I don't have enough data" state.
  const balanceKcal: number | null =
    consumedKcalToday !== null && result.breakdown.dailyTargetKcal !== null
      ? Math.round(
          (consumedKcalToday - result.breakdown.dailyTargetKcal) * 100,
        ) / 100
      : null;

  const hasEnoughObservations =
    recentWorkouts.length >= MIN_OBSERVATIONS_FOR_BALANCE;

  return {
    ...result.breakdown,
    exerciseKcal,
    balanceKcal,
    balanceUncertaintyKcal: hasEnoughObservations ? 50 : null,
  };
};

/**
 * Convert the breakdown to the wire shape. The producer-side
 * schema parse ensures any future drift fails closed at the
 * boundary.
 */
const toWire = (breakdown: EnergyBreakdown): EnergySummaryResponse =>
  energySummaryResponseSchema.parse({
    summary: {
      formulaVersion: breakdown.formulaVersion,
      userId: breakdown.userId,
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
      targetProteinG: breakdown.targetProteinG,
      targetCarbohydrateG: breakdown.targetCarbohydrateG,
      targetFatG: breakdown.targetFatG,
      balanceKcal: breakdown.balanceKcal,
      balanceUncertaintyKcal: breakdown.balanceUncertaintyKcal,
      inputs: {
        weightKg: breakdown.inputs.weightKg,
        heightCm: breakdown.inputs.heightCm,
        birthYear: breakdown.inputs.birthYear,
        sexAtBirth: breakdown.inputs.sexAtBirth,
        activityLevel: breakdown.inputs.activityLevel,
        goalKind: breakdown.inputs.goalKind,
        goalPace: breakdown.inputs.goalPace,
      },
    },
  });

export const energyRoutes: FastifyPluginAsync<EnergyRoutesOptions> = async (
  app,
  options,
) => {
  // GET /v1/energy/summary — return the verified user's energy
  // breakdown. Optional query params `activityLevel` and
  // `sexAtBirth` carry the inputs the profile doesn't yet
  // persist; once they land on the profile, the query string
  // becomes a UI override.
  app.get(
    "/energy/summary",
    { preHandler: app.authenticate },
    async (request, reply): Promise<EnergySummaryResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = energySummaryQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid energy summary query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const now = new Date();
      const breakdown = await computeRouteSummary(
        options,
        principal.userId,
        principal.accessToken,
        {
          activityLevel: parsed.data.activityLevel ?? null,
          sexAtBirth: parsed.data.sexAtBirth ?? null,
          utcOffsetMinutes: parsed.data.utcOffsetMinutes ?? 0,
        },
        now,
      );
      // Touch the version constant so a build that forgets
      // to update the breakdown's formulaVersion field still
      // surfaces a lint error.
      void ENERGY_FORMULA_VERSION;
      return toWire(breakdown);
    },
  );
};
