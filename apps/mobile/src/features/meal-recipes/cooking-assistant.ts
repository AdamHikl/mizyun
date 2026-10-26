import {
  RECIPE_ASSISTANT_MAX_MESSAGE_LENGTH,
  RECIPE_ASSISTANT_MAX_MESSAGES,
  RECIPE_ASSISTANT_VERSION,
  type MealRecipeCapabilities,
  type RecipeAssistantTurn,
  type RecipeAssistantIdea,
} from "@mizyun/contracts";
import type { MealRecipeApi } from "@mizyun/api-client";
import type {
  IngredientPhoto,
  IngredientPhotoAdapter,
  IngredientPhotoSource,
} from "./ingredient-photos";
import {
  getIngredientReviewGeneration,
  registerIngredientReviewRetirement,
} from "./ingredient-review-lifecycle";
import { recipeRequestMessage } from "./recipe-presentation";

export interface CookingChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly photo?: true;
}
export interface CookingAssistantSnapshot {
  readonly phase: "loading" | "idle" | "picking" | "sending";
  /** Null while loading; otherwise whether AI turns can be sent now. */
  readonly availability:
    MealRecipeCapabilities["reason"] | "unreachable" | null;
  readonly canUsePhotos: boolean;
  readonly ingredients: readonly string[];
  readonly ideas: readonly RecipeAssistantIdea[];
  readonly messages: readonly CookingChatMessage[];
  readonly error: string | null;
  /** Text of a failed message, restored to the composer for an explicit resend. */
  readonly unsentText: string | null;
}
export interface CookingAssistantDependencies {
  readonly owner: string;
  readonly isCurrent: () => boolean;
  readonly api: MealRecipeApi;
  readonly photos: IngredientPhotoAdapter;
  readonly newId: () => string;
  readonly now?: () => number;
}

export const PHOTO_MESSAGE = "Here’s what I have.";
/** Stay well inside the 24 KiB contract and the provider's 32 KiB prompt cap. */
const TURN_BYTE_TARGET = 20_000;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
/** Oldest history is dropped first; the newest message always stays. */
export function fitTurn(turn: RecipeAssistantTurn): RecipeAssistantTurn {
  let fitted: RecipeAssistantTurn = {
    ...turn,
    messages: turn.messages
      .slice(-RECIPE_ASSISTANT_MAX_MESSAGES)
      .map(({ role, text }) => ({
        role,
        text: text.slice(0, RECIPE_ASSISTANT_MAX_MESSAGE_LENGTH).trim(),
      }))
      .filter((message) => message.text.length > 0),
  };
  while (fitted.messages.length > 1 && bytes(fitted) > TURN_BYTE_TARGET)
    fitted = { ...fitted, messages: fitted.messages.slice(1) };
  if (bytes(fitted) > TURN_BYTE_TARGET) fitted = { ...fitted, ideas: [] };
  return fitted;
}
const RETAIN_MS = 3 * 60 * 60 * 1000;
const empty: CookingAssistantSnapshot = {
  phase: "loading",
  availability: null,
  canUsePhotos: false,
  ingredients: [],
  ideas: [],
  messages: [],
  error: null,
  unsentText: null,
};

/**
 * Conversation kept in memory only (never written to device storage), so
 * leaving to log a meal and coming back keeps the chat. Account changes and
 * AI consent retirement erase it.
 */
const memory = new Map<
  string,
  {
    readonly at: number;
    readonly value: Pick<
      CookingAssistantSnapshot,
      "ingredients" | "ideas" | "messages"
    >;
  }
>();
const watched = new Set<string>();
const remember = (
  owner: string,
  at: number,
  value: Pick<CookingAssistantSnapshot, "ingredients" | "ideas" | "messages">,
) => {
  if (!watched.has(owner)) {
    watched.add(owner);
    registerIngredientReviewRetirement(owner, () => {
      memory.delete(owner);
    });
  }
  if (value.messages.length === 0) memory.delete(owner);
  else memory.set(owner, { at, value });
};
/** Test hook and explicit "Start over" erasure. */
export const forgetCookingConversation = (owner?: string) =>
  owner === undefined ? memory.clear() : void memory.delete(owner);

