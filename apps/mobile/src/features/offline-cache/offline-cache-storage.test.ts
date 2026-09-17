import { describe, expect, it } from "vitest";
import type { Profile } from "@mizyun/contracts";
import type { StringStorage } from "@mizyun/adapter-supabase-mobile";
import {
  dashboardCacheKey,
  loadCachedDashboard,
  loadCachedProfile,
  profileCacheKey,
  purgeOfflineCache,
  saveCachedDashboard,
  saveCachedProfile,
  type DashboardMetricsData,
} from "./offline-cache-storage";

class MemoryStorage implements StringStorage {
  public map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }
}

const mockProfile = (userId: string): Profile => ({
  userId,
  displayName: "Test User",
  unitSystem: "metric",
  timezone: "UTC",
  heightCm: 180,
  birthYear: 1990,
  sexAtBirth: "male",
  activityLevel: "moderately_active",
  planTier: "free",
  aiProvider: "gemini",
  coachingPreferences: {
    experienceLevel: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    trainingFocus: "hypertrophy",
    availableEquipment: ["full_gym"],
    dietaryPreferences: ["omnivore"],
    trainingLimitations: [],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const mockDashboardData: DashboardMetricsData = {
  caloriesToday: 1850,
  macros: {
    date: "2026-09-17",
    entryCount: 3,
    caloriesKcal: 1850,
    proteinG: 140,
    carbohydrateG: 200,
    fatG: 55,
  },
  latestWeightKg: 81.5,
  workoutsInReview: 3,
  energy: {
    formulaVersion: "mizyun-energy-v1",
    userId: "11111111-1111-4111-8111-111111111111",
    computedAt: "2026-09-17T08:00:00.000Z",
    complete: true,
    incompleteReason: null,
    ageYears: 30,
    bmrKcal: 1750,
    activityMultiplier: 1.5,
    tdeeKcal: 2400,
    exerciseKcal: 200,
    goalAdjustmentKcal: -300,
    dailyTargetKcal: 2100,
    targetProteinG: 160,
    targetCarbohydrateG: 220,
    targetFatG: 60,
    balanceKcal: 250,
    balanceUncertaintyKcal: 50,
    inputs: {
      weightKg: 81.5,
      heightCm: 180,
      birthYear: 1996,
      sexAtBirth: "male",
      activityLevel: "moderately_active",
      goalKind: "cut",
      goalPace: "steady",
    },
  },
  nutritionReview: {
    loggedDays: 4,
    entryCount: 12,
    caloriesKcal: 7400,
    incompleteDays: 0,
  },
};

describe("offline-cache-storage", () => {
  it("saves and loads cached profile for owner", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-0000-0000-000000000001";
    const profile = mockProfile(userId);
    const now = new Date("2026-09-17T10:00:00.000Z");

    const saved = await saveCachedProfile(userId, profile, store, () => now);
    expect(saved).toBe(true);

    const loaded = await loadCachedProfile(userId, store);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(1);
    expect(loaded?.userId).toBe(userId);
    expect(loaded?.cachedAt).toBe("2026-09-17T10:00:00.000Z");
    expect(loaded?.profile.displayName).toBe("Test User");
  });

  it("rejects profile save if userId does not match profile.userId", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-0000-0000-000000000001";
    const profile = mockProfile("00000000-0000-0000-0000-000000000002");

    const saved = await saveCachedProfile(userId, profile, store);
    expect(saved).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it("enforces strict owner scoping across user accounts", async () => {
    const store = new MemoryStorage();
    const userA = "00000000-0000-0000-0000-000000000001";
    const userB = "00000000-0000-0000-0000-000000000002";

    await saveCachedProfile(userA, mockProfile(userA), store);
    await saveCachedDashboard(
      userA,
      {
        localDate: "2026-09-17",
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
    );

    // User B must receive null for User A's data
    const profileB = await loadCachedProfile(userB, store);
    expect(profileB).toBeNull();

    const dashboardB = await loadCachedDashboard(userB, "2026-09-17", store);
    expect(dashboardB).toBeNull();
  });

  it("handles corrupted profile JSON gracefully and purges corrupt key", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-0000-0000-000000000001";
    const key = profileCacheKey(userId);

    // 1. Invalid JSON syntax
    await store.setItem(key, "invalid{json");
    const res1 = await loadCachedProfile(userId, store);
    expect(res1).toBeNull();
    expect(await store.getItem(key)).toBeNull(); // purged

    // 2. Missing envelope fields
    await store.setItem(key, JSON.stringify({ version: 1 }));
    const res2 = await loadCachedProfile(userId, store);
    expect(res2).toBeNull();
    expect(await store.getItem(key)).toBeNull();

    // 3. Invalid profile schema
    await store.setItem(
      key,
      JSON.stringify({
        version: 1,
        userId,
        cachedAt: new Date().toISOString(),
        profile: { unitSystem: "invalid" },
      }),
    );
    const res3 = await loadCachedProfile(userId, store);
    expect(res3).toBeNull();
    expect(await store.getItem(key)).toBeNull();
  });

  it("saves and loads cached dashboard snapshot", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-0000-0000-000000000001";
    const now = new Date("2026-09-17T12:00:00.000Z");

    const saved = await saveCachedDashboard(
      userId,
      {
        localDate: "2026-09-17",
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
      () => now,
    );
    expect(saved).toBe(true);

    const loaded = await loadCachedDashboard(
      userId,
      "2026-09-17",
      store,
      {},
      () => now,
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.data.caloriesToday).toBe(1850);
    expect(loaded?.data.latestWeightKg).toBe(81.5);
    expect(loaded?.localDate).toBe("2026-09-17");
  });

  it("respects maxAgeMs bounding and date requirements for dashboard", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-0000-0000-000000000001";
    const cachedTime = new Date("2026-09-15T12:00:00.000Z"); // 2 days ago

    await saveCachedDashboard(
      userId,
      {
        localDate: "2026-09-15",
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
      () => cachedTime,
    );

    // With requireExactDate: true and different date -> null
    const withinMaxAge = new Date("2026-09-15T18:00:00.000Z");
    const dateMismatch = await loadCachedDashboard(
      userId,
      "2026-09-16",
      store,
      { requireExactDate: true },
      () => withinMaxAge,
    );
    expect(dateMismatch).toBeNull();

    // With requireExactDate: false and within maxAge -> loads successfully
    const allowed = await loadCachedDashboard(
      userId,
      "2026-09-16",
      store,
      { requireExactDate: false },
      () => withinMaxAge,
    );
    expect(allowed).not.toBeNull();
    expect(allowed?.localDate).toBe("2026-09-15");

    // Current time is 49 hours later -> exceeds 48 hour default maxAge and eagerly evicts
    const futureTime = new Date("2026-09-17T14:00:00.000Z");
    const expired = await loadCachedDashboard(
      userId,
      "2026-09-17",
      store,
      {},
      () => futureTime,
    );
    expect(expired).toBeNull();
    // Key is purged
    expect(
      await store.getItem(`mizyun.offline-cache.dashboard.${userId}`),
    ).toBeNull();
  });

  it("purges all offline cache keys on purgeOfflineCache", async () => {
    const store = new MemoryStorage();
    const userA = "00000000-0000-0000-0000-000000000001";
    const userB = "00000000-0000-0000-0000-000000000002";

    await saveCachedProfile(userA, mockProfile(userA), store);
    await saveCachedDashboard(
      userA,
      {
        localDate: "2026-09-17",
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
    );

    await saveCachedProfile(userB, mockProfile(userB), store);

    // Purge user A
    await purgeOfflineCache(userA, store);

    // User A cache is completely gone
    expect(await store.getItem(profileCacheKey(userA))).toBeNull();
    expect(await store.getItem(dashboardCacheKey(userA))).toBeNull();

    // User B cache is completely untouched
    expect(await store.getItem(profileCacheKey(userB))).not.toBeNull();
  });

  it("simulates offline startup fallback and online reconnect refresh", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-4000-8000-000000000001";
    const initialProfile = mockProfile(userId);
    const initialDashboard = mockDashboardData;
    const initialTime = new Date("2026-09-17T08:00:00.000Z");

    // 1. Initial online session saves cache
    await saveCachedProfile(userId, initialProfile, store, () => initialTime);
    await saveCachedDashboard(
      userId,
      {
        localDate: "2026-09-17",
        reviewPeriod: "week",
        data: initialDashboard,
      },
      store,
      () => initialTime,
    );

    // 2. Offline startup: server fails/offline -> load from cache
    const offlineProfile = await loadCachedProfile(userId, store);
    const offlineDashboard = await loadCachedDashboard(
      userId,
      "2026-09-17",
      store,
      {},
      () => new Date("2026-09-17T09:00:00.000Z"),
    );

    expect(offlineProfile).not.toBeNull();
    expect(offlineProfile?.profile.displayName).toBe("Test User");
    expect(offlineDashboard).not.toBeNull();
    expect(offlineDashboard?.data.caloriesToday).toBe(1850);
    expect(offlineDashboard?.cachedAt).toBe("2026-09-17T08:00:00.000Z");

    // 3. Reconnect: fresh server data arrives and updates cache
    const freshProfile: Profile = {
      ...initialProfile,
      displayName: "Updated User",
      updatedAt: "2026-09-17T12:00:00.000Z",
    };
    const freshDashboard: DashboardMetricsData = {
      ...initialDashboard,
      caloriesToday: 2400,
    };
    const reconnectTime = new Date("2026-09-17T12:00:00.000Z");

    await saveCachedProfile(userId, freshProfile, store, () => reconnectTime);
    await saveCachedDashboard(
      userId,
      {
        localDate: "2026-09-17",
        reviewPeriod: "week",
        data: freshDashboard,
      },
      store,
      () => reconnectTime,
    );

    // 4. Verify fresh data replaced stale cache
    const updatedProfile = await loadCachedProfile(userId, store);
    const updatedDashboard = await loadCachedDashboard(
      userId,
      "2026-09-17",
      store,
      {},
      () => reconnectTime,
    );

    expect(updatedProfile?.profile.displayName).toBe("Updated User");
    expect(updatedProfile?.cachedAt).toBe("2026-09-17T12:00:00.000Z");
    expect(updatedDashboard?.data.caloriesToday).toBe(2400);
    expect(updatedDashboard?.cachedAt).toBe("2026-09-17T12:00:00.000Z");
  });

  it("guarantees complete cache isolation across user sign-out and switch", async () => {
    const store = new MemoryStorage();
    const userA = "00000000-0000-4000-8000-000000000001";
    const userB = "00000000-0000-4000-8000-000000000002";

    // User A logs in and populates cache
    await saveCachedProfile(userA, mockProfile(userA), store);
    await saveCachedDashboard(
      userA,
      {
        localDate: "2026-09-17",
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
    );

    // User A signs out -> purgeOfflineCache called
    await purgeOfflineCache(userA, store);

    // User B logs in without internet connection -> no cache available for User B
    const userBProfile = await loadCachedProfile(userB, store);
    const userBDashboard = await loadCachedDashboard(
      userB,
      "2026-09-17",
      store,
    );

    expect(userBProfile).toBeNull();
    expect(userBDashboard).toBeNull();

    // User A's cache is also confirmed empty
    expect(await loadCachedProfile(userA, store)).toBeNull();
    expect(await loadCachedDashboard(userA, "2026-09-17", store)).toBeNull();
  });
});
