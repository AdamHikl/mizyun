import { describe, expect, it } from "vitest";
import type { StoredProfile, UserId } from "@mizyun/core";
import { authorizeAiAccess, isAdultEligibleForAi } from "./ai-eligibility.js";

const makeProfile = (birthYear: number | null): StoredProfile => ({
  userId: "user-1" as UserId,
  displayName: "Tester",
  unitSystem: "metric",
  timezone: "UTC",
  birthYear,
  heightCm: 180,
  activityLevel: "moderately_active",
  sexAtBirth: "male",
  coachingPreferences: {
    experienceLevel: null,
    trainingDaysPerWeek: null,
    sessionDurationMinutes: null,
    trainingFocus: null,
    availableEquipment: [],
    dietaryPreferences: [],
    trainingLimitations: [],
  },
  planTier: "free",
  aiProvider: "gemini",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

describe("isAdultEligibleForAi", () => {
  const referenceNow = new Date("2026-09-08T12:00:00Z");

  it("returns false when birthYear is null (age unspecified on profile fails closed)", () => {
    const profile = makeProfile(null);
    expect(isAdultEligibleForAi(profile, referenceNow)).toBe(false);
  });

  it("returns true when user is 18 or older", () => {
    const adultProfile = makeProfile(2008); // 2026 - 2008 = 18
    expect(isAdultEligibleForAi(adultProfile, referenceNow)).toBe(true);

    const olderAdultProfile = makeProfile(1990); // 2026 - 1990 = 36
    expect(isAdultEligibleForAi(olderAdultProfile, referenceNow)).toBe(true);
  });

  it("returns false when user is under 18", () => {
    const minorProfile = makeProfile(2010); // 2026 - 2010 = 16
    expect(isAdultEligibleForAi(minorProfile, referenceNow)).toBe(false);

    const childProfile = makeProfile(2015);
    expect(isAdultEligibleForAi(childProfile, referenceNow)).toBe(false);
  });
});

describe("authorizeAiAccess", () => {
  const referenceNow = new Date("2026-09-08T12:00:00Z");
  const adultProfile = makeProfile(1990);
  const minorProfile = makeProfile(2012);

  const validConsent = {
    userId: "user-1" as UserId,
    granted: true,
    confirmedAdult: true,
    consentVersion: "2026-09-08",
    consentedAt: new Date("2026-09-08T10:00:00Z"),
    revokedAt: null,
    createdAt: new Date("2026-09-08T10:00:00Z"),
    updatedAt: new Date("2026-09-08T10:00:00Z"),
  };

  it("fails closed with AI_AGE_RESTRICTED when profile is null or indicates a minor", () => {
    const resNull = authorizeAiAccess({
      profile: null,
      consent: validConsent,
      now: referenceNow,
    });
    expect(resNull.authorized).toBe(false);
    if (!resNull.authorized) {
      expect(resNull.code).toBe("AI_AGE_RESTRICTED");
    }

    const resMinor = authorizeAiAccess({
      profile: minorProfile,
      consent: validConsent,
      now: referenceNow,
    });
    expect(resMinor.authorized).toBe(false);
    if (!resMinor.authorized) {
      expect(resMinor.code).toBe("AI_AGE_RESTRICTED");
    }
  });

  it("fails closed with AI_CONSENT_REQUIRED when consent is absent, not granted, not adult-confirmed, or revoked", () => {
    // Absent
    const resAbsent = authorizeAiAccess({
      profile: adultProfile,
      consent: null,
      now: referenceNow,
    });
    expect(resAbsent.authorized).toBe(false);
    if (!resAbsent.authorized) {
      expect(resAbsent.code).toBe("AI_CONSENT_REQUIRED");
    }

    // Not granted
    const resNotGranted = authorizeAiAccess({
      profile: adultProfile,
      consent: { ...validConsent, granted: false },
      now: referenceNow,
    });
    expect(resNotGranted.authorized).toBe(false);
    if (!resNotGranted.authorized) {
      expect(resNotGranted.code).toBe("AI_CONSENT_REQUIRED");
    }

    // Not confirmed adult
    const resNotConfirmed = authorizeAiAccess({
      profile: adultProfile,
      consent: { ...validConsent, confirmedAdult: false },
      now: referenceNow,
    });
    expect(resNotConfirmed.authorized).toBe(false);
    if (!resNotConfirmed.authorized) {
      expect(resNotConfirmed.code).toBe("AI_CONSENT_REQUIRED");
    }

    // Outdated version
    const resOutdated = authorizeAiAccess({
      profile: adultProfile,
      consent: { ...validConsent, consentVersion: "2025-01-01" },
      now: referenceNow,
    });
    expect(resOutdated.authorized).toBe(false);
    if (!resOutdated.authorized) {
      expect(resOutdated.code).toBe("AI_CONSENT_REQUIRED");
    }

    // Revoked
    const resRevoked = authorizeAiAccess({
      profile: adultProfile,
      consent: {
        ...validConsent,
        revokedAt: new Date("2026-09-08T11:00:00Z"),
      },
      now: referenceNow,
    });
    expect(resRevoked.authorized).toBe(false);
    if (!resRevoked.authorized) {
      expect(resRevoked.code).toBe("AI_CONSENT_REQUIRED");
    }
  });

  it("authorizes when adult profile and valid active consent are present", () => {
    const res = authorizeAiAccess({
      profile: adultProfile,
      consent: validConsent,
      now: referenceNow,
    });
    expect(res.authorized).toBe(true);
  });
});
