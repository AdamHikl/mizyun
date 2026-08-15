import type { ApiClient } from "@mizyun/api-client";
import {
  profilePatchSchema,
  profileResponseSchema,
  type Profile,
  type ProfilePatch,
} from "@mizyun/contracts";

import {
  centimetersToDisplayLength,
  displayLengthToCentimeters,
} from "@/lib/length-units";

export interface ProfileSettingsForm {
  readonly displayName: string;
  readonly unitSystem: Profile["unitSystem"];
  readonly height: string;
  readonly birthYear: string;
  readonly activityLevel: Profile["activityLevel"];
  readonly sexAtBirth: Profile["sexAtBirth"];
}

export type ProfileSettingsValidation =
  | { readonly ok: true; readonly patch: ProfilePatch }
  | { readonly ok: false; readonly message: string };

export const profileSettingsFormFromProfile = (
  profile: Profile,
): ProfileSettingsForm => ({
  displayName: profile.displayName ?? "",
  unitSystem: profile.unitSystem,
  height:
    profile.heightCm == null
      ? ""
      : String(
          centimetersToDisplayLength(profile.heightCm, profile.unitSystem),
        ),
  birthYear: profile.birthYear == null ? "" : String(profile.birthYear),
  activityLevel: profile.activityLevel ?? null,
  sexAtBirth: profile.sexAtBirth ?? null,
});

export const validateProfileSettingsForm = (
  form: ProfileSettingsForm,
  currentYear: number,
): ProfileSettingsValidation => {
  const trimmedName = form.displayName.trim();
  if (trimmedName.length === 0) {
    return { ok: false, message: "Display name cannot be blank." };
  }
  if (trimmedName.length > 80) {
    return {
      ok: false,
      message: "Display name must be 80 characters or fewer.",
    };
  }

  const heightDisplay = Number(form.height.trim());
  if (!Number.isFinite(heightDisplay) || heightDisplay <= 0) {
    return { ok: false, message: "Enter a valid height." };
  }
  const heightCm = displayLengthToCentimeters(heightDisplay, form.unitSystem);
  if (heightCm < 50 || heightCm > 260) {
    return {
      ok: false,
      message: "Height is outside the supported adult range (50–260 cm).",
    };
  }

  const birthYear = Number(form.birthYear.trim());
  if (
    !Number.isInteger(birthYear) ||
    birthYear < 1900 ||
    birthYear > currentYear - 13
  ) {
    return {
      ok: false,
      message: `Birth year must be between 1900 and ${currentYear - 13}.`,
    };
  }

  if (form.sexAtBirth == null) {
    return {
      ok: false,
      message: "Choose a sex-at-birth input for the energy formula.",
    };
  }

  if (form.activityLevel == null) {
    return { ok: false, message: "Choose an activity level." };
  }

  return {
    ok: true,
    patch: profilePatchSchema.parse({
      displayName: trimmedName,
      unitSystem: form.unitSystem,
      heightCm,
      birthYear,
      activityLevel: form.activityLevel,
      sexAtBirth: form.sexAtBirth,
    }),
  };
};

export const saveProfileSettings = async (
  client: ApiClient,
  patch: ProfilePatch,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly message: string }
> => {
  const result = await client.request({
    method: "PUT",
    path: "/v1/profile",
    body: patch,
    schema: profileResponseSchema,
  });
  if (result.ok) return { ok: true };
  switch (result.error.kind) {
    case "network_error":
      return {
        ok: false,
        message: "Network unavailable. Check your connection and retry.",
      };
    case "session_expired":
    case "no_session":
      return { ok: false, message: "Sign in again to save profile details." };
    default:
      return { ok: false, message: "Could not save profile details." };
  }
};
