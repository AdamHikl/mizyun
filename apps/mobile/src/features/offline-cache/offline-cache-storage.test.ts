import { describe, expect, it } from "vitest";
import type { Profile } from "@mizyun/contracts";
import type { StringStorage } from "@mizyun/adapter-supabase-mobile";
import {
  dashboardCacheKey,
  dashboardIndexKey,
  loadCachedDashboard,
  loadCachedProfile,
  profileCacheKey,
  purgeOfflineCache,
  loadCachedTodayRow,
  saveCachedTodayRow,
  todayRowCacheKey,
  todayRowGeneration,
  saveCachedDashboard,
  saveCachedProfile,
  type DashboardMetricsData,
} from "./offline-cache-storage";

describe("dashboard snapshot timezone scope", () => {
  it("does not restore a same-date snapshot calculated with a different UTC offset", async () => {
    const store = new MemoryStorage();
    const now = () => new Date("2026-10-04T10:18:00Z");
    await saveCachedDashboard(
      "synthetic-owner",
      {
        localDate: "2026-10-04",
        reviewPeriod: "week",
        utcOffsetMinutes: 120,
        data: mockDashboardData,
      },
      store,
      now,
    );
    const matching = await loadCachedDashboard(
      "synthetic-owner",
      "2026-10-04",
      store,
      {
        reviewPeriod: "week",
        utcOffsetMinutes: 120,
      },
      now,
    );
    expect(matching?.data.caloriesToday).toBe(mockDashboardData.caloriesToday);
    expect(
      await loadCachedDashboard(
        "synthetic-owner",
        "2026-10-04",
        store,
        {
          reviewPeriod: "week",
          utcOffsetMinutes: 180,
        },
        now,
      ),
    ).toBeNull();
  });

  it("rejects a legacy unscoped snapshot when the caller requires a verified UTC offset", async () => {
    const store = new MemoryStorage();
    const now = () => new Date("2026-10-04T10:18:00Z");
    await saveCachedDashboard(
      "synthetic-owner",
      {
        localDate: "2026-10-04",
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
      now,
    );
    expect(
      await loadCachedDashboard(
        "synthetic-owner",
        "2026-10-04",
        store,
        {
          reviewPeriod: "week",
          utcOffsetMinutes: 120,
        },
        now,
      ),
    ).toBeNull();
  });
});

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

  it("remembers a Today row per account and local day and purges it", async () => {
    const store = new MemoryStorage();
    const userA = "00000000-0000-0000-0000-000000000001";
    const userB = "00000000-0000-0000-0000-000000000002";
    const day = "2026-10-23";
    await saveCachedTodayRow(
      userA,
      "evening-stretch",
      day,
      "Legs · about 4 min",
      todayRowGeneration(userA),
      store,
    );
    await saveCachedTodayRow(
      userB,
      "logging-consistency",
      day,
      null,
      todayRowGeneration(userB),
      store,
    );

    expect(
      await loadCachedTodayRow(userA, "evening-stretch", day, store),
    ).toEqual({ value: "Legs · about 4 min" });
    expect(
      await loadCachedTodayRow(userA, "evening-stretch", "2026-10-24", store),
    ).toBeNull();
    expect(
      await loadCachedTodayRow(userB, "evening-stretch", day, store),
    ).toBeNull();
    expect(
      await loadCachedTodayRow(userB, "logging-consistency", day, store),
    ).toEqual({ value: null });

    await purgeOfflineCache(userA, store);
    expect(
      await store.getItem(todayRowCacheKey(userA, "evening-stretch")),
    ).toBeNull();
    expect(
      await loadCachedTodayRow(userB, "logging-consistency", day, store),
    ).toEqual({ value: null });
  });

  it("drops a Today row read that began before account cleanup", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-0000-0000-000000000003";
    const generation = todayRowGeneration(userId);
    await purgeOfflineCache(userId, store);
    expect(
      await saveCachedTodayRow(
        userId,
        "logging-consistency",
        "2026-10-23",
        { daysLoggedThisWeek: 5 },
        generation,
        store,
      ),
    ).toBe(false);
    expect(
      await store.getItem(todayRowCacheKey(userId, "logging-consistency")),
    ).toBeNull();
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

  it("returns null when saving with reviewPeriod 'week' and loading with 'month'", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-0000-0000-000000000001";
    const date = "2026-09-21";

    await saveCachedDashboard(
      userId,
      {
        localDate: date,
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
    );

    // Loading with "month" as argument must return null
    const loadedArg = await loadCachedDashboard(userId, date, "month", store);
    expect(loadedArg).toBeNull();

    // Loading with "month" in options must also return null
    const loadedOpt = await loadCachedDashboard(userId, date, store, {
      reviewPeriod: "month",
    });
    expect(loadedOpt).toBeNull();

    // Loading with "week" returns the snapshot
    const loadedWeek = await loadCachedDashboard(userId, date, "week", store);
    expect(loadedWeek).not.toBeNull();
    expect(loadedWeek?.reviewPeriod).toBe("week");
  });

  it("returns null by default when saving with date D1 and loading with date D2 (requireExactDate: true)", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-0000-0000-000000000001";
    const dateD1 = "2026-09-20";
    const dateD2 = "2026-09-21";

    await saveCachedDashboard(
      userId,
      {
        localDate: dateD1,
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
    );

    // Default loadCachedDashboard options (no options passed) -> requireExactDate is true -> null
    const loadedDefault = await loadCachedDashboard(userId, dateD2, store);
    expect(loadedDefault).toBeNull();

    // With explicit empty options -> requireExactDate defaults to true -> null
    const loadedEmptyOpts = await loadCachedDashboard(
      userId,
      dateD2,
      store,
      {},
    );
    expect(loadedEmptyOpts).toBeNull();

    // With explicit requireExactDate: false -> returns candidate from date D1
    const loadedAllowMismatch = await loadCachedDashboard(
      userId,
      dateD2,
      store,
      { requireExactDate: false },
    );
    expect(loadedAllowMismatch).not.toBeNull();
    expect(loadedAllowMismatch?.localDate).toBe(dateD1);
  });

  it("persists concurrent saves for 'week' and 'month' on the same date independently without overwriting each other", async () => {
    const store = new MemoryStorage();
    const userId = "00000000-0000-0000-0000-000000000001";
    const date = "2026-09-21";

    const weekData: DashboardMetricsData = {
      ...mockDashboardData,
      caloriesToday: 2100,
      workoutsInReview: 4,
    };

    const monthData: DashboardMetricsData = {
      ...mockDashboardData,
      caloriesToday: 2500,
      workoutsInReview: 18,
    };

    // Run saves concurrently
    const [savedWeek, savedMonth] = await Promise.all([
      saveCachedDashboard(
        userId,
        {
          localDate: date,
          reviewPeriod: "week",
          data: weekData,
        },
        store,
      ),
      saveCachedDashboard(
        userId,
        {
          localDate: date,
          reviewPeriod: "month",
          data: monthData,
        },
        store,
      ),
    ]);

    expect(savedWeek).toBe(true);
    expect(savedMonth).toBe(true);

    // Verify both segmented keys exist in the store
    const weekKey = dashboardCacheKey(userId, date, "week");
    const monthKey = dashboardCacheKey(userId, date, "month");
    expect(await store.getItem(weekKey)).not.toBeNull();
    expect(await store.getItem(monthKey)).not.toBeNull();

    // Verify independent loading returns the correct respective data
    const loadedWeek = await loadCachedDashboard(userId, date, "week", store);
    expect(loadedWeek).not.toBeNull();
    expect(loadedWeek?.reviewPeriod).toBe("week");
    expect(loadedWeek?.data.caloriesToday).toBe(2100);
    expect(loadedWeek?.data.workoutsInReview).toBe(4);

    const loadedMonth = await loadCachedDashboard(userId, date, "month", store);
    expect(loadedMonth).not.toBeNull();
    expect(loadedMonth?.reviewPeriod).toBe("month");
    expect(loadedMonth?.data.caloriesToday).toBe(2500);
    expect(loadedMonth?.data.workoutsInReview).toBe(18);

    // Verify index contains both keys
    const rawIndex = await store.getItem(dashboardIndexKey(userId));
    expect(rawIndex).not.toBeNull();
    const parsedIndex = JSON.parse(rawIndex!) as string[];
    expect(parsedIndex).toContain(weekKey);
    expect(parsedIndex).toContain(monthKey);
  });

  it("purges all segmented cache keys and the index key on purgeOfflineCache", async () => {
    const store = new MemoryStorage();
    const userA = "00000000-0000-0000-0000-000000000001";
    const userB = "00000000-0000-0000-0000-000000000002";

    // User A has multiple segmented dashboard caches
    await saveCachedProfile(userA, mockProfile(userA), store);
    await saveCachedDashboard(
      userA,
      {
        localDate: "2026-09-20",
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
    );
    await saveCachedDashboard(
      userA,
      {
        localDate: "2026-09-20",
        reviewPeriod: "month",
        data: mockDashboardData,
      },
      store,
    );
    await saveCachedDashboard(
      userA,
      {
        localDate: "2026-09-21",
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
    );

    // User B also has cached data
    await saveCachedProfile(userB, mockProfile(userB), store);
    await saveCachedDashboard(
      userB,
      {
        localDate: "2026-09-21",
        reviewPeriod: "week",
        data: mockDashboardData,
      },
      store,
    );

    const userASegmentedKey1 = dashboardCacheKey(userA, "2026-09-20", "week");
    const userASegmentedKey2 = dashboardCacheKey(userA, "2026-09-20", "month");
    const userASegmentedKey3 = dashboardCacheKey(userA, "2026-09-21", "week");
    const userAIndexKey = dashboardIndexKey(userA);

    const userBSegmentedKey = dashboardCacheKey(userB, "2026-09-21", "week");
    const userBIndexKey = dashboardIndexKey(userB);

    // Preconditions: all exist
    expect(await store.getItem(userASegmentedKey1)).not.toBeNull();
    expect(await store.getItem(userASegmentedKey2)).not.toBeNull();
    expect(await store.getItem(userASegmentedKey3)).not.toBeNull();
    expect(await store.getItem(userAIndexKey)).not.toBeNull();

    // Purge user A
    await purgeOfflineCache(userA, store);

    // User A keys must all be purged
    expect(await store.getItem(profileCacheKey(userA))).toBeNull();
    expect(await store.getItem(dashboardCacheKey(userA))).toBeNull();
    expect(await store.getItem(userASegmentedKey1)).toBeNull();
    expect(await store.getItem(userASegmentedKey2)).toBeNull();
    expect(await store.getItem(userASegmentedKey3)).toBeNull();
    expect(await store.getItem(userAIndexKey)).toBeNull();

    // User B keys must remain untouched
    expect(await store.getItem(profileCacheKey(userB))).not.toBeNull();
    expect(await store.getItem(dashboardCacheKey(userB))).not.toBeNull();
    expect(await store.getItem(userBSegmentedKey)).not.toBeNull();
    expect(await store.getItem(userBIndexKey)).not.toBeNull();
  });
});

describe("offline purge recovery and owner isolation", () => {
  it("retains the index after failed segment deletion and retries it", async () => {
    const store = new MemoryStorage();
    const key = dashboardCacheKey("owner", "2026-10-08", "week");
    store.map.set(key, "private");
    store.map.set(dashboardIndexKey("owner"), JSON.stringify([key]));
    const remove = store.removeItem.bind(store);
    let fail = true;
    store.removeItem = async (k) => {
      if (k === key && fail) throw new Error("disk failed");
      await remove(k);
    };
    await expect(purgeOfflineCache("owner", store)).rejects.toThrow(
      "Offline account cache cleanup is incomplete.",
    );
    expect(store.map.has(dashboardIndexKey("owner"))).toBe(true);
    fail = false;
    await purgeOfflineCache("owner", store);
    expect(store.map.has(key)).toBe(false);
    expect(store.map.has(dashboardIndexKey("owner"))).toBe(false);
  });

  it("rejects an index pointing at another account without deleting its data", async () => {
    const store = new MemoryStorage();
    const key = dashboardCacheKey("other", "2026-10-08", "week");
    store.map.set(key, "other private data");
    store.map.set(dashboardIndexKey("owner"), JSON.stringify([key]));
    await expect(purgeOfflineCache("owner", store)).rejects.toThrow(
      "Offline account cache cleanup is incomplete.",
    );
    expect(store.map.get(key)).toBe("other private data");
  });

  it("reports unreadable cache inventory while still removing known caches", async () => {
    const store = new MemoryStorage();
    store.map.set(profileCacheKey("owner"), "private");
    store.getItem = async () => {
      throw new Error("disk failed");
    };
    await expect(purgeOfflineCache("owner", store)).rejects.toThrow(
      "Offline account cache cleanup is incomplete.",
    );
    expect(store.map.has(profileCacheKey("owner"))).toBe(false);
  });
});
