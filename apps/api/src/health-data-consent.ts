import type { FastifyRequest } from "fastify";
import {
  API_COMPAT_HEADER,
  API_COMPAT_HEALTH_DATA_CONSENT,
  isHealthDataConsentCurrent,
} from "@mizyun/contracts";
import type { StoredHealthDataConsent, StoredProfile } from "@mizyun/core";

export const HEALTH_DATA_CONSENT_REQUIRED_MESSAGE =
  "Agree to Mizyun storing your health data before adding it.";

/**
 * True when the client's app asks for health-data consent before collecting
 * health data (compat level 2026-10-27 or later). Builds before that never
 * show the step, so the server cannot require it from them without breaking
 * their onboarding; they are covered once users update (see the DPIA draft).
 */
export const clientAsksForHealthDataConsent = (
  request: Pick<FastifyRequest, "headers">,
): boolean => {
  const value = request.headers[API_COMPAT_HEADER];
  const level = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(level) && level >= API_COMPAT_HEALTH_DATA_CONSENT
  );
};

/** A patch that stores a body or age value (clearing one is always allowed). */
export const patchStoresHealthData = (patch: {
  readonly birthYear?: number | null | undefined;
  readonly heightCm?: number | null | undefined;
  readonly sexAtBirth?: string | null | undefined;
  readonly activityLevel?: string | null | undefined;
}): boolean =>
  (patch.birthYear !== undefined && patch.birthYear !== null) ||
  (patch.heightCm !== undefined && patch.heightCm !== null) ||
  (patch.sexAtBirth !== undefined && patch.sexAtBirth !== null) ||
  (patch.activityLevel !== undefined && patch.activityLevel !== null);

export const storedHealthDataConsentIsCurrent = (
  consent: StoredHealthDataConsent | null,
): boolean =>
  consent !== null &&
  isHealthDataConsentCurrent({
    granted: consent.granted,
    consentVersion: consent.consentVersion,
    revokedAt: consent.revokedAt?.toISOString() ?? null,
  });

/**
 * Whether a health-data write must be refused. A recorded withdrawal is
 * refused for every client (it is an explicit answer, so builds that never
 * asked are not broken by it); a missing or outdated consent only for
 * clients that ask for it.
 */
export const healthDataWriteRefused = (
  request: Pick<FastifyRequest, "headers">,
  consent: StoredHealthDataConsent | null,
): boolean =>
  (consent !== null && !consent.granted) ||
  (clientAsksForHealthDataConsent(request) &&
    !storedHealthDataConsentIsCurrent(consent));

/** The health fields of `patch` whose value differs from the stored profile. */
export const changedHealthFields = (
  patch: Parameters<typeof patchStoresHealthData>[0],
  stored: Pick<
    StoredProfile,
    "birthYear" | "heightCm" | "sexAtBirth" | "activityLevel"
  >,
): Parameters<typeof patchStoresHealthData>[0] => ({
  ...(patch.birthYear !== stored.birthYear
    ? { birthYear: patch.birthYear }
    : {}),
  // Imperial display rounding re-sends a stored height a few hundredths off.
  ...(patch.heightCm !== undefined &&
  !(
    patch.heightCm === stored.heightCm ||
    (patch.heightCm !== null &&
      stored.heightCm !== null &&
      Math.abs(patch.heightCm - stored.heightCm) < 0.05)
  )
    ? { heightCm: patch.heightCm }
    : {}),
  ...(patch.sexAtBirth !== stored.sexAtBirth
    ? { sexAtBirth: patch.sexAtBirth }
    : {}),
  ...(patch.activityLevel !== stored.activityLevel
    ? { activityLevel: patch.activityLevel }
    : {}),
});
