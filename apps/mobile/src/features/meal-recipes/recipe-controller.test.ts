import { expect, it, vi } from "vitest";
import { ok, err } from "@mizyun/core";
import { RecipeController } from "./recipe-controller";
import {
  recovery,
  metadata,
  validated,
  capabilities,
  input,
  NOW,
  requestId,
} from "./recipe-fixtures.test-support";
import type { RecipeSession } from "./recipe-storage";
const fixture = () => {
  let now = NOW,
    current = true,
    saved: RecipeSession | null = recovery();
  const store = {
    load: vi.fn(async () => saved),
    save: vi.fn(
      async (
        _owner: string,
        value: RecipeSession,
        isCurrent: () => boolean,
      ) => {
        if (!isCurrent()) throw Error("changed");
        saved = value;
      },
    ),
    clear: vi.fn(async () => {
      saved = null;
    }),
    export: vi.fn(async () => saved),
  };
  const api = {
    capabilities: vi.fn(async () => ok(capabilities)),
    suggest: vi.fn(async () =>
      ok({
        version: "meal-recipe-v1" as const,
        requestId,
        recipes: validated.recipes,
        ranking: validated.ranking,
      }),
    ),
    recognizeIngredients: vi.fn(),
  };
  const sessionApi = {
    context: vi.fn(async () => ok(metadata)),
    revalidate: vi.fn(async () => ok(validated)),
  };
  const stage = vi.fn(async () => ({
    status: "ready" as const,
    operationId: requestId,
  }));
  const controller = new RecipeController({
    owner: "owner-a",
    api,
    sessionApi,
    store,
    stage,
    newId: () => requestId,
    isCurrent: () => current,
    now: () => now,
  });
  return {
    controller,
    api,
    sessionApi,
    store,
    stage,
    setCurrent: (value: boolean) => {
      current = value;
    },
    setNow: (value: number) => {
      now = value;
    },
  };
};
it("reopens as archival until server checks current constraints, and portions recalculate without a model call", async () => {
  const f = fixture();
  await f.controller.init();
  expect(f.sessionApi.revalidate).toHaveBeenCalledOnce();
  expect(f.controller.fresh()).toBe(true);
  await f.controller.portion(1.5);
  expect(
    f.controller.selected()?.recipe.nutritionPerServing.carbohydrateG,
  ).toBe(84);
  expect(f.controller.ranking()?.ranked[0]?.fitLoss).not.toBe(
    validated.ranking.ranked[0]?.fitLoss,
  );
  expect(f.api.suggest).not.toHaveBeenCalled();
  expect(f.sessionApi.revalidate).toHaveBeenCalledOnce();
});
it("expired fit and changed inputs block cooking/handoff until current server verification", async () => {
  const f = fixture();
  await f.controller.init();
  f.setNow(NOW + 300001);
  f.controller.expire();
  expect(f.controller.fresh()).toBe(false);
  f.sessionApi.revalidate.mockResolvedValue(
    err({ kind: "network_error", cause: "offline" }) as any,
  );
  expect(await f.controller.handoff()).toBe(false);
  expect(f.stage).not.toHaveBeenCalled();
  expect(f.controller.selected()).not.toBeNull();
  await f.controller.setInput({
    ...input,
    exclusions: { ...input.exclusions, allergens: ["milk"] },
  });
  expect(f.controller.fresh()).toBe(false);
  expect(
    f.controller.getSnapshot().session?.input?.exclusions.allergens,
  ).toEqual(["milk"]);
});
it("pending input edits cannot resurrect a fresh claim by refreshing the old inputs", async () => {
  const f = fixture();
  await f.controller.init();
  f.controller.invalidateInputs();
  await f.controller.refresh();
  expect(f.controller.fresh()).toBe(false);
  expect(await f.controller.handoff()).toBe(false);
  expect(f.stage).not.toHaveBeenCalled();
});
it("required persistence failure blocks handoff and provider dispatch", async () => {
  const f = fixture();
  await f.controller.init();
  f.store.save.mockRejectedValue(new Error("private"));
  expect(await f.controller.handoff()).toBe(false);
  expect(f.stage).not.toHaveBeenCalled();
  await f.controller.generate();
  expect(f.api.suggest).not.toHaveBeenCalled();
});
it("owner change and consent retirement fence a late provider reply", async () => {
  const f = fixture();
  await f.controller.init();
  let resolve!: (value: any) => void;
  f.api.suggest.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const work = f.controller.generate();
  await vi.waitFor(() => expect(f.api.suggest).toHaveBeenCalledOnce());
  f.controller.retireAi();
  resolve(
    ok({
      version: "meal-recipe-v1",
      requestId,
      recipes: validated.recipes,
      ranking: validated.ranking,
    }),
  );
  await work;
  expect(f.controller.getSnapshot().validated).toBe(false);
  expect(f.sessionApi.revalidate).toHaveBeenCalledTimes(1);
  f.setCurrent(false);
  expect(await f.controller.handoff()).toBe(false);
  expect(f.stage).not.toHaveBeenCalled();
});
it("manual reviewed logging remains available after consent revocation, with same identity on reopen", async () => {
  const f = fixture();
  await f.controller.init();
  f.controller.retireAi();
  expect(await f.controller.handoff()).toBe(true);
  expect(await f.controller.handoff()).toBe(true);
  expect(
    f.stage.mock.calls.map((call) => (call as any)[1].operationId),
  ).toEqual([requestId, requestId]);
  expect(f.api.suggest).not.toHaveBeenCalled();
});
it("double presses stage once, collision requires explicit replacement", async () => {
  const f = fixture();
  await f.controller.init();
  f.stage.mockResolvedValue({ status: "collision" } as any);
  await Promise.all([f.controller.handoff(), f.controller.handoff()]);
  expect(f.stage).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot().collision).toBe(true);
  await f.controller.handoff(true);
  expect(f.stage).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ replace: true }),
  );
});
it("unknown macro context never claims fit but permits ordinary validated recipes", async () => {
  const f = fixture();
  f.sessionApi.revalidate.mockResolvedValue(
    ok({
      ...validated,
      ranking: {
        ...validated.ranking,
        context: {
          ...metadata.context,
          state: "unknown",
          coverage: "unknown",
          reason: "intake_unknown",
          focus: [],
        },
      },
    }) as any,
  );
  await f.controller.init();
  expect(f.controller.ranking()?.ranked[0]?.fitLoss).toBeNull();
  expect(f.controller.fresh()).toBe(true);
});

