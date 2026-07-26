import { describe, expect, it } from "vitest";

import { coachingPreferencesSchema, profilePatchSchema } from "./index";

const completePreferences = {
  experienceLevel: "intermediate" as const,
  trainingDaysPerWeek: 4,
  sessionDurationMinutes: 60,
  trainingFocus: "strength" as const,
  availableEquipment: ["barbell", "rack"] as const,
  dietaryPreferences: ["vegetarian", "lactose_free"] as const,
  trainingLimitations: ["no_running"] as const,
};

describe("coachingPreferencesSchema", () => {
  it("accepts closed normalized personalization", () => {
    expect(coachingPreferencesSchema.parse(completePreferences)).toEqual(
      completePreferences,
    );
  });

  it("rejects duplicate values and conflicting base diets", () => {
    expect(
      coachingPreferencesSchema.safeParse({
        ...completePreferences,
        availableEquipment: ["barbell", "barbell"],
      }).success,
    ).toBe(false);
    expect(
      coachingPreferencesSchema.safeParse({
        ...completePreferences,
        dietaryPreferences: ["omnivore", "vegan"],
      }).success,
    ).toBe(false);
  });

  it("is accepted as the only profile patch field", () => {
    expect(
      profilePatchSchema.safeParse({
        coachingPreferences: completePreferences,
      }).success,
    ).toBe(true);
  });
});
