import {
  captureHealthExportOwner,
  exportSavedNutrition,
} from "@/features/health-exports";
import {
  foodEntryCreateSchema,
  foodEntryResponseSchema,
  type FoodEntryResponse,
  type FoodEntryCreate,
} from "@mizyun/contracts";

import type { ApiClient, ApiError } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";
import { apiClient } from "@/composition/api-client";
import { isValidOperationId } from "./meal-form";

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
  readonly healthExportFirstParty?: boolean;
  readonly healthExportTimeBasis?: "observed" | "date_only";
  readonly clientOperationId?: string;
  readonly name: string;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly fibreG?: number | null;
  readonly saturatedFatG?: number | null;
  readonly totalSugarsG?: number | null;
  readonly sodiumMg?: number | null;
  readonly cholesterolMg?: number | null;
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
        if (result.error.status === 409) {
          return "This meal operation was already submitted with different details. Please start a new entry or review existing logs.";
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
): Promise<LogMealResult> => {
  const binding = captureHealthExportOwner();
  return submitLogMealWith(
    form,
    apiClient,
    () => new Date(),
    (entry) =>
      exportSavedNutrition(binding, entry, {
        firstParty: form.healthExportFirstParty === true,
        timeBasis: form.healthExportTimeBasis ?? "date_only",
      }),
  );
};

export const submitLogMealWith = async (
  form: LogMealForm,
  client: ApiClient,
  now: () => Date = () => new Date(),
  afterSave?: (entry: FoodEntryResponse["foodEntry"]) => void,
): Promise<LogMealResult> => {
  const trimmedName = form.name.trim();
  if (trimmedName.length === 0) {
    return { ok: false, message: "Name a meal first." };
  }
  if (!form.clientOperationId || !isValidOperationId(form.clientOperationId)) {
    return {
      ok: false,
      message:
        "Missing or invalid operation identity. Please try saving again.",
    };
  }
  const clientOperationId = form.clientOperationId;
  const payload: FoodEntryCreate = {
    clientOperationId,
    name: trimmedName,
    consumedAt: form.consumedAt ?? now().toISOString(),
    ...(form.caloriesKcal !== null ? { caloriesKcal: form.caloriesKcal } : {}),
    ...(form.proteinG !== null ? { proteinG: form.proteinG } : {}),
    ...(form.carbohydrateG !== null
      ? { carbohydrateG: form.carbohydrateG }
      : {}),
    ...(form.fatG !== null ? { fatG: form.fatG } : {}),
    ...(form.fibreG == null ? {} : { fibreG: form.fibreG }),
    ...(form.saturatedFatG == null
      ? {}
      : { saturatedFatG: form.saturatedFatG }),
    ...(form.totalSugarsG == null ? {} : { totalSugarsG: form.totalSugarsG }),
    ...(form.sodiumMg == null ? {} : { sodiumMg: form.sodiumMg }),
    ...(form.cholesterolMg == null
      ? {}
      : { cholesterolMg: form.cholesterolMg }),
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
    headers: {
      "Idempotency-Key": clientOperationId,
    },
    schema: foodEntryResponseSchema,
  });
  if (!result.ok) {
    return { ok: false, message: humanizeError(result) };
  }
  try {
    afterSave?.(result.value.foodEntry);
  } catch {
    /* Optional health export cannot undo a save. */
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
  | {
      readonly ok: true;
      readonly draft: FoodDraftCandidate;
      readonly drafts?: readonly FoodDraftCandidate[];
    }
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
    const reason = result.error.reason;
    if (reason === "daily_budget_exhausted") {
      const resetAt = result.error.resetAt;
      if (resetAt) {
        const resetDate = new Date(resetAt);
        const hours = Math.max(
          0,
          Math.ceil((resetDate.getTime() - Date.now()) / 3600000),
        );
        return `Daily photo scan limit reached. Resets in ~${hours}h.`;
      }
      return "Daily photo scan limit reached. Resets at midnight UTC.";
    }
    if (reason === "concurrent_in_flight") {
      return "A photo is already being analyzed. Please wait.";
    }
    // minute_rate_limit or unknown
    const retryAfter = result.error.retryAfterSeconds;
    if (retryAfter && retryAfter > 0) {
      return `Scanning too fast — wait ${retryAfter}s.`;
    }
    return "Photo scans are limited — try again in a minute.";
  }
  if (result.error.kind === "network_error") {
    return "Can't reach the server — type the meal by hand.";
  }
  return "Couldn't read the photo — type the meal by hand.";
};

