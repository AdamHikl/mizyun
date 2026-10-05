import { describe, expect, it } from "vitest";
import {
  DEFAULT_REST_SECONDS,
  MIN_REST_SECONDS,
  MAX_REST_SECONDS,
  REST_DURATION_PRESETS,
  keyFor,
  loadWorkoutPreferences,
  saveWorkoutPreferences,
  formatRestDuration,
  formatRestDurationLabel,
  type PreferencesStore,
} from "./workout-preferences";

const createMemoryStore = (): PreferencesStore & {
  map: Map<string, string>;
} => {
  const map = new Map<string, string>();
  return {
    map,
    getItemAsync: async (key: string) => map.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

describe("workout-preferences", () => {
  describe("keyFor", () => {
    it("generates global key when userId is undefined", () => {
      expect(keyFor(undefined)).toBe("mizyun.workout-preferences.global");
      expect(keyFor()).toBe("mizyun.workout-preferences.global");
    });

    it("generates user-specific key when userId is provided", () => {
      expect(keyFor("user-123")).toBe("mizyun.workout-preferences.user-123");
    });
  });

  describe("loadWorkoutPreferences", () => {
    it("returns default value (180, true, true) when store is empty", async () => {
      const store = createMemoryStore();
      const prefs = await loadWorkoutPreferences("user-1", store);
      expect(prefs).toEqual({
        defaultRestSeconds: DEFAULT_REST_SECONDS,
        liveNotificationEnabled: true,
        autoAdvanceTargetWeights: true,
      });
      expect(prefs.defaultRestSeconds).toBe(180);
      expect(prefs.liveNotificationEnabled).toBe(true);
      expect(prefs.autoAdvanceTargetWeights).toBe(true);
    });

    it("recovers from corrupted JSON by returning default", async () => {
      const store = createMemoryStore();
      await store.setItemAsync(keyFor("user-1"), "invalid-json{{{");
      const prefs = await loadWorkoutPreferences("user-1", store);
      expect(prefs).toEqual({
        defaultRestSeconds: 180,
        liveNotificationEnabled: true,
        autoAdvanceTargetWeights: true,
      });
    });

    it("recovers from non-numeric defaultRestSeconds by returning default", async () => {
      const store = createMemoryStore();
      await store.setItemAsync(
        keyFor("user-1"),
        JSON.stringify({ defaultRestSeconds: "not-a-number" }),
      );
      const prefs = await loadWorkoutPreferences("user-1", store);
      expect(prefs).toEqual({
        defaultRestSeconds: 180,
        liveNotificationEnabled: true,
        autoAdvanceTargetWeights: true,
      });
    });

    it("recovers from non-integer defaultRestSeconds by returning default", async () => {
      const store = createMemoryStore();
      await store.setItemAsync(
        keyFor("user-1"),
        JSON.stringify({ defaultRestSeconds: 120.5 }),
      );
      const prefs = await loadWorkoutPreferences("user-1", store);
      expect(prefs).toEqual({
        defaultRestSeconds: 180,
        liveNotificationEnabled: true,
        autoAdvanceTargetWeights: true,
      });
    });

    it("recovers from out-of-bounds values by returning default", async () => {
      const store = createMemoryStore();
      await store.setItemAsync(
        keyFor("user-1"),
        JSON.stringify({ defaultRestSeconds: 10 }), // Below MIN (15)
      );
      expect(await loadWorkoutPreferences("user-1", store)).toEqual({
        defaultRestSeconds: 180,
        liveNotificationEnabled: true,
        autoAdvanceTargetWeights: true,
      });

      await store.setItemAsync(
        keyFor("user-1"),
        JSON.stringify({ defaultRestSeconds: 900 }), // Above MAX (600)
      );
      expect(await loadWorkoutPreferences("user-1", store)).toEqual({
        defaultRestSeconds: 180,
        liveNotificationEnabled: true,
        autoAdvanceTargetWeights: true,
      });
    });

    it("recovers when store throws an exception", async () => {
      const failingStore: PreferencesStore = {
        getItemAsync: async () => {
          throw new Error("SecureStore unavailable");
        },
        setItemAsync: async () => {},
      };
      const prefs = await loadWorkoutPreferences("user-1", failingStore);
      expect(prefs).toEqual({
        defaultRestSeconds: 180,
        liveNotificationEnabled: true,
        autoAdvanceTargetWeights: true,
      });
    });
  });

  describe("saveWorkoutPreferences and round-trip", () => {
    it("saves and loads preferences round-trip", async () => {
      const store = createMemoryStore();
      const success = await saveWorkoutPreferences(
        {
          defaultRestSeconds: 120,
          liveNotificationEnabled: false,
          autoAdvanceTargetWeights: false,
        },
        "user-1",
        store,
      );
      expect(success).toBe(true);

      const loaded = await loadWorkoutPreferences("user-1", store);
      expect(loaded).toEqual({
        defaultRestSeconds: 120,
        liveNotificationEnabled: false,
        autoAdvanceTargetWeights: false,
      });
    });

    it("clamps values below MIN_REST_SECONDS (15s)", async () => {
      const store = createMemoryStore();
      const success = await saveWorkoutPreferences(
        { defaultRestSeconds: 5 },
        "user-1",
        store,
      );
      expect(success).toBe(true);

      const loaded = await loadWorkoutPreferences("user-1", store);
      expect(loaded.defaultRestSeconds).toBe(MIN_REST_SECONDS);
      expect(loaded.defaultRestSeconds).toBe(15);
      expect(loaded.liveNotificationEnabled).toBe(true);
    });

    it("clamps values above MAX_REST_SECONDS (600s)", async () => {
      const store = createMemoryStore();
      const success = await saveWorkoutPreferences(
        { defaultRestSeconds: 1000 },
        "user-1",
        store,
      );
      expect(success).toBe(true);

      const loaded = await loadWorkoutPreferences("user-1", store);
      expect(loaded.defaultRestSeconds).toBe(MAX_REST_SECONDS);
      expect(loaded.defaultRestSeconds).toBe(600);
    });

    it("rounds floating-point seconds on save", async () => {
      const store = createMemoryStore();
      await saveWorkoutPreferences(
        { defaultRestSeconds: 89.6 },
        "user-1",
        store,
      );
      const loaded = await loadWorkoutPreferences("user-1", store);
      expect(loaded.defaultRestSeconds).toBe(90);
    });

    it("updates only liveNotificationEnabled while preserving existing rest duration", async () => {
      const store = createMemoryStore();
      await saveWorkoutPreferences(
        { defaultRestSeconds: 240 },
        "user-1",
        store,
      );
      await saveWorkoutPreferences(
        { liveNotificationEnabled: false },
        "user-1",
        store,
      );

      const loaded = await loadWorkoutPreferences("user-1", store);
      expect(loaded.defaultRestSeconds).toBe(240);
      expect(loaded.liveNotificationEnabled).toBe(false);
    });

    it("handles save failure gracefully and returns false", async () => {
      const failingStore: PreferencesStore = {
        getItemAsync: async () => null,
        setItemAsync: async () => {
          throw new Error("Write failed");
        },
      };
      const success = await saveWorkoutPreferences(
        { defaultRestSeconds: 120 },
        "user-1",
        failingStore,
      );
      expect(success).toBe(false);
    });
  });

  describe("presets and constants", () => {
    it("defines the expected presets array", () => {
      expect(REST_DURATION_PRESETS).toEqual([60, 90, 120, 150, 180, 240, 300]);
    });
  });

  describe("formatRestDuration", () => {
    it("formats durations into MM:SS correctly", () => {
      expect(formatRestDuration(180)).toBe("3:00");
      expect(formatRestDuration(90)).toBe("1:30");
      expect(formatRestDuration(60)).toBe("1:00");
      expect(formatRestDuration(75)).toBe("1:15");
      expect(formatRestDuration(15)).toBe("0:15");
      expect(formatRestDuration(0)).toBe("0:00");
      expect(formatRestDuration(-10)).toBe("0:00");
      expect(formatRestDuration(600)).toBe("10:00");
    });
  });

  describe("formatRestDurationLabel", () => {
    it("formats durations into friendly labels correctly", () => {
      expect(formatRestDurationLabel(180)).toBe("3 min");
      expect(formatRestDurationLabel(90)).toBe("1.5 min");
      expect(formatRestDurationLabel(60)).toBe("1 min");
      expect(formatRestDurationLabel(75)).toBe("1m 15s");
      expect(formatRestDurationLabel(150)).toBe("2.5 min");
      expect(formatRestDurationLabel(15)).toBe("15s");
      expect(formatRestDurationLabel(45)).toBe("45s");
      expect(formatRestDurationLabel(120)).toBe("2 min");
      expect(formatRestDurationLabel(240)).toBe("4 min");
      expect(formatRestDurationLabel(300)).toBe("5 min");
    });
  });
});

it("fails closed for native status when the persisted preference cannot be read", async () => {
  const store: PreferencesStore = {
    getItemAsync: async () => {
      throw new Error("locked");
    },
    setItemAsync: async () => {},
  };
  expect(
    (await loadWorkoutPreferences("user-1", store, "disable-live-notification"))
      .liveNotificationEnabled,
  ).toBe(false);
  expect(
    (await loadWorkoutPreferences("user-1", store)).liveNotificationEnabled,
  ).toBe(true);
});