const limitMessage = (error: Parameters<typeof recipeRequestMessage>[0]) =>
  error?.kind === "http_error" &&
  (error.code === "RECIPE_INGREDIENTS_NEED_REVIEW" ||
    error.code === "RECIPE_CONTEXT_CHANGED" ||
    error.code === "RECIPE_CATALOG_REVISION")
    ? "That didn’t work. Please try again."
    : error?.kind === "http_error" &&
        (error.code === "RECIPE_LIMIT_COST_DAY" ||
          error.code === "RECIPE_LIMIT_COST_MONTH")
      ? recipeRequestMessage(error)
      : error?.kind === "http_error" &&
          (error.code === "RECIPE_LIMIT_DRAFTS" ||
            error.code === "RECIPE_LIMIT_TOKENS")
        ? "You’ve used today’s AI allowance for meal ideas. It resets tomorrow."
        : error?.kind === "http_error" &&
            (error.code === "INVALID_RECIPE_IMAGE" ||
              error.code === "RECIPE_IMAGE_LIMIT")
          ? "That photo couldn’t be used. Try another photo."
          : recipeRequestMessage(error).replace(
              "Suggestions could not be completed. Your saved request is retained; a retry creates a new request.",
              "That didn’t go through. Please try again.",
            );

export class CookingAssistant {
  #snapshot: CookingAssistantSnapshot;
  #listeners = new Set<() => void>();
  #abort: AbortController | null = null;
  /** Bumped by every send, reset and retirement; stale replies are ignored. */
  #turn = 0;
  /** Conversation before an in-flight send, kept if the screen goes away. */
  #beforeSend: CookingAssistantSnapshot["messages"] | null = null;
  #disposed = false;
  #generation: number;
  #maximumImages: 1 | 3 = 1;
  readonly #now: () => number;

