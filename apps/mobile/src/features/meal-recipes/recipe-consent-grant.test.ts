import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient, RequestOptions } from "@mizyun/api-client";
import { CURRENT_AI_CONSENT_VERSION } from "@mizyun/contracts";
import {
  loadAiConsent,
  revokeAiConsent,
  saveAiConsent,
  type SecureStoreClient,
} from "../coach/ai-consent";
import {
  notifyRecipeConsentGrant,
  retireIngredientReviews,
  subscribeRecipeConsentGrant,
} from "./public-data";

const subscriptions: (() => void)[] = [];
afterEach(() => subscriptions.splice(0).forEach((off) => off()));
const subscribe = (owner: string, callback = vi.fn()) => {
  subscriptions.push(subscribeRecipeConsentGrant(owner, callback));
  return callback;
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const consent = (overrides = {}) => ({
  ok: true as const,
  value: {
    consent: {
      granted: true,
      confirmedAdult: true,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
      consentedAt: "2026-10-13T12:00:00Z",
      revokedAt: null,
      ...overrides,
    },
  },
});
const memoryStore = () => {
  const values = new Map<string, string>();
  const store: SecureStoreClient = {
    getItemAsync: vi.fn(async (key) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key, value) => {
      values.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key) => {
      values.delete(key);
    }),
  };
  return { store, values };
};
const client = (request = vi.fn().mockResolvedValue(consent())) =>
  ({ request }) as unknown as ApiClient;

it("emits once for the owner only after remote and required local grant saves complete", async () => {
  const owner = "grant-complete";
  const callback = subscribe(owner);
  const other = subscribe("grant-other");
  const remote = deferred<ReturnType<typeof consent>>();
  const local = deferred<void>();
  const localStarted = deferred<void>();
  const { store } = memoryStore();
  store.setItemAsync = vi.fn(async () => {
    localStarted.resolve();
    await local.promise;
  });
  const request = vi.fn((_options: RequestOptions) => remote.promise);
  const saved = saveAiConsent(owner, true, true, store, client(request), 1990);
  expect(callback).not.toHaveBeenCalled();
  remote.resolve(consent());
  await localStarted.promise;
  expect(callback).not.toHaveBeenCalled();
  local.resolve();
  expect(await saved).toEqual({ ok: true });
  expect(callback).toHaveBeenCalledOnce();
  expect(other).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      method: "PUT",
      path: "/v1/account/ai-consent",
      expectedUserId: owner,
      isCurrent: expect.any(Function),
    }),
  );
});

it.each([
  ["non-grant", false, false, consent()],
  ["non-adult", true, false, consent()],
  ["remote-denied", true, true, consent({ granted: false })],
  ["remote-non-adult", true, true, consent({ confirmedAdult: false })],
  ["remote-old-version", true, true, consent({ consentVersion: "old" })],
  [
    "remote-revoked",
    true,
    true,
    consent({ revokedAt: "2026-10-13T12:01:00Z" }),
  ],
])("does not emit for %s", async (name, granted, adult, response) => {
  const owner = `grant-${name}`;
  const callback = subscribe(owner);
  await saveAiConsent(
    owner,
    granted,
    adult,
    memoryStore().store,
    client(vi.fn().mockResolvedValue(response)),
  );
  expect(callback).not.toHaveBeenCalled();
});

it("does not emit from local-only save or loading existing granted consent", async () => {
  const owner = "grant-load";
  const callback = subscribe(owner);
  const { store } = memoryStore();
  expect((await saveAiConsent(owner, true, true, store)).ok).toBe(true);
  expect((await loadAiConsent(owner, store, client())).granted).toBe(true);
  expect(callback).not.toHaveBeenCalled();
});

it.each(["remote-denied", "remote-throws", "local-fails"])(
  "does not emit when %s",
  async (failure) => {
    const owner = `grant-failure-${failure}`;
    const callback = subscribe(owner);
    const { store } = memoryStore();
    const request = vi.fn().mockResolvedValue(consent());
    if (failure === "remote-denied")
      request.mockResolvedValue({
        ok: false,
        error: { kind: "http_error", status: 403, message: "Denied" },
      });
    if (failure === "remote-throws")
      request.mockRejectedValue(new Error("Offline"));
    if (failure === "local-fails")
      store.setItemAsync = vi.fn().mockRejectedValue(new Error("Storage"));
    expect(
      (await saveAiConsent(owner, true, true, store, client(request))).ok,
    ).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    if (failure !== "local-fails")
      expect(store.setItemAsync).not.toHaveBeenCalled();
  },
);

