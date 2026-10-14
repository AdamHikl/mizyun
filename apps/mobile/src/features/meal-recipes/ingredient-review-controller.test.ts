import { describe, expect, it, vi } from "vitest";
import { ok, err } from "@mizyun/core";
import type { MealRecipeApi } from "@mizyun/api-client";
import type {
  IngredientRecognitionResponse,
  MealRecipeCapabilities,
} from "@mizyun/contracts";
import type {
  IngredientPhoto,
  IngredientPhotoPickResult,
} from "./ingredient-photos";
import { IngredientReviewController } from "./ingredient-review-controller";
import { EncryptedIngredientReviewStore } from "./ingredient-review-storage";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { resolve, promise };
};
const capability: MealRecipeCapabilities = {
  version: "meal-recipe-v1",
  suggest: true,
  recognizeIngredients: true,
  reason: "ready",
  maximumImages: 3,
  maximumTotalImageBytes: 4_194_304,
  maximumImageDimension: 4096,
  requiresIngredientConfirmation: true,
  requestIdRequired: true,
};
const photo = (
  id = "photo1",
  location: IngredientPhoto["location"] = "fridge",
): IngredientPhoto => ({
  id,
  location,
  uri: `file://private/${id}.jpg`,
  mimeType: "image/jpeg",
  byteSize: 5,
  width: 1024,
  height: 1024,
});
const candidate = (
  name = "Rice",
  ingredientId: string | null = "rice",
  preparationState: "raw" | "cooked" | "unknown" = "raw",
) => ({
  ingredientId,
  name,
  preparationState,
  confirmed: false as const,
  quantity: null,
  quantityUnit: "g" as const,
  availability: "check_quantity" as const,
});
const setup = async () => {
  const values = new Map<string, string>();
  let now = 1000;
  let current = true;
  let aiCurrent = true;
  let id = 0;
  const store = new EncryptedIngredientReviewStore(
    {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    },
    () => now,
  );
  const api: MealRecipeApi = {
    capabilities: vi.fn(async () => ok(capability)),
    suggest: vi.fn(async () =>
      err({ kind: "not_configured" as const, reason: "Unused" }),
    ),
    recognizeIngredients: vi.fn(async (input) =>
      ok({
        version: "meal-recipe-v1" as const,
        requestId: input.requestId,
        ingredients: [candidate()],
        warnings: [],
      }),
    ),
  };
  const photos = {
    pick: vi.fn(async (): Promise<IngredientPhotoPickResult> => ({
      kind: "selected",
      photo: photo(),
    })),
    release: vi.fn(async () => true),
    toUpload: vi.fn(async () => ({
      photo: new Blob(["bytes"], { type: "image/jpeg" }),
      mimeType: "image/jpeg" as const,
    })),
    recover: vi.fn(async () => true),
  };
  const dependencies = {
    userId: "owner",
    api,
    store,
    photos,
    newId: () =>
      `00000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
    now: () => now,
    isCurrent: () => current,
    isAiCurrent: () => aiCurrent,
  };
  const controller = new IngredientReviewController(dependencies);
  await controller.init();
  return {
    controller,
    dependencies,
    values,
    store,
    api,
    photos,
    setCurrent: (value: boolean) => (current = value),
    setAiCurrent: (value: boolean) => (aiCurrent = value),
    advance: () => (now += 1000),
  };
};
describe("ingredient review controller", () => {
  it("requires explicit Analyze, persists UUID before upload, then confirms only selected names/state", async () => {
    const { controller, api, photos, store } = await setup();
    await controller.addPhoto({ source: "library", location: "fridge" });
    expect(api.recognizeIngredients).not.toHaveBeenCalled();
    photos.toUpload.mockImplementationOnce(async () => {
      expect((await store.load("owner"))?.pendingRequest?.requestId).toMatch(
        /0001$/,
      );
      return { photo: new Blob(["bytes"]), mimeType: "image/jpeg" };
    });
    await controller.analyze();
    const row = controller.getSnapshot().ingredients[0];
    expect(row).toMatchObject({
      confirmed: false,
      quantity: null,
      availability: "check_quantity",
      source: "photo",
    });
    expect(photos.release).toHaveBeenCalledWith(photo());
    expect((await store.load("owner"))?.ingredients).toEqual([]);
    await controller.addTyped("  Unmapped ingredient  ");
    const typed = controller.getSnapshot().ingredients[1];
    await controller.updateIngredient(row.id, { enabled: false });
    const confirmed = await controller.confirm();
    expect(confirmed?.ingredients).toEqual([{ ...typed, confirmed: true }]);
    expect(confirmed?.ingredients[0]).toMatchObject({
      ingredientId: null,
      preparationState: "unknown",
      quantity: null,
    });
    expect(api.suggest).not.toHaveBeenCalled();
  });
  it("refreshes capabilities before picking/analyzing and rejects a basic direct bypass before upload", async () => {
    const { controller, api, photos } = await setup();
    await controller.addPhoto({ source: "camera", location: "fridge" });
    photos.pick.mockResolvedValueOnce({
      kind: "selected",
      photo: photo("photo2", "cabinet"),
    });
    await controller.addPhoto({ source: "library", location: "cabinet" });
    vi.mocked(api.capabilities).mockResolvedValue(
      ok({ ...capability, maximumImages: 1 }),
    );
    await controller.analyze();
    expect(photos.toUpload).not.toHaveBeenCalled();
    expect(api.recognizeIngredients).not.toHaveBeenCalled();
    expect(photos.release).toHaveBeenCalledTimes(2);
    await controller.addPhoto({ source: "camera", location: "fridge" });
    await controller.addPhoto({ source: "library", location: "cabinet" });
    expect(photos.pick).toHaveBeenCalledTimes(3);
    vi.mocked(api.capabilities).mockResolvedValue(
      ok({
        ...capability,
        recognizeIngredients: false,
        reason: "access_required",
      }),
    );
    await controller.analyze();
    expect(api.recognizeIngredients).not.toHaveBeenCalled();
    expect(controller.getSnapshot().message).toContain("type ingredients");
  });
  it("keeps cancellation/permission denial as text fallback, with no automatic calls", async () => {
    const { controller, api, photos } = await setup();
    photos.pick.mockResolvedValueOnce({ kind: "cancelled" });
    await controller.addPhoto({ source: "camera", location: "fridge" });
    photos.pick.mockResolvedValueOnce({ kind: "denied" });
    await controller.addPhoto({ source: "library", location: "cabinet" });
    expect(controller.getSnapshot().message).toContain("type ingredients");
    await controller.addTyped("Beans");
    expect(controller.getSnapshot().ingredients).toHaveLength(1);
    expect(api.recognizeIngredients).not.toHaveBeenCalled();
  });
  it("prevents provider calls when required identity persistence fails", async () => {
    const { controller, api, photos, store } = await setup();
    await controller.addPhoto({ source: "camera", location: "fridge" });
    vi.spyOn(store, "save").mockRejectedValue(
      new Error("native storage unavailable"),
    );
    await controller.analyze();
    expect(photos.toUpload).not.toHaveBeenCalled();
    expect(api.recognizeIngredients).not.toHaveBeenCalled();
    expect(photos.release).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().message).toContain("could not be saved");
  });
  it("deduplicates double taps and never retries a lost response or restart marker automatically", async () => {
    const { controller, dependencies, api, photos, store } = await setup();
    const response =
      deferred<ReturnType<typeof ok<IngredientRecognitionResponse>>>();
    vi.mocked(api.recognizeIngredients).mockImplementationOnce(
      () => response.promise,
    );
    await controller.addPhoto({ source: "library", location: "fridge" });
    const started = controller.analyze();
    await vi.waitFor(() =>
      expect(api.recognizeIngredients).toHaveBeenCalledTimes(1),
    );
    await controller.analyze();
    const requestId = vi.mocked(api.recognizeIngredients).mock.calls[0][0]
      .requestId;
    response.resolve(
      err({ kind: "network_error", cause: "lost response" }) as never,
    );
    await started;
    expect(controller.getSnapshot().message).toContain(
      "outcome is unavailable",
    );
    expect((await store.load("owner"))?.pendingRequest?.requestId).toBe(
      requestId,
    );
    const restarted = new IngredientReviewController(dependencies);
    await restarted.init();
    expect(restarted.getSnapshot().photos).toEqual([]);
    expect(restarted.getSnapshot().recoveryRequiresReselect).toBe(true);
    expect(api.recognizeIngredients).toHaveBeenCalledTimes(1);
    photos.pick.mockResolvedValueOnce({
      kind: "selected",
      photo: photo("photo2"),
    });
    await restarted.addPhoto({ source: "camera", location: "fridge" });
    await restarted.analyze();
    expect(api.recognizeIngredients).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(api.recognizeIngredients).mock.calls[1][0].requestId,
    ).not.toBe(requestId);
  });
  it("merges repeated objects, marks state conflicts unknown and preserves typed/confirmed edits", async () => {
    const { controller, api } = await setup();
    await controller.addTyped("  Mystery   beans ");
    const typed = controller.getSnapshot().ingredients[0];
    await controller.updateIngredient(typed.id, {
      preparationState: "cooked",
      confirmed: true,
    });
    vi.mocked(api.recognizeIngredients).mockImplementationOnce(async (input) =>
      ok({
        version: "meal-recipe-v1",
        requestId: input.requestId,
        ingredients: [
          candidate("Rice", "rice", "raw"),
          candidate("Rice", "rice", "cooked"),
          candidate("MYSTERY beans", null, "raw"),
          candidate("Odd fruit", null),
          candidate(" odd   FRUIT ", null),
        ],
        warnings: [],
      }),
    );
    await controller.addPhoto({ source: "camera", location: "fridge" });
    await controller.analyze();
    expect(controller.getSnapshot().ingredients).toHaveLength(3);
    expect(controller.getSnapshot().ingredients[0]).toMatchObject({
      ingredientId: null,
      preparationState: "cooked",
      confirmed: true,
    });
    expect(controller.getSnapshot().ingredients[1]).toMatchObject({
      ingredientId: "rice",
      preparationState: "unknown",
      confirmed: false,
    });
    expect(
      controller
        .getSnapshot()
        .ingredients.every((row) => row.quantity === null),
    ).toBe(true);
  });
  it("fences late acquisitions and makes their failed cleanup visible/retryable", async () => {
    const { controller, photos } = await setup();
    const picked = deferred<IngredientPhotoPickResult>();
    photos.pick.mockImplementationOnce(() => picked.promise);
    photos.release.mockResolvedValueOnce(false);
    const adding = controller.addPhoto({
      source: "camera",
      location: "fridge",
    });
    await vi.waitFor(() => expect(photos.pick).toHaveBeenCalled());
    await controller.cancel();
    picked.resolve({ kind: "selected", photo: photo() });
    await adding;
    expect(controller.getSnapshot().photos).toEqual([]);
    expect(controller.getSnapshot().cleanupPending).toBe(1);
    await controller.retryCleanup();
    expect(controller.getSnapshot().cleanupPending).toBe(0);
  });
  it("aborts/ignores late responses on revoke while manual review remains usable", async () => {
    const { controller, api, photos, setAiCurrent } = await setup();
    const response =
      deferred<ReturnType<typeof ok<IngredientRecognitionResponse>>>();
    vi.mocked(api.recognizeIngredients).mockImplementationOnce(
      () => response.promise,
    );
    await controller.addTyped("Beans");
    await controller.addPhoto({ source: "camera", location: "fridge" });
    const analyzing = controller.analyze();
    await vi.waitFor(() => expect(api.recognizeIngredients).toHaveBeenCalled());
    const [input, options] = vi.mocked(api.recognizeIngredients).mock.calls[0];
    setAiCurrent(false);
    const retirement = controller.retireAi();
    expect(options.signal?.aborted).toBe(true);
    expect(options.isCurrent()).toBe(false);
    await retirement;
    response.resolve(
      ok({
        version: "meal-recipe-v1",
        requestId: input.requestId,
        ingredients: [candidate()],
        warnings: [],
      }),
    );
    await analyzing;
    expect(controller.getSnapshot().ingredients.map((row) => row.name)).toEqual(
      ["Beans"],
    );
    expect(photos.release).toHaveBeenCalled();
    await controller.addTyped("Lentils");
    expect((await controller.confirm())?.ingredients).toHaveLength(2);
    await controller.analyze();
    expect(api.recognizeIngredients).toHaveBeenCalledTimes(1);
  });
  it("fences account switches during conversion and ignores retired provider callbacks", async () => {
    const { controller, api, photos, setCurrent } = await setup();
    const upload = deferred<{ photo: Blob; mimeType: "image/jpeg" }>();
    photos.toUpload.mockImplementationOnce(() => upload.promise);
    await controller.addPhoto({ source: "library", location: "fridge" });
    const analyzing = controller.analyze();
    await vi.waitFor(() => expect(photos.toUpload).toHaveBeenCalled());
    setCurrent(false);
    await controller.dispose();
    upload.resolve({ photo: new Blob(["bytes"]), mimeType: "image/jpeg" });
    await analyzing;
    expect(api.recognizeIngredients).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("retired");
    expect(controller.getSnapshot().ingredients).toEqual([]);
    expect(photos.release).toHaveBeenCalled();
  });
  it("keeps picker and selected-photo cleanup failures retryable and rejects retirement cleanup success claims", async () => {
    const { controller, photos } = await setup();
    photos.pick.mockResolvedValueOnce({ kind: "cleanup_failed" });
    photos.recover.mockResolvedValueOnce(false);
    await controller.addPhoto({ source: "library", location: "cabinet" });
    expect(controller.getSnapshot().cleanupPending).toBe(1);
    await controller.retryCleanup();
    expect(controller.getSnapshot().cleanupPending).toBe(1);
    await controller.retryCleanup();
    expect(controller.getSnapshot().cleanupPending).toBe(0);
    await controller.addPhoto({ source: "camera", location: "fridge" });
    photos.release.mockResolvedValueOnce(false);
    await expect(controller.retireAi()).rejects.toThrow(
      "cleanup is incomplete",
    );
    expect(controller.getSnapshot().aiRetired).toBe(true);
    await controller.retryCleanup();
    expect(controller.getSnapshot().cleanupPending).toBe(0);
  });
  it("does not claim retirement cleanup while native acquisition is unresolved", async () => {
    const { controller, photos } = await setup();
    const picked = deferred<IngredientPhotoPickResult>();
    photos.pick.mockImplementationOnce(() => picked.promise);
    const adding = controller.addPhoto({
      source: "camera",
      location: "fridge",
    });
    await vi.waitFor(() => expect(photos.pick).toHaveBeenCalled());
    await expect(controller.retireAi()).rejects.toThrow(
      "cleanup is incomplete",
    );
    expect(controller.getSnapshot().cleanupPending).toBe(1);
    picked.resolve({ kind: "selected", photo: photo() });
    await adding;
    expect(photos.release).toHaveBeenCalledWith(photo());
    expect(controller.getSnapshot().cleanupPending).toBe(0);
    await controller.addTyped("Beans");
    expect((await controller.confirm())?.ingredients).toHaveLength(1);
  });
  it("does not return confirmation after failed persistence or stale owner", async () => {
    const { controller, store, setCurrent } = await setup();
    await controller.addTyped("Beans");
    vi.spyOn(store, "save").mockRejectedValueOnce(new Error("storage"));
    expect(await controller.confirm()).toBeNull();
    setCurrent(false);
    expect(await controller.confirm()).toBeNull();
  });
});
