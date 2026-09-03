import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  applyProfilePatch,
  type ProfilePatch,
  type StoredProfile,
  validateProfilePatch,
} from "./profile.js";

const baseStored = (overrides: Partial<StoredProfile> = {}): StoredProfile => ({
  userId: "00000000-0000-4000-8000-000000000001" as UserId,
  displayName: "Tester",
  unitSystem: "metric",
  timezone: "UTC",
  birthYear: 1990,
  heightCm: 170,
  activityLevel: null,
  sexAtBirth: null,
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
  ...overrides,
});

describe("validateProfilePatch", () => {
  it("rejects an empty patch", () => {
    expect(validateProfilePatch({})).toEqual({ kind: "empty_patch" });
  });

  it("accepts a minimal timezone-only patch", () => {
    expect(validateProfilePatch({ timezone: "Europe/Paris" })).toBeNull();
  });

  it("accepts a clearing patch (displayName = null)", () => {
    expect(validateProfilePatch({ displayName: null })).toBeNull();
  });

  it("rejects a blank display name", () => {
    expect(validateProfilePatch({ displayName: "   " })).toEqual({
      kind: "display_name_empty",
    });
  });

  it("rejects an over-long display name", () => {
    const long = "a".repeat(81);
    expect(validateProfilePatch({ displayName: long })).toEqual({
      kind: "display_name_too_long",
      max: 80,
    });
  });

  it("rejects an invalid unit system", () => {
    // Type system would catch this in callers; the runtime guard is
    // here for defence in depth against untyped inputs.
    expect(validateProfilePatch({ unitSystem: "furlongs" as never })).toEqual({
      kind: "invalid_unit_system",
      value: "furlongs",
    });
  });

  it("rejects an invalid timezone shape", () => {
    expect(validateProfilePatch({ timezone: "not a tz!" })).toEqual({
      kind: "invalid_timezone",
      value: "not a tz!",
    });
  });

  it("rejects a height outside the plausible range", () => {
    expect(validateProfilePatch({ heightCm: 30 })).toEqual({
      kind: "height_out_of_range",
      min: 50,
      max: 260,
    });
    expect(validateProfilePatch({ heightCm: 300 })).toEqual({
      kind: "height_out_of_range",
      min: 50,
      max: 260,
    });
  });

  it("accepts a height at the boundaries", () => {
    expect(validateProfilePatch({ heightCm: 50 })).toBeNull();
    expect(validateProfilePatch({ heightCm: 260 })).toBeNull();
  });

  it("rejects a birth year outside the plausible range", () => {
    const lastYear = new Date().getUTCFullYear() + 1;
    expect(validateProfilePatch({ birthYear: 1800 })).toEqual({
      kind: "birth_year_out_of_range",
      min: 1900,
      max: new Date().getUTCFullYear(),
    });
    expect(validateProfilePatch({ birthYear: lastYear })).toEqual({
      kind: "birth_year_out_of_range",
      min: 1900,
      max: new Date().getUTCFullYear(),
    });
  });

  it("accepts a birth year equal to the current year", () => {
    const thisYear = new Date().getUTCFullYear();
    expect(validateProfilePatch({ birthYear: thisYear })).toBeNull();
  });

  it("accepts normalized explicit coaching preferences", () => {
    expect(
      validateProfilePatch({
        coachingPreferences: {
          experienceLevel: "intermediate",
          trainingDaysPerWeek: 4,
          sessionDurationMinutes: 60,
          trainingFocus: "strength",
          availableEquipment: ["barbell", "rack"],
          dietaryPreferences: ["omnivore"],
          trainingLimitations: ["no_running"],
        },
      }),
    ).toBeNull();
  });

  it("rejects invalid or duplicate coaching preference values", () => {
    expect(
      validateProfilePatch({
        coachingPreferences: {
          experienceLevel: "intermediate",
          trainingDaysPerWeek: 8,
          sessionDurationMinutes: 60,
          trainingFocus: "strength",
          availableEquipment: ["barbell", "barbell"],
          dietaryPreferences: [],
          trainingLimitations: [],
        },
      }),
    ).toEqual({ kind: "invalid_coaching_preferences" });
  });
});

