import type { FastifyPluginAsync } from "fastify";
import {
  buildCalorieReview,
  CalorieAdjustmentRepositoryError,
  computeEnergy,
  ENERGY_FORMULA_VERSION,
  estimateAdaptiveMaintenance,
  estimateExerciseKcal,
  isoWeekStart,
  REVIEW_DEFAULT_SAFETY_FLOOR_KCAL,
  SAFETY_FLOOR_KCAL,
  summariseWeightTrend,
  type ActivityLevel,
  type BodyMeasurementRepository,
  type CalorieAdjustmentRepository,
  type CalorieReview,
  type EnergyBreakdown,
  type FoodEntryRepository,
  type GoalRepository,
  type IntakeDay,
  type ProfileRepository,
  type SexAtBirth,
  type StoredCalorieAdjustmentProposal,
  type StoredFoodEntry,
  type StoredGoal,
  type UserId,
  type WeightTrendSummary,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";
import {
  calorieAdjustmentDecisionResponseSchema,
  calorieAdjustmentDecisionSchema,
  energySummaryQuerySchema,
  energySummaryResponseSchema,
  weeklyCalorieReviewQuerySchema,
  weeklyCalorieReviewResponseSchema,
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
  /**
   * Weekly calorie-review proposals (ENG-08). Without it the weekly review
   * still returns the computed review but never stores a proposal.
   */
  readonly calorieAdjustmentRepository?: CalorieAdjustmentRepository;
}

const LOOKBACK_DAYS = 14;
const MIN_OBSERVATIONS_FOR_BALANCE = 3;
/** Weight history feeding the smoothed trend (ADR-0010). */
const WEIGHT_LOOKBACK_DAYS = 60;
const WEIGHT_LOOKBACK_LIMIT = 500;
/** Completed local days feeding adaptive maintenance / weekly review. */
const ADAPTIVE_WINDOW_DAYS = 28;
const REVIEW_WINDOW_DAYS = 7;
const FOOD_PAGE_SIZE = 100;
const FOOD_MAX_PAGES = 40;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Local `YYYY-MM-DD` of an instant at a fixed UTC offset. */
const localDateIso = (instant: Date, utcOffsetMinutes: number): string =>
  new Date(instant.getTime() + utcOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);

const addDaysIso = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * Every food entry from the start of `fromIso` through the end of
 * `toIso` (local days), paged newest-first with the repository cursor.
 */
const fetchFoodEntries = async (
  repo: FoodEntryRepository,
  userId: UserId,
  fromIso: string,
  toIso: string,
  accessToken: string,
  utcOffsetMinutes: number,
): Promise<StoredFoodEntry[]> => {
  const from = isoDateToStartOfDay(fromIso, utcOffsetMinutes);
  const to = isoDateToEndOfDay(toIso, utcOffsetMinutes);
  const entries: StoredFoodEntry[] = [];
  let cursor: { consumedAt: Date; id: string } | null = null;
  for (let page = 0; page < FOOD_MAX_PAGES; page += 1) {
    const rows: ReadonlyArray<StoredFoodEntry> = await repo.list(userId, {
      from,
      to,
      limit: FOOD_PAGE_SIZE,
      cursor,
      accessToken,
    });
    entries.push(...rows);
    if (rows.length < FOOD_PAGE_SIZE) break;
    const last = rows[rows.length - 1] as StoredFoodEntry;
    cursor = { consumedAt: last.consumedAt, id: last.id };
  }
  return entries;
};

/**
 * Daily calorie totals keyed by local date. Matches the daily summary's
 * null-propagation rule: a single entry without calories makes that day's
 * total null (incomplete) rather than a silent partial sum (ENG-06).
 */
const dailyCalories = (
  entries: ReadonlyArray<StoredFoodEntry>,
  utcOffsetMinutes: number,
): Map<string, number | null> => {
  const days = new Map<string, number | null>();
  for (const entry of entries) {
    const date = localDateIso(entry.consumedAt, utcOffsetMinutes);
    const previous = days.has(date) ? (days.get(date) as number | null) : 0;
    days.set(
      date,
      previous === null || entry.caloriesKcal === null
        ? null
        : previous + entry.caloriesKcal,
    );
  }
  for (const [date, total] of days) {
    if (total !== null) days.set(date, Math.round(total * 100) / 100);
  }
  return days;
};

/** The `count` completed local days before `todayIso`, oldest first. */
const completedIntakeDays = (
  totals: ReadonlyMap<string, number | null>,
  todayIso: string,
  count: number,
): IntakeDay[] => {
  const days: IntakeDay[] = [];
  for (let back = count; back >= 1; back -= 1) {
    const date = addDaysIso(todayIso, -back);
    if (totals.has(date)) {
      days.push({ date, caloriesKcal: totals.get(date) as number | null });
    }
  }
  return days;
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

/** Everything the energy routes derive for one request. */
export interface EnergyRouteContext {
  readonly breakdown: EnergyBreakdown;
  readonly activeGoal: StoredGoal | null;
  readonly sexAtBirth: SexAtBirth | null;
  readonly weightTrend: WeightTrendSummary;
  /** Local "today" at the request's UTC offset. */
  readonly todayIso: string;
  /** Up to 28 completed local days of intake, oldest first. */
  readonly intakeDays: readonly IntakeDay[];
}

/**
 * Run the engine and post-process the result. The engine
 * returns a `breakdown` with `exerciseKcal: null` (the engine
 * itself does not have access to per-workout set counts); the
 * route fills that in, then computes the day's balance.
 *
 * v2 (ENG-07/ENG-08): BMR uses the smoothed weight trend over the last
 * 60 days, the target includes the active goal's accepted calibration,
 * and adaptive maintenance is estimated from the last 28 completed local
 * days of intake.
 */
export const loadEnergyRouteContext = async (
  options: EnergyRoutesOptions,
  userId: UserId,
  accessToken: string,
  query: {
    readonly activityLevel: ActivityLevel | null;
    readonly sexAtBirth: SexAtBirth | null;
    readonly utcOffsetMinutes: number;
  },
  now: Date,
): Promise<EnergyRouteContext> => {
  const todayIso = localDateIso(now, query.utcOffsetMinutes);
  const [profile, recentMeasurements, activeGoal, recentWorkouts, entries] =
    await Promise.all([
      options.profileRepository.getOrCreate(userId, { now, accessToken }),
      options.bodyMeasurementRepository.list(userId, {
        from: new Date(now.getTime() - WEIGHT_LOOKBACK_DAYS * 86_400_000),
        to: now,
        limit: WEIGHT_LOOKBACK_LIMIT,
        accessToken,
      }),
      options.goalRepository.getActive(userId, { accessToken }),
      fetchRecentWorkouts(options.workoutRepository, userId, now, accessToken),
      fetchFoodEntries(
        options.foodEntryRepository,
        userId,
        addDaysIso(todayIso, -ADAPTIVE_WINDOW_DAYS),
        todayIso,
        accessToken,
        query.utcOffsetMinutes,
      ),
    ]);
  // An older single reading still feeds BMR when nothing is recent.
  const latestMeasurement =
    recentMeasurements[0] ??
    (await fetchLatestMeasurement(
      options.bodyMeasurementRepository,
      userId,
      accessToken,
    ));
  const weightTrend = summariseWeightTrend(recentMeasurements);
  const totals = dailyCalories(entries, query.utcOffsetMinutes);
  const consumedKcalToday = totals.get(todayIso) ?? null;
  const intakeDays = completedIntakeDays(
    totals,
    todayIso,
    ADAPTIVE_WINDOW_DAYS,
  );
  const adaptiveMaintenance = estimateAdaptiveMaintenance({
    intakeDays,
    weightTrend,
    windowDays: ADAPTIVE_WINDOW_DAYS,
  });

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
      weightTrend,
      calorieCalibrationKcal: activeGoal?.calorieCalibrationKcal ?? 0,
      adaptiveMaintenance,
    },
    userId,
  );
  if (!result.ok) {
    // The engine never returns `ok: false` today; the discriminated
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
    breakdown: {
      ...result.breakdown,
      exerciseKcal,
      balanceKcal,
      balanceUncertaintyKcal: hasEnoughObservations ? 50 : null,
    },
    activeGoal,
    sexAtBirth,
    weightTrend,
    todayIso,
    intakeDays,
  };
};

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
): Promise<EnergyBreakdown> =>
  (await loadEnergyRouteContext(options, userId, accessToken, query, now))
    .breakdown;

