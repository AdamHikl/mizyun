import { describe, expect, it } from "vitest";
import type { StoredProfile, UserId } from "@mizyun/core";
import { isAdultEligibleForAi } from "./ai-eligibility.js";

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

  it("returns true when birthYear is null (age unspecified on profile)", () => {
    const profile = makeProfile(null);
    expect(isAdultEligibleForAi(profile, referenceNow)).toBe(true);
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
