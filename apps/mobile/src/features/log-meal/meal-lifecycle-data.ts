import {
  dailyFoodSummaryResponseSchema,
  foodEntryCreateSchema,
  foodEntryListResponseSchema,
  foodEntryPatchSchema,
  foodEntryResponseSchema,
  type DailyFoodSummary,
  type FoodEntry,
  type FoodEntryCreate,
  type FoodEntryListResponse,
  type FoodEntryPatch,
  type FoodEntryResponse,
} from "@mizyun/contracts";
import type { ApiClient, ApiError } from "@mizyun/api-client";

import { apiClient } from "@/composition/api-client";

import type { LogMealForm, LogMealResult } from "./log-meal-data";

export interface FoodDayResult {
  readonly entries: ReadonlyArray<FoodEntry>;
  readonly summary: DailyFoodSummary | null;
  readonly message: string | null;
}

export interface DayGroupSummary {
  readonly entryCount: number;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
}

export interface FoodDayGroup {
  readonly date: string;
  readonly displayDate: string;
  readonly summary: DayGroupSummary;
  readonly entries: ReadonlyArray<FoodEntry>;
}

export interface FoodHistoryResult {
  readonly groups: ReadonlyArray<FoodDayGroup>;
  readonly entries: ReadonlyArray<FoodEntry>;
  readonly message: string | null;
}

export type FoodEntryLoadResult =
  | { readonly ok: true; readonly entry: FoodEntry }
  | { readonly ok: false; readonly message: string };

export type FoodMutationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export const isoLocalDate = (now: Date): string => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const entryLocalDate = (entry: FoodEntry): string =>
  isoLocalDate(new Date(entry.consumedAt));

