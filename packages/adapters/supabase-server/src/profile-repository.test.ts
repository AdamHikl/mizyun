import { describe, expect, it, vi } from "vitest";

import type { StoredProfile } from "@mizyun/core";

import { SupabaseProfileRepository } from "./profile-repository.js";
import { RepositoryError } from "./repository-error.js";
import type {
  RepositorySupabaseClient,
  RepositorySingleResult,
  RepositoryListResult,
} from "./index.js";

/**
 * Build a mock RepositorySupabaseClient whose `from(table).select/insert/update`
 * chain returns the caller-controlled row(s) / error. The mock is
 * typed against `unknown` because the real builder is generic in
 * the row shape; tests cast at the boundary when they need to
 * assert on a specific shape.
 */
const fakeClient = (opts: {
  selectMaybeSingle?: RepositorySingleResult<unknown>;
  insertSingle?: RepositorySingleResult<unknown>;
  updateSingle?: RepositorySingleResult<unknown>;
}): RepositorySupabaseClient => ({
  from: (_t?: string) => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi
        .fn()
        .mockResolvedValue(opts.insertSingle ?? opts.updateSingle ?? null),
      maybeSingle: vi.fn().mockResolvedValue(opts.selectMaybeSingle ?? null),
      then: (resolve: (v: RepositoryListResult<unknown>) => void) => {
        resolve({ data: [], error: null });
      },
    };
    return builder as unknown as never;
  },
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  auth: {
    setSession: vi.fn().mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      error: null,
    }),
  },
});

describe("SupabaseProfileRepository.getOrCreate", () => {
  it("returns the existing profile row when present", async () => {
    const client = fakeClient({
      selectMaybeSingle: {
        data: {
          id: "00000000-0000-4000-8000-000000000001",
          display_name: "Adam",
          unit_system: "metric",
          timezone: "UTC",
          birth_year: 1990,
          height_cm: 175,
          activity_level: null,
          sex_at_birth: null,
          coaching_preferences: {
            experienceLevel: "beginner",
            trainingDaysPerWeek: 3,
            sessionDurationMinutes: 45,
            trainingFocus: "balanced",
            availableEquipment: ["dumbbells"],
            dietaryPreferences: ["vegetarian"],
            trainingLimitations: ["low_impact_only"],
          },
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        error: null,
      },
    });
    const repo = new SupabaseProfileRepository({
      clientFor: () => client,
    });
    const profile = await repo.getOrCreate(
      "00000000-0000-4000-8000-000000000001" as StoredProfile["userId"],
      {
        now: new Date(),
        accessToken: "token",
      },
    );
    expect(profile.displayName).toBe("Adam");
    expect(profile.coachingPreferences).toMatchObject({
      experienceLevel: "beginner",
      trainingDaysPerWeek: 3,
      availableEquipment: ["dumbbells"],
    });
    expect(profile.userId).toBe(
      "00000000-0000-4000-8000-000000000001" as StoredProfile["userId"],
    );
  });

  it("throws when the existing-row query returns an error", async () => {
    const client = fakeClient({
      selectMaybeSingle: {
        data: null,
        error: { message: "permission denied" },
      },
    });
    const repo = new SupabaseProfileRepository({
      clientFor: () => client,
    });
    await expect(
      repo.getOrCreate(
        "00000000-0000-4000-8000-000000000001" as StoredProfile["userId"],
        { now: new Date(), accessToken: "token" },
      ),
    ).rejects.toBeInstanceOf(RepositoryError);
  });

  it("inserts when no row exists and returns the inserted shape", async () => {
    const client = fakeClient({
      selectMaybeSingle: { data: null, error: null },
      insertSingle: {
        data: {
          id: "00000000-0000-4000-8000-000000000001",
          display_name: null,
          unit_system: "metric",
          timezone: "UTC",
          birth_year: null,
          height_cm: null,
          activity_level: null,
          sex_at_birth: null,
          created_at: "2026-07-17T00:00:00.000Z",
          updated_at: "2026-07-17T00:00:00.000Z",
        },
        error: null,
      },
    });
    const repo = new SupabaseProfileRepository({
      clientFor: () => client,
    });
    const profile = await repo.getOrCreate(
      "00000000-0000-4000-8000-000000000001" as StoredProfile["userId"],
      { now: new Date(), accessToken: "token" },
    );
    expect(profile.displayName).toBeNull();
    expect(profile.unitSystem).toBe("metric");
  });
});

describe("SupabaseProfileRepository.update", () => {
  it("returns the updated row on success", async () => {
    const client = fakeClient({
      updateSingle: {
        data: {
          id: "00000000-0000-4000-8000-000000000001",
          display_name: "Adam",
          unit_system: "imperial",
          timezone: "UTC",
          birth_year: 1990,
          height_cm: 180,
          activity_level: "moderately_active",
          sex_at_birth: "male",
          coaching_preferences: {
            experienceLevel: "intermediate",
            trainingDaysPerWeek: 4,
            sessionDurationMinutes: 60,
            trainingFocus: "strength",
            availableEquipment: ["full_gym"],
            dietaryPreferences: ["omnivore"],
            trainingLimitations: [],
          },
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-07-17T12:00:00.000Z",
          ai_provider: "gemini",
        },
        error: null,
      },
    });
    const repo = new SupabaseProfileRepository({
      clientFor: () => client,
    });
    const stored = await repo.update(
      "00000000-0000-4000-8000-000000000001" as StoredProfile["userId"],
      {
        userId:
          "00000000-0000-4000-8000-000000000001" as StoredProfile["userId"],
        displayName: "Adam",
        unitSystem: "imperial",
        timezone: "UTC",
        birthYear: 1990,
        heightCm: 180,
        activityLevel: "moderately_active",
        sexAtBirth: "male",
        coachingPreferences: {
          experienceLevel: "intermediate",
          trainingDaysPerWeek: 4,
          sessionDurationMinutes: 60,
          trainingFocus: "strength",
          availableEquipment: ["full_gym"],
          dietaryPreferences: ["omnivore"],
          trainingLimitations: [],
        },
        planTier: "free",
        aiProvider: "gemini",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-17T12:00:00.000Z"),
      },
      { accessToken: "token" },
    );
    expect(stored.unitSystem).toBe("imperial");
    expect(stored.activityLevel).toBe("moderately_active");
    expect(stored.sexAtBirth).toBe("male");
    expect(stored.aiProvider).toBe("gemini");
    expect(stored.coachingPreferences.trainingFocus).toBe("strength");
  });

  it("throws when the update query returns an error", async () => {
    const client = fakeClient({
      updateSingle: {
        data: null,
        error: { message: "RLS rejection" },
      },
    });
    const repo = new SupabaseProfileRepository({
      clientFor: () => client,
    });
    await expect(
      repo.update(
        "00000000-0000-4000-8000-000000000001" as StoredProfile["userId"],
        {
          userId:
            "00000000-0000-4000-8000-000000000001" as StoredProfile["userId"],
          displayName: null,
          unitSystem: "metric",
          timezone: "UTC",
          birthYear: null,
          heightCm: null,
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
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { accessToken: "token" },
      ),
    ).rejects.toBeInstanceOf(RepositoryError);
  });
});
