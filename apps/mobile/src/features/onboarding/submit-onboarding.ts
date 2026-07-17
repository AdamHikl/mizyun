import type { ApiClient } from "@mizyun/api-client";
import type { ProfilePatch } from "@mizyun/contracts";

import type { OnboardingForm } from "./onboarding-state";

export type SubmitOnboardingResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
    };

/**
 * Apply the wizard's final form to the API: a `PUT /v1/profile`
 * patch with displayName and unitSystem, followed by a
 * `POST /v1/goals` for the chosen primary goal. The two calls run
 * sequentially because the goal create depends on the verified user
 * (which the auth client already carries). If the profile write
 * succeeds and the goal create fails, we surface the goal error
 * rather than rolling the profile back — the user can fix the goal
 * from the dashboard without re-running onboarding.
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
  const profilePatch: ProfilePatch = {
    displayName: form.displayName.trim(),
    unitSystem: form.unitSystem,
  };
  const profileResult = await client.request({
    method: "PUT",
    path: "/v1/profile",
    body: profilePatch,
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

  if (form.goalKind === null || form.goalWeightKg === null) {
    // The route validator prevents this branch; treat it as a hard
    // success because the profile write went through.
    return { ok: true };
  }

  const goalResult = await client.request({
    method: "POST",
    path: "/v1/goals",
    body: {
      kind: form.goalKind,
      pace: "steady",
      target: { weightKg: form.goalWeightKg },
      startsOn: form.goalStartDate,
      targetDate: form.goalTargetDate,
    },
  });
  if (!goalResult.ok) {
    return {
      ok: false,
      message: humanizeError(
        goalResult.error.kind,
        "Could not save your goal.",
      ),
    };
  }
  return { ok: true };
};

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
