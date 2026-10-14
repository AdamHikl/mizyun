import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type {
  IngredientReviewController,
  IngredientReviewSnapshot,
} from "./ingredient-review-controller";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (value: unknown) => {
        hooks.slots[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) =>
    (hooks.slots[hooks.index++] ??= { current: initial }),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));
vi.mock("react-native", () => ({
  View: "View",
  Pressable: "Pressable",
  TextInput: "TextInput",
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    text: "#111",
    border: "#888",
    background: "#fff",
    backgroundElement: "#eee",
    backgroundSelected: "#ddd",
    textSecondary: "#555",
  }),
}));
import { IngredientReview } from "./ingredient-review";

let snapshot: IngredientReviewSnapshot;
let controller: IngredientReviewController;
let onConfirmed: ReturnType<typeof vi.fn>;
let onCancel: ReturnType<typeof vi.fn>;
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function render() {
  hooks.index = 0;
  return IngredientReview({
    controller,
    onConfirmed,
    onCancel,
  }) as ReactElement<any>;
}
function byLabel(tree: any, label: string) {
  const found = nodes(tree).find(
    (node) => node.props?.accessibilityLabel === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
const ingredient = {
  id: "row-a",
  ingredientId: null,
  name: "Beans",
  preparationState: "unknown" as const,
  confirmed: false,
  enabled: true,
  source: "photo" as const,
  quantity: null,
  quantityUnit: "g" as const,
  availability: "check_quantity" as const,
};
const capabilities = {
  recognizeIngredients: true,
  maximumImages: 3,
} as IngredientReviewSnapshot["capabilities"];
const photo = {
  id: "photo-a",
  uri: "file:///temporary/photo.jpg",
  location: "fridge",
} as IngredientReviewSnapshot["photos"][number];
beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  onConfirmed = vi.fn();
  onCancel = vi.fn();
  snapshot = {
    phase: "idle",
    photos: [],
    ingredients: [],
    capabilities,
    message: null,
    warnings: [],
    cleanupPending: 0,
    recoveryRequiresReselect: false,
    aiRetired: false,
  };
  controller = {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(),
    init: vi.fn(),
    dispose: vi.fn(),
    addPhoto: vi.fn().mockResolvedValue(undefined),
    removePhoto: vi.fn().mockResolvedValue(undefined),
    analyze: vi.fn().mockResolvedValue(undefined),
    addTyped: vi.fn().mockResolvedValue(undefined),
    updateIngredient: vi.fn().mockResolvedValue(undefined),
    removeIngredient: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockResolvedValue(undefined),
    retryCleanup: vi.fn().mockResolvedValue(undefined),
  } as unknown as IngredientReviewController;
});

