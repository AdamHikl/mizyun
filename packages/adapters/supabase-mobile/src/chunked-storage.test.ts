import { describe, expect, it } from "vitest";

import { ChunkedStorage, type StringStorage } from "./chunked-storage.js";
import { createWebStorage } from "./web-storage.js";

class MapStorage implements StringStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("ChunkedStorage", () => {
  it("round-trips values larger than a native secure-store entry", async () => {
    const primitive = new MapStorage();
    const storage = new ChunkedStorage(primitive, 128);
    const value = "session-token-".repeat(100);

    await storage.setItem("supabase:auth", value);

    await expect(storage.getItem("supabase:auth")).resolves.toBe(value);
    expect(primitive.values.size).toBeGreaterThan(2);
  });

  it("removes old generations when replacing a value", async () => {
    const primitive = new MapStorage();
    const storage = new ChunkedStorage(primitive, 128);
    await storage.setItem("auth", "a".repeat(500));
    await storage.setItem("auth", "new-session");

    await expect(storage.getItem("auth")).resolves.toBe("new-session");
    expect(primitive.values.size).toBe(2);
  });

  it("deletes every chunk", async () => {
    const primitive = new MapStorage();
    const storage = new ChunkedStorage(primitive, 128);
    await storage.setItem("auth", "a".repeat(500));

    await storage.removeItem("auth");

    await expect(storage.getItem("auth")).resolves.toBeNull();
    expect(primitive.values.size).toBe(0);
  });
});

describe("createWebStorage", () => {
  it("falls back to in-memory storage when SSR exposes a partial shim", async () => {
    const storage = createWebStorage({});
    await storage.setItem("session", "value");
    await expect(storage.getItem("session")).resolves.toBe("value");
  });
});

it("retains the chunk manifest until every private chunk is removed", async () => {
  const map = new Map<string, string>();
  let fail = false;
  const primitive = {
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      if (fail && !key.endsWith(".manifest")) throw new Error("disk failed");
      map.delete(key);
    },
  };
  const storage = new ChunkedStorage(primitive, 128);
  await storage.setItem("account-cache", "private".repeat(60));
  const manifestKey = [...map.keys()].find((key) => key.endsWith(".manifest"))!;
  fail = true;
  await expect(storage.removeItem("account-cache")).rejects.toThrow(
    "Stored data cleanup is incomplete.",
  );
  expect(map.has(manifestKey)).toBe(true);
  fail = false;
  await storage.removeItem("account-cache");
  expect(map.size).toBe(0);
});

it("serializes remove and replacement writes across wrappers sharing storage", async () => {
  const map = new Map<string, string>();
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let block = false;
  const primitive = {
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      if (block && !key.endsWith(".manifest")) {
        started();
        await blocked;
      }
      map.delete(key);
    },
  };
  const remover = new ChunkedStorage(primitive, 128);
  const writer = new ChunkedStorage(primitive, 128);
  await writer.setItem("account-cache", "old".repeat(60));
  block = true;
  const removal = remover.removeItem("account-cache");
  await entered;
  const replacement = writer.setItem("account-cache", "replacement".repeat(40));
  release();
  await Promise.all([removal, replacement]);
  expect(await writer.getItem("account-cache")).toBe("replacement".repeat(40));
  await remover.removeItem("account-cache");
  expect(map.size).toBe(0);
});
