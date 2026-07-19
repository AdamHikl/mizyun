import {
  foodEntryCreateSchema,
  foodEntryResponseSchema,
  type FoodEntryResponse,
  type FoodEntryCreate,
} from "@mizyun/contracts";

import type { ApiClient } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";

/**
 * Pure reducer for the log-meal form. The screen calls
 * `submitLogMeal(form)` and gets back a typed result; the screen
 * renders the humanised message or navigates back on success.
 *
 * Validation mirrors the wire schema: name is required and bounded,
 * `consumedAt` defaults to "now", at least one macro field should
 * be present. The route validator returns the same 422 the wire
 * parser would surface; the reducer translates that into a
 * recoverable user message.
 */

export type LogMealResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

export interface LogMealForm {
  readonly name: string;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly consumedAt: string | null;
}

const humanizeError = (
  result: import("@mizyun/core").Result<
    unknown,
    import("@mizyun/api-client").ApiError
  >,
): string => {
  if (!result.ok) {
    switch (result.error.kind) {
      case "session_expired":
        return "Your session expired. Sign in again.";
      case "network_error":
        return "Network unavailable. Try again when you're online.";
      case "http_error":
        if (result.error.status === 422) {
          return "Please double-check the values and try again.";
        }
        return "The server rejected the entry. Try again.";
      case "validation_error":
        return "Please double-check the values and try again.";
      case "not_configured":
        return "The API isn't configured yet.";
      case "no_session":
        return "You're signed out. Sign in and try again.";
      default:
        return "Could not save the entry.";
    }
  }
  return "Could not save the entry.";
};

export const submitLogMeal = async (
  form: LogMealForm,
): Promise<LogMealResult> =>
  submitLogMealWith(form, apiClient, () => new Date());

export const submitLogMealWith = async (
  form: LogMealForm,
  client: ApiClient,
  now: () => Date = () => new Date(),
): Promise<LogMealResult> => {
  const trimmedName = form.name.trim();
  if (trimmedName.length === 0) {
    return { ok: false, message: "Name a meal first." };
  }
  const payload: FoodEntryCreate = {
    name: trimmedName,
    consumedAt: form.consumedAt ?? now().toISOString(),
    ...(form.caloriesKcal !== null ? { caloriesKcal: form.caloriesKcal } : {}),
    ...(form.proteinG !== null ? { proteinG: form.proteinG } : {}),
    ...(form.carbohydrateG !== null
      ? { carbohydrateG: form.carbohydrateG }
      : {}),
    ...(form.fatG !== null ? { fatG: form.fatG } : {}),
  };
  const parsed = foodEntryCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please double-check the values and try again.",
    };
  }
  const result = await client.request<FoodEntryResponse>({
    method: "POST",
    path: "/v1/food-entries",
    body: parsed.data,
    schema: foodEntryResponseSchema,
  });
  if (!result.ok) {
    return { ok: false, message: humanizeError(result) };
  }
  return { ok: true, id: result.value.foodEntry.id };
};
