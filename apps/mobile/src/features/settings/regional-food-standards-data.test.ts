import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { Profile } from "@mizyun/contracts";

import {
  getCountryStandardDisplay,
  saveCountryStandard,
} from "./regional-food-standards-data";

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
    experienceLevel: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    trainingFocus: "hypertrophy",
    availableEquipment: ["dumbbells", "barbell"],
    dietaryPreferences: ["omnivore"],
    trainingLimitations: [],
    countryCode: "SK",
  },
  planTier: "free",
  aiProvider: "gemini",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("regional-food-standards-data", () => {
  describe("getCountryStandardDisplay", () => {
    it("formats known valid country code", () => {
      const display = getCountryStandardDisplay("SK");
      expect(display.isGlobal).toBe(false);
      expect(display.code).toBe("SK");
      expect(display.countryName).toBe("Slovakia");
      expect(display.label).toBe("Slovakia (SK)");
    });

    it("formats lowercase country code after normalization", () => {
      const display = getCountryStandardDisplay("cz");
      expect(display.isGlobal).toBe(false);
      expect(display.code).toBe("CZ");
      expect(display.countryName).toBe("Czechia");
      expect(display.label).toBe("Czechia (CZ)");
    });

    it("returns global standard when code is null or empty", () => {
      const displayNull = getCountryStandardDisplay(null);
      expect(displayNull.isGlobal).toBe(true);
      expect(displayNull.code).toBeNull();
      expect(displayNull.countryName).toBeNull();
      expect(displayNull.label).toContain("Global standard");

      const displayEmpty = getCountryStandardDisplay("");
      expect(displayEmpty.isGlobal).toBe(true);
      expect(displayEmpty.code).toBeNull();
    });

    it("handles invalid or non-2-letter code as global fallback", () => {
      const display = getCountryStandardDisplay("USA");
      expect(display.isGlobal).toBe(true);
      expect(display.code).toBeNull();
    });
  });

  describe("saveCountryStandard", () => {
    it("updates country code while preserving other coaching preferences", async () => {
      let capturedBody: unknown;
      const mockClient = {
        request: vi.fn().mockImplementation(async ({ body }) => {
          capturedBody = body;
          return {
            ok: true,
            value: {
              profile: {
                ...mockProfile,
                coachingPreferences: {
                  ...mockProfile.coachingPreferences,
                  countryCode: "FR",
                },
              },
            },
          };
        }),
      } as unknown as ApiClient;

      const result = await saveCountryStandard(mockClient, mockProfile, "fr");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.profile.coachingPreferences?.countryCode).toBe("FR");
      }

      expect(capturedBody).toEqual({
        coachingPreferences: {
          ...mockProfile.coachingPreferences,
          countryCode: "FR",
        },
      });
    });

    it("resets country code to null for global standard", async () => {
      let capturedBody: unknown;
      const mockClient = {
        request: vi.fn().mockImplementation(async ({ body }) => {
          capturedBody = body;
          return {
            ok: true,
            value: {
              profile: {
                ...mockProfile,
                coachingPreferences: {
                  ...mockProfile.coachingPreferences,
                  countryCode: null,
                },
              },
            },
          };
        }),
      } as unknown as ApiClient;

      const result = await saveCountryStandard(mockClient, mockProfile, null);
      expect(result.ok).toBe(true);
      expect(capturedBody).toEqual({
        coachingPreferences: {
          ...mockProfile.coachingPreferences,
          countryCode: null,
        },
      });
    });

    it("resets country code to null when passed whitespace or empty string", async () => {
      let capturedBody: unknown;
      const mockClient = {
        request: vi.fn().mockImplementation(async ({ body }) => {
          capturedBody = body;
          return {
            ok: true,
            value: {
              profile: {
                ...mockProfile,
                coachingPreferences: {
                  ...mockProfile.coachingPreferences,
                  countryCode: null,
                },
              },
            },
          };
        }),
      } as unknown as ApiClient;

      const result = await saveCountryStandard(mockClient, mockProfile, "   ");
      expect(result.ok).toBe(true);
      expect(capturedBody).toEqual({
        coachingPreferences: {
          ...mockProfile.coachingPreferences,
          countryCode: null,
        },
      });
    });

    it("rejects invalid country code with validation error before sending network request", async () => {
      const mockClient = {
        request: vi.fn(),
      } as unknown as ApiClient;

      const result = await saveCountryStandard(
        mockClient,
        mockProfile,
        "INVALID",
      );
      expect(result.ok).toBe(false);
      expect(mockClient.request).not.toHaveBeenCalled();
      if (!result.ok) {
        expect(result.message).toContain("2-letter uppercase ISO code");
      }
    });

    it("returns friendly error message on network failure", async () => {
      const mockClient = {
        request: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: "network_error", message: "offline" },
        }),
      } as unknown as ApiClient;

      const result = await saveCountryStandard(mockClient, mockProfile, "DE");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.isNetworkError).toBe(true);
        expect(result.message).toContain("Could not reach Mizyun");
      }
    });
  });
});
