import { ageFromBirthYear, type StoredProfile } from "@mizyun/core";

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
    return true;
  }
  return ageFromBirthYear(profile.birthYear, now) >= 18;
};