export const formatDisplayDate = (
  dateStr: string,
  today: Date = new Date(),
): string => {
  const todayIso = isoLocalDate(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = isoLocalDate(yesterday);

  const parts = dateStr.split("-").map((p) => Number.parseInt(p, 10));
  const [year, month, day] = parts as [number, number, number];
  const dateObj = new Date(year, month - 1, day, 12, 0, 0);
  const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const isCurrentYear = year === today.getFullYear();

  if (dateStr === todayIso) {
    return `Today · ${weekday}, ${monthDay}`;
  }
  if (dateStr === yesterdayIso) {
    return `Yesterday · ${weekday}, ${monthDay}`;
  }
  if (isCurrentYear) {
    return `${weekday}, ${monthDay}`;
  }
  return `${weekday}, ${monthDay}, ${year}`;
};

export const groupFoodEntriesByDay = (
  entries: ReadonlyArray<FoodEntry>,
  now: Date = new Date(),
): ReadonlyArray<FoodDayGroup> => {
  const groupsMap = new Map<string, FoodEntry[]>();

  for (const entry of entries) {
    const d = entryLocalDate(entry);
    const list = groupsMap.get(d);
    if (list === undefined) {
      groupsMap.set(d, [entry]);
    } else {
      list.push(entry);
    }
  }

  const sortedDates = Array.from(groupsMap.keys()).sort((a, b) =>
    b.localeCompare(a),
  );

  return sortedDates.map((dateStr) => {
    const dayEntries = groupsMap.get(dateStr) ?? [];
    dayEntries.sort(
      (a, b) =>
        new Date(b.consumedAt).getTime() - new Date(a.consumedAt).getTime(),
    );

    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;

    let hasAnyCalories = false;
    let hasAnyProtein = false;
    let hasAnyCarbs = false;
    let hasAnyFat = false;

    for (const entry of dayEntries) {
      if (entry.caloriesKcal !== null) {
        hasAnyCalories = true;
        calories += entry.caloriesKcal;
      }
      if (entry.proteinG !== null) {
        hasAnyProtein = true;
        protein += entry.proteinG;
      }
      if (entry.carbohydrateG !== null) {
        hasAnyCarbs = true;
        carbs += entry.carbohydrateG;
      }
      if (entry.fatG !== null) {
        hasAnyFat = true;
        fat += entry.fatG;
      }
    }

    const summary: DayGroupSummary = {
      entryCount: dayEntries.length,
      caloriesKcal: hasAnyCalories ? Math.round(calories) : null,
      proteinG: hasAnyProtein ? Math.round(protein * 10) / 10 : null,
      carbohydrateG: hasAnyCarbs ? Math.round(carbs * 10) / 10 : null,
      fatG: hasAnyFat ? Math.round(fat * 10) / 10 : null,
    };

    return {
      date: dateStr,
      displayDate: formatDisplayDate(dateStr, now),
      summary,
      entries: dayEntries,
    };
  });
};

const humanizeApiError = (error: ApiError, action: string): string => {
  switch (error.kind) {
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "network_error":
      return `Network unavailable. ${action} when you're online.`;
    case "http_error":
      if (error.status === 404) return "That meal no longer exists.";
      if (error.status === 422) return "Please double-check the values.";
      return `The server could not ${action.toLowerCase()}. Try again.`;
    case "validation_error":
    case "parse_error":
      return "The server returned an unexpected meal record.";
    case "not_configured":
      return "The API isn't configured yet.";
    case "no_session":
      return "You're signed out. Sign in and try again.";
  }
};

export const fetchFoodHistory = async (): Promise<FoodHistoryResult> =>
  fetchFoodHistoryWith(apiClient, -new Date().getTimezoneOffset());

export const fetchFoodHistoryWith = async (
  client: ApiClient,
  _utcOffsetMinutes = 0,
  now: Date = new Date(),
): Promise<FoodHistoryResult> => {
  const result = await client.request<FoodEntryListResponse>({
    method: "GET",
    path: "/v1/food-entries?limit=200",
    schema: foodEntryListResponseSchema,
  });

  if (!result.ok) {
    return {
      groups: [],
      entries: [],
      message: humanizeApiError(result.error, "Refresh your meals"),
    };
  }

  const entries = result.value.foodEntries;
  const groups = groupFoodEntriesByDay(entries, now);
  return {
    groups,
    entries,
    message: null,
  };
};

export const fetchFoodDay = async (date: string): Promise<FoodDayResult> =>
  fetchFoodDayWith(apiClient, date, -new Date().getTimezoneOffset());

export const fetchFoodDayWith = async (
  client: ApiClient,
  date: string,
  utcOffsetMinutes = 0,
): Promise<FoodDayResult> => {
  const encodedDate = encodeURIComponent(date);
  const encodedOffset = encodeURIComponent(utcOffsetMinutes);
  const [entriesResult, summaryResult] = await Promise.all([
    client.request<FoodEntryListResponse>({
      method: "GET",
      path: `/v1/food-entries?from=${encodedDate}&to=${encodedDate}&utcOffsetMinutes=${encodedOffset}&limit=200`,
      schema: foodEntryListResponseSchema,
    }),
    client.request<{ summary: DailyFoodSummary }>({
      method: "GET",
      path: `/v1/food-entries/summary?date=${encodedDate}&utcOffsetMinutes=${encodedOffset}`,
      schema: dailyFoodSummaryResponseSchema,
    }),
  ]);

  const firstError = !entriesResult.ok
    ? entriesResult.error
    : !summaryResult.ok
      ? summaryResult.error
      : null;
  return {
    entries: entriesResult.ok ? entriesResult.value.foodEntries : [],
    summary: summaryResult.ok ? summaryResult.value.summary : null,
    message:
      firstError === null
        ? null
        : humanizeApiError(firstError, "Refresh your meals"),
  };
};

export const fetchFoodEntry = async (
  entryId: string,
): Promise<FoodEntryLoadResult> => fetchFoodEntryWith(apiClient, entryId);

export const fetchFoodEntryWith = async (
  client: ApiClient,
  entryId: string,
): Promise<FoodEntryLoadResult> => {
  const result = await client.request<FoodEntryResponse>({
    method: "GET",
    path: `/v1/food-entries/${encodeURIComponent(entryId)}`,
    schema: foodEntryResponseSchema,
  });
  return result.ok
    ? { ok: true, entry: result.value.foodEntry }
    : {
        ok: false,
        message: humanizeApiError(result.error, "Load that meal"),
      };
};

const patchFromForm = (form: LogMealForm): FoodEntryPatch | null => {
  const parsed = foodEntryPatchSchema.safeParse({
    name: form.name.trim(),
    ...(form.consumedAt !== null ? { consumedAt: form.consumedAt } : {}),
    caloriesKcal: form.caloriesKcal,
    proteinG: form.proteinG,
    carbohydrateG: form.carbohydrateG,
    fatG: form.fatG,
  });
  return parsed.success ? parsed.data : null;
};

export const updateFoodEntry = async (
  entryId: string,
  form: LogMealForm,
): Promise<LogMealResult> => updateFoodEntryWith(apiClient, entryId, form);

export const updateFoodEntryWith = async (
  client: ApiClient,
  entryId: string,
  form: LogMealForm,
): Promise<LogMealResult> => {
  const patch = patchFromForm(form);
  if (patch === null) {
    return { ok: false, message: "Please double-check the values." };
  }
  const result = await client.request<FoodEntryResponse>({
    method: "PUT",
    path: `/v1/food-entries/${encodeURIComponent(entryId)}`,
    body: patch,
    schema: foodEntryResponseSchema,
  });
  return result.ok
    ? { ok: true, id: result.value.foodEntry.id }
    : {
        ok: false,
        message: humanizeApiError(result.error, "Save that meal"),
      };
};

export const deleteFoodEntry = async (
  entryId: string,
): Promise<FoodMutationResult> => deleteFoodEntryWith(apiClient, entryId);

export const deleteFoodEntryWith = async (
  client: ApiClient,
  entryId: string,
): Promise<FoodMutationResult> => {
  const result = await client.request<void>({
    method: "DELETE",
    path: `/v1/food-entries/${encodeURIComponent(entryId)}`,
  });
  return result.ok
    ? { ok: true }
    : {
        ok: false,
        message: humanizeApiError(result.error, "Delete that meal"),
      };
};

export const copyFoodEntry = async (
  entry: FoodEntry,
): Promise<FoodMutationResult> =>
  copyFoodEntryWith(apiClient, entry, () => new Date());

export const copyFoodEntryWith = async (
  client: ApiClient,
  entry: FoodEntry,
  now: () => Date = () => new Date(),
): Promise<FoodMutationResult> => {
  const payload: FoodEntryCreate = {
    name: entry.name,
    consumedAt: now().toISOString(),
    caloriesKcal: entry.caloriesKcal,
    proteinG: entry.proteinG,
    carbohydrateG: entry.carbohydrateG,
    fatG: entry.fatG,
    details: entry.details,
  };
  const parsed = foodEntryCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: "That meal could not be copied." };
  }
  const result = await client.request<FoodEntryResponse>({
    method: "POST",
    path: "/v1/food-entries",
    body: parsed.data,
    schema: foodEntryResponseSchema,
  });
  return result.ok
    ? { ok: true }
    : {
        ok: false,
        message: humanizeApiError(result.error, "Copy that meal"),
      };
};
