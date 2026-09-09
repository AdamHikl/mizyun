import { describe, expect, it } from "vitest";

import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "./logging-draft-storage";

const USER_ID = "00000000-0000-4000-8000-000000000001";

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

describe("logging draft storage", () => {
  it("stores drafts per user and removes them after success", async () => {
    const store = memoryStore();
    expect(
      await saveLoggingDraft(USER_ID, "meal", { name: "Toast" }, store),
    ).toBe(true);
    expect(
      await loadLoggingDraft(
        USER_ID,
        "meal",
        (value): value is { name: string } =>
          typeof value === "object" &&
          value !== null &&
          "name" in value &&
          typeof value.name === "string",
        store,
      ),
    ).toEqual({ name: "Toast" });
    expect(await clearLoggingDraft(USER_ID, "meal", store)).toBe(true);
    expect(store.values.size).toBe(0);
  });

  it("fails open when secure storage is unavailable or malformed", async () => {
    const failingStore = {
      getItemAsync: async (): Promise<string | null> => {
        throw new Error("unavailable");
      },
      setItemAsync: async (): Promise<void> => {
        throw new Error("unavailable");
      },
      deleteItemAsync: async (): Promise<void> => {
        throw new Error("unavailable");
      },
    };
    expect(
      await loadLoggingDraft(
        USER_ID,
        "weight",
        (_value): _value is Record<string, never> => false,
        failingStore,
      ),
    ).toBeNull();
    expect(
      await saveLoggingDraft(USER_ID, "weight", { weight: "72" }, failingStore),
    ).toBe(false);
    expect(await clearLoggingDraft(USER_ID, "weight", failingStore)).toBe(
      false,
    );
  });

  it("drops pending autosave if clear is called before save completes, preventing draft resurrection (Q2)", async () => {
    const store = memoryStore();
    let resolveSetItem = (): void => {};
    const slowStore = {
      ...store,
      setItemAsync: async (key: string, value: string) => {
        await new Promise<void>((resolve) => {
          resolveSetItem = resolve;
        });
        store.values.set(key, value);
      },
    };

    // 1. Initiate autosave (will block in slowStore.setItemAsync)
    const savePromise = saveLoggingDraft(
      USER_ID,
      "meal",
      { name: "In-flight meal" },
      slowStore,
    );

    // 2. Immediately call clearLoggingDraft (e.g. user submitted or pressed Clear)
    const clearPromise = clearLoggingDraft(USER_ID, "meal", store);

    // 3. Resolve the pending save
    resolveSetItem();

    const [saveResult, clearResult] = await Promise.all([
      savePromise,
      clearPromise,
    ]);

    // Save should return false (dropped due to generation bump by clear)
    expect(saveResult).toBe(false);
    expect(clearResult).toBe(true);

    // Storage must NOT contain the draft!
    const loaded = await loadLoggingDraft(
      USER_ID,
      "meal",
      (v): v is { name: string } => true,
      store,
    );
    expect(loaded).toBeNull();
  });
});
