import { recipeRequestIdSchema } from "@mizyun/contracts";
import type { StringStorage } from "@mizyun/adapter-supabase-mobile";

export type IngredientPreparationState =
  "raw" | "cooked" | "as_sold" | "unknown";
export interface ReviewedIngredient {
  readonly id: string;
  readonly ingredientId: string | null;
  readonly name: string;
  readonly preparationState: IngredientPreparationState;
  readonly confirmed: boolean;
  readonly enabled: boolean;
  readonly source: "typed" | "photo";
  readonly quantity: null;
  readonly quantityUnit: "g";
  readonly availability: "check_quantity";
}
export interface IngredientReviewRecovery {
  readonly version: "ingredient-review-v1";
  readonly updatedAt: number;
  readonly expiresAt: number;
  readonly ingredients: readonly ReviewedIngredient[];
  readonly requiresPhotoReselect: boolean;
  readonly pendingRequest: {
    readonly requestId: string;
    readonly startedAt: number;
  } | null;
}
export interface IngredientReviewStore {
  load(userId: string): Promise<IngredientReviewRecovery | null>;
  save(
    userId: string,
    value: IngredientReviewRecovery,
    isCurrent?: () => boolean,
  ): Promise<void>;
  clear(userId: string): Promise<void>;
  export(userId: string): Promise<IngredientReviewRecovery | null>;
}
export const INGREDIENT_REVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export const INGREDIENT_REVIEW_MAX_BYTES = 16_384;
const keyFor = (owner: string) => {
  if (!owner || owner.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(owner))
    throw new Error("Invalid ingredient review owner.");
  return `mizyun.ingredient-review.v1.${owner}`;
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value === value.trim() &&
  value.length <= maximum;
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const validRow = (value: unknown): value is ReviewedIngredient =>
  object(value) &&
  exactKeys(value, [
    "id",
    "ingredientId",
    "name",
    "preparationState",
    "confirmed",
    "enabled",
    "source",
    "quantity",
    "quantityUnit",
    "availability",
  ]) &&
  validId(value.id) &&
  (value.ingredientId === null || validId(value.ingredientId)) &&
  boundedText(value.name, 160) &&
  ["raw", "cooked", "as_sold", "unknown"].includes(
    value.preparationState as string,
  ) &&
  typeof value.confirmed === "boolean" &&
  typeof value.enabled === "boolean" &&
  (value.source === "typed" ||
    (value.source === "photo" && value.confirmed === true)) &&
  value.quantity === null &&
  value.quantityUnit === "g" &&
  value.availability === "check_quantity";
const validRecovery = (value: unknown): value is IngredientReviewRecovery =>
  object(value) &&
  exactKeys(value, [
    "version",
    "updatedAt",
    "expiresAt",
    "ingredients",
    "requiresPhotoReselect",
    "pendingRequest",
  ]) &&
  value.version === "ingredient-review-v1" &&
  Number.isSafeInteger(value.updatedAt) &&
  (value.updatedAt as number) >= 0 &&
  Number.isSafeInteger(value.expiresAt) &&
  (value.expiresAt as number) > (value.updatedAt as number) &&
  (value.expiresAt as number) - (value.updatedAt as number) <=
    INGREDIENT_REVIEW_TTL_MS &&
  Array.isArray(value.ingredients) &&
  value.ingredients.length <= 50 &&
  value.ingredients.every(validRow) &&
  new Set(value.ingredients.map((row) => row.id)).size ===
    value.ingredients.length &&
  typeof value.requiresPhotoReselect === "boolean" &&
  (value.pendingRequest === null ||
    (object(value.pendingRequest) &&
      exactKeys(value.pendingRequest, ["requestId", "startedAt"]) &&
      recipeRequestIdSchema.safeParse(value.pendingRequest.requestId).success &&
      Number.isSafeInteger(value.pendingRequest.startedAt) &&
      (value.pendingRequest.startedAt as number) >= 0 &&
      (value.pendingRequest.startedAt as number) <=
        (value.updatedAt as number) &&
      value.requiresPhotoReselect === true));

/** Serialize each owner; clear invalidates queued writes before waiting for an active write. */
export class EncryptedIngredientReviewStore implements IngredientReviewStore {
  #queues = new Map<string, Promise<unknown>>();
  #generations = new Map<string, number>();
  constructor(
    private readonly storage: StringStorage | (() => Promise<StringStorage>),
    private readonly now: () => number = Date.now,
  ) {}
  #generation(owner: string) {
    return this.#generations.get(owner) ?? 0;
  }
  #enqueue<T>(
    owner: string,
    work: (storage: StringStorage) => Promise<T>,
  ): Promise<T> {
    keyFor(owner);
    const previous = this.#queues.get(owner) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () =>
        work(
          typeof this.storage === "function"
            ? await this.storage()
            : this.storage,
        ),
      );
    this.#queues.set(owner, next);
    void next
      .finally(() => {
        if (this.#queues.get(owner) === next) this.#queues.delete(owner);
      })
      .catch(() => undefined);
    return next;
  }
  load(owner: string): Promise<IngredientReviewRecovery | null> {
    const generation = this.#generation(owner);
    return this.#enqueue(owner, async (storage) => {
      if (generation !== this.#generation(owner)) return null;
      const raw = await storage.getItem(keyFor(owner));
      if (generation !== this.#generation(owner) || raw === null) return null;
      let value: unknown;
      try {
        value =
          raw.length <= INGREDIENT_REVIEW_MAX_BYTES ? JSON.parse(raw) : null;
      } catch {
        value = null;
      }
      if (
        !object(value) ||
        !exactKeys(value, ["owner", "data"]) ||
        value.owner !== owner ||
        !validRecovery(value.data) ||
        new TextEncoder().encode(raw).byteLength >
          INGREDIENT_REVIEW_MAX_BYTES ||
        value.data.expiresAt <= this.now() ||
        value.data.updatedAt > this.now()
      ) {
        await storage.removeItem(keyFor(owner));
        return null;
      }
      return value.data;
    });
  }
  save(
    owner: string,
    value: IngredientReviewRecovery,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const generation = this.#generation(owner);
    // Project before encoding: unconfirmed image proposals can never become recovery data.
    const projected = {
      ...value,
      ingredients: value.ingredients.filter(
        (row) => row.source === "typed" || row.confirmed,
      ),
    };
    if (!validRecovery(projected))
      return Promise.reject(new Error("Invalid ingredient review recovery."));
    const encoded = JSON.stringify({ owner, data: projected });
    if (
      new TextEncoder().encode(encoded).byteLength > INGREDIENT_REVIEW_MAX_BYTES
    )
      return Promise.reject(
        new Error("Ingredient review recovery is too large."),
      );
    return this.#enqueue(owner, async (storage) => {
      if (generation !== this.#generation(owner) || !isCurrent())
        throw new Error("Ingredient review context changed.");
      await storage.setItem(keyFor(owner), encoded);
      if (generation !== this.#generation(owner) || !isCurrent()) {
        await storage.removeItem(keyFor(owner));
        throw new Error("Ingredient review context changed.");
      }
    });
  }
  clear(owner: string): Promise<void> {
    this.#generations.set(owner, this.#generation(owner) + 1);
    return this.#enqueue(owner, (storage) => storage.removeItem(keyFor(owner)));
  }
  export(owner: string) {
    return this.load(owner);
  }
}

