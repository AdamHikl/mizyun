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

export type FoodEntryLoadResult =
  | { readonly ok: true; readonly entry: FoodEntry }
  | { readonly ok: false; readonly message: string };

export type FoodMutationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

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
