import Constants from "expo-constants";

import { mobileConfigResult } from "./mobile-config";

export type AppVariant = "dev" | "production";

export interface AppVariantOverrides {
  readonly expoExtraVariant?: unknown;
  readonly expoExtraProgressPhotos?: unknown;
  readonly expoExtraBouldering?: unknown;
  readonly authRedirectUri?: string | null;
  readonly apiUrl?: string | null;
}

/**
 * Resolves whether the current runtime is running the Dev or Production app variant.
 *
 * Precedence:
 * 1. Explicit override passed by callers / unit tests
 * 2. `Constants.expoConfig?.extra?.mizyunVariant` (populated by app.config.js)
 * 3. Deep-link URI scheme in `mobileConfigResult` (e.g. `mizyun-dev://` vs `mizyun://`)
 * 4. API hostname in `mobileConfigResult` (e.g. `mizyun-api-dev.phiskel.com`)
 * 5. Fail-closed fallback: "production"
 */
export function resolveAppVariant(overrides?: AppVariantOverrides): AppVariant {
  const extraVariant =
    overrides?.expoExtraVariant ?? Constants.expoConfig?.extra?.mizyunVariant;
  if (extraVariant === "dev" || extraVariant === "production") {
    return extraVariant;
  }

  const authRedirectUri =
    overrides?.authRedirectUri !== undefined
      ? overrides.authRedirectUri
      : mobileConfigResult.ok
        ? mobileConfigResult.value.authRedirectUri
        : null;

  if (authRedirectUri?.startsWith("mizyun-dev://")) {
    return "dev";
  }
  if (authRedirectUri?.startsWith("mizyun://")) {
    return "production";
  }

  const apiUrl =
    overrides?.apiUrl !== undefined
      ? overrides.apiUrl
      : mobileConfigResult.ok
        ? mobileConfigResult.value.apiUrl
        : null;

  if (apiUrl?.includes("mizyun-api-dev")) {
    return "dev";
  }

  return "production";
}

/**
 * Returns the current application variant ("dev" | "production").
 */
export function getAppVariant(): AppVariant {
  return resolveAppVariant();
}

/**
 * Returns true if the progress photos feature is enabled in this build variant.
 * Progress photos are currently experimental and only enabled on Dev builds.
 */
export function isProgressPhotosEnabled(
  overrides?: AppVariantOverrides,
): boolean {
  const extraFlag =
    overrides?.expoExtraProgressPhotos ??
    Constants.expoConfig?.extra?.enableProgressPhotos;
  if (typeof extraFlag === "boolean") {
    return extraFlag;
  }

  return resolveAppVariant(overrides) === "dev";
}

/**
 * Returns true if indoor bouldering (ADR-0066) is enabled in this build.
 * Dev builds have it on; Production stays off unless the build sets
 * `extra.enableBouldering === true`. An explicit boolean wins either way.
 */
export function isBoulderingEnabled(overrides?: AppVariantOverrides): boolean {
  const extraFlag =
    overrides?.expoExtraBouldering ??
    Constants.expoConfig?.extra?.enableBouldering;
  if (typeof extraFlag === "boolean") return extraFlag;
  return resolveAppVariant(overrides) === "dev";
}
