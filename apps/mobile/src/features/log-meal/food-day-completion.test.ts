import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import {
  clearFoodDayCompletions,
  getIsoLocalDate,
  isFoodDayCompleted,
  isFoodDayCompletionMap,
  isFoodDayCompletionRecord,
  loadAllFoodDayCompletions,
  pruneOldCompletions,
  setFoodDayCompletion,
} from "./food-day-completion";

const userId = "00000000-0000-4000-8000-000000000001";

const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
};

describe("food-day-completion", () => {
  describe("isFoodDayCompletionRecord & isFoodDayCompletionMap", () => {
    it("validates valid record", () => {
      expect(
        isFoodDayCompletionRecord({
          isCompleted: true,
          completedAt: "2026-09-23T20:00:00.000Z",
        }),
      ).toBe(true);
      expect(
        isFoodDayCompletionRecord({
          isCompleted: false,
          completedAt: null,
        }),
      ).toBe(true);
    });

    it("rejects invalid records", () => {
      expect(isFoodDayCompletionRecord(null)).toBe(false);
      expect(isFoodDayCompletionRecord({})).toBe(false);
      expect(isFoodDayCompletionRecord({ isCompleted: "yes" })).toBe(false);
    });

    it("validates valid map", () => {
      expect(isFoodDayCompletionMap({})).toBe(true);
      expect(
        isFoodDayCompletionMap({
          "2026-09-23": {
            isCompleted: true,
            completedAt: "2026-09-23T20:00:00.000Z",
          },
        }),
      ).toBe(true);
    });

    it("rejects invalid map keys or contents", () => {
      expect(isFoodDayCompletionMap(null)).toBe(false);
      expect(isFoodDayCompletionMap([])).toBe(false);
      expect(
        isFoodDayCompletionMap({
          "invalid-date": {
            isCompleted: true,
            completedAt: null,
          },
        }),
      ).toBe(false);
    });
  });

  describe("getIsoLocalDate", () => {
    it("formats local date correctly", () => {
      const d = new Date(2026, 8, 23, 14, 30);
      expect(getIsoLocalDate(d)).toBe("2026-09-23");
    });
  });

  describe("load, set and clear", () => {
    it("loads empty map by default", async () => {
      const store = memoryStore();
      const map = await loadAllFoodDayCompletions(userId, store);
      expect(map).toEqual({});
      const completed = await isFoodDayCompleted(userId, "2026-09-23", store);
      expect(completed).toBe(false);
    });

    it("sets completion for a date and marks completedAt timestamp", async () => {
      const store = memoryStore();
      const fixedNow = new Date("2026-09-23T19:45:00.000Z");

      const record = await setFoodDayCompletion(
        userId,
        "2026-09-23",
        true,
        { now: () => fixedNow },
        store,
      );

      expect(record.isCompleted).toBe(true);
      expect(record.completedAt).toBe("2026-09-23T19:45:00.000Z");

      const completed = await isFoodDayCompleted(userId, "2026-09-23", store);
      expect(completed).toBe(true);

      const map = await loadAllFoodDayCompletions(userId, store);
      expect(map["2026-09-23"]).toEqual(record);
    });

    it("unsets completion for a date", async () => {
      const store = memoryStore();
      await setFoodDayCompletion(userId, "2026-09-23", true, {}, store);
      expect(await isFoodDayCompleted(userId, "2026-09-23", store)).toBe(true);

      const record = await setFoodDayCompletion(
        userId,
        "2026-09-23",
        false,
        {},
        store,
      );
      expect(record.isCompleted).toBe(false);
      expect(record.completedAt).toBeNull();
      expect(await isFoodDayCompleted(userId, "2026-09-23", store)).toBe(false);
    });

    it("clears completions for user", async () => {
      const store = memoryStore();
      await setFoodDayCompletion(userId, "2026-09-23", true, {}, store);
      await clearFoodDayCompletions(userId, store);

      const map = await loadAllFoodDayCompletions(userId, store);
      expect(map).toEqual({});
    });

    it("prunes records older than 28 days to maintain Android 2KB SecureStore budget", () => {
      const reference = new Date(2026, 8, 23); // 2026-09-23
      const map = {
        "2026-09-23": {
          isCompleted: true,
          completedAt: "2026-09-23T20:00:00Z",
        },
        "2026-09-01": {
          isCompleted: true,
          completedAt: "2026-09-01T20:00:00Z",
        },
        "2026-08-01": {
          isCompleted: true,
          completedAt: "2026-08-01T20:00:00Z",
        }, // > 50 days old
      };
      const pruned = pruneOldCompletions(map, reference);
      expect(pruned["2026-09-23"]).toBeDefined();
      expect(pruned["2026-09-01"]).toBeDefined();
      expect(pruned["2026-08-01"]).toBeUndefined();
    });
  });
});
