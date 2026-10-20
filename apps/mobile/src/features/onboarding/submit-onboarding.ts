import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  bodyMeasurementCreateSchema,
  bodyMeasurementListResponseSchema,
  bodyMeasurementResponseSchema,
  goalResponseSchema,
  profileResponseSchema,
  type BodyMeasurementListResponse,
  type ProfilePatch,
} from "@mizyun/contracts";
import { displayWeightToKilograms } from "@/lib/weight-units";
import { displayLengthToCentimeters } from "@/lib/length-units";

import { parseNumericInput, type OnboardingForm } from "./onboarding-state";

export type SubmitOnboardingResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
    };

/**
 * Apply the wizard in a retry-safe sequence. Goal and baseline measurement are
 * ensured first; the profile display name is written last because SessionGate
 * uses it as the onboarding completion marker. A retry reads existing goal and
 * measurement authority before creating anything, avoiding duplicate records
 * after a partial network failure.
 *
 * The result shape is intentionally minimal: success or a single
 * human-readable message. The screen layer turns the failure into a
 * retry affordance without parsing SDK error shapes.
 *
 * `client` is required so the unit test can pass a stub. The
 * `OnboardingScreen` passes the mobile composition root's `apiClient`.
 */
export const submitOnboarding = async (
  form: OnboardingForm,
  client: ApiClient,
): Promise<SubmitOnboardingResult> => {
  const baselineDisplay = parseNumericInput(form.baselineWeight);
  const goalDisplay = parseNumericInput(form.goalWeight);
  const heightDisplay = parseNumericInput(form.height);
  const birthYear = parseNumericInput(form.birthYear);
  if (
    form.goalKind === null ||
    form.activityLevel === null ||
    form.sexAtBirth === null ||
    !Number.isFinite(baselineDisplay) ||
    !Number.isFinite(goalDisplay) ||
    !Number.isFinite(heightDisplay) ||
    !Number.isInteger(birthYear)
  ) {
    return { ok: false, message: "Please review your goal and weight values." };
  }
  const baselineWeightKg = displayWeightToKilograms(
    baselineDisplay,
    form.unitSystem,
  );
  const goalWeightKg = displayWeightToKilograms(goalDisplay, form.unitSystem);
  const heightCm = displayLengthToCentimeters(heightDisplay, form.unitSystem);

  const activeGoal = await client.request({
    method: "GET",
    path: "/v1/goals/active",
    schema: goalResponseSchema,
  });
  if (!activeGoal.ok && !isNotFound(activeGoal.error)) {
    return {
      ok: false,
      message: humanizeError(
        activeGoal.error.kind,
        "Could not check your goal.",
      ),
    };
  }
  if (!activeGoal.ok) {
    const goalResult = await client.request({
      method: "POST",
      path: "/v1/goals",
      body: {
        kind: form.goalKind,
        pace: "steady",
        target: { weightKg: goalWeightKg },
        startsOn: form.goalStartDate,
        ...(form.goalTargetDate !== null
          ? { targetDate: form.goalTargetDate }
          : {}),
      },
      schema: goalResponseSchema,
    });
    if (!goalResult.ok && !isActiveGoalConflict(goalResult.error)) {
      return {
        ok: false,
        message: humanizeError(
          goalResult.error.kind,
          "Could not save your goal.",
        ),
      };
    }
  }

  const measurementsResult = await client.request<BodyMeasurementListResponse>({
    method: "GET",
    path: "/v1/body-measurements?limit=200",
    schema: bodyMeasurementListResponseSchema,
  });
  if (!measurementsResult.ok) {
    return {
      ok: false,
      message: humanizeError(
        measurementsResult.error.kind,
        "Could not check your starting weight.",
      ),
    };
  }
  const hasConfirmedWeight = measurementsResult.value.bodyMeasurements.some(
    (measurement) => measurement.weightKg !== null,
  );
  if (!hasConfirmedWeight) {
    const baselinePayload = bodyMeasurementCreateSchema.parse({
      weightKg: baselineWeightKg,
      measuredAt: new Date().toISOString(),
      measurements: { context: "onboarding_baseline" },
    });
    const baselineResult = await client.request({
      method: "POST",
      path: "/v1/body-measurements",
      body: baselinePayload,
      schema: bodyMeasurementResponseSchema,
    });
    if (!baselineResult.ok) {
      return {
        ok: false,
        message: humanizeError(
          baselineResult.error.kind,
          "Could not save your starting weight.",
        ),
      };
    }
  }

  const profilePatch: ProfilePatch = {
    displayName: form.displayName.trim(),
    unitSystem: form.unitSystem,
    heightCm,
    birthYear,
    activityLevel: form.activityLevel,
    sexAtBirth: form.sexAtBirth,
  };
  const profileResult = await client.request({
    method: "PUT",
    path: "/v1/profile",
    body: profilePatch,
    schema: profileResponseSchema,
  });
  if (!profileResult.ok) {
    return {
      ok: false,
      message: humanizeError(
        profileResult.error.kind,
        "Could not save your profile.",
      ),
    };
  }

  return { ok: true };
};

const isNotFound = (error: ApiError): boolean =>
  error.kind === "http_error" && error.status === 404;

// The active-goal route reuses VALIDATION_ERROR for both the
// "user already has an active goal" conflict and the unrelated
// invalid-status-transition path, so match the message verbatim.
const isActiveGoalConflict = (error: ApiError): boolean =>
  error.kind === "http_error" &&
  error.status === 409 &&
  error.code === "VALIDATION_ERROR" &&
  error.message === "user already has an active goal";

const humanizeError = (kind: string, fallback: string): string => {
  switch (kind) {
    case "session_expired":
      return "Your session expired. Sign in again to continue.";
    case "network_error":
      return "Network unavailable. Check your connection and retry.";
    case "not_configured":
      return "Mizyun is not fully configured on this device.";
    case "no_session":
      return "You are signed out. Sign in again to continue.";
    case "validation_error":
      return "The server rejected the values. Please review and retry.";
    case "http_error":
      return "The server returned an error. Please retry.";
    default:
      return fallback;
  }
};
