import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({}));

import type { ApiClient } from "@mizyun/api-client";
import { listStretchOptions, type StretchSessionInput } from "@mizyun/core";

import {
  MAX_STRETCH_AI_ATTEMPTS_PER_DAY,
  clearTailoredStretchPlan,
  loadTailoredStretchPlan,
  peekTailoredStretchPlan,
  stretchTrainingFingerprint,
} from "./stretch-ai-refine";

const USER = "00000000-0000-4000-8000-000000000001";
const TODAY = "2026-10-19";
const input: StretchSessionInput = {
  exercises: [
    { name: "Chest Dips", setCount: 3 },
    { name: "Cable Fly", setCount: 3 },
  ],
  activities: [],
};
const ids = listStretchOptions().map((option) => option.id);
const refined = {
  focusMuscles: ["chest", "front shoulders"],
  steps: ids.slice(0, 4).map((exerciseId) => ({ exerciseId, holdSeconds: 35 })),
};

const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
};

const client = (reply: unknown) => {
  const request = vi.fn(async () => reply);
  return {
    request,
    client: { status: vi.fn(), request } as unknown as ApiClient,
  };
};

const ok = (plan: unknown) => ({
  ok: true,
  value: {
    plan,
    provenance: { provider: "gemini", model: "m", promptVersion: "v" },
    requestId: "r",
  },
});

