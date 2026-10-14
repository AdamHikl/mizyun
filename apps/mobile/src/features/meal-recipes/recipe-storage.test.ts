import { expect, it, vi } from "vitest";
import { EncryptedRecipeSessionStore } from "./recipe-storage";
import { recovery, NOW } from "./recipe-fixtures.test-support";
const fixture = () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
  };
  return {
    values,
    storage,
    store: new EncryptedRecipeSessionStore(storage, () => NOW),
  };
};
it("strictly retains confirmed session by owner and rejects raw photos and corrupt reads", async () => {
  const f = fixture();
  await f.store.save("owner-a", recovery(), () => true);
  expect(await f.store.load("owner-b")).toBeNull();
  expect(await f.store.export("owner-a")).toEqual(recovery());
  await expect(
    f.store.save(
      "owner-a",
      { ...recovery(), photos: ["file:///private.jpg"] } as any,
      () => true,
    ),
  ).rejects.toThrow();
  f.values.set("mizyun.recipe-session.v1.owner-a", "corrupt");
  await expect(f.store.load("owner-a")).rejects.toThrow("Recipe recovery");
});
it("expiry removes recipe inventory without touching an ambiguous meal operation", async () => {
  const f = fixture();
  await f.store.save("owner-a", recovery(), () => true);
  f.values.set("mizyun.logging_draft.meal.owner-a", "frozen operation");
  const later = new EncryptedRecipeSessionStore(
    f.storage,
    () => NOW + 86400001,
  );
  expect(await later.load("owner-a")).toBeNull();
  expect(f.values.get("mizyun.logging_draft.meal.owner-a")).toBe(
    "frozen operation",
  );
});
it("clear and account replacement fence an in-flight write", async () => {
  const f = fixture();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.storage.setItem = async (key, value) => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    f.values.set(key, value);
  };
  let current = true;
  const write = f.store.save("owner-a", recovery(), () => current);
  await ready;
  current = false;
  const clear = f.store.clear("owner-a");
  release();
  await expect(write).rejects.toThrow("context changed");
  await clear;
  expect(f.values.size).toBe(0);
});
it("surfaces unavailable storage and failed required persistence", async () => {
  const f = fixture();
  f.storage.setItem = vi.fn().mockRejectedValue(new Error("private"));
  await expect(
    f.store.save("owner-a", recovery(), () => true),
  ).rejects.toThrow();
  expect(await f.store.load("owner-a")).toBeNull();
});