  constructor(private readonly deps: CookingAssistantDependencies) {
    this.#now = deps.now ?? Date.now;
    this.#generation = getIngredientReviewGeneration(deps.owner);
    const saved = memory.get(deps.owner);
    this.#snapshot =
      saved && this.#now() - saved.at < RETAIN_MS
        ? { ...empty, ...saved.value }
        : empty;
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  getSnapshot = () => this.#snapshot;

  #live() {
    return (
      !this.#disposed &&
      this.deps.isCurrent() &&
      this.#generation === getIngredientReviewGeneration(this.deps.owner)
    );
  }
  #set(patch: Partial<CookingAssistantSnapshot>) {
    if (this.#disposed) return;
    this.#snapshot = { ...this.#snapshot, ...patch };
    remember(this.deps.owner, this.#now(), this.#snapshot);
    for (const listener of [...this.#listeners]) listener();
  }
  #options(signal?: AbortSignal) {
    return {
      expectedUserId: this.deps.owner,
      isCurrent: () => this.#live(),
      ...(signal ? { signal } : {}),
    };
  }

  async init() {
    if (!this.#live()) return;
    if (this.#snapshot.phase !== "loading" && this.#snapshot.phase !== "idle")
      return;
    const result = await this.deps.api.capabilities(this.#options());
    if (!this.#live()) return;
    // A send may have started meanwhile; only the initial load owns the phase.
    const phase =
      this.#snapshot.phase === "loading" ? "idle" : this.#snapshot.phase;
    if (!result.ok) {
      this.#set({ phase, availability: "unreachable" });
      return;
    }
    this.#maximumImages = result.value.maximumImages;
    this.#set({
      phase,
      availability: result.value.reason,
      canUsePhotos: result.value.recognizeIngredients,
    });
  }

  /** Pick one photo and send it straight away; there is no separate analyze step. */
  async sendPhoto(source: IngredientPhotoSource) {
    if (!this.#ready() || !this.#snapshot.canUsePhotos) return;
    this.#set({ phase: "picking", error: null });
    const picked = await this.deps.photos
      .pick({
        source,
        location: "fridge",
        userId: this.deps.owner,
        isCurrent: () => this.#live(),
        maximumImages: this.#maximumImages,
        existing: [],
      })
      .catch(() => ({ kind: "invalid" as const }));
    if (!this.#live()) {
      if (picked.kind === "selected")
        await this.deps.photos.release(picked.photo).catch(() => false);
      return;
    }
    if (picked.kind !== "selected") {
      this.#set({
        phase: "idle",
        error:
          picked.kind === "cancelled"
            ? null
            : picked.kind === "denied"
              ? source === "camera"
                ? "Allow camera access in Settings to take a photo."
                : "Allow photo access in Settings to choose a photo."
              : "That photo couldn’t be used. Try another photo.",
      });
      return;
    }
    await this.#send({ text: PHOTO_MESSAGE, photo: picked.photo });
  }

  async sendText(raw: string) {
    const text = raw.trim().slice(0, RECIPE_ASSISTANT_MAX_MESSAGE_LENGTH);
    if (!text || !this.#ready()) return;
    await this.#send({ text });
  }

  removeIngredient(name: string) {
    if (this.#snapshot.phase !== "idle") return;
    this.#set({
      ingredients: this.#snapshot.ingredients.filter((item) => item !== name),
    });
  }

  /** Clear the conversation; nothing was stored outside memory. */
  reset() {
    this.#turn += 1;
    this.#beforeSend = null;
    this.#abort?.abort();
    this.#set({
      ...empty,
      phase: "idle",
      availability: this.#snapshot.availability,
      canUsePhotos: this.#snapshot.canUsePhotos,
    });
    memory.delete(this.deps.owner);
  }

  /** AI consent retired or account changed: stop work and drop the chat. */
  retire() {
    this.#turn += 1;
    this.#beforeSend = null;
    this.#abort?.abort();
    memory.delete(this.deps.owner);
    this.#set({ ...empty, phase: "idle", availability: "access_required" });
  }

  dispose() {
    // An unanswered message is not kept: its outcome is unknown.
    if (this.#beforeSend)
      remember(this.deps.owner, this.#now(), {
        ...this.#snapshot,
        messages: this.#beforeSend,
      });
    this.#turn += 1;
    this.#abort?.abort();
    this.#disposed = true;
    this.#listeners.clear();
  }

  #ready() {
    return (
      this.#live() &&
      (this.#snapshot.phase === "idle" || this.#snapshot.phase === "picking") &&
      this.#snapshot.availability === "ready"
    );
  }

  async #send(input: { text: string; photo?: IngredientPhoto }) {
    const user: CookingChatMessage = {
      id: this.deps.newId(),
      role: "user",
      text: input.text,
      ...(input.photo ? { photo: true as const } : {}),
    };
    const before = this.#snapshot;
    const messages = [...before.messages, user];
    const turnId = ++this.#turn;
    const owns = () => this.#live() && this.#turn === turnId;
    this.#set({ phase: "sending", messages, error: null, unsentText: null });
    this.#beforeSend = before.messages;
    const abort = new AbortController();
    this.#abort = abort;
    const fail = (error: string) => {
      if (!owns()) return;
      this.#set({
        phase: "idle",
        // A failed turn is not part of the conversation the model sees.
        messages: before.messages,
        error,
        unsentText: input.photo ? null : input.text,
      });
    };
    try {
      const images = input.photo
        ? [await this.deps.photos.toUpload(input.photo)]
        : [];
      if (!owns()) return;
      const requestId = this.deps.newId();
      const result = await this.deps.api.assist(
        {
          turn: fitTurn({
            version: RECIPE_ASSISTANT_VERSION,
            requestId,
            ingredients: [...before.ingredients],
            ideas: [...before.ideas],
            messages: messages.map(({ role, text }) => ({ role, text })),
          }),
          images,
        },
        this.#options(abort.signal),
      );
      if (!owns()) return;
      if (!result.ok) {
        fail(
          result.error.kind === "http_error"
            ? limitMessage(result.error)
            : result.error.kind === "validation_error"
              ? "That message couldn’t be sent. Try a shorter message or start over."
              : "That didn’t go through. Check your connection and try again.",
        );
        return;
      }
      this.#set({
        phase: "idle",
        ingredients: result.value.ingredients,
        ideas: result.value.ideas,
        messages: [
          ...messages,
          {
            id: this.deps.newId(),
            role: "assistant",
            text: result.value.reply,
          },
        ],
      });
    } catch {
      fail("That didn’t go through. Please try again.");
    } finally {
      if (this.#abort === abort) this.#abort = null;
      if (this.#turn === turnId) this.#beforeSend = null;
      if (input.photo)
        await this.deps.photos.release(input.photo).catch(() => false);
    }
  }
}
