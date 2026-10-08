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
  /** Older snapshots omit this and cannot satisfy an offset-scoped read. */
  readonly utcOffsetMinutes?: number;
  readonly data: DashboardMetricsData;
}

export interface SaveDashboardInput {
  readonly localDate: string;
  readonly reviewPeriod: "week" | "month";
  readonly utcOffsetMinutes?: number;
  readonly data: DashboardMetricsData;
}

export interface LoadDashboardOptions {
  /** Require the exact offset used to calculate local-day totals. */
  readonly utcOffsetMinutes?: number;
  /**
   * Maximum allowed age in milliseconds for a cached dashboard snapshot.
   * Defaults to 48 hours (172,800,000 ms).
   */
  readonly maxAgeMs?: number;
  /**
   * If true, requires candidate.localDate to match the requested localDate.
   * Defaults to true.
   */
  readonly requireExactDate?: boolean;
  /**
   * Optional review period to scope the cache lookup.
   */
  readonly reviewPeriod?: "week" | "month";
}

export const DEFAULT_MAX_DASHBOARD_CACHE_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

export const profileCacheKey = (userId: string): string =>
  `mizyun.offline-cache.profile.${userId}`;

export const dashboardCacheKey = (
  userId: string,
  localDate?: string,
  reviewPeriod?: "week" | "month",
): string => {
  if (localDate && reviewPeriod) {
    return `mizyun.offline-cache.dashboard.${userId}.${localDate}.${reviewPeriod}`;
  }
  return `mizyun.offline-cache.dashboard.${userId}`;
};

export const dashboardIndexKey = (userId: string): string =>
  `mizyun.offline-cache.dashboard-keys.${userId}`;

const indexLocks = new Map<string, Promise<unknown>>();

const withIndexLock = async <T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const previous = indexLocks.get(userId) ?? Promise.resolve();
  let resolveCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  const nextPromise = previous.then(
    () => current,
    () => current,
  );
  indexLocks.set(userId, nextPromise);

  await previous;
  try {
    return await fn();
  } finally {
    resolveCurrent();
    if (indexLocks.get(userId) === nextPromise) {
      indexLocks.delete(userId);
    }
  }
};

const isStringStorage = (val: unknown): val is StringStorage =>
  typeof val === "object" &&
  val !== null &&
  "getItem" in val &&
  typeof (val as Record<string, unknown>).getItem === "function";

const isLoadDashboardOptions = (val: unknown): val is LoadDashboardOptions =>
  typeof val === "object" && val !== null && !("getItem" in val);

const defaultSecureStorePrimitive: StringStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
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
      ...(input.utcOffsetMinutes !== undefined
        ? { utcOffsetMinutes: input.utcOffsetMinutes }
        : {}),
      data: input.data,
    };
    const serialized = JSON.stringify(snapshot);
    const segmentedKey = dashboardCacheKey(
      userId,
      input.localDate,
      input.reviewPeriod,
    );
    const legacyKey = dashboardCacheKey(userId);

    await store.setItem(segmentedKey, serialized);
    await store.setItem(legacyKey, serialized);

    await withIndexLock(userId, async () => {
      const indexKey = dashboardIndexKey(userId);
      const rawIndex = await store.getItem(indexKey);
      let keys: string[] = [];
      if (rawIndex) {
        try {
          const parsed = JSON.parse(rawIndex);
          if (Array.isArray(parsed)) {
            keys = parsed.filter((k): k is string => typeof k === "string");
          }
        } catch {
          keys = [];
        }
      }
      if (!keys.includes(segmentedKey)) {
        keys.push(segmentedKey);
        await store.setItem(indexKey, JSON.stringify(keys));
      }
    });

    return true;
  } catch {
    return false;
  }
};

