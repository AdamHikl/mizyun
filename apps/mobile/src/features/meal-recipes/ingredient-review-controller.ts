import type { MealRecipeApi } from "@mizyun/api-client";
import {
  ingredientRecognitionResponseSchema,
  mealRecipeCapabilitiesSchema,
  recipeRequestIdSchema,
  type MealRecipeCapabilities,
} from "@mizyun/contracts";
import type {
  IngredientPhoto,
  IngredientPhotoAdapter,
  IngredientPhotoLocation,
  IngredientPhotoSource,
} from "./ingredient-photos";
import {
  INGREDIENT_REVIEW_TTL_MS,
  type IngredientReviewRecovery,
  type IngredientReviewStore,
  type ReviewedIngredient,
} from "./ingredient-review-storage";

export type IngredientReviewPhase =
  "initializing" | "idle" | "picking" | "analyzing" | "retired";
export interface IngredientReviewSnapshot {
  readonly phase: IngredientReviewPhase;
  readonly photos: readonly IngredientPhoto[];
  readonly ingredients: readonly ReviewedIngredient[];
  readonly capabilities: MealRecipeCapabilities | null;
  readonly message: string | null;
  readonly warnings: readonly string[];
  readonly cleanupPending: number;
  readonly recoveryRequiresReselect: boolean;
  readonly aiRetired: boolean;
}
export interface ConfirmedIngredientReview {
  readonly version: "meal-recipe-v1";
  readonly ingredients: readonly ReviewedIngredient[];
}
export interface IngredientReviewControllerDependencies {
  readonly userId: string;
  readonly api: MealRecipeApi;
  readonly store: IngredientReviewStore;
  readonly photos: Pick<
    IngredientPhotoAdapter,
    "pick" | "release" | "toUpload"
  > &
    Partial<Pick<IngredientPhotoAdapter, "recover">>;
  readonly newId: () => string;
  readonly now?: () => number;
  readonly isCurrent: () => boolean;
  readonly isAiCurrent?: () => boolean;
}
const normalize = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
const manualFallback = "You can type ingredients instead.";
const retryMessage =
  "The analysis outcome is unavailable. Reselect photos and choose Analyze again for a new request.";

