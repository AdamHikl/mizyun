import { describe, expect, it } from "vitest";
import {
  CURRENT_AI_CONSENT_VERSION,
  DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS,
  LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
} from "@mizyun/contracts";
import type { StoredAiConsent, StoredProfile, UserId } from "@mizyun/core";
import { InMemoryAiConsentRepository } from "./ai-consent-repository.js";
import {
  authorizeAiAccess,
  authorizedAiConsentVersion,
  isAdultEligibleForAi,
  resolveAcceptedAiConsentVersions,
  withAcceptedAiConsentVersions,
} from "./ai-eligibility.js";

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

  describe("self-service consent admission", () => {
    it.each([undefined, null, "new-user@example.test", "founder@example.test"])(
      "does not require manual email enrollment for %s",
      (userEmail) => {
        expect(
          authorizeAiAccess({
            profile: adultProfile,
            consent: validConsent,
            now: referenceNow,
            userEmail,
            allowedEmails: ["founder@example.test"],
          }).authorized,
        ).toBe(true);
        expect(
          authorizeAiAccess({
            profile: adultProfile,
            consent: null,
            now: referenceNow,
            userEmail,
            allowedEmails: ["founder@example.test"],
          }).authorized,
        ).toBe(false);
      },
    );
  });
});

describe("accepted AI consent versions", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const profile = makeProfile(1990);
  const consentAt = (consentVersion: string): StoredAiConsent => ({
    userId: "user-1" as UserId,
    granted: true,
    confirmedAdult: true,
    consentVersion,
    consentedAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const devAccepted = [CURRENT_AI_CONSENT_VERSION];

  it("defaults to the contract set when unset or empty", () => {
    expect(resolveAcceptedAiConsentVersions()).toBe(
      DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS,
    );
    expect(resolveAcceptedAiConsentVersions(null)).toBe(
      DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS,
    );
    expect(resolveAcceptedAiConsentVersions([])).toBe(
      DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS,
    );
    expect(resolveAcceptedAiConsentVersions(devAccepted)).toEqual(devAccepted);
  });

  it.each([
    [LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY, true],
    [CURRENT_AI_CONSENT_VERSION, true],
    ["2025-01-01", false],
    ["v1", false],
  ])("default set: stored version %s authorized=%s", (version, expected) => {
    const consent = consentAt(version);
    expect(authorizeAiAccess({ profile, consent, now }).authorized).toBe(
      expected,
    );
    expect(authorizedAiConsentVersion({ profile, consent, now })).toBe(
      expected ? version : null,
    );
  });

  it("a Dev-style set rejects the Gemini-only consent and keeps the current one", () => {
    const legacy = authorizeAiAccess({
      profile,
      consent: consentAt(LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY),
      acceptedConsentVersions: devAccepted,
      now,
    });
    expect(legacy).toMatchObject({
      authorized: false,
      code: "AI_CONSENT_REQUIRED",
    });
    expect(
      authorizeAiAccess({
        profile,
        consent: consentAt(CURRENT_AI_CONSENT_VERSION),
        acceptedConsentVersions: devAccepted,
        now,
      }).authorized,
    ).toBe(true);
  });

  it("keeps the deprecated single-version option strict", () => {
    expect(
      authorizeAiAccess({
        profile,
        consent: consentAt(LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY),
        currentConsentVersion: CURRENT_AI_CONSENT_VERSION,
        now,
      }).authorized,
    ).toBe(false);
  });

  it("returns null instead of a version when consent is refused", () => {
    expect(
      authorizedAiConsentVersion({ profile, consent: null, now }),
    ).toBeNull();
    expect(
      authorizedAiConsentVersion({
        profile: makeProfile(2012),
        consent: consentAt(CURRENT_AI_CONSENT_VERSION),
        now,
      }),
    ).toBeNull();
  });

  it("reads a granted consent under an unaccepted version as not granted, leaving the row", async () => {
    const stored = new InMemoryAiConsentRepository();
    const userId = "user-1" as UserId;
    await stored.saveConsent(userId, {
      granted: true,
      confirmedAdult: true,
      consentVersion: LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
    });
    const dev = withAcceptedAiConsentVersions(stored, devAccepted);
    const effective = await dev.getConsent(userId);
    expect(effective).toMatchObject({
      granted: false,
      consentVersion: LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
    });
    expect(
      authorizeAiAccess({ profile, consent: effective, now }),
    ).toMatchObject({ authorized: false, code: "AI_CONSENT_REQUIRED" });
    expect((await stored.getConsent(userId))?.granted).toBe(true);

    await dev.saveConsent(userId, {
      granted: true,
      confirmedAdult: true,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
    });
    expect(await dev.getConsent(userId)).toMatchObject({
      granted: true,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
    });
    const defaults = withAcceptedAiConsentVersions(
      stored,
      DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS,
    );
    await stored.saveConsent(userId, {
      granted: true,
      confirmedAdult: true,
      consentVersion: LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
    });
    expect((await defaults.getConsent(userId))?.granted).toBe(true);
  });
});
