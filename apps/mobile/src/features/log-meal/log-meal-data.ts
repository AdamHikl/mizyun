import {
  foodEntryCreateSchema,
  foodEntryResponseSchema,
  type FoodEntryResponse,
  type FoodEntryCreate,
} from "@mizyun/contracts";

import type { ApiClient, ApiError } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";
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
  readonly details?: Readonly<Record<string, unknown>>;
}

const humanizeError = (result: Result<unknown, ApiError>): string => {
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
    ...(form.details === undefined ? {} : { details: form.details }),
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

// =========================================================================
// VISION-001 — Photo-to-draft flow.
// =========================================================================

import {
  foodDraftCandidateSchema,
  foodDraftResponseSchema,
  type FoodDraftCandidate,
  type FoodDraftResponse,
} from "@mizyun/contracts";

export type SnapMealPhotoResult =
  | { readonly ok: true; readonly draft: FoodDraftCandidate }
  | { readonly ok: false; readonly message: string };

const humanizeDraftError = (result: Result<unknown, ApiError>): string => {
  // `draftFoodEntry` is best-effort: a failure here just means
  // the user has to fill the form by hand. The screen does not
  // surface a transient / retryable hint — that's a Coach-level
  // distinction. Keep the copy short and actionable.
  if (result.ok) {
    return "Couldn't read the photo — type the meal by hand.";
  }
  if (
    result.error.kind === "http_error" &&
    result.error.code === "AI_CONFIGURATION_ERROR"
  ) {
    return "Photo drafts are not configured on this server.";
  }
  if (
    result.error.kind === "http_error" &&
    result.error.code === "RATE_LIMITED"
  ) {
    return "Photo drafts are limited — try again in a minute.";
  }
  if (result.error.kind === "network_error") {
    return "Can't reach the server — type the meal by hand.";
  }
  return "Couldn't read the photo — type the meal by hand.";
};

export const snapMealPhoto = async (
  photo: Blob,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  textHint?: string,
): Promise<SnapMealPhotoResult> =>
  snapMealPhotoWith(apiClient, photo, mimeType, textHint);

export const snapMealPhotoWith = async (
  client: ApiClient,
  photo: Blob,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  textHint?: string,
): Promise<SnapMealPhotoResult> => {
  if (client.draftFoodEntry === undefined) {
    return {
      ok: false,
      message: "Photo drafts are not configured on this server.",
    };
  }
  const result = await client.draftFoodEntry({
    photo,
    mimeType,
    ...(textHint !== undefined && textHint.trim().length > 0
      ? { textHint }
      : {}),
  });
  if (!result.ok) {
    return { ok: false, message: humanizeDraftError(result) };
  }
  const parsed = foodDraftCandidateSchema.safeParse(result.value.draft);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Couldn't read the photo — type the meal by hand.",
    };
  }
  return { ok: true, draft: parsed.data };
};

export const draftMealFromText = async (
  description: string,
): Promise<SnapMealPhotoResult> => {
  const result = await apiClient.request<FoodDraftResponse>({
    method: "POST",
    path: "/v1/food-entries/draft/text",
    body: { description: description.trim() },
    schema: foodDraftResponseSchema,
  });
  if (!result.ok) {
    return { ok: false, message: humanizeDraftError(result) };
  }
  return { ok: true, draft: result.value.draft };
};
