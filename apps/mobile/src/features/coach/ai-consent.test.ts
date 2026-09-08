import { describe, expect, it } from "vitest";
import { loadAiConsent, revokeAiConsent, saveAiConsent } from "./ai-consent";

class MemorySecureStore {
  private readonly items = new Map<string, string>();

  async getItemAsync(key: string): Promise<string | null> {
    return this.items.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<unknown> {
    this.items.set(key, value);
    return null;
  }

  async deleteItemAsync(key: string): Promise<unknown> {
    this.items.delete(key);
    return null;
  }
}

describe("ai-consent", () => {
  it("returns ungranted status when no consent has been stored", async () => {
    const store = new MemorySecureStore();
    const result = await loadAiConsent("user-1", store);
    expect(result).toEqual({
      granted: false,
      confirmedAdult: false,
      consentedAt: null,
    });
  });

  it("persists and reloads granted consent with adult confirmation", async () => {
    const store = new MemorySecureStore();
    const saved = await saveAiConsent("user-1", true, true, store);
    expect(saved).toBe(true);

    const result = await loadAiConsent("user-1", store);
    expect(result.granted).toBe(true);
    expect(result.confirmedAdult).toBe(true);
    expect(typeof result.consentedAt).toBe("string");
  });

  it("persists non-granted state", async () => {
    const store = new MemorySecureStore();
    await saveAiConsent("user-1", false, false, store);

    const result = await loadAiConsent("user-1", store);
    expect(result.granted).toBe(false);
    expect(result.confirmedAdult).toBe(false);
    expect(result.consentedAt).toBeNull();
  });

  it("revokes stored consent", async () => {
    const store = new MemorySecureStore();
    await saveAiConsent("user-1", true, true, store);
    const revoked = await revokeAiConsent("user-1", store);
    expect(revoked).toBe(true);

    const result = await loadAiConsent("user-1", store);
    expect(result.granted).toBe(false);
    expect(result.confirmedAdult).toBe(false);
    expect(result.consentedAt).toBeNull();
  });

  it("handles corrupted storage gracefully", async () => {
    const store = new MemorySecureStore();
    await store.setItemAsync("mizyun.ai-consent.user-1", "invalid json{");

    const result = await loadAiConsent("user-1", store);
    expect(result).toEqual({
      granted: false,
      confirmedAdult: false,
      consentedAt: null,
    });
  });

  it("handles store exceptions gracefully", async () => {
    const throwingStore = {
      async getItemAsync() {
        throw new Error("Disk error");
      },
      async setItemAsync() {
        throw new Error("Disk error");
      },
      async deleteItemAsync() {
        throw new Error("Disk error");
      },
    };

    expect(await loadAiConsent("user-1", throwingStore)).toEqual({
      granted: false,
      confirmedAdult: false,
      consentedAt: null,
    });
    expect(await saveAiConsent("user-1", true, true, throwingStore)).toBe(
      false,
    );
    expect(await revokeAiConsent("user-1", throwingStore)).toBe(false);
  });
});
