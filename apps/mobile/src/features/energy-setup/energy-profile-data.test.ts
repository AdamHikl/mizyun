import { describe, expect, it } from "vitest";

import {
  energyProfileFormFromProfile,
  validateEnergyProfileForm,
} from "./energy-profile-data";

describe("energy profile form", () => {
  it("prefills imperial height from canonical centimeters", () => {
    const form = energyProfileFormFromProfile({
      userId: "00000000-0000-4000-8000-000000000001",
      displayName: "Tester",
      unitSystem: "imperial",
      timezone: "UTC",
      heightCm: 177.8,
      birthYear: 1990,
      activityLevel: "lightly_active",
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
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(form.height).toBe("70");
  });

  it("returns a canonical patch for valid inputs", () => {
    const result = validateEnergyProfileForm(
      {
        height: "70",
        birthYear: "1990",
        activityLevel: "moderately_active",
        sexAtBirth: "female",
      },
      "imperial",
      2026,
    );
    expect(result).toEqual({
      ok: true,
      patch: {
        heightCm: 177.8,
        birthYear: 1990,
        activityLevel: "moderately_active",
        sexAtBirth: "female",
      },
    });
  });

  it("rejects a missing formula input", () => {
    const result = validateEnergyProfileForm(
      {
        height: "175",
        birthYear: "1990",
        activityLevel: null,
        sexAtBirth: "male",
      },
      "metric",
      2026,
    );
    expect(result.ok).toBe(false);
  });
});
