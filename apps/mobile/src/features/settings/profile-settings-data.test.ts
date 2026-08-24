import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { Profile } from "@mizyun/contracts";

import {
  profileSettingsFormFromProfile,
  saveProfileSettings,
  validateProfileSettingsForm,
} from "./profile-settings-data";

const mockProfile: Profile = {
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Adam",
  unitSystem: "metric",
  timezone: "UTC",
  heightCm: 180,
  birthYear: 1995,
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
  aiProvider: "mistral",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("profile-settings-data", () => {
  it("converts profile to form values", () => {
    const form = profileSettingsFormFromProfile(mockProfile);
    expect(form).toEqual({
      displayName: "Adam",
      unitSystem: "metric",
      height: "180",
      birthYear: "1995",
      activityLevel: "moderately_active",
      sexAtBirth: "male",
    });
  });

  it("converts imperial profile height to inches in form", () => {
    const imperialProfile: Profile = {
      ...mockProfile,
      unitSystem: "imperial",
      heightCm: 177.8,
    };
    const form = profileSettingsFormFromProfile(imperialProfile);
    expect(form.height).toBe("70");
  });

  it("validates and creates patch for valid inputs", () => {
    const validation = validateProfileSettingsForm(
      {
        displayName: "Adam H",
        unitSystem: "metric",
        height: "182",
        birthYear: "1994",
        activityLevel: "very_active",
        sexAtBirth: "male",
      },
      2026,
    );
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.patch).toEqual({
        displayName: "Adam H",
        unitSystem: "metric",
        heightCm: 182,
        birthYear: 1994,
        activityLevel: "very_active",
        sexAtBirth: "male",
      });
    }
  });

  it("rejects blank display name", () => {
    const validation = validateProfileSettingsForm(
      {
        displayName: "   ",
        unitSystem: "metric",
        height: "180",
        birthYear: "1995",
        activityLevel: "moderately_active",
        sexAtBirth: "male",
      },
      2026,
    );
    expect(validation.ok).toBe(false);
  });

  it("rejects out-of-range height", () => {
    const validation = validateProfileSettingsForm(
      {
        displayName: "Adam",
        unitSystem: "metric",
        height: "350",
        birthYear: "1995",
        activityLevel: "moderately_active",
        sexAtBirth: "male",
      },
      2026,
    );
    expect(validation.ok).toBe(false);
  });

  it("saves profile settings via ApiClient", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: { profile: mockProfile },
    });
    const client = { request } as unknown as ApiClient;

    const result = await saveProfileSettings(client, {
      displayName: "Adam New",
      unitSystem: "metric",
    });

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/v1/profile",
        body: { displayName: "Adam New", unitSystem: "metric" },
      }),
    );
  });
});
