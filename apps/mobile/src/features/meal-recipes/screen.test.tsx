import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  metadata,
  NOW,
  recovery,
  capabilities,
  validated,
} from "./recipe-fixtures.test-support";
import type { RecipeController, RecipeSnapshot } from "./recipe-controller";
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  erase: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (value: any) => {
        hooks.slots[index] =
          typeof value === "function" ? value(hooks.slots[index]) : value;
      },
    ];
  },
  useRef: (initial: any) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useSyncExternalStore: (_subscribe: any, get: () => any) => get(),
}));
vi.mock("react-native", () => ({
  AppState: {},
  KeyboardAvoidingView: "Keyboard",
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  TextInput: "TextInput",
  StyleSheet: { create: (value: any) => value },
}));
vi.mock("expo-router", () => ({
  router: { push: mocks.push, back: mocks.back },
  useFocusEffect: vi.fn(),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "View" }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ border: "#555", text: "#111", textSecondary: "#555" }),
}));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: vi.fn() }));
vi.mock("./recipe-data", () => ({ createRecipeController: vi.fn() }));
vi.mock("./public-data", () => ({ clearRecipeIngredientData: mocks.erase }));
vi.mock("./ingredient-review-session", () => ({
  RecipeIngredientReview: "IngredientReview",
}));
import { RecipeFlow } from "./screen";
import { RecipeDetail } from "./recipe-detail";
let snapshot: RecipeSnapshot, controller: RecipeController, current: boolean;
function nodes(tree: any): any[] {
  return !tree || typeof tree !== "object"
    ? []
    : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
const render = () => {
  hooks.index = 0;
  return RecipeFlow({ controller, owner: "owner-a", isCurrent: () => current });
};
const labelled = (tree: any, label: string) =>
  nodes(tree).find((row) => row.props?.accessibilityLabel === label);
const text = (tree: any) =>
  nodes(tree)
    .flatMap((row) => [row.props?.children].flat(Infinity))
    .filter((value) => typeof value === "string")
    .join(" ");
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  hooks.slots = [];
  hooks.index = 0;
  current = true;
  vi.clearAllMocks();
  snapshot = {
    phase: "idle",
    session: recovery(),
    metadata,
    capabilities,
    validated: true,
    message: null,
    collision: false,
    persistenceReady: true,
  };
  controller = {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(),
    selected: vi.fn(() => ({
      recipe: validated.recipes[0],
      candidate: validated.candidates[0],
    })),
    ranking: vi.fn(() => validated.ranking),
    fresh: () => true,
    refresh: vi.fn(),
    init: vi.fn(),
    handoff: vi.fn().mockResolvedValue(true),
    generate: vi.fn(),
    select: vi.fn(),
    portion: vi.fn(),
    invalidateInputs: vi.fn(),
    anotherConsumption: vi.fn(),
  } as any;
});
it("labels unknown context and estimates; recipe browsing never navigates to logging", () => {
  snapshot = { ...snapshot, validated: false };
  (controller.ranking as any) = () => ({
    ...validated.ranking,
    context: { ...metadata.context, state: "unknown" },
  });
  (controller.fresh as any) = () => false;
  const tree = render();
  expect(text(tree)).toContain("Your daily balance");
  expect(text(tree)).toContain("Unknown");
  expect(text(tree)).toContain("You can still find recipes");
  expect(text(tree)).toContain("Nothing is logged until you save a meal");
  labelled(tree, "View Rice bowl").props.onPress();
  expect(controller.select).toHaveBeenCalledWith("rice-bowl");
  expect(mocks.push).not.toHaveBeenCalled();
});
it("stale details disable cooking-derived handoff and expose ordinary manual logging", () => {
  (controller.fresh as any) = () => false;
  const tree = render();
  const detail = nodes(tree).find((node) => node.type === RecipeDetail);
  expect(detail.props.canAct).toBe(false);
  labelled(tree, "Log a meal manually").props.onPress();
  expect(mocks.push).toHaveBeenCalledWith("/log-meal");
});
it("only a durable ready handoff opens editable Save, with no sensitive route parameters", async () => {
  const tree = render();
  const detail = nodes(tree).find((node) => node.type === RecipeDetail);
  await detail.props.onLog();
  await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/log-meal"));
  expect(controller.handoff).toHaveBeenCalledWith(false);
});
it("a late account change cannot navigate after the staged handoff", async () => {
  (controller.handoff as any) = vi.fn(async () => {
    current = false;
    return true;
  });
  nodes(render())
    .find((node) => node.type === RecipeDetail)
    .props.onLog();
  await Promise.resolve();
  expect(mocks.push).not.toHaveBeenCalled();
});
it("failed local erasure remains visible and can be retried", async () => {
  mocks.erase
    .mockRejectedValueOnce(Error("private"))
    .mockResolvedValueOnce(undefined);
  expect(labelled(render(), "Clear recipe data")).toBeUndefined();
  labelled(render(), "Recipe options").props.onPress();
  labelled(render(), "Clear recipe data").props.onPress();
  await vi.waitFor(() =>
    expect(text(render())).toContain("couldn’t be cleared"),
  );
  labelled(render(), "Retry clearing recipe data").props.onPress();
  await vi.waitFor(() => expect(mocks.back).toHaveBeenCalledOnce());
});
it("detail portion and logging actions have accessible touch controls and uncertainty", () => {
  const portion = vi.fn(),
    log = vi.fn();
  const tree = RecipeDetail({
    recipe: validated.recipes[0]!,
    portion: 1,
    busy: false,
    canAct: false,
    onPortion: portion,
    onLog: log,
  });
  expect(text(tree)).toContain("Estimated nutrition");
  const button = labelled(tree, "I ate this · Review meal");
  expect(button.props.disabled).toBe(true);
  expect(labelled(tree, "1.5 serving").props.accessibilityRole).toBe("button");
});

