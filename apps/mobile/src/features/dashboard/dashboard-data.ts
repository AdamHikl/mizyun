import {
  bodyMeasurementListResponseSchema,
  boulderSessionListResponseSchema,
  dailyFoodSummaryListResponseSchema,
  dailyFoodSummaryResponseSchema,
  energySummaryResponseSchema,
  workoutListResponseSchema,
  type BodyMeasurementListResponse,
  type BoulderSessionListResponse,
  type DailyFoodSummary,
  type DailyFoodSummaryResponse,
  type EnergySummaryResponse,
  type FoodEntry,
  type WorkoutListResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";

import {
  dailyProteinRange,
  proteinProgressStatus,
  type ProteinProgressStatus,
  type Result,
} from "@mizyun/core";
import { savedDisplayTime } from "@/composition/personal-read-events";

/**
 * Pure reducers that turn `(apiClient, principal)` into a typed
 * dashboard payload. The dashboard screen wires these to
 * `useEffect` / `useState`; the reducers are pure so vitest can
 * exercise them without React or the network.
 *
 * `principal` is null only when the SessionGate is in the
 * `auth_required` state — the screen renders the existing "—"
 * placeholder in that case.
 */

export type DailySummary = DailyFoodSummaryResponse["summary"];
export type LatestWeight =
  BodyMeasurementListResponse["bodyMeasurements"][number] | null;
export type WorkoutCount = number;
export type EnergySummary = EnergySummaryResponse["summary"];

export interface LocalDayQuery {
  readonly date: string;
  readonly utcOffsetMinutes: number;
}

export interface NutritionReviewRangeQuery {
  readonly fromIsoDate: string;
  readonly toIsoDate: string;
  readonly utcOffsetMinutes?: number;
}

export interface NutritionReview {
  readonly loggedDays: number;
  readonly entryCount: number;
  /** Null when any logged day contains an entry without confirmed calories. */
  readonly caloriesKcal: number | null;
  readonly incompleteDays: number;
}

export interface DailyDataResult<T> {
  readonly value: T | null;
  readonly error: ApiError | null;
}

export type DashboardPrincipal = {
  readonly userId: string;
  readonly accessToken: string;
} | null;

const unauthenticatedResult = <T>(): DailyDataResult<T> => ({
  value: null,
  error: { kind: "no_session" },
});

/**
 * Run the schema's parse via the contract's typed exports. We don't
 * import the `zod` namespace because the mobile app doesn't carry
 * `zod` as a direct dependency — the contracts package owns it.
 */
const parseSafe = <T>(
  value: unknown,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T } },
): T | null => {
  const parsed = schema.safeParse(value);
  return parsed.success && parsed.data !== undefined ? parsed.data : null;
};

const dailySummaryRequest = (options: {
  readonly date: string;
  readonly utcOffsetMinutes?: number;
}) => ({
  method: "GET" as const,
  path: `/v1/food-entries/summary?date=${encodeURIComponent(options.date)}&utcOffsetMinutes=${encodeURIComponent(options.utcOffsetMinutes ?? 0)}`,
  schema: dailyFoodSummaryResponseSchema,
});
// Same read as the body history list (newest first), so one cached request
// serves Home, Goal settings and the weight history instead of two.
const weightRequest = {
  method: "GET" as const,
  path: "/v1/body-measurements?limit=200",
  schema: bodyMeasurementListResponseSchema,
};
const energyRequest = (offset: number) => ({
  method: "GET" as const,
  path: `/v1/energy/summary?utcOffsetMinutes=${encodeURIComponent(offset)}`,
  schema: energySummaryResponseSchema,
});
const reviewRequest = (query: NutritionReviewRangeQuery) => ({
  method: "GET" as const,
  path: `/v1/food-entries/summary?from=${encodeURIComponent(query.fromIsoDate)}&to=${encodeURIComponent(query.toIsoDate)}${query.utcOffsetMinutes !== undefined ? `&utcOffsetMinutes=${encodeURIComponent(query.utcOffsetMinutes)}` : ""}`,
  schema: dailyFoodSummaryListResponseSchema,
});
const workoutCountRequest = (options: {
  readonly fromIsoDate: string;
  readonly toIsoDate: string;
}) => ({
  method: "GET" as const,
  path: `/v1/workouts?from=${encodeURIComponent(options.fromIsoDate)}&to=${encodeURIComponent(options.toIsoDate)}&limit=200`,
  schema: workoutListResponseSchema,
});

