import { expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { createMealRecipeApi } from "@mizyun/api-client";
import { SessionReadCache } from "@/composition/session-read-cache";
import { CommunityReadCache } from "../community/state/read-cache";
it("forwards each explicit recipe request through both read wrappers without caching or generic transport", async () => {
  const capabilities = vi
    .fn()
    .mockResolvedValue({ ok: true, value: { recognizeIngredients: false } });
  const recognize = vi
    .fn()
    .mockResolvedValue({ ok: false, error: { kind: "unauthorized" } });
  const suggest = vi
    .fn()
    .mockResolvedValue({ ok: false, error: { kind: "unauthorized" } });
  const assist = vi
    .fn()
    .mockResolvedValue({ ok: false, error: { kind: "unauthorized" } });
  const request = vi.fn();
  const raw = {
    request,
    status: () => ({ configured: true }),
    getMealRecipeCapabilities: capabilities,
    recognizeMealRecipeIngredients: recognize,
    suggestMealRecipes: suggest,
    assistMealRecipe: assist,
  } as unknown as ApiClient;
  const api = createMealRecipeApi(
    new CommunityReadCache(
      new SessionReadCache(raw, async () => null),
      async () => null,
    ),
  );
  const options = { expectedUserId: "owner", isCurrent: () => true };
  await api.capabilities(options);
  await api.capabilities(options);
  const input = {
    requestId: "00000000-0000-4000-8000-000000000001",
    images: [],
  };
  await api.recognizeIngredients(input, options);
  await api.suggest({} as any, options);
  const turn = { turn: {} as any, images: [] };
  await api.assist(turn, options);
  expect(capabilities).toHaveBeenCalledTimes(2);
  expect(capabilities).toHaveBeenLastCalledWith(options);
  expect(recognize).toHaveBeenCalledExactlyOnceWith(input, options);
  expect(suggest).toHaveBeenCalledOnce();
  expect(assist).toHaveBeenCalledExactlyOnceWith(turn, options);
  expect(request).not.toHaveBeenCalled();
});
