import * as SecureStore from "expo-secure-store";

export interface FoodDayCompletionRecord {
  readonly isCompleted: boolean;
  readonly completedAt: string | null;
}

export type FoodDayCompletionMap = Readonly<
  Record<string, FoodDayCompletionRecord>
>;

export interface DayCompletionStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

export const getIsoLocalDate = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const keyFor = (userId: string): string =>
  `mizyun.food-day-completion.${userId}`;

export const isFoodDayCompletionRecord = (
  value: unknown,
): value is FoodDayCompletionRecord => {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<FoodDayCompletionRecord>;
  return (
    typeof c.isCompleted === "boolean" &&
    (c.completedAt === null || typeof c.completedAt === "string")
  );
};

export const isFoodDayCompletionMap = (
  value: unknown,
): value is FoodDayCompletionMap => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const map = value as Record<string, unknown>;
  return Object.entries(map).every(
    ([date, record]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) && isFoodDayCompletionRecord(record),
  );
};

export const loadAllFoodDayCompletions = async (
  userId: string,
  store: DayCompletionStore = SecureStore,
): Promise<FoodDayCompletionMap> => {
  try {
    const raw = await store.getItemAsync(keyFor(userId));
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isFoodDayCompletionMap(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
};

export const isFoodDayCompleted = async (
  userId: string,
  date: string,
  store: DayCompletionStore = SecureStore,
): Promise<boolean> => {
  const map = await loadAllFoodDayCompletions(userId, store);
  return map[date]?.isCompleted === true;
};

const MAX_RETENTION_DAYS = 28; // Keeps storage well within Android 2048-byte SecureStore limit

export const pruneOldCompletions = (
  map: FoodDayCompletionMap,
  referenceDate: Date = new Date(),
): Record<string, FoodDayCompletionRecord> => {
  const cutoff = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate() - MAX_RETENTION_DAYS,
  );
  const cutoffIso = getIsoLocalDate(cutoff);

  const pruned: Record<string, FoodDayCompletionRecord> = {};
  for (const [date, record] of Object.entries(map)) {
    if (date >= cutoffIso && record.isCompleted) {
      pruned[date] = record;
    }
  }
  return pruned;
};

export const setFoodDayCompletion = async (
  userId: string,
  date: string,
  isCompleted: boolean,
  options: {
    readonly now?: () => Date;
  } = {},
  store: DayCompletionStore = SecureStore,
): Promise<FoodDayCompletionRecord> => {
  const map = await loadAllFoodDayCompletions(userId, store);
  const now = options.now ? options.now() : new Date();

  const record: FoodDayCompletionRecord = {
    isCompleted,
    completedAt: isCompleted ? now.toISOString() : null,
  };

  const updated: Record<string, FoodDayCompletionRecord> = pruneOldCompletions(
    map,
    now,
  );

  if (isCompleted) {
    updated[date] = record;
  } else {
    delete updated[date];
  }

  await store.setItemAsync(keyFor(userId), JSON.stringify(updated));
  return record;
};

export const clearFoodDayCompletions = async (
  userId: string,
  store: DayCompletionStore = SecureStore,
): Promise<void> => {
  try {
    if (typeof store.deleteItemAsync === "function") {
      await store.deleteItemAsync(keyFor(userId));
    } else {
      await store.setItemAsync(keyFor(userId), JSON.stringify({}));
    }
  } catch {
    // Best-effort cleanup during account deletion or logout.
  }
};
