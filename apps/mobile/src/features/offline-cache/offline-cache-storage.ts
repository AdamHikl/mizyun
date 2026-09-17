import * as SecureStore from "expo-secure-store";
import { profileSchema, type Profile } from "@mizyun/contracts";
import {
  ChunkedStorage,
  type StringStorage,
} from "@mizyun/adapter-supabase-mobile";
import type {
  DailySummary,
  EnergySummary,
  LatestWeight,
  NutritionReview,
} from "../dashboard/dashboard-data";

export interface DashboardMetricsData {
  readonly caloriesToday: number | null;
  readonly macros: DailySummary | null;
  readonly latestWeightKg: number | null;
  readonly workoutsInReview: number | null;
  readonly energy: EnergySummary | null;
  readonly nutritionReview: NutritionReview | null;
}

export interface CachedProfileSnapshot {
  readonly version: 1;
  readonly userId: string;
  readonly cachedAt: string;
  readonly profile: Profile;
}

export interface CachedDashboardSnapshot {
  readonly version: 1;
  readonly userId: string;
  readonly cachedAt: string;
  readonly localDate: string;
  readonly reviewPeriod: "week" | "month";
  readonly data: DashboardMetricsData;
}

export interface SaveDashboardInput {
  readonly localDate: string;
  readonly reviewPeriod: "week" | "month";
  readonly data: DashboardMetricsData;
}

export interface LoadDashboardOptions {
  /**
   * Maximum allowed age in milliseconds for a cached dashboard snapshot.
   * Defaults to 48 hours (172,800,000 ms).
   */
  readonly maxAgeMs?: number;
  /**
   * If true, requires candidate.localDate to match the requested localDate.
   * Defaults to false.
   */
  readonly requireExactDate?: boolean;
}

export const DEFAULT_MAX_DASHBOARD_CACHE_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

export const profileCacheKey = (userId: string): string =>
  `mizyun.offline-cache.profile.${userId}`;

export const dashboardCacheKey = (userId: string): string =>
  `mizyun.offline-cache.dashboard.${userId}`;

const defaultSecureStorePrimitive: StringStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key).catch(() => {}),
};

export const createDefaultOfflineCacheStorage = (): StringStorage =>
  new ChunkedStorage(defaultSecureStorePrimitive, 1800);

export const saveCachedProfile = async (
  userId: string,
  profile: Profile,
  store: StringStorage = createDefaultOfflineCacheStorage(),
  now: () => Date = () => new Date(),
): Promise<boolean> => {
  try {
    if (!userId || profile.userId !== userId) {
      return false;
    }
    const snapshot: CachedProfileSnapshot = {
      version: 1,
      userId,
      cachedAt: now().toISOString(),
      profile,
    };
    await store.setItem(profileCacheKey(userId), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
};

export const loadCachedProfile = async (
  userId: string,
  store: StringStorage = createDefaultOfflineCacheStorage(),
): Promise<CachedProfileSnapshot | null> => {
  if (!userId) return null;
  const key = profileCacheKey(userId);
  try {
    const raw = await store.getItem(key);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await store.removeItem(key).catch(() => {});
      return null;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      !("userId" in parsed) ||
      !("profile" in parsed) ||
      !("cachedAt" in parsed)
    ) {
      await store.removeItem(key).catch(() => {});
      return null;
    }

    const candidate = parsed as CachedProfileSnapshot;
    if (candidate.version !== 1 || candidate.userId !== userId) {
      return null;
    }

    const profileParsed = profileSchema.safeParse(candidate.profile);
    if (!profileParsed.success) {
      await store.removeItem(key).catch(() => {});
      return null;
    }

    return {
      version: 1,
      userId: candidate.userId,
      cachedAt: candidate.cachedAt,
      profile: profileParsed.data,
    };
  } catch {
    return null;
  }
};

export const saveCachedDashboard = async (
  userId: string,
  input: SaveDashboardInput,
  store: StringStorage = createDefaultOfflineCacheStorage(),
  now: () => Date = () => new Date(),
): Promise<boolean> => {
  try {
    if (!userId) return false;
    const snapshot: CachedDashboardSnapshot = {
      version: 1,
      userId,
      cachedAt: now().toISOString(),
      localDate: input.localDate,
      reviewPeriod: input.reviewPeriod,
      data: input.data,
    };
    await store.setItem(dashboardCacheKey(userId), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
};

export const loadCachedDashboard = async (
  userId: string,
  localDate: string,
  store: StringStorage = createDefaultOfflineCacheStorage(),
  options: LoadDashboardOptions = {},
  now: () => Date = () => new Date(),
): Promise<CachedDashboardSnapshot | null> => {
  if (!userId) return null;
  const key = dashboardCacheKey(userId);
  try {
    const raw = await store.getItem(key);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await store.removeItem(key).catch(() => {});
      return null;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      !("userId" in parsed) ||
      !("localDate" in parsed) ||
      !("reviewPeriod" in parsed) ||
      !("data" in parsed) ||
      !("cachedAt" in parsed)
    ) {
      await store.removeItem(key).catch(() => {});
      return null;
    }

    const candidate = parsed as CachedDashboardSnapshot;
    if (candidate.version !== 1 || candidate.userId !== userId) {
      return null;
    }

    if (options.requireExactDate && candidate.localDate !== localDate) {
      return null;
    }

    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_DASHBOARD_CACHE_AGE_MS;
    const cachedTime = new Date(candidate.cachedAt).getTime();
    const currentTime = now().getTime();
    if (
      Number.isNaN(cachedTime) ||
      currentTime - cachedTime > maxAgeMs ||
      currentTime < cachedTime - 60_000 // future drift tolerance 1 min
    ) {
      await store.removeItem(key).catch(() => {});
      return null;
    }

    if (
      typeof candidate.data !== "object" ||
      candidate.data === null ||
      !("caloriesToday" in candidate.data) ||
      !("macros" in candidate.data) ||
      !("energy" in candidate.data)
    ) {
      await store.removeItem(key).catch(() => {});
      return null;
    }

    return candidate;
  } catch {
    return null;
  }
};

export const purgeOfflineCache = async (
  userId: string,
  store: StringStorage = createDefaultOfflineCacheStorage(),
): Promise<void> => {
  if (!userId) return;
  await Promise.allSettled([
    store.removeItem(profileCacheKey(userId)),
    store.removeItem(dashboardCacheKey(userId)),
  ]);
};