const humanizeRefineError = (result: Result<unknown, ApiError>): string => {
  // Refine shares the rate limiter + provider with the photo /
  // text-draft endpoints, so reuse the same code-based
  // short-circuits. The fallback copy is refine-specific (no
  // "photo" wording) so the user isn't told their photo failed
  // when they only asked the AI to re-estimate the values.
  if (result.ok) {
    return "Couldn't refine the draft. Edit the values manually.";
  }
  if (
    result.error.kind === "http_error" &&
    result.error.code === "AI_CONFIGURATION_ERROR"
  ) {
    return "Refine is not configured on this server.";
  }
  if (
    result.error.kind === "http_error" &&
    result.error.code === "RATE_LIMITED"
  ) {
    const reason = result.error.reason;
    if (reason === "daily_budget_exhausted") {
      return "Daily AI limit reached. Try again tomorrow.";
    }
    if (reason === "concurrent_in_flight") {
      return "Already refining — please wait.";
    }
    const retryAfter = result.error.retryAfterSeconds;
    if (retryAfter && retryAfter > 0) {
      return `Refine limited — wait ${retryAfter}s.`;
    }
    return "Refine is limited — try again in a minute.";
  }
  if (result.error.kind === "network_error") {
    return "Can't reach the server — try again in a moment.";
  }
  if (result.error.kind === "validation_error") {
    return "Couldn't refine the draft. Edit the values manually.";
  }
  if (result.error.kind === "http_error" && result.error.status === 422) {
    return "Couldn't refine the draft. Edit the values manually.";
  }
  return "Couldn't refine the draft. Edit the values manually.";
};

export const snapMealPhoto = async (
  photo: Blob,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  textHint?: string,
  additionalPhotos?: readonly {
    readonly photo: Blob;
    readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  }[],
): Promise<SnapMealPhotoResult> =>
  snapMealPhotoWith(apiClient, photo, mimeType, textHint, additionalPhotos);

export const snapMealPhotoWith = async (
  client: ApiClient,
  photo: Blob,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  textHint?: string,
  additionalPhotos?: readonly {
    readonly photo: Blob;
    readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  }[],
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
    ...(additionalPhotos !== undefined ? { additionalPhotos } : {}),
    ...(textHint !== undefined && textHint.trim().length > 0
      ? { textHint }
      : {}),
  });
  if (!result.ok) {
    return { ok: false, message: humanizeDraftError(result) };
  }
  const parsed = foodDraftResponseSchema.safeParse(result.value);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Couldn't read the photo — type the meal by hand.",
    };
  }
  return {
    ok: true,
    draft: parsed.data.draft,
    ...(parsed.data.drafts !== undefined ? { drafts: parsed.data.drafts } : {}),
  };
};

export const draftMealFromText = async (
  description: string,
  countryCode?: string | null,
): Promise<SnapMealPhotoResult> => {
  const result = await apiClient.request<FoodDraftResponse>({
    method: "POST",
    path: "/v1/food-entries/draft/text",
    body: {
      description: description.trim(),
      ...(countryCode ? { countryCode } : {}),
    },
    schema: foodDraftResponseSchema,
  });
  if (!result.ok) {
    return { ok: false, message: humanizeDraftError(result) };
  }
  return { ok: true, draft: result.value.draft };
};

// =========================================================================
// AI-ACT-007 — Refine an existing AI meal draft.
// =========================================================================

import { foodRefineDraftRequestSchema } from "@mizyun/contracts";

/**
 * Re-run the structured-output provider with the current draft
 * values plus a free-text instruction like
 * "make the chicken 200g instead of 100g". The route returns a
 * refined `FoodDraftCandidate`; the screen updates the form
 * fields with the result so the user can confirm before saving.
 *
 * Failures are best-effort: a 503 means the server has no model
 * wired up; a 422 means the instruction was rejected; a
 * 429 means the user is over the per-minute cap. The screen
 * shows the humanised message but does not block the manual
 * save path.
 */
export const refineMealDraft = async (
  currentDraft: FoodDraftCandidate,
  instruction: string,
): Promise<SnapMealPhotoResult> =>
  refineMealDraftWith(apiClient, currentDraft, instruction);

export const refineMealDraftWith = async (
  client: ApiClient,
  currentDraft: FoodDraftCandidate,
  instruction: string,
): Promise<SnapMealPhotoResult> => {
  const trimmedInstruction = instruction.trim();
  if (trimmedInstruction.length < 2) {
    return { ok: false, message: "Type an instruction for the AI." };
  }
  const payload = {
    currentDraft,
    instruction: trimmedInstruction,
  };
  const parsed = foodRefineDraftRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Couldn't refine the draft. Edit the values manually.",
    };
  }
  const result = await client.request<FoodDraftResponse>({
    method: "POST",
    path: "/v1/food-entries/draft/refine",
    body: parsed.data,
    schema: foodDraftResponseSchema,
  });
  if (!result.ok) {
    return { ok: false, message: humanizeRefineError(result) };
  }
  const refined = foodDraftCandidateSchema.safeParse(result.value.draft);
  if (!refined.success) {
    return {
      ok: false,
      message: "Couldn't refine the draft. Edit the values manually.",
    };
  }
  return { ok: true, draft: refined.data };
};
