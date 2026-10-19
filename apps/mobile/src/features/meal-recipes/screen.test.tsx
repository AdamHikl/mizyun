import { beforeEach, expect, it, vi } from "vitest";
import type { RecipeAssistantIdea } from "@mizyun/contracts";
import type {
  CookingAssistant,
  CookingAssistantSnapshot,
} from "./cooking-assistant";
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  alert: vi.fn(),
  reviewConsent: vi.fn(),
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
  useEffect: () => undefined,
  useSyncExternalStore: (_subscribe: any, get: () => any) => get(),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: mocks.alert },
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
  router: { push: mocks.push },
  useFocusEffect: vi.fn(),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "View" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Icon: "Icon",
  IconButton: "IconButton",
}));
vi.mock("@/constants/theme", () => ({
  Radius: { lg: 16, xl: 22, pill: 999 },
  Spacing: { half: 2, one: 4, two: 8, three: 16, four: 24 },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: vi.fn() }));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("@/features/log-meal/public-data", () => ({
  stageRecipeMealDraft: vi.fn(),
}));
vi.mock("./ingredient-review-composition", () => ({
  getDefaultIngredientPhotoAdapter: vi.fn(),
}));
vi.mock("./public-data", () => ({ subscribeRecipeConsentGrant: vi.fn() }));
vi.mock("@/features/coach/ai-consent-controller", () => ({
  useAiConsentController: vi.fn(),
}));
vi.mock("@/features/coach/ai-consent-modal", () => ({
  AiConsentModal: "AiConsentModal",
}));
import { CookingAssistantView, type CookResult } from "./screen";

const idea: RecipeAssistantIdea = {
  ideaId: "spinach-omelette",
  name: "Spinach omelette",
  summary: "Eggs with spinach.",
  prepMinutes: 10,
  servings: 1,
  ingredients: [
    { name: "eggs", amount: "3", fromPhoto: true },
    { name: "olive oil", amount: "1 tsp", fromPhoto: false },
  ],
  steps: ["Whisk.", "Cook until set."],
  estimatePerServing: {
    caloriesKcal: 281.4,
    proteinG: 20.2,
    carbohydrateG: 2,
    fatG: null,
  },
  warnings: ["Cook eggs until firm."],
};
const base: CookingAssistantSnapshot = {
  phase: "idle",
  availability: "ready",
  canUsePhotos: true,
  ingredients: [],
  ideas: [],
  messages: [],
  error: null,
  unsentText: null,
};
let snapshot: CookingAssistantSnapshot;
let assistant: Record<string, any>;
let onCook: ReturnType<typeof vi.fn<(...args: any[]) => Promise<CookResult>>>;
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  // Expand stateless child components such as IdeaCard.
  if (typeof tree.type === "function") return nodes(tree.type(tree.props));
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
const render = () => {
  hooks.index = 0;
  return CookingAssistantView({
    assistant: assistant as unknown as CookingAssistant,
    onCook,
    onReviewConsent: mocks.reviewConsent,
  });
};
const byLabel = (tree: any, label: string) =>
  nodes(tree).find(
    (row) =>
      row.props?.accessibilityLabel === label || row.props?.label === label,
  );
const text = (tree: any) =>
  nodes(tree)
    .flatMap((row) =>
      row.type === "Text" ? [row.props?.children].flat(Infinity) : [],
    )
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join("");
beforeEach(() => {
  hooks.slots = [];
  mocks.reviewConsent.mockClear();
  mocks.push.mockClear();
  snapshot = base;
  onCook = vi.fn(async () => "done" as CookResult);
  assistant = {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    sendPhoto: vi.fn(),
    sendText: vi.fn(),
    removeIngredient: vi.fn(),
    reset: vi.fn(),
    init: vi.fn(),
  };
  mocks.push.mockReset();
  mocks.alert.mockReset();
});

it("starts with one clear photo action and no ingredient mapping list", () => {
  const tree = render();
  byLabel(tree, "Take photo").props.onPress();
  expect(assistant.sendPhoto).toHaveBeenCalledWith("camera");
  byLabel(tree, "Choose photo").props.onPress();
  expect(assistant.sendPhoto).toHaveBeenCalledWith("library");
  expect(text(tree)).toContain("Snap your fridge, get meal ideas");
  expect(text(tree)).not.toContain("Match your ingredients");
  expect(byLabel(tree, "Start over")).toBeUndefined();
});

it("shows the chat, removable ingredients and compact idea cards", () => {
  snapshot = {
    ...base,
    ingredients: ["eggs", "spinach"],
    ideas: [idea],
    messages: [
      { id: "1", role: "user", text: "Here’s what I have.", photo: true },
      { id: "2", role: "assistant", text: "Try these." },
    ],
  };
  let tree = render();
  expect(text(tree)).toContain("Try these.");
  expect(text(tree)).toContain("Photo sent");
  expect(text(tree)).toContain("10 min · ~281 kcal · P 20 g · C 2 g · F ? g");
  expect(text(tree)).not.toContain("Whisk.");
  byLabel(tree, "Remove spinach").props.onPress();
  expect(assistant.removeIngredient).toHaveBeenCalledWith("spinach");
  byLabel(tree, "Spinach omelette, 10 minutes").props.onPress();
  tree = render();
  expect(text(tree)).toContain("Whisk.");
  expect(text(tree)).toContain("(you may need this)");
  expect(text(tree)).toContain("Nutrition is an AI estimate");
});

it("sends typed messages and offers both photo sources from the composer", () => {
  snapshot = {
    ...base,
    messages: [{ id: "2", role: "assistant", text: "Hi" }],
  };
  let tree = render();
  expect(byLabel(tree, "Send message").props.disabled).toBe(true);
  byLabel(tree, "Message the cooking assistant").props.onChangeText(
    "more protein",
  );
  tree = render();
  byLabel(tree, "Send message").props.onPress();
  expect(assistant.sendText).toHaveBeenCalledWith("more protein");
  byLabel(tree, "Add a photo").props.onPress();
  const [, , buttons] = mocks.alert.mock.calls[0]!;
  buttons[0].onPress();
  buttons[1].onPress();
  expect(assistant.sendPhoto.mock.calls).toEqual([["camera"], ["library"]]);
});

it("hands a chosen idea to the editable meal form and resolves a draft collision", async () => {
  snapshot = {
    ...base,
    ideas: [idea],
    messages: [{ id: "2", role: "assistant", text: "Try these." }],
  };
  render();
  byLabel(render(), "Spinach omelette, 10 minutes").props.onPress();
  onCook.mockResolvedValueOnce("collision");
  await byLabel(render(), "I ate this · Review meal").props.onPress();
  await vi.waitFor(() => expect(onCook).toHaveBeenCalledWith(idea, false));
  const tree = render();
  expect(text(tree)).toContain("unfinished meal");
  byLabel(tree, "Replace it with this meal").props.onPress();
  expect(onCook).toHaveBeenLastCalledWith(idea, true);
});

it("explains missing consent instead of offering AI actions", () => {
  snapshot = { ...base, availability: "access_required" };
  const tree = render();
  expect(byLabel(tree, "Take photo").props.disabled).toBe(true);
  byLabel(tree, "Review AI sharing consent").props.onPress();
  // The consent prompt opens here; Settings can only revoke (#302).
  expect(mocks.reviewConsent).toHaveBeenCalledOnce();
  expect(mocks.push).not.toHaveBeenCalled();
});