it("changing an exact catalog reference after validation immediately disables old recipe actions", () => {
  labelled(render(), "Edit ingredients").props.onPress();
  const review = nodes(render()).find(
    (node) => node.type === "IngredientReview",
  );
  review.props.onConfirmed({
    version: "meal-recipe-v1",
    ingredients: [
      {
        id: "row-1",
        ingredientId: null,
        name: "Rice",
        preparationState: "unknown",
        confirmed: true,
        enabled: true,
        source: "typed",
        quantity: null,
        quantityUnit: "g",
        availability: "check_quantity",
      },
    ],
  });
  vi.mocked(controller.invalidateInputs).mockClear();
  const choice = nodes(render()).find(
    (node) =>
      node.type === "Pressable" &&
      text(node).includes("Cooked rice") &&
      !text(node).includes("Choose"),
  );
  expect(choice).toBeTruthy();
  choice.props.onPress();
  expect(controller.invalidateInputs).toHaveBeenCalledOnce();
  snapshot = { ...snapshot, validated: false };
  (controller.fresh as any) = () => false;
  expect(
    nodes(render()).find((node) => node.type === RecipeDetail).props.canAct,
  ).toBe(false);
});

it("starts with ingredients and one main action instead of disabled dashboard controls", () => {
  snapshot = { ...snapshot, session: null };
  vi.mocked(controller.selected).mockReturnValue(null);
  const tree = render();
  expect(text(tree)).toContain("What’s in your kitchen?");
  expect(labelled(tree, "Suggest meals")).toBeUndefined();
  expect(labelled(tree, "Clear recipe data")).toBeUndefined();
  expect(text(tree)).not.toContain(
    "Check current macros and recipe constraints",
  );
  labelled(tree, "Add ingredients").props.onPress();
  expect(controller.invalidateInputs).not.toHaveBeenCalled();
  expect(nodes(render()).some((node) => node.type === "IngredientReview")).toBe(
    true,
  );
});

it("formats screenshot macro values without floating-point noise and describes the focus plainly", () => {
  vi.mocked(controller.ranking).mockReturnValue({
    ...validated.ranking,
    context: {
      ...metadata.context,
      remaining: {
        proteinG: 48.900000000000006,
        carbohydrateG: 386.7,
        fatG: 39.7,
      },
      focus: ["carbohydrate"],
    },
  });
  const visible = text(render());
  expect(visible).toContain("Left for today");
  expect(visible).toContain("Protein 48.9 g");
  expect(visible).toContain("Carbs 386.7 g");
  expect(visible).toContain("Fat 39.7 g");
  expect(visible).not.toContain("48.900000000000006");
  expect(visible).toContain("Let’s focus on carbs");
  expect(visible).toContain("Based on what you’ve logged so far");
});

it("labels amounts beyond a target instead of presenting them as remaining food needs", () => {
  vi.mocked(controller.ranking).mockReturnValue({
    ...validated.ranking,
    context: {
      ...metadata.context,
      remaining: { proteinG: 50, carbohydrateG: 150, fatG: -10.1 },
    },
  });
  expect(text(render())).toContain("Fat 10.1 g over target");
});