describe("applyProfilePatch", () => {
  it("advances updatedAt and preserves untouched fields", () => {
    const stored = baseStored();
    const patch: ProfilePatch = { timezone: "America/New_York" };
    const next = applyProfilePatch(
      stored,
      patch,
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.timezone).toBe("America/New_York");
    expect(next.displayName).toBe(stored.displayName);
    expect(next.unitSystem).toBe(stored.unitSystem);
    expect(next.birthYear).toBe(stored.birthYear);
    expect(next.heightCm).toBe(stored.heightCm);
    expect(next.createdAt).toEqual(stored.createdAt);
    expect(next.updatedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
  });

  it("clears nullable fields when patch sets them to null", () => {
    const stored = baseStored({ displayName: "Renamed", birthYear: 1995 });
    const next = applyProfilePatch(
      stored,
      { displayName: null, birthYear: null },
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.displayName).toBeNull();
    expect(next.birthYear).toBeNull();
  });

  it("replaces coaching preferences as one auditable user choice", () => {
    const preferences = {
      experienceLevel: "beginner" as const,
      trainingDaysPerWeek: 3,
      sessionDurationMinutes: 45,
      trainingFocus: "balanced" as const,
      availableEquipment: ["dumbbells"] as const,
      dietaryPreferences: ["vegetarian"] as const,
      trainingLimitations: ["low_impact_only"] as const,
    };
    const next = applyProfilePatch(
      baseStored(),
      { coachingPreferences: preferences },
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.coachingPreferences).toEqual(preferences);
  });

  it("preserves userId and createdAt across updates", () => {
    const stored = baseStored();
    const next = applyProfilePatch(
      stored,
      { unitSystem: "imperial" },
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.userId).toBe(stored.userId);
    expect(next.createdAt).toEqual(stored.createdAt);
  });

  it("accepts activityLevel and sexAtBirth patches", () => {
    expect(
      validateProfilePatch({
        activityLevel: "moderately_active",
        sexAtBirth: "female",
      }),
    ).toBeNull();
  });

  it("accepts null activityLevel and null sexAtBirth (clearing)", () => {
    expect(
      validateProfilePatch({
        activityLevel: null,
        sexAtBirth: null,
      }),
    ).toBeNull();
  });

  it("rejects an invalid activityLevel value", () => {
    expect(
      validateProfilePatch({
        // Deliberately invalid; cast to bypass the type narrowing
        // so the validator's run-time reject path is exercised.
        activityLevel: "vigorously_active" as unknown as never,
      }),
    ).toEqual({
      kind: "invalid_activity_level",
      value: "vigorously_active",
    });
  });

  it("rejects an invalid sexAtBirth value", () => {
    expect(
      validateProfilePatch({
        sexAtBirth: "other" as unknown as never,
      }),
    ).toEqual({ kind: "invalid_sex_at_birth", value: "other" });
  });

  it("applies activityLevel and sexAtBirth via applyProfilePatch", () => {
    const stored = baseStored();
    const next = applyProfilePatch(
      stored,
      { activityLevel: "very_active", sexAtBirth: "male" },
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(next.activityLevel).toBe("very_active");
    expect(next.sexAtBirth).toBe("male");
  });

  it("clears activityLevel and sexAtBirth when the patch sets null", () => {
    const stored = baseStored({
      activityLevel: "moderately_active",
      sexAtBirth: "female",
    });
    const next = applyProfilePatch(
      stored,
      { activityLevel: null, sexAtBirth: null },
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(next.activityLevel).toBeNull();
    expect(next.sexAtBirth).toBeNull();
  });

  it("accepts valid aiProvider patch (gemini)", () => {
    expect(validateProfilePatch({ aiProvider: "gemini" })).toBeNull();
  });

  it("rejects an invalid aiProvider value", () => {
    expect(
      validateProfilePatch({
        aiProvider: "mistral" as unknown as never,
      }),
    ).toEqual({ kind: "invalid_ai_provider", value: "mistral" });
  });

  it("applies aiProvider via applyProfilePatch", () => {
    const stored = baseStored({ aiProvider: "gemini" });
    const next = applyProfilePatch(
      stored,
      { aiProvider: "gemini" },
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(next.aiProvider).toBe("gemini");
  });
});