/**
 * Newest finished bouldering sessions, the same read the Workouts history
 * makes. 50 is the route maximum and covers a month of climbing.
 */
const BOULDER_SESSION_LIMIT = 50;
const boulderSessionsRequest = {
  method: "GET" as const,
  path: `/v1/bouldering/sessions?limit=${BOULDER_SESSION_LIMIT}`,
  schema: boulderSessionListResponseSchema,
};

/** Finished sessions whose activity date falls in the inclusive range. */
const countBoulderSessions = (
  list: BoulderSessionListResponse,
  range: { readonly fromIsoDate: string; readonly toIsoDate: string },
): number =>
  list.sessions.filter(
    (session) =>
      session.completedAt !== null &&
      session.session.activityDate >= range.fromIsoDate &&
      session.session.activityDate <= range.toIsoDate,
  ).length;

/** The older of two optional save times; undefined when neither is known. */
const oldestSavedTime = (
  first: number | undefined,
  second: number | undefined,
): number | undefined =>
  first === undefined || second === undefined
    ? (first ?? second)
    : Math.min(first, second);

export interface DashboardSnapshotRead<T> {
  readonly value: T;
  readonly savedAt?: number;
}
export interface DashboardReadSnapshot {
  readonly daily: DashboardSnapshotRead<DailySummary> | null;
  readonly weight: DashboardSnapshotRead<LatestWeight> | null;
  readonly energy: DashboardSnapshotRead<EnergySummary> | null;
  readonly workouts: DashboardSnapshotRead<WorkoutCount> | null;
  readonly history: DashboardSnapshotRead<ReadonlyArray<DailySummary>> | null;
}
export const readDashboardSnapshot = (
  peek: <T>(options: RequestOptions) => Result<T, ApiError> | null,
  query: {
    readonly date: string;
    readonly fromIsoDate: string;
    readonly toIsoDate: string;
    readonly utcOffsetMinutes: number;
    /** Count finished bouldering sessions in `workouts`. */
    readonly boulderingEnabled?: boolean;
  },
): DashboardReadSnapshot => {
  const daily = peek<DailyFoodSummaryResponse>(dailySummaryRequest(query));
  const weight = peek<BodyMeasurementListResponse>(weightRequest);
  const energy = peek<EnergySummaryResponse>(
    energyRequest(query.utcOffsetMinutes),
  );
  const workouts = peek<WorkoutListResponse>(
    workoutCountRequest({
      fromIsoDate: query.fromIsoDate,
      toIsoDate: query.date,
    }),
  );
  // The session read cache does not store the bouldering list yet, so this
  // misses and Today waits for the live read rather than showing a count
  // without climbs.
  const boulders = query.boulderingEnabled
    ? peek<BoulderSessionListResponse>(boulderSessionsRequest)
    : null;
  const history =
    query.fromIsoDate <= query.toIsoDate
      ? peek<{ readonly summaries: ReadonlyArray<DailySummary> }>(
          reviewRequest(query),
        )
      : null;
  return {
    daily: daily?.ok
      ? { value: daily.value.summary, savedAt: savedDisplayTime(daily) }
      : null,
    weight: weight?.ok
      ? {
          value: weight.value.bodyMeasurements[0] ?? null,
          savedAt: savedDisplayTime(weight),
        }
      : null,
    energy: energy?.ok
      ? { value: energy.value.summary, savedAt: savedDisplayTime(energy) }
      : null,
    // With bouldering on, a count that lacks the climbing read would be
    // wrong, so the whole value waits for both saved reads.
    workouts:
      workouts?.ok && (!query.boulderingEnabled || boulders?.ok)
        ? {
            value:
              workouts.value.workouts.filter((w) => w.completedAt !== null)
                .length +
              (boulders?.ok
                ? countBoulderSessions(boulders.value, {
                    fromIsoDate: query.fromIsoDate,
                    toIsoDate: query.date,
                  })
                : 0),
            savedAt: oldestSavedTime(
              savedDisplayTime(workouts),
              boulders?.ok ? savedDisplayTime(boulders) : undefined,
            ),
          }
        : null,
    history:
      query.fromIsoDate > query.toIsoDate
        ? { value: [] }
        : history?.ok
          ? {
              value: history.value.summaries,
              savedAt: savedDisplayTime(history),
            }
          : null,
  };
};

