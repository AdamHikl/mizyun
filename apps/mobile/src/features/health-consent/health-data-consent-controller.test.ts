import { describe, expect, it } from "vitest";
import { err, ok } from "@mizyun/core";
import type { ApiClient } from "@mizyun/api-client";
import { CURRENT_HEALTH_DATA_CONSENT_VERSION } from "@mizyun/contracts";

import type { ConsentCacheStore } from "./health-data-consent";
import { HealthDataConsentController } from "./health-data-consent-controller";

const userId = "00000000-0000-4000-8000-000000000001";
const cacheKey = `mizyun.health-data-consent.${userId}`;

const consent = (granted: boolean) => ({
  consent: {
    granted,
    consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION,
    consentedAt: granted ? "2026-10-27T10:00:00.000Z" : null,
    revokedAt: granted ? null : "2026-10-27T11:00:00.000Z",
  },
});
const offline = err({ kind: "network_error", cause: new Error("offline") });

/** An API client whose responses the test releases one at a time. */
const manualClient = () => {
  const pending: Array<(value: unknown) => void> = [];
  const client = {
    request: () => new Promise((resolve) => pending.push(resolve)),
  } as unknown as ApiClient;
  return {
    client,
    /** Answers the oldest waiting request, or the one at `index`. */
    respond: async (value: unknown, index = 0) => {
      const [next] = pending.splice(index, 1);
      if (!next) throw new Error("no request waiting");
      next(value);
      await flush();
    },
    get waiting() {
      return pending.length;
    },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const memoryStore = (
  initial: Record<string, unknown> = {},
): ConsentCacheStore & { data: Map<string, string> } => {
  const data = new Map(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  return {
    data,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => void data.set(key, value),
    deleteItemAsync: async (key) => void data.delete(key),
  };
};

const setup = (store = memoryStore()) => {
  const api = manualClient();
  const states: Array<string | null> = [];
  const controller = new HealthDataConsentController({
    userId,
    client: api.client,
    store,
    onChange: (state) => states.push(state?.status ?? null),
  });
  return { api, controller, states, store };
};

describe("HealthDataConsentController (PRIV-01 review)", () => {
  it("opens on a cached grant, then follows the server", async () => {
    const { api, controller } = setup(
      memoryStore({ [cacheKey]: consent(true).consent }),
    );
    void controller.start();
    await flush();
    expect(controller.state?.status).toBe("granted");
    await api.respond(ok(consent(false)));
    expect(controller.state).toMatchObject({
      status: "required",
      withdrawn: true,
    });
  });

  it("does not let a slow cache read overwrite the server answer", async () => {
    let releaseCache: (value: string | null) => void = () => undefined;
    const store: ConsentCacheStore = {
      getItemAsync: () => new Promise((resolve) => (releaseCache = resolve)),
      setItemAsync: async () => undefined,
      deleteItemAsync: async () => undefined,
    };
    const { api, controller } = setup(store as never);
    void controller.start();
    await api.respond(ok(consent(false)));
    releaseCache(JSON.stringify(consent(true).consent));
    await flush();
    expect(controller.state?.status).toBe("required");
  });

  it("ignores a foreground refresh until the first answer is shown, so loading always ends", async () => {
    const { api, controller } = setup();
    void controller.start();
    await controller.refresh();
    expect(api.waiting).toBe(1);
    await api.respond(offline);
    expect(controller.state?.status).toBe("unavailable");
  });

  it("keeps the shown answer when a foreground refresh fails", async () => {
    const { api, controller } = setup();
    void controller.start();
    await api.respond(ok(consent(true)));
    const refreshing = controller.refresh();
    await api.respond(offline);
    await refreshing;
    expect(controller.state?.status).toBe("granted");
  });

  it("does not cache a stale grant read before this device's withdrawal", async () => {
    const { api, controller, store } = setup();
    void controller.start();
    await api.respond(ok(consent(true)));
    const refreshing = controller.refresh();
    const withdrawing = controller.save(false);
    // The PUT (second request) answers first, then the GET that read the
    // old grant.
    await api.respond(ok(consent(false)), 1);
    await withdrawing;
    await api.respond(ok(consent(true)));
    await refreshing;
    expect(controller.state?.status).toBe("required");
    expect(JSON.parse(store.data.get(cacheKey)!).granted).toBe(false);
  });

  it("drops a refresh that started during a save and answered after it", async () => {
    const { api, controller, store } = setup();
    void controller.start();
    await api.respond(ok(consent(true)));
    const withdrawing = controller.save(false);
    const refreshing = controller.refresh();
    await api.respond(ok(consent(false)));
    await withdrawing;
    await api.respond(ok(consent(true)));
    await refreshing;
    expect(controller.state?.status).toBe("required");
    expect(JSON.parse(store.data.get(cacheKey)!).granted).toBe(false);
  });

  it("drops a save that finishes after dispose (user switch)", async () => {
    const { api, controller, states } = setup();
    void controller.start();
    await api.respond(ok(consent(false)));
    const granting = controller.save(true);
    controller.dispose();
    await api.respond(ok(consent(true)));
    await expect(granting).resolves.toBeNull();
    expect(states.at(-1)).toBe("required");
  });

  it("retry starts again from loading", async () => {
    const { api, controller, states } = setup();
    void controller.start();
    await api.respond(offline);
    void controller.start();
    expect(states.at(-1)).toBeNull();
    await api.respond(ok(consent(true)));
    expect(controller.state?.status).toBe("granted");
  });
});