/**
 * This week's deterministic review for the active goal (ENG-08), or null
 * without one. The current target is the dashboard's integer target,
 * calibration included.
 */
/**
 * Whole-kcal target before calibration, derived from the same rounded
 * target the review compares against so the two cannot differ by a
 * rounding step. When the floor clamp is active the calibrated target
 * no longer reflects the calibration, so use TDEE + goal adjustment.
 */
const uncalibratedTarget = (context: EnergyRouteContext): number | null => {
  const { tdeeKcal, goalAdjustmentKcal, dailyTargetKcal } = context.breakdown;
  if (tdeeKcal === null || goalAdjustmentKcal === null) return null;
  const calibration = context.activeGoal?.calorieCalibrationKcal ?? 0;
  const candidate = tdeeKcal + goalAdjustmentKcal + calibration;
  if (dailyTargetKcal !== null && candidate >= dailyTargetKcal - 0.005) {
    return Math.round(dailyTargetKcal) - calibration;
  }
  return Math.round(tdeeKcal + goalAdjustmentKcal);
};

export const buildWeeklyReview = (
  context: EnergyRouteContext,
  now: Date,
  lastAcceptedAt: Date | null = null,
): CalorieReview | null => {
  const goal = context.activeGoal;
  if (goal === null) return null;
  const target = context.breakdown.dailyTargetKcal;
  return buildCalorieReview({
    goalKind: goal.kind,
    goalPace: goal.pace,
    goalStartsOn: goal.startsOn,
    calibrationKcal: goal.calorieCalibrationKcal ?? 0,
    currentTargetKcal: target === null ? null : Math.round(target),
    uncalibratedTargetKcal: uncalibratedTarget(context),
    goalAdjustmentKcal: context.breakdown.goalAdjustmentKcal,
    // Unknown sex uses the lower floor rather than no floor at all.
    safetyFloorKcal:
      context.sexAtBirth === null
        ? REVIEW_DEFAULT_SAFETY_FLOOR_KCAL
        : SAFETY_FLOOR_KCAL[context.sexAtBirth],
    weightTrend: context.weightTrend,
    recentIntakeDays: context.intakeDays.slice(-REVIEW_WINDOW_DAYS),
    adaptiveMaintenance: context.breakdown.adaptiveMaintenance,
    lastAcceptedAt,
    now,
  });
};

