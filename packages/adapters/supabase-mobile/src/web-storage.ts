import type { StringStorage } from "./chunked-storage";

const memoryStorage = (): StringStorage => {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
};

export const createWebStorage = (
  candidate: unknown = globalThis.localStorage,
): StringStorage => {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("getItem" in candidate) ||
    typeof candidate.getItem !== "function" ||
    !("setItem" in candidate) ||
    typeof candidate.setItem !== "function" ||
    !("removeItem" in candidate) ||
    typeof candidate.removeItem !== "function"
  ) {
    return memoryStorage();
  }
  const storage = candidate as {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  return {
    getItem: async (key) => storage.getItem(key),
    setItem: async (key, value) => storage.setItem(key, value),
    removeItem: async (key) => storage.removeItem(key),
  };
};