it("does not cache or emit a grant finishing after its owner was retired", async () => {
  const owner = "grant-owner-change";
  const callback = subscribe(owner);
  const { store } = memoryStore();
  const remote = deferred<ReturnType<typeof consent>>();
  const request = vi.fn((_options: RequestOptions) => remote.promise);
  const saved = saveAiConsent(owner, true, true, store, client(request));
  await retireIngredientReviews(owner, "account");
  remote.resolve(consent());
  expect((await saved).ok).toBe(false);
  expect(callback).not.toHaveBeenCalled();
  expect(store.setItemAsync).not.toHaveBeenCalled();
  expect(request.mock.calls[0]![0].isCurrent!()).toBe(false);
});

it("cleans a native write racing failed revocation before allowing a newer grant", async () => {
  const owner = "grant-native-revoke";
  const callback = subscribe(owner);
  const { store, values } = memoryStore();
  const local = deferred<void>();
  const started = deferred<void>();
  const originalWrite = store.setItemAsync;
  store.setItemAsync = vi.fn(async (key, value) => {
    if (!startedResolved) {
      startedResolved = true;
      started.resolve();
      await local.promise;
    }
    return originalWrite(key, value);
  });
  let startedResolved = false;
  const oldSave = saveAiConsent(owner, true, true, store, client());
  await started.promise;
  expect(
    await revokeAiConsent(
      owner,
      store,
      client(
        vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: "network_error" },
        }),
      ),
    ),
  ).toBe(false);
  const newSave = saveAiConsent(owner, true, true, store, client());
  local.resolve();
  expect((await oldSave).ok).toBe(false);
  expect(await newSave).toEqual({ ok: true });
  expect(callback).toHaveBeenCalledOnce();
  expect(JSON.parse(values.get(`mizyun.ai-consent.${owner}`)!)).toMatchObject({
    granted: true,
    confirmedAdult: true,
  });
  expect(store.deleteItemAsync).toHaveBeenCalledOnce();
});

it("does not retain or emit a local grant racing account retirement", async () => {
  const owner = "grant-native-account";
  const callback = subscribe(owner);
  const { store, values } = memoryStore();
  const local = deferred<void>();
  const started = deferred<void>();
  const originalWrite = store.setItemAsync;
  store.setItemAsync = vi.fn(async (key, value) => {
    started.resolve();
    await local.promise;
    return originalWrite(key, value);
  });
  const saved = saveAiConsent(owner, true, true, store, client());
  await started.promise;
  await retireIngredientReviews(owner, "account");
  local.resolve();
  expect((await saved).ok).toBe(false);
  expect(callback).not.toHaveBeenCalled();
  expect(values.has(`mizyun.ai-consent.${owner}`)).toBe(false);
});

it("fences remaining callbacks when a grant observer retires the owner", () => {
  const owner = "grant-reentrant";
  subscribe(
    owner,
    vi.fn(() => {
      void retireIngredientReviews(owner);
    }),
  );
  const second = subscribe(owner);
  notifyRecipeConsentGrant(owner);
  expect(second).not.toHaveBeenCalled();
});

it("unsubscribe prevents notification and a throwing observer cannot break a saved grant", async () => {
  const owner = "grant-unsubscribe";
  const removed = vi.fn();
  const off = subscribeRecipeConsentGrant(owner, removed);
  off();
  subscribe(
    owner,
    vi.fn(() => {
      throw new Error("Presentation failed");
    }),
  );
  const callback = subscribe(owner);
  expect(
    await saveAiConsent(owner, true, true, memoryStore().store, client()),
  ).toEqual({ ok: true });
  expect(removed).not.toHaveBeenCalled();
  expect(callback).toHaveBeenCalledOnce();
});
