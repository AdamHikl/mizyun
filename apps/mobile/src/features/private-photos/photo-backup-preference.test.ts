import { beforeEach, expect, it } from "vitest";
import {
  loadPhotoBackupEnabled,
  photoBackupKeyFor,
  resetPhotoBackupPreferenceForTests,
  savePhotoBackupEnabled,
} from "./photo-backup-preference";

const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

beforeEach(() => resetPhotoBackupPreferenceForTests());

it("is off until the account turns it on", async () => {
  const store = memoryStore();
  expect(await loadPhotoBackupEnabled("user-a", store)).toBe(false);
  resetPhotoBackupPreferenceForTests();
  expect(await savePhotoBackupEnabled("user-a", true, store)).toBe(true);
  expect(store.values.get(photoBackupKeyFor("user-a"))).toBe("on");
  resetPhotoBackupPreferenceForTests();
  expect(await loadPhotoBackupEnabled("user-a", store)).toBe(true);
  expect(await loadPhotoBackupEnabled("user-b", store)).toBe(false);
});

it("never uploads when the stored value cannot be read", async () => {
  const failing = {
    getItemAsync: async () => {
      throw new Error("keychain locked");
    },
    setItemAsync: async () => undefined,
  };
  expect(await loadPhotoBackupEnabled("user-a", failing)).toBe(false);
});

it("keeps the previous value when saving fails", async () => {
  const store = memoryStore();
  await savePhotoBackupEnabled("user-a", true, store);
  const failing = {
    getItemAsync: store.getItemAsync,
    setItemAsync: async () => {
      throw new Error("write failed");
    },
  };
  expect(await savePhotoBackupEnabled("user-a", false, failing)).toBe(false);
  expect(await loadPhotoBackupEnabled("user-a", store)).toBe(true);
});
