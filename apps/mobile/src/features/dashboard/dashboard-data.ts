import {
  bodyMeasurementListResponseSchema,
  dailyFoodSummaryResponseSchema,
  workoutListResponseSchema,
  type BodyMeasurementListResponse,
  type DailyFoodSummaryResponse,
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

export const fetchWorkoutCountThisWeek = async (
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
  // `completeWorkoutsOnly` would require a `status` filter the
  // route doesn't expose yet; count every workout in the window.
  // PERSIST-002 follow-up: narrow to completed-only once the
  // route lands a status filter.
  return {
    value: (parsed?.workouts ?? []).length,
    error: null,
  };
};
