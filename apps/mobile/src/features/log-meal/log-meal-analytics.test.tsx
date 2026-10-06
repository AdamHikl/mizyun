import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  load: vi.fn(),
  persist: vi.fn(),
  clear: vi.fn(),
  history: vi.fn(),
  textDraft: vi.fn(),
  refresh: vi.fn(),
  track: vi.fn().mockResolvedValue({ recorded: true }),
  remove: null as (() => void) | null,
  scopeCount: 0,
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = hooks.index++;
      if (!(i in hooks.slots)) hooks.slots[i] = initial;
      return [
        hooks.slots[i],
        (next: any) => {
          hooks.slots[i] =
            typeof next === "function" ? next(hooks.slots[i]) : next;
        },
      ];
    },
    useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useEffect: (callback: () => void, deps: any[]) => {
      const i = hooks.index++;
      const previous = hooks.slots[i];
      if (
        !previous ||
        previous.length !== deps.length ||
        !previous.every((v: any, j: number) => Object.is(v, deps[j]))
      ) {
        hooks.slots[i] = deps;
        hooks.effects.push(callback);
      }
    },
  };
});
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Keyboard: { dismiss: vi.fn() },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn() },
  Stack: { Screen: "StackScreen" },
  useLocalSearchParams: () => ({}),
  useNavigation: () => navigation,
}));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-image-picker", () => ({}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({
  BottomTabInset: 0,
  MaxContentWidth: 600,
  Spacing: {},
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ text: "#000", border: "#888" }),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "synthetic-user" } },
    profile: null,
  }),
}));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: {
    track: mocks.track,
    createFlowScope: () => ({ flowId: `scope-${++mocks.scopeCount}` }),
  },
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: async () => ({ ok: false }) },
}));
vi.mock("@/features/logging-draft-storage", () => ({
  loadLoggingDraft: mocks.load,
  saveLoggingDraft: mocks.persist,
  clearLoggingDraft: mocks.clear,
}));
vi.mock("@/features/coach/ai-consent-modal", () => ({
  AiConsentModal: "AiConsentModal",
}));
vi.mock("@/features/coach/ai-consent-controller", () => ({
  useAiConsentController: ({ onExecuteAction }: any) => ({
    requestAction: onExecuteAction,
  }),
}));
vi.mock("./advanced-nutrition", () => ({
  AdvancedNutrientFields: "AdvancedNutrientFields",
  useAdvancedNutritionCapability: () => ({
    enabled: true,
    refresh: mocks.refresh,
  }),
}));
vi.mock("./log-meal-data", () => ({
  submitLogMeal: mocks.submit,
  draftMealFromText: mocks.textDraft,
}));
vi.mock("./meal-photo", () => ({ normalizeMealPhoto: vi.fn() }));
vi.mock("./meal-lifecycle-data", () => ({ fetchFoodHistory: mocks.history }));
vi.mock("./first-meal-reminders", () => ({
  loadFirstMealReminders: async () => ({ enabled: true }),
  reconcileFirstMealReminders: vi.fn(),
}));
vi.mock("./evening-catch-up-reminders", () => ({
  reconcileEveningReminders: vi.fn(),
}));
vi.mock("./first-meal-routine-modal", () => ({
  FirstMealRoutineModal: "FirstMealRoutineModal",
}));

const navigation = {
  addListener: (_name: string, callback: () => void) => {
    mocks.remove = callback;
    return () => {
      mocks.remove = null;
    };
  },
};

import { LogMealScreen } from "./log-meal-screen";

const draft = {
  name: "Synthetic label food",
  nutritionBasis: "per100g",
  portionGrams: "150",
  calories: "200",
  protein: "10",
  carbs: "20",
  fat: "5",
  fibre: "2",
  sodium: "30",
  clientOperationId: "11111111-1111-4111-8111-111111111111",
  consumedAt: new Date().toISOString(),
};
function render(): any {
  hooks.index = 0;
  const tree = LogMealScreen();
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, predicate: (n: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((n) => find(n, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const byId = (id: string) => find(render(), (n) => n.props?.testID === id);
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
async function submit() {
  byId("submit-meal-button").props.onPress();
  await flush();
  render();
}
beforeEach(async () => {
  hooks.slots = [];
  hooks.effects = [];
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ ...draft });
  mocks.persist.mockResolvedValue(true);
  mocks.history.mockResolvedValue({ entries: [] });
  mocks.refresh.mockResolvedValue(true);
  mocks.submit.mockResolvedValue({ ok: true });
  render();
  await flush();
  render();
});

describe("meal logging analytics lifecycle", () => {
  it("keeps an AI-filled form unfinished until the authoritative Save", async () => {
    mocks.textDraft.mockResolvedValue({
      ok: true,
      draft: {
        name: "Synthetic AI food",
        portionWeightG: 150,
        caloriesKcal: 250,
        proteinG: 12,
        carbohydrateG: 30,
        fatG: 5,
        calorieRangeKcal: null,
        proteinRangeG: null,
        carbohydrateRangeG: null,
        fatRangeG: null,
        warnings: [],
        assumptions: [],
        confidence: 0.5,
        provenance: {
          inputKind: "text",
          provider: "stub",
          model: "stub",
          promptVersion: "test",
        },
      },
    });
    byId("meal-description-input").props.onChangeText("Synthetic food");
    find(
      render(),
      (node) => node.props?.accessibilityLabel === "Draft from description",
    ).props.onPress();
    await flush();
    render();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(
      mocks.track.mock.calls.filter(([event]) =>
        ["core_record_created", "logging_flow_completed"].includes(event.name),
      ),
    ).toEqual([]);
    await submit();
    expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
      "logging_flow_started",
      "logging_flow_completed",
      "core_record_created",
    ]);
    expect(
      new Set(mocks.track.mock.calls.map(([, scope]) => scope.flowId)).size,
    ).toBe(1);
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain(
      "Synthetic AI food",
    );
  });
  it("reports an observed route removal once and ignores cleanup after save", async () => {
    mocks.remove!();
    mocks.remove!();
    await Promise.resolve();
    expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
      "logging_flow_started",
      "logging_flow_exited",
    ]);
    expect(mocks.track.mock.calls[1][0].properties.exit).toBe("navigate_away");
  });
});
