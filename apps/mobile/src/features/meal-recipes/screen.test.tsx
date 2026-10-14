import { beforeEach, expect, it, vi } from "vitest";
import {
  metadata,
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
beforeEach(() => {
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
    selected: () => ({
      recipe: validated.recipes[0],
      candidate: validated.candidates[0],
    }),
    ranking: () => validated.ranking,
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
  expect(text(tree)).toContain("Macro fit unavailable");
  expect(text(tree)).toContain("only Save");
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
  labelled(
    render(),
    "Erase saved recipe inventory and suggestions",
  ).props.onPress();
  await vi.waitFor(() =>
    expect(text(render())).toContain("erasure is incomplete"),
  );
  labelled(render(), "Retry recipe erasure").props.onPress();
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
  expect(text(tree)).toContain("Estimate:");
  const button = labelled(tree, "I ate this · Review meal");
  expect(button.props.disabled).toBe(true);
  expect(labelled(tree, "1.5 serving").props.accessibilityRole).toBe("button");
});

it("changing an exact catalog reference after validation immediately disables old recipe actions", () => {
  labelled(render(), "Review fridge and cabinet ingredients").props.onPress();
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
