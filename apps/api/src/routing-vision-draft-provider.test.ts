import { describe, expect, it, vi } from "vitest";

import {
  DisabledVisionProvider,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";

import { createRoutingVisionDraftProvider } from "./routing-vision-draft-provider.js";

type Request<K extends keyof VisionDraftProvider> = Parameters<
  NonNullable<VisionDraftProvider[K]>
>[0];

const fakeProvider = (name: string, ready = true) => {
  const result = (operation: string) => ({ served: name, operation });
  return {
    status: vi.fn(async () => ({ ready, provider: name })),
    generateDraft: vi.fn(async () => result("photo") as never),
    generateTextDraft: vi.fn(async () => result("text") as never),
    refineDraft: vi.fn(async () => result("refine") as never),
    generateActivityDraft: vi.fn(async () => result("activity") as never),
    refineStretchPlan: vi.fn(async () => result("stretch") as never),
  } satisfies VisionDraftProvider;
};

const photoRequest = { images: [] } as unknown as Request<"generateDraft">;
const textRequest = {
  text: "toast",
} as unknown as Request<"generateTextDraft">;
const refineRequest = {} as unknown as Request<"refineDraft">;
const activityRequest = {} as unknown as Request<"generateActivityDraft">;
const stretchRequest = {} as unknown as Request<"refineStretchPlan">;

describe("createRoutingVisionDraftProvider", () => {
  it("returns the provider itself when every route uses it", () => {
    const only = fakeProvider("gemini-vision");
    expect(
      createRoutingVisionDraftProvider({
        photo: only,
        text: only,
        activity: only,
        stretch: only,
      }),
    ).toBe(only);
  });

  it("dispatches each operation to its routed provider", async () => {
    const gemini = fakeProvider("gemini-vision");
    const anthropic = fakeProvider("anthropic-vision");
    const routed = createRoutingVisionDraftProvider({
      photo: gemini,
      text: anthropic,
      activity: anthropic,
      stretch: gemini,
    });

    await expect(routed.generateDraft(photoRequest)).resolves.toEqual({
      served: "gemini-vision",
      operation: "photo",
    });
    await expect(routed.generateTextDraft?.(textRequest)).resolves.toEqual({
      served: "anthropic-vision",
      operation: "text",
    });
    await expect(routed.refineDraft?.(refineRequest)).resolves.toEqual({
      served: "anthropic-vision",
      operation: "refine",
    });
    await expect(
      routed.generateActivityDraft?.(activityRequest),
    ).resolves.toEqual({ served: "anthropic-vision", operation: "activity" });
    await expect(routed.refineStretchPlan?.(stretchRequest)).resolves.toEqual({
      served: "gemini-vision",
      operation: "stretch",
    });

    expect(gemini.generateDraft).toHaveBeenCalledWith(photoRequest);
    expect(anthropic.generateDraft).not.toHaveBeenCalled();
    expect(gemini.generateTextDraft).not.toHaveBeenCalled();
    expect(gemini.refineDraft).not.toHaveBeenCalled();
    expect(gemini.generateActivityDraft).not.toHaveBeenCalled();
    expect(anthropic.refineStretchPlan).not.toHaveBeenCalled();
    // Methods run against their own provider, so private state stays intact.
    expect(anthropic.generateTextDraft.mock.contexts[0]).toBe(anthropic);
  });

  it("propagates a routed provider's failure without trying another vendor", async () => {
    const gemini = fakeProvider("gemini-vision");
    const anthropic = fakeProvider("anthropic-vision");
    anthropic.generateTextDraft.mockRejectedValueOnce(new Error("refused"));
    const routed = createRoutingVisionDraftProvider({
      photo: gemini,
      text: anthropic,
      activity: anthropic,
      stretch: anthropic,
    });

    await expect(routed.generateTextDraft?.(textRequest)).rejects.toThrow(
      "refused",
    );
    expect(gemini.generateTextDraft).not.toHaveBeenCalled();
  });

  it("omits operations the routed provider does not implement", () => {
    const photoOnly: VisionDraftProvider = {
      status: async () => ({ ready: true, provider: "photo-only" }),
      generateDraft: async () => ({}) as never,
    };
    const routed = createRoutingVisionDraftProvider({
      photo: fakeProvider("gemini-vision"),
      text: photoOnly,
      activity: photoOnly,
      stretch: photoOnly,
    });
    expect(routed.generateTextDraft).toBeUndefined();
    expect(routed.refineDraft).toBeUndefined();
    expect(routed.generateActivityDraft).toBeUndefined();
    expect(routed.refineStretchPlan).toBeUndefined();
  });

  it("reports which provider serves each route and ready only when all are", async () => {
    const gemini = fakeProvider("gemini-vision");
    const anthropic = fakeProvider("anthropic-vision");
    const routes = {
      photo: gemini,
      text: anthropic,
      activity: anthropic,
      stretch: gemini,
    };
    await expect(
      createRoutingVisionDraftProvider(routes).status(),
    ).resolves.toEqual({
      ready: true,
      provider: "gemini-vision+anthropic-vision",
      routes: {
        photo: "gemini-vision",
        text: "anthropic-vision",
        activity: "anthropic-vision",
        stretch: "gemini-vision",
      },
    });

    const notReady = createRoutingVisionDraftProvider({
      ...routes,
      photo: new DisabledVisionProvider(),
    });
    await expect(notReady.status()).resolves.toMatchObject({
      ready: false,
      routes: { photo: "disabled", text: "anthropic-vision" },
    });
  });
});
