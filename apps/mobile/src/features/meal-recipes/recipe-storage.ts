import {
  recipeSessionRecoverySchema,
  recipeSessionEnvelopeSchema,
  type RecipeSessionRecovery,
} from "@mizyun/contracts";
import type { StringStorage } from "@mizyun/adapter-supabase-mobile";
import { createIngredientReviewChunkedStorage } from "./ingredient-review-storage";
export const RECIPE_SESSION_TTL_MS = 86400000;
export const recipeSessionSchema = recipeSessionRecoverySchema;
export type RecipeSession = RecipeSessionRecovery;
export interface RecipeSessionStore {
  load(owner: string): Promise<RecipeSession | null>;
  save(
    owner: string,
    value: RecipeSession,
    isCurrent: () => boolean,
  ): Promise<void>;
  clear(owner: string): Promise<void>;
  export(owner: string): Promise<RecipeSession | null>;
}
const keyFor = (owner: string) => {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(owner))
    throw new Error("Invalid recipe owner.");
  return `mizyun.recipe-session.v1.${owner}`;
};
export class EncryptedRecipeSessionStore implements RecipeSessionStore {
  private queues = new Map<string, Promise<unknown>>();
  private generations = new Map<string, number>();
  constructor(
    private storage: StringStorage | (() => Promise<StringStorage>),
    private now: () => number = Date.now,
  ) {}
  private generation(owner: string) {
    return this.generations.get(owner) ?? 0;
  }
  private enqueue<T>(
    owner: string,
    work: (storage: StringStorage) => Promise<T>,
  ): Promise<T> {
    keyFor(owner);
    const next = (this.queues.get(owner) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () =>
        work(
          typeof this.storage === "function"
            ? await this.storage()
            : this.storage,
        ),
      );
    this.queues.set(owner, next);
    void next
      .finally(() => {
        if (this.queues.get(owner) === next) this.queues.delete(owner);
      })
      .catch(() => undefined);
    return next;
  }
  load(owner: string) {
    const generation = this.generation(owner);
    return this.enqueue(owner, async (storage) => {
      if (generation !== this.generation(owner)) return null;
      const raw = await storage.getItem(keyFor(owner));
      if (raw === null || generation !== this.generation(owner)) return null;
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error("Recipe recovery is unavailable.");
      }
      const envelope = recipeSessionEnvelopeSchema.safeParse(value);
      if (
        !envelope.success ||
        envelope.data.owner !== owner ||
        new TextEncoder().encode(raw).byteLength > 16384
      )
        throw new Error("Recipe recovery is unavailable.");
      if (
        envelope.data.data.expiresAt <= this.now() ||
        envelope.data.data.updatedAt > this.now()
      ) {
        await storage.removeItem(keyFor(owner));
        return null;
      }
      return envelope.data.data;
    });
  }
  async save(owner: string, value: RecipeSession, isCurrent: () => boolean) {
    const generation = this.generation(owner);
    const parsed = recipeSessionSchema.parse(value);
    const encoded = JSON.stringify({ owner, data: parsed });
    if (new TextEncoder().encode(encoded).byteLength > 16384)
      return Promise.reject(new Error("Recipe recovery is too large."));
    return this.enqueue(owner, async (storage) => {
      if (generation !== this.generation(owner) || !isCurrent())
        throw new Error("Recipe context changed.");
      await storage.setItem(keyFor(owner), encoded);
      if (generation !== this.generation(owner) || !isCurrent()) {
        await storage.removeItem(keyFor(owner));
        throw new Error("Recipe context changed.");
      }
    });
  }
  clear(owner: string) {
    this.generations.set(owner, this.generation(owner) + 1);
    return this.enqueue(owner, (storage) => storage.removeItem(keyFor(owner)));
  }
  export(owner: string) {
    return this.load(owner);
  }
}
let native: Promise<StringStorage> | undefined;
const nativeStore = () =>
  (native ??= (async () => {
    const [{ ChunkedStorage }, secure] = await Promise.all([
      import("@mizyun/adapter-supabase-mobile"),
      import("expo-secure-store"),
    ]);
    const primitive: StringStorage = {
      getItem: (key) => secure.getItemAsync(key),
      setItem: (key, value) => secure.setItemAsync(key, value),
      removeItem: (key) => secure.deleteItemAsync(key),
    };
    return createIngredientReviewChunkedStorage(
      primitive,
      (store) => new ChunkedStorage(store, 512),
    );
  })());
export const recipeSessionStore: RecipeSessionStore =
  new EncryptedRecipeSessionStore(nativeStore);
