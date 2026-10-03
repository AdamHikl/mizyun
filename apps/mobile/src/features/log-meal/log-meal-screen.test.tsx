import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  load: vi.fn(),
  persist: vi.fn(),
  clear: vi.fn(),
  history: vi.fn(),
  textDraft: vi.fn(),
  refresh: vi.fn(),
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
}));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-image-picker", () => ({}));
vi.mock("@mizyun/observability", () => ({
  LoggingFlowMeasurement: class {
    tap() {}
    retry() {}
    fail() {}
    complete() {}
  },
}));
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
vi.mock("@/composition/analytics-client", () => ({ analyticsClient: {} }));
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

describe("manual per-100-g meal entry", () => {
  it("restores legacy drafts in total mode", async () => {
    hooks.slots = [];
    hooks.effects = [];
    const { nutritionBasis, ...legacy } = draft;
    mocks.load.mockResolvedValue(legacy);
    render();
    await flush();
    render();
    expect(byId("meal-basis-total").props.accessibilityState.selected).toBe(
      true,
    );
    await submit();
    expect(mocks.submit.mock.calls[0]?.[0].caloriesKcal).toBe(200);
  });
  it("saves serving totals from the restored label values and weight", async () => {
    await submit();
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        caloriesKcal: 300,
        proteinG: 15,
        carbohydrateG: 30,
        fatG: 7.5,
        fibreG: 3,
        sodiumMg: 45,
        details: { grams: 150 },
      }),
    );
    expect(mocks.persist).toHaveBeenLastCalledWith(
      "synthetic-user",
      "meal",
      expect.objectContaining({
        nutritionBasis: "per100g",
        calories: "200",
        portionGrams: "150",
      }),
    );
  });
  it("uses the selected basis and recalculates from raw label values after weight changes", async () => {
    byId("meal-basis-total").props.onPress();
    expect(byId("meal-calories-input").props.value).toBe("200");
    byId("meal-basis-per100g").props.onPress();
    expect(byId("meal-basis-per100g").props.accessibilityState.selected).toBe(
      true,
    );
    byId("meal-portion-weight-input").props.onChangeText("175,5");
    byId("meal-portion-weight-input").props.onChangeText("150,5");
    byId("meal-protein-input").props.onChangeText("10,11");
    await submit();
    expect(mocks.submit.mock.calls[0]?.[0]).toMatchObject({
      caloriesKcal: 301,
      proteinG: 15.22,
      details: { grams: 150.5 },
    });
  });
  it.each(["", "0", "-1", "Infinity", "garbage", "20001"])(
    "prevents saving invalid per-100-g weight %s",
    async (weight) => {
      byId("meal-portion-weight-input").props.onChangeText(weight);
      await submit();
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it("preserves unknown and zero nutrients", async () => {
    byId("meal-protein-input").props.onChangeText("");
    byId("meal-fat-input").props.onChangeText("0");
    await submit();
    expect(mocks.submit.mock.calls[0]?.[0]).toMatchObject({
      proteinG: null,
      fatG: 0,
    });
  });
  it("preserves the old total-entry mode with optional weight", async () => {
    byId("meal-basis-total").props.onPress();
    byId("meal-portion-weight-input").props.onChangeText("");
    await submit();
    expect(mocks.submit.mock.calls[0]?.[0]).toMatchObject({
      caloriesKcal: 200,
      proteinG: 10,
    });
    expect(mocks.submit.mock.calls[0]?.[0].details).toBeUndefined();
  });
  it("resets to total mode after clearing", async () => {
    byId("clear-meal-button").props.onPress();
    await flush();
    expect(byId("meal-basis-total").props.accessibilityState.selected).toBe(
      true,
    );
    expect(byId("meal-calories-input").props.value).toBe("");
  });
  it("resets recent meal totals and clears a previously entered weight when it is unknown", async () => {
    hooks.slots = [];
    hooks.effects = [];
    mocks.history.mockResolvedValue({
      entries: [
        {
          name: "Synthetic recent food",
          caloriesKcal: 250,
          proteinG: 12,
          carbohydrateG: 30,
          fatG: 5,
          details: {},
        },
      ],
    });
    render();
    await flush();
    render();
    const recent = find(
      render(),
      (n) =>
        n.type === "Pressable" &&
        n.props.children?.[0]?.props.children === "Synthetic recent food",
    );
    recent.props.onPress();
    expect(byId("meal-basis-total").props.accessibilityState.selected).toBe(
      true,
    );
    expect(byId("meal-portion-weight-input").props.value).toBe("");
    await submit();
    expect(mocks.submit.mock.calls[0]?.[0].caloriesKcal).toBe(250);
  });
  it("uses serving totals after a replacement AI draft without retaining label values", async () => {
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
    const button = find(
      render(),
      (n) => n.props?.accessibilityLabel === "Draft from description",
    );
    button.props.onPress();
    await flush();
    render();
    expect(byId("meal-basis-per100g")).toBeUndefined();
    expect(byId("meal-calories-input").props.label).toBe("Calories (kcal)");
    await submit();
    expect(mocks.submit.mock.calls[0]?.[0]).toMatchObject({
      caloriesKcal: 250,
      proteinG: 12,
      details: { grams: 150 },
    });
    expect(mocks.submit.mock.calls[0]?.[0].fibreG).toBeUndefined();
  });
  it("replays identical calculated totals after a lost response even if Pro access has expired", async () => {
    mocks.submit.mockResolvedValueOnce({ ok: false, message: "network error" });
    await submit();
    const first = mocks.submit.mock.calls[0]?.[0];
    mocks.refresh.mockResolvedValue(false);
    await submit();
    expect(mocks.submit.mock.calls[1]?.[0]).toEqual(first);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("blocks an edited calculated payload while its original outcome is unresolved", async () => {
    mocks.submit.mockResolvedValueOnce({ ok: false, message: "network error" });
    await submit();
    byId("meal-portion-weight-input").props.onChangeText("200");
    await submit();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("keeps the Pro check on new advanced-nutrient entries", async () => {
    mocks.refresh.mockResolvedValue(false);
    await submit();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("fails safely if draft persistence fails before sending", async () => {
    mocks.persist.mockResolvedValue(false);
    await submit();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