it("refreshes current targets and retries initialization when local persistence is unavailable", () => {
  labelled(render(), "Refresh daily targets").props.onPress();
  expect(controller.refresh).toHaveBeenCalledOnce();
  snapshot = { ...snapshot, persistenceReady: false };
  labelled(render(), "Refresh daily targets").props.onPress();
  expect(controller.init).toHaveBeenCalledOnce();
});

function confirmPendingIngredient() {
  snapshot = { ...snapshot, session: null };
  vi.mocked(controller.selected).mockReturnValue(null);
  labelled(render(), "Add ingredients").props.onPress();
  nodes(render())
    .find((node) => node.type === "IngredientReview")
    .props.onConfirmed({
      ingredients: [
        { id: "pending-rice", name: "Rice", preparationState: "unknown" },
      ],
    });
}

it("keeps first-time reviewed ingredients editable before a food match is saved", () => {
  confirmPendingIngredient();
  labelled(render(), "Edit ingredients").props.onPress();
  expect(nodes(render()).some((node) => node.type === "IngredientReview")).toBe(
    true,
  );
});

it("closes food matching after a successful save so only Find meals remains primary", async () => {
  confirmPendingIngredient();
  const match = nodes(render()).find(
    (node) => node.type === "Pressable" && text(node).includes("Cooked rice"),
  );
  match.props.onPress();
  (controller.setInput as any) = vi.fn(async (input) => {
    snapshot = { ...snapshot, session: { ...recovery(), input } };
  });
  await labelled(render(), "Use these ingredients").props.onPress();
  expect(labelled(render(), "Use these ingredients")).toBeUndefined();
  expect(labelled(render(), "Suggest meals")).toBeTruthy();
});

it("keeps pending food matches available when saving ingredients fails", async () => {
  confirmPendingIngredient();
  nodes(render())
    .find(
      (node) => node.type === "Pressable" && text(node).includes("Cooked rice"),
    )
    .props.onPress();
  (controller.setInput as any) = vi.fn(async () => {
    snapshot = { ...snapshot, persistenceReady: false };
  });
  await labelled(render(), "Use these ingredients").props.onPress();
  expect(labelled(render(), "Use these ingredients")).toBeTruthy();
  expect(labelled(render(), "Suggest meals")).toBeUndefined();
});

it("canceling ingredient editing preserves the saved meal draft and restores recipe actions", () => {
  snapshot = {
    ...snapshot,
    session: {
      ...recovery(),
      operationId: "81000000-0000-4000-8000-000000000009",
    },
  };
  const retained = snapshot.session;
  labelled(render(), "Edit ingredients").props.onPress();
  expect(
    nodes(render()).find((node) => node.type === RecipeDetail).props.canAct,
  ).toBe(false);
  nodes(render())
    .find((node) => node.type === "IngredientReview")
    .props.onCancel();
  expect(controller.invalidateInputs).not.toHaveBeenCalled();
  expect(snapshot.session).toBe(retained);
  expect(
    nodes(render()).find((node) => node.type === RecipeDetail).props.canAct,
  ).toBe(true);
});

it("retains a newer dietary exclusion when an older ingredient save finishes late", async () => {
  confirmPendingIngredient();
  nodes(render())
    .find(
      (node) => node.type === "Pressable" && text(node).includes("Cooked rice"),
    )
    .props.onPress();
  let finish!: () => void;
  (controller.setInput as any) = vi.fn((input) => {
    snapshot = { ...snapshot, phase: "working" };
    return new Promise<void>((resolve) => {
      finish = () => {
        snapshot = {
          ...snapshot,
          phase: "idle",
          session: { ...recovery(), input },
        };
        resolve();
      };
    });
  });
  const pending = labelled(render(), "Use these ingredients").props.onPress();
  expect(labelled(render(), "Excluded allergens").props.editable).toBe(false);
  expect(labelled(render(), "Maximum prep minutes").props.editable).toBe(false);
  expect(labelled(render(), "normal meal").props.disabled).toBe(true);
  // A queued input callback must still fence completion after controls disable.
  labelled(render(), "Excluded allergens").props.onChangeText("nuts");
  finish();
  await pending;
  expect(labelled(render(), "Use these ingredients")).toBeTruthy();
  expect(labelled(render(), "Excluded allergens").props.value).toBe("nuts");
  expect(labelled(render(), "Suggest meals")).toBeUndefined();
});