export const fetchDailySummary = async (
  client: ApiClient,
  principal: DashboardPrincipal,
  options: { readonly date: string; readonly utcOffsetMinutes?: number },
): Promise<DailyDataResult<DailySummary>> => {
  if (principal === null) return unauthenticatedResult();
  const result = await client.request(dailySummaryRequest(options));
  if (!result.ok) return { value: null, error: result.error };
  const summary = parseSafe(result.value, dailyFoodSummaryResponseSchema);
  return {
    value: summary !== null ? summary.summary : null,
    error: null,
  };
};

export const fetchLatestWeight = async (
  client: ApiClient,
  principal: DashboardPrincipal,
): Promise<DailyDataResult<LatestWeight>> => {
  if (principal === null) return unauthenticatedResult();
  // The list is newest first; the latest measurement is its first row.
  const result = await client.request(weightRequest);
  if (!result.ok) return { value: null, error: result.error };
  const parsed = parseSafe(result.value, bodyMeasurementListResponseSchema);
  const list = parsed?.bodyMeasurements ?? [];
  const first = list[0];
  return {
    value: first !== undefined ? first : null,
    error: null,
  };
};

export const fetchEnergySummary = async (
  client: ApiClient,
  principal: DashboardPrincipal,
  utcOffsetMinutes: number,
): Promise<DailyDataResult<EnergySummary>> => {
  if (principal === null) return unauthenticatedResult();
  const result = await client.request(energyRequest(utcOffsetMinutes));
  if (!result.ok) return { value: null, error: result.error };
  const parsed = parseSafe(result.value, energySummaryResponseSchema);
  return { value: parsed?.summary ?? null, error: null };
};

export const summariseNutritionReview = (
  summaries: ReadonlyArray<DailyFoodSummary>,
): NutritionReview => {
  const logged = summaries.filter((summary) => summary.entryCount > 0);
  const incompleteDays = logged.filter(
    (summary) => summary.caloriesKcal === null,
  ).length;
  return {
    loggedDays: logged.length,
    entryCount: logged.reduce((sum, summary) => sum + summary.entryCount, 0),
    caloriesKcal:
      incompleteDays > 0
        ? null
        : logged.reduce((sum, summary) => sum + (summary.caloriesKcal ?? 0), 0),
    incompleteDays,
  };
};

export const combineNutritionReview = (
  historicalSummaries: ReadonlyArray<DailyFoodSummary>,
  todaySummary: DailyFoodSummary | null,
): NutritionReview => {
  const byDate = new Map<string, DailyFoodSummary>();
  for (const summary of historicalSummaries) {
    if (summary.entryCount > 0) {
      byDate.set(summary.date, summary);
    }
  }
  if (todaySummary !== null) {
    if (todaySummary.entryCount > 0) {
      byDate.set(todaySummary.date, todaySummary);
    } else {
      byDate.delete(todaySummary.date);
    }
  }
  return summariseNutritionReview(Array.from(byDate.values()));
};

export const fetchNutritionReviewSummaries = async (
  client: ApiClient,
  principal: DashboardPrincipal,
  query: NutritionReviewRangeQuery,
): Promise<DailyDataResult<ReadonlyArray<DailyFoodSummary>>> => {
  if (principal === null) return unauthenticatedResult();
  const result = await client.request(reviewRequest(query));
  if (!result.ok) return { value: null, error: result.error };
  const parsed = parseSafe(result.value, dailyFoodSummaryListResponseSchema);
  return {
    value: parsed?.summaries ?? null,
    error: null,
  };
};