describe("ingredient review", () => {
  it("never initializes, analyzes or disposes on render; manual input works with AI off", async () => {
    snapshot = { ...snapshot, capabilities: null, aiRetired: true };
    let tree = render();
    expect(controller.init).not.toHaveBeenCalled();
    expect(controller.analyze).not.toHaveBeenCalled();
    expect(controller.dispose).not.toHaveBeenCalled();
    expect(byLabel(tree, "Camera").props.disabled).toBe(true);
    expect(byLabel(tree, "Photo library").props.disabled).toBe(true);
    byLabel(tree, "Ingredient to add").props.onChangeText("Oats");
    tree = render();
    await byLabel(tree, "Add ingredient").props.onPress();
    expect(controller.addTyped).toHaveBeenCalledWith("Oats");
  });

  it("passes the selected location and source for explicit camera/library actions", async () => {
    let tree = render();
    byLabel(tree, "Cabinet").props.onPress();
    tree = render();
    await byLabel(tree, "Photo library").props.onPress();
    await byLabel(tree, "Camera").props.onPress();
    expect(controller.addPhoto).toHaveBeenNthCalledWith(1, {
      source: "library",
      location: "cabinet",
    });
    expect(controller.addPhoto).toHaveBeenNthCalledWith(2, {
      source: "camera",
      location: "cabinet",
    });
    expect(controller.analyze).not.toHaveBeenCalled();
  });

  it("shows uncached transient previews and only analyzes after a press", async () => {
    snapshot = { ...snapshot, photos: [photo] };
    const tree = render();
    const image = nodes(tree).find((node) => node.type === "Image");
    expect(image.props.cachePolicy).toBe("none");
    expect(image.props.source).toEqual({ uri: photo.uri });
    expect(controller.analyze).not.toHaveBeenCalled();
    await byLabel(tree, "Analyze photos").props.onPress();
    expect(controller.analyze).toHaveBeenCalledOnce();
    await byLabel(tree, "Remove photo 1").props.onPress();
    expect(controller.removePhoto).toHaveBeenCalledWith(photo.id);
  });

  it.each(["ios", "android"])(
    "exposes accessible wrap-friendly state correction and include controls on %s",
    async () => {
      snapshot = { ...snapshot, ingredients: [ingredient] };
      const tree = render();
      expect(byLabel(tree, "Ingredient 1 name").props.editable).toBe(true);
      expect(
        byLabel(tree, "Unsure: Beans").props.accessibilityState.selected,
      ).toBe(true);
      byLabel(tree, "Ingredient 1 name").props.onChangeText("Lentils");
      await byLabel(tree, "Ingredient 1 name").props.onEndEditing({
        nativeEvent: { text: "Lentils" },
      });
      await byLabel(tree, "Cooked: Beans").props.onPress();
      await byLabel(tree, "Include Beans").props.onPress();
      expect(controller.updateIngredient).toHaveBeenCalledWith("row-a", {
        name: "Lentils",
      });
      expect(controller.updateIngredient).toHaveBeenCalledWith("row-a", {
        preparationState: "cooked",
      });
      expect(controller.updateIngredient).toHaveBeenCalledWith("row-a", {
        enabled: false,
      });
      expect(byLabel(tree, "Include Beans").props.accessibilityRole).toBe(
        "checkbox",
      );
      expect(
        byLabel(tree, "Include Beans").props.accessibilityState.checked,
      ).toBe(true);
      expect(nodes(tree).some((node) => node.type === "ScrollView")).toBe(
        false,
      );
      for (const node of nodes(tree).filter(
        (node) => node.type === "Pressable",
      )) {
        expect(node.props.style[0].minHeight).toBeGreaterThanOrEqual(44);
        expect(node.props.accessibilityLabel).toBeTruthy();
      }
      await byLabel(tree, "Remove Beans").props.onPress();
      expect(controller.removeIngredient).toHaveBeenCalledWith("row-a");
    },
  );

  it("keeps spaces while editing and flushes the final name before confirmation", async () => {
    snapshot = { ...snapshot, ingredients: [ingredient] };
    let tree = render();
    byLabel(tree, "Ingredient 1 name").props.onChangeText("Black ");
    tree = render();
    expect(byLabel(tree, "Ingredient 1 name").props.value).toBe("Black ");
    expect(controller.updateIngredient).not.toHaveBeenCalled();
    byLabel(tree, "Ingredient 1 name").props.onChangeText("Black beans");
    byLabel(render(), "Confirm ingredients").props.onPress();
    await vi.waitFor(() => expect(controller.confirm).toHaveBeenCalledOnce());
    expect(controller.updateIngredient).toHaveBeenCalledWith("row-a", {
      name: "Black beans",
    });
    expect(
      vi.mocked(controller.updateIngredient).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(controller.confirm).mock.invocationCallOrder[0]);
  });

  it("fences two confirmation presses before rerender through the deferred handoff", async () => {
    snapshot = { ...snapshot, ingredients: [ingredient] };
    const result = {
      version: "meal-recipe-v1" as const,
      ingredients: [{ ...ingredient, confirmed: true }],
    };
    let release!: (value: typeof result) => void;
    vi.mocked(controller.confirm).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const press = byLabel(render(), "Confirm ingredients").props.onPress;
    press();
    press();
    expect(controller.confirm).toHaveBeenCalledOnce();
    expect(onConfirmed).not.toHaveBeenCalled();
    release(result);
    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce());
    expect(onConfirmed).toHaveBeenCalledWith(result);
  });

  it("hands the confirmed review forward exactly once without an intake action", async () => {
    snapshot = { ...snapshot, ingredients: [ingredient] };
    const result = {
      version: "meal-recipe-v1",
      ingredients: [{ ...ingredient, confirmed: true }],
    };
    vi.mocked(controller.confirm).mockResolvedValue(result as any);
    byLabel(render(), "Confirm ingredients").props.onPress();
    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(result));
    expect(controller.confirm).toHaveBeenCalledOnce();
    vi.mocked(controller.confirm).mockResolvedValue(null);
    byLabel(render(), "Confirm ingredients").props.onPress();
    await vi.waitFor(() => expect(controller.confirm).toHaveBeenCalledTimes(2));
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it.each(["initializing", "picking", "analyzing", "retired"] as const)(
    "disables photo and confirmation while %s",
    (phase) => {
      snapshot = {
        ...snapshot,
        phase,
        photos: [photo],
        ingredients: [ingredient],
      };
      const tree = render();
      for (const label of [
        "Camera",
        "Photo library",
        "Analyze photos",
        "Confirm ingredients",
      ])
        expect(byLabel(tree, label).props.disabled).toBe(true);
      if (phase === "analyzing" || phase === "picking")
        expect(byLabel(tree, "Ingredient 1 name").props.editable).toBe(true);
    },
  );

  it("honors the one-photo capability and blocks empty/excluded-only confirmation", () => {
    snapshot = {
      ...snapshot,
      capabilities: {
        ...capabilities,
        maximumImages: 1,
      } as typeof capabilities,
      photos: [photo],
    };
    let tree = render();
    expect(byLabel(tree, "Camera").props.disabled).toBe(true);
    expect(byLabel(tree, "Photo library").props.disabled).toBe(true);
    expect(byLabel(tree, "Analyze photos").props.disabled).toBe(false);
    expect(byLabel(tree, "Confirm ingredients").props.disabled).toBe(true);
    snapshot = {
      ...snapshot,
      ingredients: [{ ...ingredient, enabled: false }],
    };
    tree = render();
    expect(byLabel(tree, "Confirm ingredients").props.disabled).toBe(true);
  });

  it("offers recovery cleanup and cancel callbacks; normalizes action errors", async () => {
    snapshot = {
      ...snapshot,
      cleanupPending: 1,
      recoveryRequiresReselect: true,
      ingredients: [ingredient],
    };
    let tree = render();
    expect(byLabel(tree, "Confirm ingredients").props.disabled).toBe(true);
    await byLabel(tree, "Retry photo cleanup").props.onPress();
    expect(controller.retryCleanup).toHaveBeenCalledOnce();
    vi.mocked(controller.removeIngredient).mockRejectedValue(
      new Error("secret raw error"),
    );
    byLabel(tree, "Remove Beans").props.onPress();
    await vi.waitFor(() => {
      tree = render();
      expect(
        nodes(tree).some(
          (node) =>
            node.props?.children ===
            "This action could not finish. Please try again.",
        ),
      ).toBe(true);
    });
    expect(JSON.stringify(tree)).not.toContain("secret raw error");
    byLabel(tree, "Cancel ingredient review").props.onPress();
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(controller.cancel).toHaveBeenCalledOnce();
  });
});
