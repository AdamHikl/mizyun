import { DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS } from "@mizyun/contracts";
import {
  ageFromBirthYear,
  type AiConsentRepository,
  type StoredAiConsent,
  type StoredProfile,
} from "@mizyun/core";

/**
 * The stored consent versions this server accepts: the configured
 * `AI_CONSENT_ACCEPTED_VERSIONS` list, or the contract default (every
 * disclosure version an installed build may have saved) when unset.
 */
export const resolveAcceptedAiConsentVersions = (
  configured?: readonly string[] | null,
): readonly string[] =>
  configured !== undefined && configured !== null && configured.length > 0
    ? configured
    : DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS;

/**
 * Wraps the consent store so a granted consent saved under a disclosure
 * version this environment no longer accepts reads as not granted. Every AI
 * route and GET /v1/account/ai-consent then report "consent needed", so
 * clients ask again. The stored row and its version are unchanged, and SQL
 * functions still compare against that stored version.
 */
export const withAcceptedAiConsentVersions = (
  repository: AiConsentRepository,
  acceptedVersions: readonly string[],
): AiConsentRepository => ({
  getConsent: async (userId, options) => {
    const consent = await repository.getConsent(userId, options);
    return consent !== null &&
      consent.granted &&
      !acceptedVersions.includes(consent.consentVersion)
      ? { ...consent, granted: false }
      : consent;
  },
  saveConsent: (userId, consent, options) =>
    repository.saveConsent(userId, consent, options),
});

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
 *   2. Explicit, granted, unrevoked consent whose stored version is accepted.
 *
 * Consent is self-service; no email enrollment or administrator approval is required.
 * Fails closed on missing profile, lookup errors, or outdated disclosures.
 * (Q8-A / Q8-B / Finding R5 / REL-AUD-005)
 */
export const authorizeAiAccess = (options: {
  readonly profile: StoredProfile | null;
  readonly consent: StoredAiConsent | null;
  /** Accepted stored versions; defaults to the contract's accepted set. */
  readonly acceptedConsentVersions?: readonly string[] | undefined;
  /** @deprecated Accept only this version; prefer `acceptedConsentVersions`. */
  readonly currentConsentVersion?: string | undefined;
  readonly now?: Date | undefined;
  /** @deprecated Ignored. Access depends on authenticated profile and consent. */
  readonly userEmail?: string | null | undefined;
  /** @deprecated Ignored, including nonempty legacy lists. No manual admission. */
  readonly allowedEmails?: readonly string[] | undefined;
}): AiAuthorizationResult => {
  const { profile, consent, now = new Date() } = options;
  const acceptedVersions =
    options.currentConsentVersion !== undefined
      ? [options.currentConsentVersion]
      : (options.acceptedConsentVersions ??
        DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS);

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
    !acceptedVersions.includes(consent.consentVersion) ||
    consent.revokedAt !== null
  ) {
    return {
      authorized: false,
      statusCode: 403,
      code: "AI_CONSENT_REQUIRED",
      message:
        "Explicit consent to third-party AI processing (Anthropic and Google Gemini API) is required before using AI features.",
    };
  }

  return { authorized: true };
};

/**
 * The stored consent version when `authorizeAiAccess` admits the request,
 * otherwise `null`. SQL functions that re-check consent compare the stored
 * row to this value, so it must be the stored version, not the current one.
 */
export const authorizedAiConsentVersion = (
  options: Parameters<typeof authorizeAiAccess>[0],
): string | null =>
  authorizeAiAccess(options).authorized && options.consent !== null
    ? options.consent.consentVersion
    : null;