export const fetchNutritionReview = async (
  client: ApiClient,
  principal: DashboardPrincipal,
  query: NutritionReviewRangeQuery | ReadonlyArray<LocalDayQuery>,
): Promise<DailyDataResult<NutritionReview>> => {
  if (principal === null) return unauthenticatedResult();

  if ("fromIsoDate" in query) {
    const rangeResult = await fetchNutritionReviewSummaries(
      client,
      principal,
      query,
    );
    if (rangeResult.error !== null) {
      return { value: null, error: rangeResult.error };
    }
    if (rangeResult.value === null) {
      return { value: null, error: null };
    }
    return {
      value: summariseNutritionReview(rangeResult.value),
      error: null,
    };
  }

  if (query.length === 0) {
    return {
      value: {
        loggedDays: 0,
        entryCount: 0,
        caloriesKcal: 0,
        incompleteDays: 0,
      },
      error: null,
    };
  }

  const firstDate = query[0].date;
  const lastDate = query[query.length - 1].date;
  const rangeQuery: NutritionReviewRangeQuery = {
    fromIsoDate: firstDate <= lastDate ? firstDate : lastDate,
    toIsoDate: firstDate <= lastDate ? lastDate : firstDate,
    utcOffsetMinutes: query[0].utcOffsetMinutes,
  };

  const rangeResult = await fetchNutritionReviewSummaries(
    client,
    principal,
    rangeQuery,
  );
  if (rangeResult.error === null && rangeResult.value !== null) {
    return {
      value: summariseNutritionReview(rangeResult.value),
      error: null,
    };
  }

  // Fallback: batched execution with bounded concurrency (batch size 4)
  const BATCH_SIZE = 4;
  const allSummaries: DailyFoodSummary[] = [];

  for (let i = 0; i < query.length; i += BATCH_SIZE) {
    const batch = query.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((day) => fetchDailySummary(client, principal, day)),
    );
    const failed = results.find((result) => result.error !== null);
    if (failed?.error) return { value: null, error: failed.error };

    for (const result of results) {
      if (result.value !== null) {
        allSummaries.push(result.value);
      }
    }
  }

  return {
    value: summariseNutritionReview(allSummaries),
    error: null,
  };
};

export const fetchWorkoutCountForPeriod = async (
  client: ApiClient,
  principal: DashboardPrincipal,
  options: {
    readonly fromIsoDate: string;
    readonly toIsoDate: string;
  },
): Promise<DailyDataResult<WorkoutCount>> => {
  if (principal === null) return unauthenticatedResult();
  const result = await client.request(workoutCountRequest(options));
  if (!result.ok) return { value: null, error: result.error };
  const parsed = parseSafe(result.value, workoutListResponseSchema);
  return {
    value: (parsed?.workouts ?? []).filter(
      (workout) => workout.completedAt !== null,
    ).length,
    error: null,
  };
};

/**
 * Finished bouldering sessions in the period, from the existing session
 * history read. A server with bouldering switched off counts as zero.
 */
export const fetchBoulderSessionCountForPeriod = async (
  client: ApiClient,
  principal: DashboardPrincipal,
  options: {
    readonly fromIsoDate: string;
    readonly toIsoDate: string;
  },
): Promise<DailyDataResult<WorkoutCount>> => {
  if (principal === null) return unauthenticatedResult();
  const result = await client.request(boulderSessionsRequest);
  if (!result.ok) {
    return result.error.kind === "http_error" &&
      result.error.code === "FEATURE_DISABLED"
      ? { value: 0, error: null }
      : { value: null, error: result.error };
  }
  const parsed = parseSafe(result.value, boulderSessionListResponseSchema);
  // An unreadable list is a failed read, so the screen keeps its saved count.
  if (parsed === null)
    return {
      value: null,
      error: { kind: "parse_error", cause: "Invalid bouldering sessions." },
    };
  return { value: countBoulderSessions(parsed, options), error: null };
};

/**
 * Training total for Today: strength workouts plus bouldering sessions.
 * Either read failing withholds the total, so the screen keeps its last
 * saved value instead of showing a count that leaves climbing out.
 */
export const combineTrainingCounts = (
  workouts: DailyDataResult<WorkoutCount>,
  boulders: DailyDataResult<WorkoutCount> | null,
): DailyDataResult<WorkoutCount> => {
  if (workouts.error !== null) return workouts;
  if (boulders === null) return workouts;
  if (boulders.error !== null) return { value: null, error: boulders.error };
  return {
    value:
      workouts.value === null || boulders.value === null
        ? null
        : workouts.value + boulders.value,
    error: null,
  };
};

