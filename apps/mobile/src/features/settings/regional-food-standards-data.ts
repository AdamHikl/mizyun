import type { ApiClient } from "@mizyun/api-client";
import {
  profileResponseSchema,
  type Profile,
  type ProfileResponse,
} from "@mizyun/contracts";

import { getCountryByCode, getLocalizedCountryName } from "@/lib/country-data";

export interface CountryStandardDisplay {
  readonly code: string | null;
  readonly countryName: string | null;
  readonly isGlobal: boolean;
  readonly label: string;
}

/**
 * Returns formatted display metadata for a country standard code.
 */
export const getCountryStandardDisplay = (
  countryCode: string | null | undefined,
): CountryStandardDisplay => {
  const normalized = countryCode?.trim().toUpperCase() ?? null;
  if (!normalized || !/^[A-Z]{2}$/.test(normalized)) {
    return {
      code: null,
      countryName: null,
      isGlobal: true,
      label: "Global standard (No regional calibration)",
    };
  }

  const country = getCountryByCode(normalized);
  const countryName = getLocalizedCountryName(normalized, country?.name);

  return {
    code: normalized,
    countryName,
    isGlobal: false,
    label: countryName ? `${countryName} (${normalized})` : normalized,
  };
};

export type SaveCountryStandardResult =
  | { readonly ok: true; readonly profile: Profile }
  | {
      readonly ok: false;
      readonly message: string;
      readonly isNetworkError: boolean;
    };

/**
 * Persists the selected country/regional food standard while safely preserving
 * existing coaching preferences.
 */
export const saveCountryStandard = async (
  client: ApiClient,
  profile: Profile,
  countryCode: string | null,
): Promise<SaveCountryStandardResult> => {
  const normalizedCode = countryCode?.trim().toUpperCase() || null;
  if (normalizedCode !== null && !/^[A-Z]{2}$/.test(normalizedCode)) {
    return {
      ok: false,
      message: "Country code must be a 2-letter uppercase ISO code.",
      isNetworkError: false,
    };
  }

  const nextPreferences = {
    ...profile.coachingPreferences,
    countryCode: normalizedCode,
  };

  const result = await client.request<ProfileResponse>({
    method: "PUT",
    path: "/v1/profile",
    body: { coachingPreferences: nextPreferences },
    schema: profileResponseSchema,
  });

  if (!result.ok) {
    const isNetwork = result.error.kind === "network_error";
    return {
      ok: false,
      message: isNetwork
        ? "Could not reach Mizyun. Your choice was not saved."
        : "Could not save regional food standard. Please retry.",
      isNetworkError: isNetwork,
    };
  }

  return {
    ok: true,
    profile: result.value.profile,
  };
};
