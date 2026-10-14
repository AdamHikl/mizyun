import { expect, it, vi } from "vitest";
import {
  getIngredientReviewGeneration,
  registerIngredientReviewRetirement,
  retireIngredientReviews,
} from "./ingredient-review-lifecycle";
import { clearRecipeIngredientData } from "./public-data";
import {
  EncryptedIngredientReviewStore,
  type IngredientReviewStore,
} from "./ingredient-review-storage";
import { revokeAiConsent } from "../coach/ai-consent";

it("fences every callback synchronously before awaiting cleanup and keeps owners separate", async () => {
  let finish!: () => void;
  const one = vi.fn(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  const two = vi.fn();
  const off = registerIngredientReviewRetirement("fence-owner", one);
  const offOther = registerIngredientReviewRetirement("other-owner", two);
  const generation = getIngredientReviewGeneration("fence-owner");
  const cleanup = retireIngredientReviews("fence-owner");
  expect(getIngredientReviewGeneration("fence-owner")).toBe(generation + 1);
  expect(one).toHaveBeenCalledOnce();
  expect(two).not.toHaveBeenCalled();
  finish();
  expect(await cleanup).toBe(true);
  off();
  offOther();
});
it("reports cleanup failure without skipping account-scoped recovery erasure", async () => {
  const clear = vi.fn().mockResolvedValue(undefined);
  const store = { clear } as unknown as IngredientReviewStore;
  const off = registerIngredientReviewRetirement("erase-owner", () => {
    throw new Error("private detail");
  });
  const cleanupPhotos = vi.fn().mockResolvedValue(false);
  await expect(
    clearRecipeIngredientData("erase-owner", { store, cleanupPhotos }),
  ).rejects.toThrow("Local recipe ingredient cleanup is incomplete.");
  expect(clear).toHaveBeenCalledTimes(2);
  expect(clear).toHaveBeenCalledWith("erase-owner");
  expect(cleanupPhotos).toHaveBeenCalledExactlyOnceWith("erase-owner");
  off();
});
it("revoke fences pending photo work even when the remote consent request fails", async () => {
  const retired = vi.fn();
  const off = registerIngredientReviewRetirement("consent-owner", retired);
  const deleteItemAsync = vi.fn();
  const request = vi.fn(async () => {
    expect(retired).toHaveBeenCalledOnce();
    return { ok: false, error: { kind: "network_error" } };
  });
  expect(
    await revokeAiConsent(
      "consent-owner",
      { deleteItemAsync } as any,
      { request } as any,
    ),
  ).toBe(false);
  expect(deleteItemAsync).not.toHaveBeenCalled();
  off();
});
it("purges only owned recovery and photos, and rejects a write racing deletion", async () => {
  const rows = new Map<string, string>();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const storage = {
    getItem: async (k: string) => rows.get(k) ?? null,
    removeItem: async (k: string) => {
      rows.delete(k);
    },
    setItem: async (k: string, v: string) => {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
      rows.set(k, v);
    },
  };
  const store = new EncryptedIngredientReviewStore(storage, () => 1000);
  const write = store.save("delete-race", {
    version: "ingredient-review-v1",
    updatedAt: 1000,
    expiresAt: 2000,
    ingredients: [],
    requiresPhotoReselect: false,
    pendingRequest: null,
  });
  await started;
  const cleanupPhotos = vi.fn().mockResolvedValue(true);
  const deleted = clearRecipeIngredientData("delete-race", {
    store,
    cleanupPhotos,
  });
  release();
  await expect(write).rejects.toThrow("context changed");
  await deleted;
  expect(await store.load("delete-race")).toBeNull();
  expect(rows.size).toBe(0);
});