interface BaseDailyNutritionDisplay {
  readonly status:
    "loading" | "error" | "no_entries" | "incomplete" | "complete";
  readonly consumedKcal: number | null;
  readonly targetKcal: number | null;
  readonly remainingKcal: number | null;
  readonly kcalPercent: number;
  readonly proteinG: number | null;
  readonly targetProteinG: number | null;
  readonly proteinPercent: number;
  readonly carbohydrateG: number | null;
  readonly targetCarbohydrateG: number | null;
  readonly carbohydratePercent: number;
  readonly fatG: number | null;
  readonly targetFatG: number | null;
  readonly fatPercent: number;
  readonly badgeText: string;
  readonly badgeType: "normal" | "over" | "alert" | "neutral";
  readonly hasIncompleteMeals: boolean;
}

export interface DailyNutritionDisplay extends BaseDailyNutritionDisplay {
  /** Protein against its good range; only steers protein ideas. */
  readonly proteinStatus: ProteinProgressStatus;
}

interface DailyNutritionParams {
  readonly summary: DailySummary | null;
  readonly energy: EnergySummary | null;
  readonly caloriesToday: number | null;
  readonly loading: boolean;
  readonly hasError: boolean;
}

export const computeDailyNutritionDisplay = (
  params: DailyNutritionParams,
): DailyNutritionDisplay => {
  const base = computeBaseNutritionDisplay(params);
  const range = dailyProteinRange({
    targetProteinG: base.targetProteinG,
    weightKg: params.energy?.inputs?.weightKg ?? null,
    goalKind: params.energy?.inputs?.goalKind ?? null,
  });
  return {
    ...base,
    proteinStatus: proteinProgressStatus(base.proteinG, range),
  };
};