describe("loadTailoredStretchPlan", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("returns the server plan rebuilt from the catalog and caches it", async () => {
    const { request, client: api } = client(ok(refined));
    const plan = await loadTailoredStretchPlan(USER, input, TODAY, api, store);
    expect(plan?.steps.map((step) => step.exerciseId)).toEqual(ids.slice(0, 4));
    expect(plan?.steps.every((step) => step.holdSeconds === 35)).toBe(true);
    expect(plan?.focusMuscles).toEqual(["chest", "front shoulders"]);
    expect(request).toHaveBeenCalledTimes(1);
    const body = (request.mock.calls[0] as unknown as [{ body: unknown }])[0]
      .body;
    // The date stays on the device; it only keys the cache.
    expect(body).toEqual({
      exercises: [
        { name: "Chest Dips", setCount: 3 },
        { name: "Cable Fly", setCount: 3 },
      ],
      activities: [],
    });

    // Same training the same day: served from the cache, no second call.
    const again = await loadTailoredStretchPlan(USER, input, TODAY, api, store);
    expect(again?.steps).toEqual(plan?.steps);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await peekTailoredStretchPlan(USER, input, TODAY, store)).toEqual(
      plan,
    );
  });

  it("keeps the deterministic plan when the server fails", async () => {
    const { client: api } = client({
      ok: false,
      error: { kind: "http_error", status: 502 },
    });
    expect(
      await loadTailoredStretchPlan(USER, input, TODAY, api, store),
    ).toBeNull();
  });

  it("rejects a plan the device cannot validate", async () => {
    const { client: api } = client(
      ok({
        focusMuscles: ["chest"],
        steps: [ids[0], ids[1], "barbell-squat"].map((exerciseId) => ({
          exerciseId,
          holdSeconds: 30,
        })),
      }),
    );
    expect(
      await loadTailoredStretchPlan(USER, input, TODAY, api, store),
    ).toBeNull();
    expect(await peekTailoredStretchPlan(USER, input, TODAY, store)).toBeNull();
  });

  it("stops after the daily attempts, but tries again tomorrow", async () => {
    const failing = client({ ok: false, error: { kind: "network_error" } });
    for (let i = 0; i < MAX_STRETCH_AI_ATTEMPTS_PER_DAY + 2; i++) {
      await loadTailoredStretchPlan(USER, input, TODAY, failing.client, store);
    }
    expect(failing.request).toHaveBeenCalledTimes(
      MAX_STRETCH_AI_ATTEMPTS_PER_DAY,
    );
    const tomorrow = client(ok(refined));
    expect(
      await loadTailoredStretchPlan(
        USER,
        input,
        "2026-10-20",
        tomorrow.client,
        store,
      ),
    ).not.toBeNull();
  });

  it("asks again when today's training changed, within the daily attempts", async () => {
    const first = client(ok(refined));
    await loadTailoredStretchPlan(USER, input, TODAY, first.client, store);
    const changed: StretchSessionInput = {
      ...input,
      exercises: [...input.exercises, { name: "Lat Pulldown", setCount: 3 }],
    };
    expect(
      await peekTailoredStretchPlan(USER, changed, TODAY, store),
    ).toBeNull();
    const second = client(ok(refined));
    await loadTailoredStretchPlan(USER, changed, TODAY, second.client, store);
    expect(second.request).toHaveBeenCalledTimes(1);
    const third = client(ok(refined));
    await loadTailoredStretchPlan(
      USER,
      { ...changed, activities: ["running"] },
      TODAY,
      third.client,
      store,
    );
    expect(third.request).not.toHaveBeenCalled();
  });

  it("does nothing without training and clears per user", async () => {
    const { request, client: api } = client(ok(refined));
    expect(
      await loadTailoredStretchPlan(
        USER,
        { exercises: [], activities: [] },
        TODAY,
        api,
        store,
      ),
    ).toBeNull();
    expect(request).not.toHaveBeenCalled();
    await loadTailoredStretchPlan(USER, input, TODAY, api, store);
    await clearTailoredStretchPlan(USER, store);
    expect(store.values.size).toBe(0);
  });

  it("shares one server call when the same training is loaded twice at once", async () => {
    const store = memoryStore();
    const api = client(ok(refined));

    const [first, second] = await Promise.all([
      loadTailoredStretchPlan(USER, input, TODAY, api.client, store),
      loadTailoredStretchPlan(USER, input, TODAY, api.client, store),
    ]);

    expect(api.request).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(JSON.parse(store.values.values().next().value!).attempts).toBe(1);
    // Once settled, a later load reads the cache without another call.
    await loadTailoredStretchPlan(USER, input, TODAY, api.client, store);
    expect(api.request).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the account may not use AI any more", async () => {
    const store = memoryStore();
    const api = client(ok(refined));

    const plan = await loadTailoredStretchPlan(
      USER,
      input,
      TODAY,
      api.client,
      store,
      async () => false,
    );

    expect(plan).toBeNull();
    expect(api.request).not.toHaveBeenCalled();
    expect(store.values.size).toBe(0);
  });

  it("keeps no answer that arrives after consent was revoked", async () => {
    const store = memoryStore();
    const api = client(ok(refined));
    let allowed = true;
    api.request.mockImplementation(async () => {
      allowed = false;
      return ok(refined);
    });

    const plan = await loadTailoredStretchPlan(
      USER,
      input,
      TODAY,
      api.client,
      store,
      () => allowed,
    );

    expect(plan).toBeNull();
    expect(await peekTailoredStretchPlan(USER, input, TODAY, store)).toBeNull();
  });

  it("rejects a plan that leaves out one of today's sessions", async () => {
    const climb: StretchSessionInput = {
      exercises: [
        { name: "Chest Dips", setCount: 4, session: "push" },
        { name: "Cable Fly", setCount: 4, session: "push" },
      ],
      activities: ["bouldering"],
    };
    const chestOnly = listStretchOptions()
      .filter(
        (option) =>
          !option.primaryMuscles.some((muscle) =>
            ["forearms", "lats"].includes(muscle),
          ),
      )
      .slice(0, 4)
      .map((option) => ({ exerciseId: option.id, holdSeconds: 30 }));
    const api = client(ok({ focusMuscles: ["chest"], steps: chestOnly }));

    expect(
      await loadTailoredStretchPlan(
        USER,
        climb,
        TODAY,
        api.client,
        memoryStore(),
      ),
    ).toBeNull();
  });

  it("counts attempts one load at a time for different training", async () => {
    const store = memoryStore();
    const api = client(ok(refined));
    const other: StretchSessionInput = {
      exercises: [{ name: "Chest Dips", setCount: 5 }],
      activities: [],
    };
    const third: StretchSessionInput = {
      exercises: [{ name: "Cable Fly", setCount: 5 }],
      activities: [],
    };

    await Promise.all([
      loadTailoredStretchPlan(USER, input, TODAY, api.client, store),
      loadTailoredStretchPlan(USER, other, TODAY, api.client, store),
      loadTailoredStretchPlan(USER, third, TODAY, api.client, store),
    ]);

    expect(api.request).toHaveBeenCalledTimes(MAX_STRETCH_AI_ATTEMPTS_PER_DAY);
  });

  it("fingerprints training regardless of order", () => {
    expect(stretchTrainingFingerprint(input)).toBe(
      stretchTrainingFingerprint({
        ...input,
        exercises: [...input.exercises].reverse(),
      }),
    );
  });
});
