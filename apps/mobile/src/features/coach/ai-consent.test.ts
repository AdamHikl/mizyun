import { describe, expect, it } from "vitest";
import {
  CURRENT_AI_CONSENT_VERSION,
  LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
} from "@mizyun/contracts";
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
    expect(saved.ok).toBe(true);

    const result = await loadAiConsent("user-1", store);
    expect(result.granted).toBe(true);
    expect(result.confirmedAdult).toBe(true);
    expect(typeof result.consentedAt).toBe("string");
  });

  it("persists non-granted state", async () => {
    const store = new MemorySecureStore();
    const saved = await saveAiConsent("user-1", false, false, store);
    expect(saved.ok).toBe(true);

    const result = await loadAiConsent("user-1", store);
    expect(result.granted).toBe(false);
    expect(result.confirmedAdult).toBe(false);
    expect(result.consentedAt).toBeNull();
  });

  it("forgets today's AI-tailored stretch when consent is revoked", async () => {
    const store = new MemorySecureStore();
    await saveAiConsent("user-1", true, true, store);
    await store.setItemAsync("mizyun.evening-stretch-ai.user-1", "{}");
    await store.setItemAsync("mizyun.evening-stretch-ai.user-2", "{}");
    expect(await revokeAiConsent("user-1", store)).toBe(true);
    expect(
      await store.getItemAsync("mizyun.evening-stretch-ai.user-1"),
    ).toBeNull();
    expect(await store.getItemAsync("mizyun.evening-stretch-ai.user-2")).toBe(
      "{}",
    );
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
    expect(await saveAiConsent("user-1", true, true, throwingStore)).toEqual({
      ok: false,
      error: "Disk error",
    });
    expect(await revokeAiConsent("user-1", throwingStore)).toBe(false);
  });

  it("syncs with ApiClient on load, save, and revoke", async () => {
    const store = new MemorySecureStore();
    const mockApiClient = {
      request: async (options: {
        readonly method: string;
        readonly path: string;
        readonly body?: unknown;
      }) => {
        if (
          options.method === "GET" &&
          options.path === "/v1/account/ai-consent"
        ) {
          return {
            ok: true as const,
            value: {
              consent: {
                granted: true,
                confirmedAdult: true,
                consentVersion: CURRENT_AI_CONSENT_VERSION,
                consentedAt: "2026-09-08T12:00:00Z",
                revokedAt: null,
              },
            },
          };
        }
        if (
          options.method === "PUT" &&
          options.path === "/v1/account/ai-consent"
        ) {
          const body = options.body as {
            granted: boolean;
            confirmedAdult: boolean;
          };
          return {
            ok: true as const,
            value: {
              consent: {
                granted: body.granted,
                confirmedAdult: body.confirmedAdult,
                consentVersion: CURRENT_AI_CONSENT_VERSION,
                consentedAt: body.granted ? "2026-09-08T12:00:00Z" : null,
                revokedAt: body.granted ? null : "2026-09-08T12:05:00Z",
              },
            },
          };
        }
        return {
          ok: false as const,
          error: { kind: "network_error" as const, message: "unknown" },
        };
      },
      status: () => ({
        configured: true as const,
        baseUrl: "https://api.test",
      }),
    };

    // Load fetches from server and caches in store
    const loaded = await loadAiConsent("user-1", store, mockApiClient as any);
    expect(loaded.granted).toBe(true);
    expect(loaded.consentVersion).toBe(CURRENT_AI_CONSENT_VERSION);

    // Save calls PUT on server and writes to store
    const saved = await saveAiConsent(
      "user-1",
      true,
      true,
      store,
      mockApiClient as any,
    );
    expect(saved.ok).toBe(true);

    // Revoke calls PUT with granted: false and clears store
    const revoked = await revokeAiConsent(
      "user-1",
      store,
      mockApiClient as any,
    );
    expect(revoked).toBe(true);
    const afterRevoke = await store.getItemAsync("mizyun.ai-consent.user-1");
    expect(afterRevoke).toBeNull();
  });

  it("sends birthYear when saving consent with birthYear", async () => {
    const store = new MemorySecureStore();
    let sentBody: unknown = null;
    const mockApiClient = {
      request: async (options: {
        readonly method: string;
        readonly path: string;
        readonly body?: unknown;
      }) => {
        sentBody = options.body;
        return {
          ok: true as const,
          value: {
            consent: {
              granted: true,
              confirmedAdult: true,
              consentVersion: CURRENT_AI_CONSENT_VERSION,
              consentedAt: "2026-09-08T12:00:00Z",
              revokedAt: null,
            },
          },
        };
      },
      status: () => ({
        configured: true as const,
        baseUrl: "https://api.test",
      }),
    };

    const saved = await saveAiConsent(
      "user-1",
      true,
      true,
      store,
      mockApiClient as any,
      1995,
    );
    expect(saved.ok).toBe(true);
    expect(sentBody).toMatchObject({
      granted: true,
      confirmedAdult: true,
      birthYear: 1995,
    });
  });

  it("returns server error message when server rejects consent", async () => {
    const store = new MemorySecureStore();
    const failingApiClient = {
      request: async () => ({
        ok: false as const,
        error: {
          kind: "http_error" as const,
          status: 403,
          code: "forbidden",
          message:
            "Mizyun AI features require confirmed adult status (18+). Please specify your birth year.",
        },
      }),
      status: () => ({
        configured: true as const,
        baseUrl: "https://api.test",
      }),
    };

    const saved = await saveAiConsent(
      "user-1",
      true,
      true,
      store,
      failingApiClient as any,
    );
    expect(saved.ok).toBe(false);
    expect(saved.error).toBe(
      "Mizyun AI features require confirmed adult status (18+). Please specify your birth year.",
    );
  });

  it("falls back to local store if server request fails", async () => {
    const store = new MemorySecureStore();
    await saveAiConsent("user-1", true, true, store);

    const failingApiClient = {
      request: async () => ({
        ok: false as const,
        error: { kind: "network_error" as const, message: "offline" },
      }),
      status: () => ({
        configured: true as const,
        baseUrl: "https://api.test",
      }),
    };

    const loaded = await loadAiConsent(
      "user-1",
      store,
      failingApiClient as any,
    );
    expect(loaded.granted).toBe(true);
    expect(loaded.confirmedAdult).toBe(true);
  });
  it("asks again when the server holds a Gemini-only consent from an older build", async () => {
    const store = new MemorySecureStore();
    const puts: unknown[] = [];
    const mockApiClient = {
      request: async (options: {
        readonly method: string;
        readonly body?: unknown;
      }) => {
        if (options.method === "PUT") puts.push(options.body);
        return {
          ok: true as const,
          value: {
            consent: {
              granted: true,
              confirmedAdult: true,
              consentVersion:
                options.method === "PUT"
                  ? CURRENT_AI_CONSENT_VERSION
                  : LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
              consentedAt: "2026-09-08T12:00:00Z",
              revokedAt: null,
            },
          },
        };
      },
      status: () => ({
        configured: true as const,
        baseUrl: "https://api.test",
      }),
    };
    const loaded = await loadAiConsent("user-1", store, mockApiClient as any);
    expect(loaded.granted).toBe(false);
    expect(loaded.consentVersion).toBe(LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY);
    expect(
      (await saveAiConsent("user-1", true, true, store, mockApiClient as any))
        .ok,
    ).toBe(true);
    expect(puts).toEqual([
      expect.objectContaining({
        granted: true,
        consentVersion: CURRENT_AI_CONSENT_VERSION,
      }),
    ]);
    expect(CURRENT_AI_CONSENT_VERSION).toBe("2026-10-20");
  });
});
