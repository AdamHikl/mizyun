import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  availability: "access_required" as string,
  alert: vi.fn(),
  consented: false,
  requestAction: vi.fn(async () => undefined),
  confirmConsent: vi.fn(async () => undefined),
  declineConsent: vi.fn(),
  refreshProfile: vi.fn(async () => undefined),
  controllerOptions: [] as any[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, () => undefined],
  useRef: (current: unknown) => ({ current }),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: mocks.alert },
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  KeyboardAvoidingView: "Keyboard",
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  TextInput: "TextInput",
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
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
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "owner" } },
    profile: { birthYear: 1990 },
    refreshProfile: mocks.refreshProfile,
  }),
}));
vi.mock("@/composition/api-client", () => ({ apiClient: { id: "api" } }));
vi.mock("@mizyun/api-client", () => ({ createMealRecipeApi: () => ({}) }));
vi.mock("@/features/log-meal/public-data", () => ({
  stageRecipeMealDraft: vi.fn(),
}));
vi.mock("./ingredient-review-composition", () => ({
  getDefaultIngredientPhotoAdapter: vi.fn(),
}));
vi.mock("./ingredient-review-lifecycle", () => ({
  registerIngredientReviewRetirement: () => () => undefined,
}));
vi.mock("./public-data", () => ({ subscribeRecipeConsentGrant: vi.fn() }));
vi.mock("./cooking-assistant", () => ({
  CookingAssistant: class {
    init = mocks.init;
    getSnapshot = () => ({ availability: mocks.availability });
  },
}));
vi.mock("@/features/coach/ai-consent-controller", () => ({
  useAiConsentController: (options: unknown) => {
    mocks.controllerOptions.push(options);
    return {
      isModalVisible: true,
      consentGranted: mocks.consented,
      confirmedAdult: mocks.consented,
      isSaving: false,
      error: null,
      requestAction: mocks.requestAction,
      confirmConsent: mocks.confirmConsent,
      declineConsent: mocks.declineConsent,
    };
  },
}));
vi.mock("@/features/coach/ai-consent-modal", () => ({
  AiConsentModal: "AiConsentModal",
}));

import { CookingAssistantView, MealRecipesScreen } from "./screen";

const children = () => {
  const tree = MealRecipesScreen() as any;
  const nodes = [tree.props.children].flat();
  return {
    view: nodes.find((node: any) => node?.type === CookingAssistantView),
    modal: nodes.find((node: any) => node?.type === "AiConsentModal"),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.controllerOptions = [];
  mocks.consented = false;
  mocks.availability = "access_required";
});

it("opens the shared AI consent prompt from recipe ideas (#302)", () => {
  const { view, modal } = children();
  expect(mocks.controllerOptions[0]).toMatchObject({
    userId: "owner",
    apiClient: { id: "api" },
  });
  view.props.onReviewConsent();
  expect(mocks.requestAction).toHaveBeenCalledWith({ kind: "recipe_ideas" });
  expect(mocks.alert).not.toHaveBeenCalled();
  expect(modal.props).toMatchObject({
    visible: true,
    isSaving: false,
    currentBirthYear: 1990,
  });
});

it("saves consent with the birth year and refreshes the profile", async () => {
  const { modal } = children();
  await modal.props.onConsent(1990);
  expect(mocks.confirmConsent).toHaveBeenCalledWith(1990);
  expect(mocks.refreshProfile).toHaveBeenCalledOnce();
  modal.props.onDecline();
  expect(mocks.declineConsent).toHaveBeenCalledOnce();
});

it("re-checks recipe access when the consented action resumes", async () => {
  children();
  await mocks.controllerOptions[0].onExecuteAction({ kind: "recipe_ideas" });
  expect(mocks.init).toHaveBeenCalledOnce();
  await mocks.controllerOptions[0].onExecuteAction({
    kind: "meal_text_draft",
    text: "eggs",
  });
  expect(mocks.init).toHaveBeenCalledOnce();
});

it("explains a refusal when consent is already saved", async () => {
  mocks.consented = true;
  const { view } = children();
  await view.props.onReviewConsent();
  expect(mocks.requestAction).not.toHaveBeenCalled();
  expect(mocks.init).toHaveBeenCalledOnce();
  expect(mocks.alert.mock.calls[0]?.[1]).toContain("birth date");
});

it("stays quiet when the re-check finds access", async () => {
  mocks.consented = true;
  mocks.availability = "ready";
  const { view } = children();
  await view.props.onReviewConsent();
  expect(mocks.alert).not.toHaveBeenCalled();
});
