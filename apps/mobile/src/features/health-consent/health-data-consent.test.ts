import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@mizyun/core";
import type { ApiClient } from "@mizyun/api-client";
import { CURRENT_HEALTH_DATA_CONSENT_VERSION } from "@mizyun/contracts";

import {
  loadHealthDataConsent,
  readCachedHealthDataConsent,
  saveHealthDataConsent,
  type ConsentCacheStore,
} from "./health-data-consent";

const userId = "00000000-0000-4000-8000-000000000001";

const memoryStore = (): ConsentCacheStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => void data.set(key, value),
    deleteItemAsync: async (key) => void data.delete(key),
  };
};

const consent = (
  granted: boolean,
  consentVersion = CURRENT_HEALTH_DATA_CONSENT_VERSION,
) => ({
  consent: {
    granted,
    consentVersion,
    consentedAt: granted ? "2026-10-27T10:00:00.000Z" : null,
    revokedAt: granted ? null : "2026-10-27T11:00:00.000Z",
  },
});

const clientReturning = (...results: unknown[]) => {
  const request = vi.fn();
  for (const result of results) request.mockResolvedValueOnce(result);
  return { client: { request } as unknown as ApiClient, request };
};

describe("health data consent client (PRIV-01)", () => {
  it("requires consent when the server has none", async () => {
    const { client } = clientReturning(
      ok({
        consent: {
          granted: false,
          consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION,
          consentedAt: null,
          revokedAt: null,
        },
      }),
    );
    await expect(
      loadHealthDataConsent(userId, client, memoryStore()),
    ).resolves.toEqual({
      status: "required",
      confirmedByServer: true,
      withdrawn: false,
    });
  });

  it("asks again when the stored grant is for an older explanation", async () => {
    const { client } = clientReturning(ok(consent(true, "2026-01-01")));
    const loaded = await loadHealthDataConsent(userId, client, memoryStore());
    expect(loaded.status).toBe("required");
  });

  it("sends the current version, caches the grant and uses it offline", async () => {
    const store = memoryStore();
    const { client, request } = clientReturning(
      ok(consent(true)),
      err({ kind: "network_error", cause: new Error("offline") }),
    );
    const saved = await saveHealthDataConsent(userId, true, client, store);
    expect(saved).toMatchObject({ ok: true, consent: { status: "granted" } });
    expect(request.mock.calls[0]![0]).toMatchObject({
      method: "PUT",
      path: "/v1/account/health-data-consent",
      body: {
        granted: true,
        consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION,
      },
      expectedUserId: userId,
    });
    const offline = await loadHealthDataConsent(userId, client, store);
    expect(offline).toEqual({
      status: "granted",
      confirmedByServer: false,
      withdrawn: false,
    });
  });

  it("reports unavailable, not a consent step it cannot save, when nothing answers", async () => {
    for (const failure of [
      err({ kind: "network_error", cause: new Error("offline") }),
      err({
        kind: "http_error",
        status: 404,
        code: "NOT_FOUND",
        message: "Route not found",
      }),
    ]) {
      const { client } = clientReturning(failure);
      const loaded = await loadHealthDataConsent(userId, client, memoryStore());
      expect(loaded.status).toBe("unavailable");
    }
  });

  it("reads the cached answer without the network", async () => {
    const store = memoryStore();
    const { client } = clientReturning(ok(consent(true)));
    await loadHealthDataConsent(userId, client, store);
    await expect(readCachedHealthDataConsent(userId, store)).resolves.toEqual({
      status: "granted",
      confirmedByServer: false,
      withdrawn: false,
    });
    await expect(
      readCachedHealthDataConsent("someone-else", store),
    ).resolves.toBeNull();
  });

  it("records a withdrawal so the app asks again and offers export/delete", async () => {
    const store = memoryStore();
    const { client } = clientReturning(ok(consent(false)));
    const saved = await saveHealthDataConsent(userId, false, client, store);
    expect(saved).toEqual({
      ok: true,
      consent: { status: "required", confirmedByServer: true, withdrawn: true },
    });
  });

  it("reports a failed save without changing the cached answer", async () => {
    const store = memoryStore();
    const { client } = clientReturning(
      err({ kind: "network_error", cause: new Error("offline") }),
    );
    const saved = await saveHealthDataConsent(userId, true, client, store);
    expect(saved).toEqual({
      ok: false,
      message: "You're offline. Connect to the internet and try again.",
    });
    expect(store.data.size).toBe(0);
  });
});
