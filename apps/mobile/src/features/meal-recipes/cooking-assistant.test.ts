import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { err, ok } from "@mizyun/core";
import type { MealRecipeApi } from "@mizyun/api-client";
import {
  recipeAssistantTurnSchema,
  type RecipeAssistantIdea,
} from "@mizyun/contracts";
import {
  CookingAssistant,
  PHOTO_MESSAGE,
  fitTurn,
  forgetCookingConversation,
} from "./cooking-assistant";
import type {
  IngredientPhoto,
  IngredientPhotoAdapter,
} from "./ingredient-photos";
import { retireIngredientReviews } from "./ingredient-review-lifecycle";

const idea: RecipeAssistantIdea = {
  ideaId: "spinach-omelette",
  name: "Spinach omelette",
  summary: "Eggs with spinach.",
  prepMinutes: 10,
  servings: 1,
  ingredients: [{ name: "eggs", amount: "3", fromPhoto: true }],
  steps: ["Cook until set."],
  estimatePerServing: {
    caloriesKcal: 280,
    proteinG: 20,
    carbohydrateG: 2,
    fatG: 20,
  },
  warnings: [],
};
const capabilities = {
  version: "meal-recipe-v1" as const,
  suggest: true,
  recognizeIngredients: true,
  reason: "ready" as const,
  maximumImages: 1 as const,
  maximumTotalImageBytes: 4_194_304 as const,
  maximumImageDimension: 4096 as const,
  requiresIngredientConfirmation: true as const,
  requestIdRequired: true as const,
};
const photo: IngredientPhoto = {
  id: "photo-1",
  location: "fridge",
  uri: "file:///cache/photo.jpg",
  mimeType: "image/jpeg",
  byteSize: 10,
  width: 10,
  height: 10,
};
let ids = 0;
let current = true;
const blob = { size: 10, type: "image/jpeg" } as Blob;
function fixture(owner = "owner-a") {
  const api = {
    capabilities: vi.fn(async () => ok(capabilities)),
    suggest: vi.fn(),
    recognizeIngredients: vi.fn(),
    assist: vi.fn(
      async (
        input: Parameters<MealRecipeApi["assist"]>[0],
        _options: Parameters<MealRecipeApi["assist"]>[1],
      ) =>
        ok({
          version: "meal-recipe-assistant-v1" as const,
          requestId: input.turn.requestId,
          reply: "Try these.",
          ingredients: ["eggs", "spinach"],
          ideas: [idea],
        }),
    ),
  };
  const photos = {
    pick: vi.fn(async () => ({ kind: "selected" as const, photo })),
    release: vi.fn(async () => true),
    cleanupForUser: vi.fn(async () => true),
    toUpload: vi.fn(async () => ({
      photo: blob,
      mimeType: "image/jpeg" as const,
    })),
    recover: vi.fn(async () => true),
  } satisfies IngredientPhotoAdapter;
  const assistant = new CookingAssistant({
    owner,
    isCurrent: () => current,
    api: api as unknown as MealRecipeApi,
    photos,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
  return { api, photos, assistant };
}
beforeEach(() => {
  ids = 0;
  current = true;
  forgetCookingConversation();
});
afterEach(() => forgetCookingConversation());

it("sends a picked photo straight away and shows the ideas", async () => {
  const f = fixture();
  await f.assistant.init();
  await f.assistant.sendPhoto("camera");
  expect(f.api.assist).toHaveBeenCalledOnce();
  const [input, options] = f.api.assist.mock.calls[0]!;
  expect(input.images).toEqual([{ photo: blob, mimeType: "image/jpeg" }]);
  expect(input.turn.messages).toEqual([{ role: "user", text: PHOTO_MESSAGE }]);
  expect(options!.expectedUserId).toBe("owner-a");
  expect(f.photos.release).toHaveBeenCalledWith(photo);
  const snapshot = f.assistant.getSnapshot();
  expect(snapshot.phase).toBe("idle");
  expect(snapshot.ideas).toEqual([idea]);
  expect(snapshot.ingredients).toEqual(["eggs", "spinach"]);
  expect(snapshot.messages.map((m) => [m.role, m.text, m.photo])).toEqual([
    ["user", PHOTO_MESSAGE, true],
    ["assistant", "Try these.", undefined],
  ]);
});

it("continues the chat with history, current ideas and edited ingredients", async () => {
  const f = fixture();
  await f.assistant.init();
  await f.assistant.sendPhoto("library");
  f.assistant.removeIngredient("spinach");
  await f.assistant.sendText("  no eggs please  ");
  const turn = f.api.assist.mock.calls[1]![0].turn;
  expect(turn.ingredients).toEqual(["eggs"]);
  expect(turn.ideas).toEqual([idea]);
  expect(turn.messages.map((m) => m.text)).toEqual([
    PHOTO_MESSAGE,
    "Try these.",
    "no eggs please",
  ]);
  expect(f.api.assist.mock.calls[1]![0].images).toEqual([]);
  // Every turn is a new request identity.
  expect(turn.requestId).not.toBe(
    f.api.assist.mock.calls[0]![0].turn.requestId,
  );
});

it("drops a failed message from the chat and restores its text", async () => {
  const f = fixture();
  await f.assistant.init();
  f.api.assist.mockResolvedValueOnce(
    err({
      kind: "http_error",
      status: 429,
      code: "RECIPE_LIMIT_MINUTE",
      retryAfterSeconds: 30,
    }) as never,
  );
  await f.assistant.sendText("something quick");
  const snapshot = f.assistant.getSnapshot();
  expect(snapshot.messages).toEqual([]);
  expect(snapshot.unsentText).toBe("something quick");
  expect(snapshot.error).toMatch(/Too many requests/);
  expect(snapshot.phase).toBe("idle");
});

it("does nothing without consent or when the picker is cancelled or denied", async () => {
  const f = fixture();
  f.api.capabilities.mockResolvedValueOnce(
    ok({ ...capabilities, reason: "access_required" as never }),
  );
  await f.assistant.init();
  await f.assistant.sendText("hello");
  await f.assistant.sendPhoto("camera");
  expect(f.photos.pick).not.toHaveBeenCalled();
  await f.assistant.init();
  f.photos.pick.mockResolvedValueOnce({ kind: "cancelled" } as never);
  await f.assistant.sendPhoto("camera");
  expect(f.assistant.getSnapshot().error).toBeNull();
  f.photos.pick.mockResolvedValueOnce({ kind: "denied" } as never);
  await f.assistant.sendPhoto("camera");
  expect(f.assistant.getSnapshot().error).toMatch(/camera access/);
  expect(f.api.assist).not.toHaveBeenCalled();
});

it("ignores a late reply after the account changes and still releases the photo", async () => {
  const f = fixture();
  await f.assistant.init();
  let resolve!: (value: unknown) => void;
  f.api.assist.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }) as never,
  );
  const pending = f.assistant.sendPhoto("camera");
  await vi.waitFor(() => expect(f.api.assist).toHaveBeenCalledOnce());
  current = false;
  resolve(
    ok({
      version: "meal-recipe-assistant-v1",
      requestId: "x",
      reply: "late",
      ingredients: [],
      ideas: [idea],
    }),
  );
  await pending;
  expect(f.assistant.getSnapshot().ideas).toEqual([]);
  expect(f.photos.release).toHaveBeenCalledWith(photo);
});

