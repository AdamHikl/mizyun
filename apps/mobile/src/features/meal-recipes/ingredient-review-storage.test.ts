import { describe, expect, it } from "vitest";
import { ChunkedStorage } from "@mizyun/adapter-supabase-mobile/chunked-storage";
import {
  EncryptedIngredientReviewStore,
  INGREDIENT_REVIEW_TTL_MS,
  clearIngredientReview,
  exportIngredientReview,
  createIngredientReviewChunkedStorage,
  type IngredientReviewRecovery,
  type ReviewedIngredient,
} from "./ingredient-review-storage";

const row = (patch: Partial<ReviewedIngredient> = {}): ReviewedIngredient => ({
  id: "row1",
  ingredientId: null,
  name: "Rice",
  preparationState: "unknown",
  confirmed: false,
  enabled: true,
  source: "typed",
  quantity: null,
  quantityUnit: "g",
  availability: "check_quantity",
  ...patch,
});
const recovery = (
  patch: Partial<IngredientReviewRecovery> = {},
): IngredientReviewRecovery => ({
  version: "ingredient-review-v1",
  updatedAt: 1000,
  expiresAt: 1000 + INGREDIENT_REVIEW_TTL_MS,
  ingredients: [row()],
  requiresPhotoReselect: false,
  pendingRequest: null,
  ...patch,
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { resolve, promise };
};
const memory = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
  };
};
describe("ingredient review encrypted recovery boundary", () => {
  it("restores only typed and explicitly confirmed rows, with no photo assets", async () => {
    const primitive = memory();
    const store = new EncryptedIngredientReviewStore(primitive, () => 1000);
    await store.save(
      "owner",
      recovery({
        ingredients: [
          row(),
          row({ id: "photo-proposal", source: "photo" }),
          row({ id: "photo-confirmed", source: "photo", confirmed: true }),
        ],
        requiresPhotoReselect: true,
        pendingRequest: {
          requestId: "00000000-0000-4000-8000-000000000001",
          startedAt: 1000,
        },
      }),
    );
    expect(
      (await store.load("owner"))?.ingredients.map((item) => item.id),
    ).toEqual(["row1", "photo-confirmed"]);
    expect(JSON.stringify([...primitive.values])).not.toContain("uri");
    expect((await store.load("owner"))?.requiresPhotoReselect).toBe(true);
  });
  it("expires after 24 hours and prunes at load/export", async () => {
    const primitive = memory();
    let now = 1000;
    const store = new EncryptedIngredientReviewStore(primitive, () => now);
    await store.save("owner", recovery());
    now += INGREDIENT_REVIEW_TTL_MS;
    expect(await exportIngredientReview("owner", store)).toBeNull();
    expect(primitive.values.size).toBe(0);
  });
  it("rejects oversized data and unknown persisted fields", async () => {
    const primitive = memory();
    const store = new EncryptedIngredientReviewStore(primitive, () => 1000);
    await expect(
      store.save(
        "owner",
        recovery({
          ingredients: Array.from({ length: 50 }, (_, index) =>
            row({ id: `row${index}`, name: "米".repeat(160) }),
          ),
        }),
      ),
    ).rejects.toThrow("too large");
    await expect(
      store.save(
        "owner",
        recovery({
          ingredients: [
            { ...row(), uri: "private-photo" } as ReviewedIngredient,
          ],
        }),
      ),
    ).rejects.toThrow("Invalid");
    await store.save("owner", recovery());
    const [key, raw] = [...primitive.values][0];
    const payload = JSON.parse(raw);
    payload.data.uri = "private-photo";
    primitive.values.set(key, JSON.stringify(payload));
    expect(await store.load("owner")).toBeNull();
    expect(primitive.values.size).toBe(0);
  });
  it("rejects owner/version mismatches instead of exporting another owner", async () => {
    const primitive = memory();
    const store = new EncryptedIngredientReviewStore(primitive, () => 1000);
    await store.save("owner", recovery());
    const [key, raw] = [...primitive.values][0];
    const payload = JSON.parse(raw);
    payload.owner = "other";
    primitive.values.set(key, JSON.stringify(payload));
    expect(await store.load("owner")).toBeNull();
    expect(await store.load("other")).toBeNull();
    await expect(
      store.save(
        "owner",
        recovery({ version: "wrong" as "ingredient-review-v1" }),
      ),
    ).rejects.toThrow();
  });
  it("clear invalidates queued writes and removes an active late write", async () => {
    const primitive = memory();
    const gate = deferred();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const store = new EncryptedIngredientReviewStore(
      {
        ...primitive,
        setItem: async (key, value) => {
          entered();
          await gate.promise;
          await primitive.setItem(key, value);
        },
      },
      () => 1000,
    );
    const first = store.save("owner", recovery());
    await started;
    const queued = store.save("owner", recovery());
    const cleared = clearIngredientReview("owner", store);
    const settled = Promise.allSettled([first, queued, cleared]);
    gate.resolve();
    expect((await settled).map((item) => item.status)).toEqual([
      "rejected",
      "rejected",
      "fulfilled",
    ]);
    expect(primitive.values.size).toBe(0);
  });
  it("fences writes after owner context changes, propagates storage failure and recovers the queue", async () => {
    const primitive = memory();
    const gate = deferred();
    let current = true;
    let failing = true;
    const store = new EncryptedIngredientReviewStore(
      {
        ...primitive,
        setItem: async (key, value) => {
          if (failing) {
            await gate.promise;
            await primitive.setItem(key, value);
          } else await primitive.setItem(key, value);
        },
      },
      () => 1000,
    );
    const save = store.save("owner", recovery(), () => current);
    await Promise.resolve();
    await Promise.resolve();
    current = false;
    gate.resolve();
    await expect(save).rejects.toThrow("context changed");
    expect(primitive.values.size).toBe(0);
    failing = false;
    current = true;
    await store.save("owner", recovery());
    expect(await store.load("owner")).not.toBeNull();
    const broken = new EncryptedIngredientReviewStore(
      {
        ...primitive,
        setItem: async () => {
          throw new Error("native failed");
        },
      },
      () => 1000,
    );
    await expect(broken.save("owner", recovery())).rejects.toThrow(
      "native failed",
    );
  });
  it("uses bounded chunks and removes orphan generations after partial native writes", async () => {
    const primitive = memory();
    let fail = false;
    const tracked = createIngredientReviewChunkedStorage(
      {
        ...primitive,
        setItem: async (key, value) => {
          if (fail && key.endsWith(".1"))
            throw new Error("native write failed");
          await primitive.setItem(key, value);
        },
      },
      (storage) => new ChunkedStorage(storage, 128),
    );
    await tracked.setItem("review", "a".repeat(300));
    const firstKeys = [...primitive.values.keys()];
    fail = true;
    await expect(tracked.setItem("review", "b".repeat(500))).rejects.toThrow(
      "native write failed",
    );
    expect(await tracked.getItem("review")).toBe("a".repeat(300));
    expect([...primitive.values.keys()]).toEqual(firstKeys);
    await tracked.removeItem("review");
    expect(primitive.values.size).toBe(0);
  });
  it("repairs a crash before manifest publication and retains cleanup failures for restart retry", async () => {
    const primitive = memory();
    const base = Array.from("review", (character) =>
      character.charCodeAt(0).toString(16),
    ).join("_");
    primitive.values.set(
      `${base}.cleanup`,
      JSON.stringify({
        version: 1,
        previous: null,
        next: { generation: "interrupted_1", count: 2 },
      }),
    );
    primitive.values.set(`${base}.interrupted_1.0`, "private ingredients");
    primitive.values.set(`${base}.interrupted_1.1`, "more ingredients");
    let fail = true;
    const tracked = createIngredientReviewChunkedStorage(
      {
        ...primitive,
        removeItem: async (key) => {
          if (fail && key.endsWith(".1")) throw new Error("cleanup failed");
          await primitive.removeItem(key);
        },
      },
      (storage) => new ChunkedStorage(storage, 128),
    );
    await expect(tracked.removeItem("review")).rejects.toThrow(
      "cleanup is incomplete",
    );
    expect(primitive.values.has(`${base}.cleanup`)).toBe(true);
    fail = false;
    expect(await tracked.getItem("review")).toBeNull();
    expect(primitive.values.size).toBe(0);
  });
  it("cleans the old generation after a committed overwrite whose cleanup response was lost", async () => {
    const primitive = memory();
    let fail = false;
    const tracked = createIngredientReviewChunkedStorage(
      {
        ...primitive,
        removeItem: async (key) => {
          if (fail && key.endsWith(".0")) throw new Error("cleanup failed");
          await primitive.removeItem(key);
        },
      },
      (storage) => new ChunkedStorage(storage, 128),
    );
    await tracked.setItem("review", "a".repeat(200));
    fail = true;
    await expect(tracked.setItem("review", "b".repeat(200))).rejects.toThrow();
    expect(
      [...primitive.values.keys()].some((key) => key.endsWith(".cleanup")),
    ).toBe(true);
    fail = false;
    expect(await tracked.getItem("review")).toBe("b".repeat(200));
    expect(primitive.values.size).toBe(3);
    await tracked.removeItem("review");
    expect(primitive.values.size).toBe(0);
  });
  it("fails closed on a corrupt unbounded chunk manifest before allocating native reads", async () => {
    const primitive = memory();
    const base = Array.from("review", (character) =>
      character.charCodeAt(0).toString(16),
    ).join("_");
    primitive.values.set(
      `${base}.manifest`,
      JSON.stringify({ version: 1, generation: "bad_1", count: 100_000_000 }),
    );
    const tracked = createIngredientReviewChunkedStorage(
      primitive,
      (storage) => new ChunkedStorage(storage, 128),
    );
    await expect(tracked.getItem("review")).rejects.toThrow(
      "Invalid ingredient recovery chunk manifest",
    );
    expect(primitive.values.size).toBe(1);
  });
});

it("does not silently export an empty review when a committed encrypted chunk is missing", async () => {
  const primitive = memory();
  const chunks = createIngredientReviewChunkedStorage(
    primitive,
    (storage) => new ChunkedStorage(storage, 128),
  );
  await chunks.setItem("review", "a".repeat(300));
  const chunk = [...primitive.values.keys()].find((key) => key.endsWith(".1"))!;
  primitive.values.delete(chunk);
  await expect(chunks.getItem("review")).rejects.toThrow(
    "Ingredient recovery is incomplete.",
  );
  await chunks.removeItem("review");
  expect(primitive.values.size).toBe(0);
});