const goalModeToWire = (mode: {
  readonly id: string;
  readonly label: string;
  readonly minWeeklyPercent: number;
  readonly maxWeeklyPercent: number;
  readonly targetWeeklyPercent: number;
}) => ({
  id: mode.id,
  label: mode.label,
  minWeeklyPercent: mode.minWeeklyPercent,
  maxWeeklyPercent: mode.maxWeeklyPercent,
  targetWeeklyPercent: mode.targetWeeklyPercent,
});

const reviewToWire = (review: CalorieReview) => ({
  version: review.version,
  computedAt: review.computedAt.toISOString(),
  status: review.status,
  reasons: [...review.reasons],
  method: review.method,
  goalMode: goalModeToWire(review.goalMode),
  goalAgeDays: review.goalAgeDays,
  observedWeeklyPercent: review.observedWeeklyPercent,
  observedWeeklyChangeKg: review.observedWeeklyChangeKg,
  smoothedWeightKg: review.smoothedWeightKg,
  loggedDays: review.loggedDays,
  averageIntakeKcal: review.averageIntakeKcal,
  adherencePercent: review.adherencePercent,
  adaptiveMaintenanceKcal: review.adaptiveMaintenanceKcal,
  currentTargetKcal: review.currentTargetKcal,
  proposedTargetKcal: review.proposedTargetKcal,
  deltaKcal: review.deltaKcal,
  targetChangeKcal: review.targetChangeKcal,
  calibrationBeforeKcal: review.calibrationBeforeKcal,
  calibrationAfterKcal: review.calibrationAfterKcal,
});

