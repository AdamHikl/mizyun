import type { MobileConfigResult } from "@mizyun/config";
import { getAppVariant } from "./app-variant";
import { mobileConfigResult } from "./mobile-config";

/** Client presentation gate only; the server authorizes admission and cohort. */
export function resolveCommunityEnrollmentOpen({
  variant,
  configuration,
}: {
  variant: unknown;
  configuration: MobileConfigResult;
}): boolean {
  if (variant !== "dev" || !configuration.ok) return false;
  const config = configuration.value;
  return (
    config.supabase.configured &&
    (config.apiUrl === "https://mizyun-api-dev.phiskel.com" ||
      config.apiUrl === "https://mizyun-api-dev.phiskel.com/") &&
    (config.supabaseConfig?.url === "https://mizyun-supabase-dev.phiskel.com" ||
      config.supabaseConfig?.url ===
        "https://mizyun-supabase-dev.phiskel.com/") &&
    config.authRedirectUri === "mizyun-dev://auth/callback"
  );
}

/** Deliberate enrollment is available only in the configured standalone Dev app. */
export const COMMUNITY_ENROLLMENT_OPEN = resolveCommunityEnrollmentOpen({
  variant: getAppVariant(),
  configuration: mobileConfigResult,
});
