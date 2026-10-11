vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => "production",
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodDraftCandidate, FoodEntry } from "@mizyun/contracts";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  update: vi.fn(),
  fetch: vi.fn(),
  persist: vi.fn(),
  load: vi.fn(),
  clear: vi.fn(),
  refresh: vi.fn(),
  enabled: true,
  visuals: true,
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const same = (a: any[], b: any[]) =>
    a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    ...actual,
    useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
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
    useCallback: (fn: unknown) => fn,
    useEffect: (callback: () => any, deps: any[]) => {
      const i = hooks.index++;
      if (!hooks.slots[i] || !same(hooks.slots[i], deps)) {
        hooks.slots[i] = deps;
        hooks.effects.push(callback);
      }
    },
  };
});
vi.mock("react-native", () => ({
  View: "View",
  TextInput: "TextInput",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn() },
  Stack: { Screen: "StackScreen" },
  useLocalSearchParams: () => ({ id: "entry-a" }),
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({
  BottomTabInset: 0,
  MaxContentWidth: 600,
  Spacing: {},
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "user-a" } } }),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
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
    enabled: mocks.enabled,
    refresh: mocks.refresh,
  }),
}));
vi.mock("./meal-visual-capability", () => ({
  useMealVisualCapability: () => ({ enabled: mocks.visuals, refresh: vi.fn() }),
}));
vi.mock("./meal-lifecycle-data", () => ({
  fetchFoodEntry: mocks.fetch,
  updateFoodEntry: mocks.update,
}));
import { EditMealScreen } from "./edit-meal-screen";