/** Owns review only. No intake mutation, photo retention or automatic provider retry. */
export class IngredientReviewController {
  #snapshot: IngredientReviewSnapshot = {
    phase: "initializing",
    photos: [],
    ingredients: [],
    capabilities: null,
    message: null,
    warnings: [],
    cleanupPending: 0,
    recoveryRequiresReselect: false,
    aiRetired: false,
  };
  #listeners = new Set<() => void>();
  #generation = 0;
  #disposed = false;
  #abort: AbortController | null = null;
  #cleanup = new Map<string, IngredientPhoto>();
  #released = new WeakSet<IngredientPhoto>();
  #releases = new Map<string, Promise<void>>();
  #pickerCleanupPending = false;
  #picking = false;
  #retiredPickPending = false;
  #pendingRequest: IngredientReviewRecovery["pendingRequest"] = null;
  #init: Promise<void> | null = null;
  #now: () => number;
  constructor(
    private readonly dependencies: IngredientReviewControllerDependencies,
  ) {
    this.#now = dependencies.now ?? Date.now;
  }
  getSnapshot = (): IngredientReviewSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  #set(patch: Partial<IngredientReviewSnapshot>) {
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch });
    for (const listener of this.#listeners) listener();
  }
  #cleanupCount() {
    return (
      this.#cleanup.size +
      Number(this.#pickerCleanupPending) +
      Number(this.#retiredPickPending)
    );
  }
  #current(generation = this.#generation) {
    return (
      !this.#disposed &&
      generation === this.#generation &&
      this.dependencies.isCurrent()
    );
  }
  #aiCurrent(generation: number) {
    return (
      this.#current(generation) &&
      !this.#snapshot.aiRetired &&
      (this.dependencies.isAiCurrent?.() ?? true)
    );
  }
  #options(generation: number, signal?: AbortSignal) {
    return {
      expectedUserId: this.dependencies.userId,
      isCurrent: () => this.#aiCurrent(generation),
      ...(signal ? { signal } : {}),
    };
  }
  #recovery(): IngredientReviewRecovery {
    const now = this.#now();
    return {
      version: "ingredient-review-v1",
      updatedAt: now,
      expiresAt: now + INGREDIENT_REVIEW_TTL_MS,
      ingredients: this.#snapshot.ingredients.filter(
        (row) => row.source === "typed" || row.confirmed,
      ),
      requiresPhotoReselect:
        this.#snapshot.photos.length > 0 ||
        this.#snapshot.recoveryRequiresReselect ||
        this.#pendingRequest !== null,
      pendingRequest: this.#pendingRequest,
    };
  }
  async #persist(generation = this.#generation): Promise<boolean> {
    if (!this.#current(generation)) return false;
    try {
      await this.dependencies.store.save(
        this.dependencies.userId,
        this.#recovery(),
        () => this.#current(generation),
      );
      return this.#current(generation);
    } catch {
      if (this.#current(generation))
        this.#set({
          message:
            "Ingredient recovery could not be saved. Try again before continuing.",
        });
      return false;
    }
  }
  init(): Promise<void> {
    return (this.#init ??= this.#initialize());
  }
  async #initialize() {
    const generation = this.#generation;
    try {
      if (!this.#current(generation)) return;
      const recovered = await this.dependencies.store.load(
        this.dependencies.userId,
      );
      if (!this.#current(generation)) return;
      if (recovered) {
        this.#pendingRequest = recovered.pendingRequest;
        this.#set({
          ingredients: recovered.ingredients,
          recoveryRequiresReselect: recovered.requiresPhotoReselect,
          message: recovered.requiresPhotoReselect
            ? "Photos were not saved. Reselect them to analyze again; typed and confirmed ingredients were recovered."
            : null,
        });
      }
      await this.#capabilities(generation);
    } catch {
      if (this.#current(generation))
        this.#set({
          message: `Ingredient recovery is unavailable. ${manualFallback}`,
        });
    } finally {
      if (this.#current(generation)) this.#set({ phase: "idle" });
    }
  }
  async #capabilities(
    generation: number,
  ): Promise<MealRecipeCapabilities | null> {
    if (!this.#aiCurrent(generation)) return null;
    const result = await this.dependencies.api.capabilities(
      this.#options(generation),
    );
    if (!this.#aiCurrent(generation)) return null;
    const parsed = result.ok
      ? mealRecipeCapabilitiesSchema.safeParse(result.value)
      : null;
    if (!parsed?.success) {
      this.#set({
        capabilities: null,
        message: `Photo analysis is unavailable. ${manualFallback}`,
      });
      return null;
    }
    this.#set({ capabilities: parsed.data });
    if (!parsed.data.recognizeIngredients)
      this.#set({
        message: `Photo analysis is unavailable. ${manualFallback}`,
      });
    return parsed.data;
  }
  async #release(photo: IngredientPhoto): Promise<void> {
    if (this.#released.has(photo)) return;
    const running = this.#releases.get(photo.id);
    if (running) return running;
    this.#cleanup.set(photo.id, photo);
    const work = (async () => {
      try {
        if (await this.dependencies.photos.release(photo)) {
          this.#cleanup.delete(photo.id);
          this.#released.add(photo);
        }
      } catch {
        /* Keep for explicit retry. */
      }
      this.#set({
        cleanupPending: this.#cleanupCount(),
        ...(this.#cleanup.size || this.#pickerCleanupPending
          ? { message: "Temporary photo cleanup is incomplete. Retry cleanup." }
          : {}),
      });
    })();
    this.#releases.set(photo.id, work);
    try {
      await work;
    } finally {
      this.#releases.delete(photo.id);
    }
  }
  async #releasePhotos(photos: readonly IngredientPhoto[]) {
    await Promise.all(photos.map((photo) => this.#release(photo)));
  }
  async retryCleanup() {
    await this.#releasePhotos([...this.#cleanup.values()]);
    if (this.#pickerCleanupPending && this.dependencies.photos.recover) {
      try {
        this.#pickerCleanupPending =
          !(await this.dependencies.photos.recover());
      } catch {
        /* Keep visible retry. */
      }
    }
    this.#set({ cleanupPending: this.#cleanupCount() });
  }
  async addPhoto(input: {
    source: IngredientPhotoSource;
    location: IngredientPhotoLocation;
  }) {
    if (
      !this.#current() ||
      this.#snapshot.aiRetired ||
      this.#snapshot.phase !== "idle" ||
      this.#snapshot.cleanupPending > 0
    )
      return;
    const generation = this.#generation;
    this.#set({ phase: "picking", message: null });
    try {
      const capabilities = await this.#capabilities(generation);
      if (!this.#aiCurrent(generation)) return;
      if (!capabilities?.recognizeIngredients) return;
      if (this.#snapshot.photos.length >= capabilities.maximumImages) {
        this.#set({
          message: `This account can use up to ${capabilities.maximumImages} photo${capabilities.maximumImages === 1 ? "" : "s"}.`,
        });
        return;
      }
      this.#picking = true;
      const result = await this.dependencies.photos.pick({
        ...input,
        userId: this.dependencies.userId,
        isCurrent: () => this.#aiCurrent(generation),
        maximumImages: capabilities.maximumImages,
        existing: this.#snapshot.photos,
      });
      if (result.kind === "selected") {
        if (!this.#aiCurrent(generation)) {
          await this.#release(result.photo);
          return;
        }
        if (
          this.#snapshot.photos.some((photo) => photo.id === result.photo.id)
        ) {
          await this.#release(result.photo);
          return;
        }
        this.#set({
          photos: [...this.#snapshot.photos, result.photo],
          recoveryRequiresReselect: false,
        });
        await this.#persist(generation);
      } else {
        if (result.kind === "cleanup_failed") {
          this.#pickerCleanupPending = true;
          this.#set({
            cleanupPending: this.#cleanupCount(),
            message: "Temporary photo cleanup is incomplete. Retry cleanup.",
          });
        } else if (this.#aiCurrent(generation))
          this.#set({
            message:
              result.kind === "cancelled"
                ? manualFallback
                : `Photo selection is unavailable. ${manualFallback}`,
          });
      }
    } catch {
      if (this.#aiCurrent(generation))
        this.#set({ message: `Photo selection failed. ${manualFallback}` });
    } finally {
      this.#picking = false;
      this.#retiredPickPending = false;
      this.#set({ cleanupPending: this.#cleanupCount() });
      if (this.#aiCurrent(generation)) this.#set({ phase: "idle" });
    }
  }
  async removePhoto(id: string) {
    if (!this.#current() || this.#snapshot.phase !== "idle") return;
    const photo = this.#snapshot.photos.find((item) => item.id === id);
    if (!photo) return;
    this.#set({
      photos: this.#snapshot.photos.filter((item) => item.id !== id),
    });
    await this.#release(photo);
    await this.#persist();
  }
  async analyze() {
    if (
      !this.#current() ||
      this.#snapshot.aiRetired ||
      this.#snapshot.phase !== "idle" ||
      this.#snapshot.cleanupPending > 0
    )
      return;
    const generation = this.#generation;
    const photos = [...this.#snapshot.photos];
    if (photos.length === 0) {
      this.#set({ message: `Select a photo to analyze. ${manualFallback}` });
      return;
    }
    this.#abort = new AbortController();
    const abort = this.#abort;
    this.#set({ phase: "analyzing", message: null, warnings: [] });
    let dispatched = false;
    let terminal = false;
    try {
      const capabilities = await this.#capabilities(generation);
      if (!this.#aiCurrent(generation)) return;
      if (
        !capabilities?.recognizeIngredients ||
        photos.length > capabilities.maximumImages ||
        photos.reduce((sum, photo) => sum + photo.byteSize, 0) >
          capabilities.maximumTotalImageBytes ||
        photos.some(
          (photo) =>
            photo.byteSize <= 0 ||
            !Number.isSafeInteger(photo.byteSize) ||
            !Number.isSafeInteger(photo.width) ||
            !Number.isSafeInteger(photo.height) ||
            photo.width <= 0 ||
            photo.height <= 0 ||
            photo.width > capabilities.maximumImageDimension ||
            photo.height > capabilities.maximumImageDimension,
        )
      ) {
        this.#set({
          message: `These photos exceed the current account limits. ${manualFallback}`,
        });
        return;
      }
      const requestId = this.dependencies.newId();
      if (!recipeRequestIdSchema.safeParse(requestId).success)
        throw new Error("Invalid request identity");
      this.#pendingRequest = { requestId, startedAt: this.#now() };
      if (!(await this.#persist(generation)) || !this.#aiCurrent(generation))
        return;
      const images = [];
      for (const photo of photos) {
        if (!this.#aiCurrent(generation)) return;
        const image = await this.dependencies.photos.toUpload(photo);
        if (!this.#aiCurrent(generation)) return;
        images.push(image);
      }
      if (
        images.some(
          (image) =>
            !Number.isFinite(image.photo.size) ||
            image.photo.size <= 0 ||
            image.mimeType !== "image/jpeg",
        ) ||
        images.reduce((sum, image) => sum + image.photo.size, 0) >
          capabilities.maximumTotalImageBytes
      )
        throw new Error("Invalid normalized photos");
      if (!this.#aiCurrent(generation)) return;
      dispatched = true;
      const result = await this.dependencies.api.recognizeIngredients(
        { requestId, images },
        this.#options(generation, abort.signal),
      );
      if (!this.#aiCurrent(generation)) return;
      const parsed = result.ok
        ? ingredientRecognitionResponseSchema.safeParse(result.value)
        : null;
      if (!parsed?.success || parsed.data.requestId !== requestId) {
        this.#set({ message: retryMessage, recoveryRequiresReselect: true });
        return;
      }
      terminal = true;
      this.#pendingRequest = null;
      this.#set({
        ingredients: this.#merge(parsed.data.ingredients),
        warnings: parsed.data.warnings,
        message:
          "Review each ingredient from the combined photos. Amounts are unknown.",
        recoveryRequiresReselect: false,
      });
    } catch {
      if (this.#aiCurrent(generation))
        this.#set({
          message: dispatched
            ? retryMessage
            : `Photo analysis could not start. ${manualFallback}`,
          recoveryRequiresReselect: dispatched,
        });
    } finally {
      // Even retired operations retain cleanup ownership of their frozen selection.
      await this.#releasePhotos(photos);
      if (this.#aiCurrent(generation)) {
        this.#set({
          photos: this.#snapshot.photos.filter(
            (photo) => !photos.some((item) => item.id === photo.id),
          ),
          phase: "idle",
        });
        if (!dispatched || terminal) this.#pendingRequest = null;
        await this.#persist(generation);
      }
      if (this.#abort === abort) this.#abort = null;
    }
  }
  #merge(
    proposals: readonly {
      ingredientId: string | null;
      name: string;
      preparationState: ReviewedIngredient["preparationState"];
    }[],
  ): ReviewedIngredient[] {
    const rows = [...this.#snapshot.ingredients];
    for (const proposal of proposals) {
      const index = rows.findIndex(
        (row) =>
          (row.ingredientId !== null &&
            proposal.ingredientId !== null &&
            row.ingredientId === proposal.ingredientId) ||
          ((row.ingredientId === null || proposal.ingredientId === null) &&
            normalize(row.name) === normalize(proposal.name)),
      );
      const existing = rows[index];
      if (existing) {
        if (existing.source === "typed" || existing.confirmed) continue;
        if (existing.preparationState !== proposal.preparationState)
          rows[index] = { ...existing, preparationState: "unknown" };
      } else if (rows.length < 50)
        rows.push({
          id: this.dependencies.newId(),
          ingredientId: proposal.ingredientId,
          name: proposal.name,
          preparationState: proposal.preparationState,
          confirmed: false,
          enabled: true,
          source: "photo",
          quantity: null,
          quantityUnit: "g",
          availability: "check_quantity",
        });
    }
    return rows;
  }
  async addTyped(name: string) {
    if (!this.#current() || this.#snapshot.phase === "initializing") return;
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (
      !trimmed ||
      trimmed.length > 160 ||
      this.#snapshot.ingredients.length >= 50
    ) {
      this.#set({
        message:
          "Enter an ingredient name of up to 160 characters (maximum 50 ingredients).",
      });
      return;
    }
    if (
      this.#snapshot.ingredients.some(
        (row) => normalize(row.name) === normalize(trimmed),
      )
    )
      return;
    this.#set({
      ingredients: [
        ...this.#snapshot.ingredients,
        {
          id: this.dependencies.newId(),
          ingredientId: null,
          name: trimmed,
          preparationState: "unknown",
          confirmed: false,
          enabled: true,
          source: "typed",
          quantity: null,
          quantityUnit: "g",
          availability: "check_quantity",
        },
      ],
    });
    await this.#persist();
  }
  async updateIngredient(
    id: string,
    patch: Partial<
      Pick<
        ReviewedIngredient,
        "name" | "preparationState" | "confirmed" | "enabled"
      >
    >,
  ) {
    if (!this.#current()) return;
    const row = this.#snapshot.ingredients.find((item) => item.id === id);
    if (!row) return;
    const name = patch.name?.trim().replace(/\s+/g, " ") ?? row.name;
    if (
      !name ||
      name.length > 160 ||
      (patch.preparationState !== undefined &&
        !["raw", "cooked", "as_sold", "unknown"].includes(
          patch.preparationState,
        ))
    )
      return;
    const next = {
      ...row,
      ...patch,
      name,
      ...(normalize(name) !== normalize(row.name)
        ? {
            ingredientId: null,
            source: "typed" as const,
            confirmed: patch.confirmed ?? false,
          }
        : {}),
    };
    this.#set({
      ingredients: this.#snapshot.ingredients.map((item) =>
        item.id === id ? next : item,
      ),
    });
    await this.#persist();
  }
  async removeIngredient(id: string) {
    if (!this.#current()) return;
    this.#set({
      ingredients: this.#snapshot.ingredients.filter((row) => row.id !== id),
    });
    await this.#persist();
  }
  async confirm(): Promise<ConfirmedIngredientReview | null> {
    if (!this.#current() || this.#snapshot.phase !== "idle") return null;
    const generation = this.#generation;
    const rows = this.#snapshot.ingredients.filter((row) => row.enabled);
    if (rows.length === 0 || this.#snapshot.cleanupPending > 0) {
      this.#set({
        message:
          rows.length === 0
            ? "Select at least one ingredient to confirm."
            : "Retry photo cleanup before continuing.",
      });
      return null;
    }
    // Confirmation can also follow typed review without analyzing selected photos.
    const photos = this.#snapshot.photos;
    this.#set({ photos: [] });
    await this.#releasePhotos(photos);
    if (!this.#current(generation) || this.#snapshot.cleanupPending > 0)
      return null;
    const selected = rows.map((row) => ({ ...row, confirmed: true }));
    this.#set({
      ingredients: this.#snapshot.ingredients.map((row) =>
        row.enabled ? { ...row, confirmed: true } : row,
      ),
    });
    if (!(await this.#persist(generation))) return null;
    return { version: "meal-recipe-v1", ingredients: selected };
  }
  #fence(aiOnly: boolean) {
    this.#generation += 1;
    this.#abort?.abort();
    this.#abort = null;
    this.#pendingRequest = null;
    this.#retiredPickPending = this.#picking;
    const photos = this.#snapshot.photos;
    this.#set({
      photos: [],
      phase: aiOnly ? "idle" : "retired",
      aiRetired: aiOnly || this.#snapshot.aiRetired,
      capabilities: null,
      recoveryRequiresReselect: false,
      cleanupPending: this.#cleanupCount(),
    });
    return photos;
  }
  async cancel() {
    if (this.#disposed) return;
    const photos = this.#fence(false);
    this.#set({ phase: "idle", message: null });
    await this.#releasePhotos(photos);
    await this.#persist();
  }
  async retireAi() {
    if (this.#disposed) return;
    const photos = this.#fence(true);
    this.#set({ message: `Photo analysis has stopped. ${manualFallback}` });
    await this.#releasePhotos(photos);
    await this.#persist();
    if (this.#snapshot.cleanupPending > 0)
      throw new Error("Temporary ingredient photo cleanup is incomplete.");
  }
  async dispose() {
    if (this.#disposed) return;
    const photos = this.#fence(false);
    this.#disposed = true;
    await this.#releasePhotos(photos);
    this.#listeners.clear();
    if (this.#snapshot.cleanupPending > 0)
      throw new Error("Temporary ingredient photo cleanup is incomplete.");
  }
}
