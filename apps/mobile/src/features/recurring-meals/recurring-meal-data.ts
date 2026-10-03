import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import {
  recurringMealCreateSchema,
  recurringMealPatchSchema,
  recurringMealListResponseSchema,
  recurringMealResponseSchema,
  type RecurringMeal,
  type RecurringMealCreate,
  type RecurringMealPatch,
} from "@mizyun/contracts";
import { apiClient, invalidateSessionReads } from "@/composition/api-client";

export interface MealScheduleForm {
  localTime: string;
  timeZone: string;
  weekdays: number[];
}
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const deviceTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export function scheduleDate(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export const scheduleDays = (weekdays: readonly number[]): string =>
  weekdays.length === 7
    ? "Every day"
    : weekdays.map((day) => WEEKDAY_LABELS[day]).join(", ");
export function isAutomaticallyLogged(
  details: Record<string, unknown> | null,
): boolean {
  const marker = details?.recurringMeal;
  return Boolean(
    marker &&
    typeof marker === "object" &&
    typeof (marker as Record<string, unknown>).scheduleId === "string" &&
    typeof (marker as Record<string, unknown>).localDate === "string",
  );
}
function message(error: ApiError): string {
  switch (error.kind) {
    case "no_session":
    case "session_expired":
      return "Sign in again to manage recurring meals.";
    case "network_error":
      return "Could not confirm the change. Check your connection and retry.";
    case "http_error":
      return error.status === 404
        ? "That meal or schedule no longer exists."
        : "Could not update recurring meals. Please retry.";
    default:
      return "Could not load recurring meals. Please retry.";
  }
}
export type ScheduleResult =
  { ok: true } | { ok: false; message: string; definitiveRejected?: boolean };
export type ScheduleReadResult =
  | { ok: true; recurringMeals: RecurringMeal[] }
  | { ok: false; message: string };
export type ScheduleLifetime = Pick<
  RequestOptions,
  "expectedUserId" | "isCurrent"
>;
export async function loadSchedules(
  lifetime: ScheduleLifetime,
  client: ApiClient = apiClient,
): Promise<ScheduleReadResult> {
  const result = await client.request<{ recurringMeals: RecurringMeal[] }>({
    method: "GET",
    path: "/v1/recurring-meals",
    schema: recurringMealListResponseSchema,
    ...lifetime,
  });
  return result.ok
    ? { ok: true, recurringMeals: result.value.recurringMeals }
    : { ok: false, message: message(result.error) };
}
async function mutate(
  options: RequestOptions,
  client: ApiClient,
): Promise<ScheduleResult> {
  // Also invalidate an ambiguous write: the server may have committed before a lost response.
  invalidateSessionReads();
  try {
    const result = await client.request(options);
    return result.ok
      ? { ok: true }
      : {
          ok: false,
          message: message(result.error),
          definitiveRejected:
            result.error.kind === "http_error" &&
            [404, 409, 422].includes(result.error.status),
        };
  } finally {
    invalidateSessionReads();
  }
}
export async function createSchedule(
  input: RecurringMealCreate,
  lifetime: ScheduleLifetime,
  client: ApiClient = apiClient,
): Promise<ScheduleResult> {
  const parsed = recurringMealCreateSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: "Choose a valid time (HH:mm), time zone and at least one day.",
    };
  return mutate(
    {
      method: "POST",
      path: "/v1/recurring-meals",
      body: parsed.data,
      schema: recurringMealResponseSchema,
      ...lifetime,
    },
    client,
  );
}
export async function updateSchedule(
  id: string,
  input: RecurringMealPatch,
  lifetime: ScheduleLifetime,
  client: ApiClient = apiClient,
): Promise<ScheduleResult> {
  const parsed = recurringMealPatchSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: "Choose a valid time (HH:mm), time zone and at least one day.",
    };
  return mutate(
    {
      method: "PATCH",
      path: `/v1/recurring-meals/${encodeURIComponent(id)}`,
      body: parsed.data,
      schema: recurringMealResponseSchema,
      ...lifetime,
    },
    client,
  );
}
export function stopSchedule(
  id: string,
  lifetime: ScheduleLifetime,
  client: ApiClient = apiClient,
): Promise<ScheduleResult> {
  return mutate(
    {
      method: "DELETE",
      path: `/v1/recurring-meals/${encodeURIComponent(id)}`,
      ...lifetime,
    },
    client,
  );
}
export function skipSchedule(
  id: string,
  localDate: string,
  lifetime: ScheduleLifetime,
  client: ApiClient = apiClient,
): Promise<ScheduleResult> {
  return mutate(
    {
      method: "POST",
      path: `/v1/recurring-meals/${encodeURIComponent(id)}/skip`,
      body: { localDate },
      ...lifetime,
    },
    client,
  );
}
