import type { MobileConfigResult } from "@mizyun/config";
import Constants from "expo-constants";
import { getAppVariant } from "./app-variant";
import { mobileConfigResult } from "./mobile-config";

const DEV_TARGETS = {
  apiUrl: "https://mizyun-api-dev.phiskel.com",
  supabaseUrl: "https://mizyun-supabase-dev.phiskel.com",
  authRedirectUri: "mizyun-dev://auth/callback",
};
const PRODUCTION_TARGETS = {
  apiUrl: "https://mizyun-api.phiskel.com",
  supabaseUrl: "https://mizyun-supabase.phiskel.com",
  authRedirectUri: "mizyun://auth/callback",
};
const sameOrigin = (value: string | null | undefined, canonical: string) =>
  value === canonical || value === `${canonical}/`;

/**
 * Client presentation gate only; the server authorizes admission and cohort.
 * Dev builds open enrollment on the canonical Dev targets. Production builds
 * open it only when the build sets `extra.enableCommunity === true` and points
 * at the canonical Production targets (Production release, 2026-10-21).
 */
export function resolveCommunityEnrollmentOpen({
  variant,
  configuration,
  communityReleased = false,
}: {
  variant: unknown;
  configuration: MobileConfigResult;
  communityReleased?: unknown;
}): boolean {
  const targets =
    variant === "dev"
      ? DEV_TARGETS
      : variant === "production" && communityReleased === true
        ? PRODUCTION_TARGETS
        : null;
  if (!targets || !configuration.ok) return false;
  const config = configuration.value;
  return (
    config.supabase.configured &&
    sameOrigin(config.apiUrl, targets.apiUrl) &&
    sameOrigin(config.supabaseConfig?.url, targets.supabaseUrl) &&
    config.authRedirectUri === targets.authRedirectUri
  );
}

/** Deliberate enrollment is available only in a configured standalone build. */
export const COMMUNITY_ENROLLMENT_OPEN = resolveCommunityEnrollmentOpen({
  variant: getAppVariant(),
  configuration: mobileConfigResult,
  communityReleased: Constants.expoConfig?.extra?.enableCommunity,
});