const computeBaseNutritionDisplay = (
  params: DailyNutritionParams,
): BaseDailyNutritionDisplay => {
  const { summary, energy, caloriesToday, loading, hasError } = params;

  const targetKcal = energy?.dailyTargetKcal
    ? Math.round(energy.dailyTargetKcal)
    : null;
  const targetProtein = energy?.targetProteinG
    ? Math.round(energy.targetProteinG)
    : null;
  const targetCarbs = energy?.targetCarbohydrateG
    ? Math.round(energy.targetCarbohydrateG)
    : null;
  const targetFat = energy?.targetFatG ? Math.round(energy.targetFatG) : null;

  if (loading && summary === null && caloriesToday === null) {
    return {
      status: "loading",
      consumedKcal: null,
      targetKcal,
      remainingKcal: null,
      kcalPercent: 0,
      proteinG: null,
      targetProteinG: targetProtein,
      proteinPercent: 0,
      carbohydrateG: null,
      targetCarbohydrateG: targetCarbs,
      carbohydratePercent: 0,
      fatG: null,
      targetFatG: targetFat,
      fatPercent: 0,
      badgeText: targetKcal !== null ? `${targetKcal} kcal target` : "—",
      badgeType: "neutral",
      hasIncompleteMeals: false,
    };
  }

  if (hasError && summary === null && caloriesToday === null) {
    return {
      status: "error",
      consumedKcal: null,
      targetKcal,
      remainingKcal: null,
      kcalPercent: 0,
      proteinG: null,
      targetProteinG: targetProtein,
      proteinPercent: 0,
      carbohydrateG: null,
      targetCarbohydrateG: targetCarbs,
      carbohydratePercent: 0,
      fatG: null,
      targetFatG: targetFat,
      fatPercent: 0,
      badgeText: "Unavailable",
      badgeType: "neutral",
      hasIncompleteMeals: false,
    };
  }

  const entryCount = summary?.entryCount ?? 0;

  if (entryCount === 0) {
    return {
      status: "no_entries",
      consumedKcal: 0,
      targetKcal,
      remainingKcal: targetKcal,
      kcalPercent: 0,
      proteinG: 0,
      targetProteinG: targetProtein,
      proteinPercent: 0,
      carbohydrateG: 0,
      targetCarbohydrateG: targetCarbs,
      carbohydratePercent: 0,
      fatG: 0,
      targetFatG: targetFat,
      fatPercent: 0,
      badgeText: targetKcal !== null ? `${targetKcal} kcal left` : "",
      badgeType: "normal",
      hasIncompleteMeals: false,
    };
  }

  // If entryCount > 0, check if calories or macros are incomplete
  const hasIncompleteCalories = caloriesToday === null;
  const hasIncompleteMacros =
    summary !== null &&
    (summary.proteinG === null ||
      summary.carbohydrateG === null ||
      summary.fatG === null);
  const hasIncompleteMeals = hasIncompleteCalories || hasIncompleteMacros;

  if (hasIncompleteCalories) {
    const protein = summary?.proteinG ?? null;
    const carbs = summary?.carbohydrateG ?? null;
    const fat = summary?.fatG ?? null;
    return {
      status: "incomplete",
      consumedKcal: null,
      targetKcal,
      remainingKcal: null, // Withheld: never report remaining allowance when calories are unknown
      kcalPercent: 0,
      proteinG: protein !== null ? Math.round(protein) : null,
      targetProteinG: targetProtein,
      proteinPercent:
        protein !== null && targetProtein && targetProtein > 0
          ? Math.min(Math.round((protein / targetProtein) * 100), 100)
          : 0,
      carbohydrateG: carbs !== null ? Math.round(carbs) : null,
      targetCarbohydrateG: targetCarbs,
      carbohydratePercent:
        carbs !== null && targetCarbs && targetCarbs > 0
          ? Math.min(Math.round((carbs / targetCarbs) * 100), 100)
          : 0,
      fatG: fat !== null ? Math.round(fat) : null,
      targetFatG: targetFat,
      fatPercent:
        fat !== null && targetFat && targetFat > 0
          ? Math.min(Math.round((fat / targetFat) * 100), 100)
          : 0,
      badgeText: "Needs nutrition",
      badgeType: "alert",
      hasIncompleteMeals: true,
    };
  }

  // Calories are known (complete)
  const consumedKcal = Math.round(caloriesToday);
  const remainingKcal = targetKcal !== null ? targetKcal - consumedKcal : null;
  const kcalPercent =
    targetKcal && targetKcal > 0
      ? Math.min(Math.round((consumedKcal / targetKcal) * 100), 100)
      : 0;

  const protein = summary?.proteinG ?? null;
  const carbs = summary?.carbohydrateG ?? null;
  const fat = summary?.fatG ?? null;

  const proteinPercent =
    protein !== null && targetProtein && targetProtein > 0
      ? Math.min(Math.round((protein / targetProtein) * 100), 100)
      : 0;
  const carbsPercent =
    carbs !== null && targetCarbs && targetCarbs > 0
      ? Math.min(Math.round((carbs / targetCarbs) * 100), 100)
      : 0;
  const fatPercent =
    fat !== null && targetFat && targetFat > 0
      ? Math.min(Math.round((fat / targetFat) * 100), 100)
      : 0;

  let badgeText = "";
  let badgeType: "normal" | "over" | "alert" | "neutral" = "normal";

  if (hasIncompleteMacros) {
    badgeText = "Needs nutrition";
    badgeType = "alert";
  } else if (remainingKcal !== null) {
    if (remainingKcal >= 0) {
      badgeText = `${remainingKcal} kcal left`;
      badgeType = "normal";
    } else {
      badgeText = `${Math.abs(remainingKcal)} kcal over`;
      badgeType = "over";
    }
  }

  return {
    status: hasIncompleteMacros ? "incomplete" : "complete",
    consumedKcal,
    targetKcal,
    remainingKcal: hasIncompleteMacros ? null : remainingKcal,
    kcalPercent,
    proteinG: protein !== null ? Math.round(protein) : null,
    targetProteinG: targetProtein,
    proteinPercent,
    carbohydrateG: carbs !== null ? Math.round(carbs) : null,
    targetCarbohydrateG: targetCarbs,
    carbohydratePercent: carbsPercent,
    fatG: fat !== null ? Math.round(fat) : null,
    targetFatG: targetFat,
    fatPercent,
    badgeText,
    badgeType,
    hasIncompleteMeals,
  };
};

/** Select the earliest reusable meal from a complete selected day's history. */
export const extractFirstEligibleMeal = (
  entries: ReadonlyArray<FoodEntry>,
): FoodEntry | null => {
  let firstMeal: FoodEntry | null = null;
  let firstTime = Infinity;
  for (const entry of entries) {
    const consumedAt = Date.parse(entry.consumedAt);
    if (
      typeof entry.name === "string" &&
      entry.name.trim().length > 0 &&
      Number.isFinite(consumedAt) &&
      consumedAt < firstTime
    ) {
      firstMeal = entry;
      firstTime = consumedAt;
    }
  }
  return firstMeal;
};
