import { CURRENT_AI_CONSENT_VERSION } from "@mizyun/contracts";
import {
  ageFromBirthYear,
  type StoredAiConsent,
  type StoredProfile,
} from "@mizyun/core";

/**
 * Validates adult eligibility for external AI processing (Google Gemini API).
 * Gemini API Terms of Service require adult eligibility (18+) and restrict
 * clients likely to be accessed by minors.
 *
 * (Finding R5 / REL-AUD-005)
 */
export const isAdultEligibleForAi = (
  profile: StoredProfile,
  now: Date = new Date(),
): boolean => {
  if (profile.birthYear === null) {
    return false;
  }
  return ageFromBirthYear(profile.birthYear, now) >= 18;
};

export type AiAuthorizationResult =
  | { readonly authorized: true }
  | {
      readonly authorized: false;
      readonly statusCode: 403;
      readonly code: "AI_AGE_RESTRICTED" | "AI_CONSENT_REQUIRED";
      readonly message: string;
    };

/**
 * Centralized server authorization boundary for all AI provider entry points
 * (Coach messages, photos, and food draft routes).
 *
 * Enforces:
 *   1. Profile presence and declared adult eligibility (18+).
 *   2. Explicit, granted, unrevoked consent matching the current consent version.
 *
 * Consent is self-service; no email enrollment or administrator approval is required.
 * Fails closed on missing profile, lookup errors, or outdated disclosures.
 * (Q8-A / Q8-B / Finding R5 / REL-AUD-005)
 */
export const authorizeAiAccess = (options: {
  readonly profile: StoredProfile | null;
  readonly consent: StoredAiConsent | null;
  readonly currentConsentVersion?: string | undefined;
  readonly now?: Date | undefined;
  /** @deprecated Ignored. Access depends on authenticated profile and consent. */
  readonly userEmail?: string | null | undefined;
  /** @deprecated Ignored, including nonempty legacy lists. No manual admission. */
  readonly allowedEmails?: readonly string[] | undefined;
}): AiAuthorizationResult => {
  const { profile, consent, now = new Date() } = options;
  const currentVersion =
    options.currentConsentVersion ?? CURRENT_AI_CONSENT_VERSION;

  if (profile === null || !isAdultEligibleForAi(profile, now)) {
    return {
      authorized: false,
      statusCode: 403,
      code: "AI_AGE_RESTRICTED",
      message:
        "AI features require adult eligibility (18 years or older) under provider terms.",
    };
  }

  if (
    consent === null ||
    !consent.granted ||
    !consent.confirmedAdult ||
    consent.consentVersion !== currentVersion ||
    consent.revokedAt !== null
  ) {
    return {
      authorized: false,
      statusCode: 403,
      code: "AI_CONSENT_REQUIRED",
      message:
        "Explicit consent to third-party AI processing (Google Gemini API) is required before using AI features.",
    };
  }

  return { authorized: true };
};
