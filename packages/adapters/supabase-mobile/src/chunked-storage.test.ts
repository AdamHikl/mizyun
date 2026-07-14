import { describe, expect, it } from "vitest";

import { ChunkedStorage, type StringStorage } from "./chunked-storage.js";

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