it("keeps the chat in memory across screens, and erases it on retirement or start over", async () => {
  const first = fixture();
  await first.assistant.init();
  await first.assistant.sendPhoto("camera");
  first.assistant.dispose();
  const again = fixture();
  expect(again.assistant.getSnapshot().ideas).toEqual([idea]);
  expect(fixture("owner-b").assistant.getSnapshot().messages).toEqual([]);
  again.assistant.reset();
  expect(fixture().assistant.getSnapshot().messages).toEqual([]);

  const third = fixture();
  await third.assistant.init();
  await third.assistant.sendPhoto("camera");
  await retireIngredientReviews("owner-a", "account");
  expect(fixture().assistant.getSnapshot().messages).toEqual([]);
  // The retired instance is fenced from sending again.
  await third.assistant.sendText("more");
  expect(third.api.assist).toHaveBeenCalledOnce();
});

it("keeps a send in progress when capabilities refresh mid-turn", async () => {
  const f = fixture();
  await f.assistant.init();
  let resolve!: (value: unknown) => void;
  f.api.assist.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }) as never,
  );
  const pending = f.assistant.sendText("quick lunch");
  await vi.waitFor(() => expect(f.api.assist).toHaveBeenCalledOnce());
  await f.assistant.init();
  expect(f.assistant.getSnapshot().phase).toBe("sending");
  resolve(
    ok({
      version: "meal-recipe-assistant-v1",
      requestId: "x",
      reply: "Try this.",
      ingredients: [],
      ideas: [idea],
    }),
  );
  await pending;
  expect(f.assistant.getSnapshot().messages.map((m) => m.text)).toEqual([
    "quick lunch",
    "Try this.",
  ]);
});

it("ignores a late failure after Start over and drops an unanswered message on leave", async () => {
  const f = fixture();
  await f.assistant.init();
  let resolve!: (value: unknown) => void;
  f.api.assist.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }) as never,
  );
  const pending = f.assistant.sendText("first");
  await vi.waitFor(() => expect(f.api.assist).toHaveBeenCalledOnce());
  f.assistant.reset();
  resolve(err({ kind: "network_error", cause: "aborted" }));
  await pending;
  expect(f.assistant.getSnapshot()).toMatchObject({
    messages: [],
    error: null,
    unsentText: null,
    phase: "idle",
  });

  await f.assistant.sendText("kept");
  f.api.assist.mockReturnValueOnce(new Promise(() => undefined) as never);
  void f.assistant.sendText("unanswered");
  await vi.waitFor(() => expect(f.api.assist).toHaveBeenCalledTimes(3));
  f.assistant.dispose();
  expect(
    fixture()
      .assistant.getSnapshot()
      .messages.map((m) => m.text),
  ).toEqual(["kept", "Try these."]);
});

it("fits long conversations inside the turn limits, newest message first", () => {
  const long = "x".repeat(1_400);
  const big: RecipeAssistantIdea = {
    ...idea,
    ingredients: Array.from({ length: 15 }, (_, i) => ({
      name: `food ${i} ${"y".repeat(60)}`,
      amount: "z".repeat(40),
      fromPhoto: true,
    })),
    steps: Array.from({ length: 10 }, () => "s".repeat(300)),
  };
  const turn = fitTurn({
    version: "meal-recipe-assistant-v1",
    requestId: "00000000-0000-4000-8000-000000000001",
    ingredients: [],
    ideas: [big, { ...big, ideaId: "b" }, { ...big, ideaId: "c" }],
    messages: Array.from({ length: 14 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      text: i === 13 ? "newest" : long,
    })),
  });
  expect(recipeAssistantTurnSchema.safeParse(turn).success).toBe(true);
  expect(turn.messages.at(-1)!.text).toBe("newest");
  expect(turn.messages.every((m) => m.text.length <= 1_000)).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(turn)).length).toBeLessThan(
    20_001,
  );
});