const proposalToWire = (proposal: StoredCalorieAdjustmentProposal) => ({
  id: proposal.id,
  goalId: proposal.goalId,
  weekStart: proposal.weekStart,
  status: proposal.status,
  review: reviewToWire(proposal.review),
  createdAt: proposal.createdAt.toISOString(),
  decidedAt: proposal.decidedAt?.toISOString() ?? null,
});

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
      calibrationKcal: breakdown.calibrationKcal,
      weightSource: breakdown.weightSource,
      goalMode:
        breakdown.goalMode === null ? null : goalModeToWire(breakdown.goalMode),
      targetWeeklyChangeKg: breakdown.targetWeeklyChangeKg,
      projection:
        breakdown.projection === null
          ? null
          : {
              projectedWeeksToTarget:
                breakdown.projection.projectedWeeksToTarget,
              projectedDate: breakdown.projection.projectedDate,
              targetDateRealistic: breakdown.projection.targetDateRealistic,
            },
      adaptiveMaintenance:
        breakdown.adaptiveMaintenance === null
          ? null
          : {
              status: breakdown.adaptiveMaintenance.status,
              reason: breakdown.adaptiveMaintenance.reason,
              maintenanceKcal: breakdown.adaptiveMaintenance.maintenanceKcal,
              averageIntakeKcal:
                breakdown.adaptiveMaintenance.averageIntakeKcal,
              loggedDays: breakdown.adaptiveMaintenance.loggedDays,
              windowDays: breakdown.adaptiveMaintenance.windowDays,
              weeklyChangeKg: breakdown.adaptiveMaintenance.weeklyChangeKg,
            },
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

  // GET /v1/energy/weekly-review — this week's deterministic calorie
  // review (ENG-08). Generated lazily on the owner's authenticated
  // request: when the review says "adjust" and no proposal exists for
  // (goal, ISO week), a pending proposal is stored under the caller's RLS
  // session. No background worker reads health data with the service role.
  app.get(
    "/energy/weekly-review",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = weeklyCalorieReviewQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid weekly review query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const now = new Date();
      const context = await loadEnergyRouteContext(
        options,
        principal.userId,
        principal.accessToken,
        {
          activityLevel: null,
          sexAtBirth: null,
          utcOffsetMinutes: parsed.data.utcOffsetMinutes ?? 0,
        },
        now,
      );
      const goal = context.activeGoal;
      const repository = options.calorieAdjustmentRepository;
      const access = { accessToken: principal.accessToken };
      // Cooldown (ENG-08): no new proposal within 14 days of an acceptance.
      const lastAcceptedAt =
        goal !== null && repository !== undefined
          ? await repository.getLastAcceptedAt(
              principal.userId,
              goal.id,
              access,
            )
          : null;
      const review = buildWeeklyReview(context, now, lastAcceptedAt);
      let proposal: StoredCalorieAdjustmentProposal | null = null;
      if (review !== null && goal !== null && repository !== undefined) {
        const weekStart = isoWeekStart(context.todayIso);
        proposal = await repository.getForWeek(
          principal.userId,
          goal.id,
          weekStart,
          access,
        );
        if (proposal === null && review.status === "adjust") {
          proposal = await repository.create(
            {
              id: crypto.randomUUID(),
              userId: principal.userId,
              goalId: goal.id,
              weekStart,
              goalPace: goal.pace,
              review,
            },
            access,
          );
        }
      }
      return weeklyCalorieReviewResponseSchema.parse({
        review: review === null ? null : reviewToWire(review),
        proposal: proposal === null ? null : proposalToWire(proposal),
      });
    },
  );

  // POST /v1/energy/weekly-review/:id/decision — accept or decline a
  // pending proposal. Acceptance moves the goal's calibration atomically
  // or supersedes a stale proposal (409 CALORIE_ADJUSTMENT_STALE).
  app.post<{ Params: { id: string } }>(
    "/energy/weekly-review/:id/decision",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const repository = options.calorieAdjustmentRepository;
      if (repository === undefined) {
        await sendApiError(
          reply,
          request,
          503,
          "SERVICE_UNAVAILABLE",
          "Calorie adjustments are not available.",
        );
        return;
      }
      const parsed = calorieAdjustmentDecisionSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid decision: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const notFound = () =>
        sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No pending calorie adjustment with that id exists for this user.",
        );
      if (!UUID_PATTERN.test(request.params.id)) {
        await notFound();
        return;
      }
      let decided: StoredCalorieAdjustmentProposal;
      try {
        decided = await repository.decide(
          principal.userId,
          request.params.id,
          parsed.data.decision,
          { accessToken: principal.accessToken },
        );
      } catch (error) {
        if (error instanceof CalorieAdjustmentRepositoryError) {
          if (error.kind === "not_found") {
            await notFound();
            return;
          }
          if (error.kind === "already_decided") {
            await sendApiError(
              reply,
              request,
              409,
              "CALORIE_ADJUSTMENT_ALREADY_DECIDED",
              "This calorie adjustment was already decided.",
            );
            return;
          }
        }
        throw error;
      }
      if (
        parsed.data.decision === "accept" &&
        decided.status === "superseded"
      ) {
        await sendApiError(
          reply,
          request,
          409,
          "CALORIE_ADJUSTMENT_STALE",
          "Your goal changed since this adjustment was proposed; review it again.",
        );
        return;
      }
      return calorieAdjustmentDecisionResponseSchema.parse({
        proposal: proposalToWire(decided),
      });
    },
  );
};