export async function loadCachedDashboard(
  userId: string,
  localDate: string,
  reviewPeriod: "week" | "month",
  store?: StringStorage,
  options?: LoadDashboardOptions,
  now?: () => Date,
): Promise<CachedDashboardSnapshot | null>;
export async function loadCachedDashboard(
  userId: string,
  localDate: string,
  store?: StringStorage,
  options?: LoadDashboardOptions,
  now?: () => Date,
): Promise<CachedDashboardSnapshot | null>;
export async function loadCachedDashboard(
  userId: string,
  localDate: string,
  options?: LoadDashboardOptions,
  now?: () => Date,
): Promise<CachedDashboardSnapshot | null>;
export async function loadCachedDashboard(
  userId: string,
  localDate: string,
  arg3?: "week" | "month" | StringStorage | LoadDashboardOptions,
  arg4?: StringStorage | LoadDashboardOptions | (() => Date),
  arg5?: LoadDashboardOptions | (() => Date),
  arg6?: () => Date,
): Promise<CachedDashboardSnapshot | null> {
  if (!userId) return null;

  let effectiveReviewPeriod: ("week" | "month") | undefined;
  let effectiveStore: StringStorage = createDefaultOfflineCacheStorage();
  let effectiveOptions: LoadDashboardOptions = {};
  let effectiveNow: () => Date = () => new Date();

  if (arg3 === "week" || arg3 === "month") {
    effectiveReviewPeriod = arg3;
    if (isStringStorage(arg4)) {
      effectiveStore = arg4;
      if (isLoadDashboardOptions(arg5)) {
        effectiveOptions = arg5;
      }
      if (typeof arg6 === "function") {
        effectiveNow = arg6;
      }
    } else if (isLoadDashboardOptions(arg4)) {
      effectiveOptions = arg4;
      if (typeof arg5 === "function") {
        effectiveNow = arg5;
      }
    } else if (typeof arg4 === "function") {
      effectiveNow = arg4;
    }
  } else if (isStringStorage(arg3)) {
    effectiveStore = arg3;
    if (isLoadDashboardOptions(arg4)) {
      effectiveOptions = arg4;
    }
    if (typeof arg5 === "function") {
      effectiveNow = arg5;
    }
  } else if (isLoadDashboardOptions(arg3)) {
    effectiveOptions = arg3;
    if (typeof arg4 === "function") {
      effectiveNow = arg4;
    }
  } else if (typeof arg3 === "function") {
    effectiveNow = arg3;
  }

  if (!effectiveReviewPeriod && effectiveOptions.reviewPeriod) {
    effectiveReviewPeriod = effectiveOptions.reviewPeriod;
  }

  const segmentedKey = effectiveReviewPeriod
    ? dashboardCacheKey(userId, localDate, effectiveReviewPeriod)
    : null;
  const legacyKey = dashboardCacheKey(userId);

  let activeKey = segmentedKey ?? legacyKey;
  let raw: string | null = null;
  try {
    if (segmentedKey) {
      raw = await effectiveStore.getItem(segmentedKey);
    }
    if (!raw) {
      activeKey = legacyKey;
      raw = await effectiveStore.getItem(legacyKey);
    }
  } catch {
    return null;
  }

  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await effectiveStore.removeItem(activeKey).catch(() => {});
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
    await effectiveStore.removeItem(activeKey).catch(() => {});
    return null;
  }

  const candidate = parsed as CachedDashboardSnapshot;
  if (candidate.version !== 1 || candidate.userId !== userId) {
    return null;
  }

  if (
    effectiveOptions.utcOffsetMinutes !== undefined &&
    (!Number.isInteger(effectiveOptions.utcOffsetMinutes) ||
      Math.abs(effectiveOptions.utcOffsetMinutes) > 14 * 60 ||
      candidate.utcOffsetMinutes !== effectiveOptions.utcOffsetMinutes)
  ) {
    return null;
  }

  const maxAgeMs =
    effectiveOptions.maxAgeMs ?? DEFAULT_MAX_DASHBOARD_CACHE_AGE_MS;
  const cachedTime = new Date(candidate.cachedAt).getTime();
  const currentTime = effectiveNow().getTime();
  if (
    Number.isNaN(cachedTime) ||
    currentTime - cachedTime > maxAgeMs ||
    currentTime < cachedTime - 60_000 // future drift tolerance 1 min
  ) {
    await effectiveStore.removeItem(activeKey).catch(() => {});
    return null;
  }

  if (
    typeof candidate.data !== "object" ||
    candidate.data === null ||
    !("caloriesToday" in candidate.data) ||
    !("macros" in candidate.data) ||
    !("energy" in candidate.data)
  ) {
    await effectiveStore.removeItem(activeKey).catch(() => {});
    return null;
  }

  const requireExactDate = effectiveOptions.requireExactDate !== false;
  if (requireExactDate && candidate.localDate !== localDate) {
    return null;
  }

  if (
    effectiveReviewPeriod &&
    candidate.reviewPeriod !== effectiveReviewPeriod
  ) {
    return null;
  }

  return candidate;
}

export const purgeOfflineCache = async (
  userId: string,
  store: StringStorage = createDefaultOfflineCacheStorage(),
): Promise<void> => {
  if (!userId) return;
  await withIndexLock(userId, async () => {
    const indexKey = dashboardIndexKey(userId);
    const prefix = dashboardCacheKey(userId) + ".";
    let keysToPurge: string[] = [];
    let indexFailed = false;
    try {
      const rawIndex = await store.getItem(indexKey);
      if (rawIndex !== null) {
        const parsed: unknown = JSON.parse(rawIndex);
        if (!Array.isArray(parsed)) indexFailed = true;
        else {
          for (const key of parsed) {
            if (
              typeof key === "string" &&
              key.startsWith(prefix) &&
              /^\d{4}-\d{2}-\d{2}\.(week|month)$/.test(key.slice(prefix.length))
            )
              keysToPurge.push(key);
            else indexFailed = true;
          }
        }
      }
    } catch {
      indexFailed = true;
    }
    const results = await Promise.allSettled(
      [
        profileCacheKey(userId),
        dashboardCacheKey(userId),
        ...new Set(keysToPurge),
      ].map((key) => Promise.resolve().then(() => store.removeItem(key))),
    );
    // Keep the index until all referenced removals succeed so retry can find them.
    if (indexFailed || results.some((result) => result.status === "rejected"))
      throw new Error("Offline account cache cleanup is incomplete.");
    await store.removeItem(indexKey);
  });
};
