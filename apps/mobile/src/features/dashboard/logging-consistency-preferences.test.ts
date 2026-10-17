import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import {
  DEFAULT_LOGGING_CONSISTENCY_PREFERENCES,
  clearLoggingConsistencyPreferences,
  loadLoggingConsistencyPreferences,
  loggingConsistencyKey,
  saveLoggingConsistencyPreferences,
} from "./logging-consistency-preferences";

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (key: string) => data.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      data.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      data.delete(key);
    },
  };
};

describe("logging consistency preferences", () => {
  it("defaults to five days and visible", async () => {
    expect(await loadLoggingConsistencyPreferences("a", memoryStore())).toEqual(
      { weeklyGoal: 5, hidden: false },
    );
  });

  it("persists per user without leaking across accounts", async () => {
    const store = memoryStore();
    expect(
      await saveLoggingConsistencyPreferences(
        "a",
        { weeklyGoal: 3, hidden: true },
        store,
      ),
    ).toBe(true);
    expect(await loadLoggingConsistencyPreferences("a", store)).toEqual({
      weeklyGoal: 3,
      hidden: true,
    });
    expect(await loadLoggingConsistencyPreferences("b", store)).toEqual(
      DEFAULT_LOGGING_CONSISTENCY_PREFERENCES,
    );
  });

  it("clamps stored goals and survives corrupt data", async () => {
    const store = memoryStore();
    store.data.set(
      loggingConsistencyKey("a"),
      JSON.stringify({ weeklyGoal: 40, hidden: "yes" }),
    );
    expect(await loadLoggingConsistencyPreferences("a", store)).toEqual({
      weeklyGoal: 7,
      hidden: false,
    });
    store.data.set(loggingConsistencyKey("a"), "{not json");
    expect(await loadLoggingConsistencyPreferences("a", store)).toEqual(
      DEFAULT_LOGGING_CONSISTENCY_PREFERENCES,
    );
  });

  it("reports a failed save", async () => {
    const store = {
      ...memoryStore(),
      setItemAsync: async () => {
        throw new Error("keychain locked");
      },
    };
    expect(
      await saveLoggingConsistencyPreferences(
        "a",
        { weeklyGoal: 4, hidden: false },
        store,
      ),
    ).toBe(false);
  });

  it("is removed on account deletion", async () => {
    const store = memoryStore();
    await saveLoggingConsistencyPreferences(
      "a",
      { weeklyGoal: 4, hidden: false },
      store,
    );
    await clearLoggingConsistencyPreferences("a", store);
    expect(store.data.size).toBe(0);
  });
});