it("recorded consumption cannot reopen Save under its old identity; explicit repeat creates a new one", async () => {
  const f = fixture();
  await f.controller.init();
  expect(await f.controller.handoff()).toBe(true);
  expect(f.controller.getSnapshot().session?.handoffOpened).toBe(true);
  await f.controller.portion(2);
  expect(f.controller.getSnapshot().session?.portion).toBe(1);
  f.stage.mockResolvedValue({
    status: "resolved",
    operationId: requestId,
  } as any);
  expect(await f.controller.handoff()).toBe(false);
  expect(f.stage).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ requireExisting: true, operationId: requestId }),
  );
  expect(f.controller.getSnapshot().message).toContain("already recorded");
  await f.controller.anotherConsumption();
  expect(f.controller.getSnapshot().session?.operationId).toBeNull();
});

it("midnight invalidates cooking authority even while the five-minute context TTL remains", async () => {
  const f = fixture();
  const generated = Date.parse("2026-10-13T23:59:00Z");
  f.setNow(generated);
  const result = {
    ...validated,
    ranking: {
      ...validated.ranking,
      context: {
        ...metadata.context,
        snapshot: {
          ...metadata.context.snapshot,
          generatedAt: new Date(generated).toISOString(),
          expiresAt: new Date(generated + 300000).toISOString(),
        },
      },
    },
  };
  f.sessionApi.revalidate.mockResolvedValue(ok(result));
  await f.controller.init();
  expect(f.controller.fresh()).toBe(true);
  f.setNow(Date.parse("2026-10-14T00:01:00Z"));
  expect(f.controller.fresh()).toBe(false);
  f.controller.expire();
  expect(f.controller.getSnapshot().validated).toBe(false);
  expect(f.controller.ranking()?.context.state).toBe("stale");
});

it("refreshes initial missing-consent capability but cannot revive locally retired AI from stale server readiness", async () => {
  const f = fixture();
  f.store.load.mockResolvedValue(null);
  f.api.capabilities.mockResolvedValueOnce(
    ok({
      ...capabilities,
      suggest: false,
      recognizeIngredients: false,
      reason: "access_required",
    }),
  );
  await f.controller.init();
  expect(f.controller.getSnapshot().capabilities?.suggest).toBe(false);
  await f.controller.refresh();
  expect(f.controller.getSnapshot().capabilities?.suggest).toBe(true);
  f.controller.retireAi();
  await f.controller.refresh();
  expect(f.controller.getSnapshot().capabilities?.suggest).toBe(false);
  await f.controller.generate();
  expect(f.api.suggest).not.toHaveBeenCalled();
});
it("explains a definitive limit rejection and clears the unknown-outcome marker", async () => {
  const f = fixture();
  await f.controller.init();
  vi.mocked(f.api.suggest).mockResolvedValueOnce(
    err({
      kind: "http_error",
      status: 429,
      code: "RECIPE_LIMIT_DRAFTS",
      message: "limit",
    }) as never,
  );
  await f.controller.generate();
  const snapshot = f.controller.getSnapshot();
  expect(snapshot.message).toContain("today’s meal ideas");
  expect(snapshot.session?.pendingRequestId).toBeNull();
});
it("keeps the unknown-outcome marker after an ambiguous transport failure", async () => {
  const f = fixture();
  await f.controller.init();
  vi.mocked(f.api.suggest).mockResolvedValueOnce(
    err({ kind: "network_error", cause: Error("offline") }) as never,
  );
  await f.controller.generate();
  const snapshot = f.controller.getSnapshot();
  expect(snapshot.message).toContain("a retry creates a new request");
  expect(snapshot.session?.pendingRequestId).toBe(requestId);
});