const entry: FoodEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  name: "Synthetic oats",
  caloriesKcal: 300,
  proteinG: 10,
  carbohydrateG: 40,
  fatG: 10,
  fibreG: 4,
  saturatedFatG: null,
  totalSugarsG: null,
  sodiumMg: 12,
  cholesterolMg: null,
  consumedAt: "2026-10-02T10:00:00Z",
  createdAt: "2026-10-02T10:00:00Z",
  updatedAt: "2026-10-02T10:00:00Z",
  source: "manual",
  confidence: null,
  confirmedByUser: true,
  details: { grams: 100 },
};
const candidate: FoodDraftCandidate = {
  name: "Synthetic oats",
  portionWeightG: 100,
  caloriesKcal: 320,
  proteinG: 11,
  carbohydrateG: 42,
  fatG: 10,
  fibreG: 6,
  saturatedFatG: null,
  totalSugarsG: 0,
  sodiumMg: 40,
  cholesterolMg: 0,
  calorieRangeKcal: null,
  proteinRangeG: null,
  carbohydrateRangeG: null,
  fatRangeG: null,
  confidence: 0.5,
  warnings: ["Estimate needs review."],
  assumptions: [],
  provenance: {
    inputKind: "text",
    provider: "stub",
    model: "stub",
    promptVersion: "nutrition-draft-v3",
  },
};
function render(): any {
  hooks.index = 0;
  const tree = EditMealScreen();
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, predicate: (n: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((n) => find(n, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const byLabel = (label: string) =>
  find(
    render(),
    (n) => n.props?.accessibilityLabel === label || n.props?.label === label,
  );
const nutrients = () =>
  find(render(), (n) => n.type === "AdvancedNutrientFields").props;
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
async function refine() {
  byLabel("AI refine instruction").props.onChangeText(
    "estimate missing nutrients",
  );
  byLabel("Refine meal with AI").props.onPress();
  await flush();
  render();
}
beforeEach(async () => {
  hooks.slots = [];
  hooks.index = 0;
  hooks.effects = [];
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.visuals = true;
  mocks.refresh.mockResolvedValue(true);
  mocks.fetch.mockResolvedValue({ ok: true, entry });
  mocks.load.mockResolvedValue(null);
  mocks.persist.mockResolvedValue(true);
  mocks.update.mockResolvedValue({ ok: true });
  mocks.request.mockResolvedValue({ ok: true, value: { draft: candidate } });
  render();
  await flush();
  render();
});
describe("AI advanced nutrients in saved meal editing", () => {
  it("refines current inputs, fills editable estimates, and persists only after Save", async () => {
    byLabel("Calories (kcal)").props.onChangeText("410");
    nutrients().onChange("fibre", "7,5");
    await refine();
    expect(mocks.request.mock.calls[0]?.[0].body.currentDraft).toMatchObject({
      caloriesKcal: 410,
      fibreG: 7.5,
      sodiumMg: 12,
    });
    expect(nutrients().form).toMatchObject({
      fibre: "6",
      saturatedFat: "",
      totalSugars: "0",
      sodium: "40",
      cholesterol: "0",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenLastCalledWith(
      "user-a",
      "meal-edit-entry-a",
      expect.objectContaining({ fibre: "6", totalSugars: "0" }),
    );
    byLabel("Save meal changes").props.onPress();
    await flush();
    expect(mocks.update).toHaveBeenCalledWith(
      "entry-a",
      expect.objectContaining({
        fibreG: 6,
        totalSugarsG: 0,
        sodiumMg: 40,
        cholesterolMg: 0,
      }),
    );
  });
  it("keeps manual values for older responses with missing fields but clears explicit null", async () => {
    const {
      fibreG,
      saturatedFatG,
      totalSugarsG,
      sodiumMg,
      cholesterolMg,
      ...legacy
    } = candidate;
    mocks.request.mockResolvedValue({
      ok: true,
      value: { draft: { ...legacy, sodiumMg: null } },
    });
    await refine();
    expect(nutrients().form).toMatchObject({ fibre: "4", sodium: "" });
  });
  it("scales reviewed extra nutrients from the refined portion baseline", async () => {
    await refine();
    byLabel("Portion weight in grams").props.onChangeText("200");
    expect(nutrients().form).toMatchObject({
      fibre: "12",
      sodium: "80",
      totalSugars: "0",
      cholesterol: "0",
    });
  });
  it("establishes the AI portion baseline for a saved meal without an earlier weight", async () => {
    hooks.slots = [];
    hooks.index = 0;
    hooks.effects = [];
    mocks.fetch.mockResolvedValue({
      ok: true,
      entry: { ...entry, details: {} },
    });
    render();
    await flush();
    render();
    await refine();
    byLabel("Portion weight in grams").props.onChangeText("200");
    expect(nutrients().form).toMatchObject({ fibre: "12", sodium: "80" });
  });

  it("fills an authorized response even when capability arrived after the request started", async () => {
    mocks.enabled = false;
    mocks.refresh.mockResolvedValue(true);
    await refine();
    expect(nutrients().form).toMatchObject({ fibre: "6", totalSugars: "0" });
  });

  it("blocks refinement while Save is checking the current grant", async () => {
    let resolveGrant!: (value: boolean) => void;
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGrant = resolve;
        }),
    );
    nutrients().onChange("fibre", "8");
    byLabel("AI refine instruction").props.onChangeText(
      "estimate missing nutrients",
    );
    byLabel("Save meal changes").props.onPress();
    await flush();
    expect(byLabel("Refine meal with AI").props.disabled).toBe(true);
    byLabel("Refine meal with AI").props.onPress();
    await flush();
    expect(mocks.request).not.toHaveBeenCalled();
    resolveGrant(true);
    await flush();
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it("keeps edits made while refinement is pending and blocks Save until it settles", async () => {
    let resolveResponse!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    byLabel("AI refine instruction").props.onChangeText(
      "estimate missing nutrients",
    );
    byLabel("Refine meal with AI").props.onPress();
    await flush();
    expect(byLabel("Save meal changes").props.disabled).toBe(true);
    byLabel("Save meal changes").props.onPress();
    expect(mocks.update).not.toHaveBeenCalled();
    byLabel("Calories (kcal)").props.onChangeText("999");
    nutrients().onChange("fibre", "9");
    resolveResponse({ ok: true, value: { draft: candidate } });
    await flush();
    render();
    expect(nutrients().form).toMatchObject({
      calories: "999",
      fibre: "9",
      totalSugars: "",
    });
    expect(byLabel("Save meal changes").props.disabled).toBe(false);
  });

  it("does not introduce hidden new nutrient writes without Pro and blocks a downgrade before Save", async () => {
    mocks.enabled = false;
    mocks.refresh.mockResolvedValue(false);
    await refine();
    expect(nutrients().form).toMatchObject({
      fibre: "4",
      sodium: "12",
      totalSugars: "",
    });
    expect(
      mocks.request.mock.calls[0]?.[0].body.currentDraft,
    ).not.toHaveProperty("fibreG");
    byLabel("Save meal changes").props.onPress();
    await flush();
    expect(mocks.update.mock.calls[0]?.[1]).not.toHaveProperty("fibreG");
    expect(mocks.update.mock.calls[0]?.[1].details.aiDraft).not.toHaveProperty(
      "fibreG",
    );
    mocks.enabled = true;
    mocks.refresh.mockResolvedValue(true);
    await refine();
    mocks.refresh.mockResolvedValue(false);
    mocks.update.mockClear();
    byLabel("Save meal changes").props.onPress();
    await flush();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

vi.mock("./meal-visual", () => ({
  MealVisual: "MealVisual",
}));

it("gates saved-meal visuals independently from nutrition editing access", () => {
  expect(
    find(render(), (node) => node.type === "MealVisual").props.enabled,
  ).toBe(true);
  mocks.visuals = false;
  mocks.enabled = true;
  expect(
    find(render(), (node) => node.type === "MealVisual").props.enabled,
  ).toBe(false);
  expect(nutrients().enabled).toBe(true);
});
