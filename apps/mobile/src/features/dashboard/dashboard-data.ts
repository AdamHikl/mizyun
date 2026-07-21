import {
  bodyMeasurementListResponseSchema,
  dailyFoodSummaryResponseSchema,
  energySummaryResponseSchema,
  workoutListResponseSchema,
  type BodyMeasurementListResponse,
  type DailyFoodSummaryResponse,
  type EnergySummaryResponse,
  type WorkoutListResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError } from "@mizyun/api-client";

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

export const fetchDailySummary = async (
  client: ApiClient,
  principal: DashboardPrincipal,
  options: { readonly date: string; readonly utcOffsetMinutes?: number },
): Promise<DailyDataResult<DailySummary>> => {
  if (principal === null) return unauthenticatedResult();
  const result = await client.request({
    method: "GET",
    path: `/v1/food-entries/summary?date=${encodeURIComponent(options.date)}&utcOffsetMinutes=${encodeURIComponent(options.utcOffsetMinutes ?? 0)}`,
    schema: dailyFoodSummaryResponseSchema,
  });
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
  // Pull the most-recent measurement. The route list API caps at
  // one row when limit=1.
  const result = await client.request({
    method: "GET",
    path: "/v1/body-measurements?limit=1",
    schema: bodyMeasurementListResponseSchema,
  });
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
  const result = await client.request({
    method: "GET",
    path: `/v1/energy/summary?utcOffsetMinutes=${encodeURIComponent(utcOffsetMinutes)}`,
    schema: energySummaryResponseSchema,
  });
  if (!result.ok) return { value: null, error: result.error };
  const parsed = parseSafe(result.value, energySummaryResponseSchema);
  return { value: parsed?.summary ?? null, error: null };
};

export const fetchNutritionReview = async (
  client: ApiClient,
  principal: DashboardPrincipal,
  days: ReadonlyArray<LocalDayQuery>,
): Promise<DailyDataResult<NutritionReview>> => {
  if (principal === null) return unauthenticatedResult();
  const results = await Promise.all(
    days.map((day) => fetchDailySummary(client, principal, day)),
  );
  const failed = results.find((result) => result.error !== null);
  if (failed?.error) return { value: null, error: failed.error };

  const summaries = results.flatMap((result) =>
    result.value === null ? [] : [result.value],
  );
  const logged = summaries.filter((summary) => summary.entryCount > 0);
  const incompleteDays = logged.filter(
    (summary) => summary.caloriesKcal === null,
  ).length;
  return {
    value: {
      loggedDays: logged.length,
      entryCount: logged.reduce((sum, summary) => sum + summary.entryCount, 0),
      caloriesKcal:
        incompleteDays > 0
          ? null
          : logged.reduce(
              (sum, summary) => sum + (summary.caloriesKcal ?? 0),
              0,
            ),
      incompleteDays,
    },
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
  const query = `from=${encodeURIComponent(options.fromIsoDate)}&to=${encodeURIComponent(options.toIsoDate)}&limit=200`;
  const result = await client.request({
    method: "GET",
    path: `/v1/workouts?${query}`,
    schema: workoutListResponseSchema,
  });
  if (!result.ok) return { value: null, error: result.error };
  const parsed = parseSafe(result.value, workoutListResponseSchema);
  return {
    value: (parsed?.workouts ?? []).filter(
      (workout) => workout.completedAt !== null,
    ).length,
    error: null,
  };
};
