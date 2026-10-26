import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHARE_CARD_PREFERENCES,
  loadShareCardPreferences,
  saveShareCardPreferences,
  shareCardPreferencesKey,
} from "./share-card-preferences";

const memoryStore = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItemAsync: async (key: string) => data.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

describe("share card preferences", () => {
  it("stores the gym name only while remembering is on", async () => {
    const store = memoryStore();
    await saveShareCardPreferences(
      "u1",
      { rememberGymName: false, gymName: "Ostbloc", scheme: "dark" },
      store,
    );
    expect(JSON.parse(store.data.get(shareCardPreferencesKey("u1"))!)).toEqual({
      rememberGymName: false,
      gymName: null,
      scheme: "dark",
    });
    await saveShareCardPreferences(
      "u1",
      { rememberGymName: true, gymName: "  Ostbloc  ", scheme: null },
      store,
    );
    expect(await loadShareCardPreferences("u1", store)).toEqual({
      rememberGymName: true,
      gymName: "Ostbloc",
      scheme: null,
    });
  });

  it("keeps users apart and falls back on bad or failing storage", async () => {
    const store = memoryStore({
      [shareCardPreferencesKey("u1")]: JSON.stringify({
        rememberGymName: true,
        gymName: "Ostbloc",
      }),
      [shareCardPreferencesKey("u2")]: "{not json",
      [shareCardPreferencesKey("u3")]: JSON.stringify({
        rememberGymName: false,
        gymName: "Leaked",
        scheme: "neon",
      }),
    });
    expect((await loadShareCardPreferences("u2", store)).gymName).toBeNull();
    expect(await loadShareCardPreferences("u3", store)).toEqual(
      DEFAULT_SHARE_CARD_PREFERENCES,
    );
    expect(await loadShareCardPreferences("u4", store)).toEqual(
      DEFAULT_SHARE_CARD_PREFERENCES,
    );
    const failing = {
      getItemAsync: async () => {
        throw new Error("locked");
      },
      setItemAsync: async () => {
        throw new Error("locked");
      },
    };
    expect(await loadShareCardPreferences("u1", failing)).toEqual(
      DEFAULT_SHARE_CARD_PREFERENCES,
    );
    await expect(
      saveShareCardPreferences("u1", DEFAULT_SHARE_CARD_PREFERENCES, failing),
    ).resolves.toBeUndefined();
  });
});