interface ChunkGeneration {
  readonly generation: string;
  readonly count: number;
}
interface CleanupJournal {
  readonly version: 1;
  readonly previous: ChunkGeneration | null;
  readonly next: ChunkGeneration | null;
}
const encodedChunkKey = (value: string) =>
  Array.from(value, (character) => character.codePointAt(0)!.toString(16)).join(
    "_",
  );
const chunkGeneration = (value: unknown): ChunkGeneration | null => {
  if (
    !object(value) ||
    typeof value.generation !== "string" ||
    !/^[a-z0-9_]{1,80}$/.test(value.generation) ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) < 0 ||
    (value.count as number) > 64
  )
    return null;
  return { generation: value.generation, count: value.count as number };
};

/** Track uncommitted/previous chunk generations so an interrupted native write remains erasable. */
export const createIngredientReviewChunkedStorage = (
  primitive: StringStorage,
  createChunks: (primitive: StringStorage) => StringStorage,
): StringStorage => {
  const readManifest = async (
    base: string,
  ): Promise<ChunkGeneration | null> => {
    const raw = await primitive.getItem(`${base}.manifest`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const generation = chunkGeneration(parsed);
    if (
      !generation ||
      !object(parsed) ||
      !exactKeys(parsed, ["version", "generation", "count"]) ||
      parsed.version !== 1
    )
      throw new Error("Invalid ingredient recovery chunk manifest.");
    return generation;
  };
  const repair = async (key: string) => {
    const base = encodedChunkKey(key),
      journalKey = `${base}.cleanup`;
    const raw = await primitive.getItem(journalKey);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (
      !object(parsed) ||
      !exactKeys(parsed, ["version", "previous", "next"]) ||
      parsed.version !== 1 ||
      (parsed.previous !== null && !chunkGeneration(parsed.previous)) ||
      (parsed.next !== null && !chunkGeneration(parsed.next))
    )
      throw new Error("Ingredient recovery cleanup is incomplete.");
    const journal = parsed as unknown as CleanupJournal;
    const committed = await readManifest(base);
    const obsolete = [journal.previous, journal.next].filter(
      (item): item is ChunkGeneration =>
        item !== null && item.generation !== committed?.generation,
    );
    const results = await Promise.allSettled(
      obsolete.flatMap((item) =>
        Array.from({ length: item.count }, (_, index) =>
          primitive.removeItem(`${base}.${item.generation}.${index}`),
        ),
      ),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Ingredient recovery cleanup is incomplete.");
    await primitive.removeItem(journalKey);
  };
  return {
    getItem: async (key) => {
      await repair(key);
      const manifest = await readManifest(encodedChunkKey(key));
      const content = await createChunks(primitive).getItem(key);
      if (manifest && content === null)
        throw new Error("Ingredient recovery is incomplete.");
      return content;
    },
    removeItem: async (key) => {
      await repair(key);
      await readManifest(encodedChunkKey(key));
      await createChunks(primitive).removeItem(key);
    },
    setItem: async (key, value) => {
      if (
        new TextEncoder().encode(value).byteLength > INGREDIENT_REVIEW_MAX_BYTES
      )
        throw new Error("Ingredient review recovery is too large.");
      await repair(key);
      const base = encodedChunkKey(key),
        journalKey = `${base}.cleanup`;
      let journal: CleanupJournal = {
        version: 1,
        previous: await readManifest(base),
        next: null,
      };
      await primitive.setItem(journalKey, JSON.stringify(journal));
      let journalWrites = Promise.resolve();
      const writes: Promise<void>[] = [];
      const tracking: StringStorage = {
        getItem: (chunkKey) => primitive.getItem(chunkKey),
        removeItem: (chunkKey) => primitive.removeItem(chunkKey),
        setItem: (chunkKey, chunkValue) => {
          const suffix = chunkKey.startsWith(`${base}.`)
            ? chunkKey
                .slice(base.length + 1)
                .match(/^([a-z0-9_]{1,80})\.(\d+)$/)
            : null;
          if (suffix) {
            journalWrites = journalWrites.then(async () => {
              journal = {
                ...journal,
                next: {
                  generation: suffix[1],
                  count: Math.max(
                    journal.next?.count ?? 0,
                    Number(suffix[2]) + 1,
                  ),
                },
              };
              await primitive.setItem(journalKey, JSON.stringify(journal));
            });
          }
          const write = journalWrites.then(() =>
            primitive.setItem(chunkKey, chunkValue),
          );
          writes.push(write);
          return write;
        },
      };
      try {
        await createChunks(tracking).setItem(key, value);
      } catch (cause) {
        await Promise.allSettled(writes);
        await repair(key);
        throw cause;
      }
      await repair(key);
    },
  };
};

let nativeStorage: Promise<StringStorage> | undefined;
const getNativeStorage = (): Promise<StringStorage> =>
  (nativeStorage ??= (async () => {
    const [{ ChunkedStorage }, secureStore] = await Promise.all([
      import("@mizyun/adapter-supabase-mobile"),
      import("expo-secure-store"),
    ]);
    // 512 UTF-16 units stay below historical native value limits even with multibyte names.
    const primitive: StringStorage = {
      getItem: (key) => secureStore.getItemAsync(key),
      setItem: (key, value) => secureStore.setItemAsync(key, value),
      removeItem: (key) => secureStore.deleteItemAsync(key),
    };
    return createIngredientReviewChunkedStorage(
      primitive,
      (storage) => new ChunkedStorage(storage, 512),
    );
  })());
export const ingredientReviewStore: IngredientReviewStore =
  new EncryptedIngredientReviewStore(getNativeStorage);
export const clearIngredientReview = (
  userId: string,
  store: IngredientReviewStore = ingredientReviewStore,
) => store.clear(userId);
export const exportIngredientReview = (
  userId: string,
  store: IngredientReviewStore = ingredientReviewStore,
) => store.export(userId);
