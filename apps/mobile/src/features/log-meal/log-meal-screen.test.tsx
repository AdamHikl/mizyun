import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  picker: vi.fn(),
  photoDraft: vi.fn(),
  normalize: vi.fn(),
  pro: true,
  owner: "synthetic-user",
  token: "synthetic-token",
  load: vi.fn(),
  persist: vi.fn(),
  clear: vi.fn(),
  history: vi.fn(),
  textDraft: vi.fn(),
  refresh: vi.fn(),
  params: {} as { date?: string | string[] },
  reminders: vi.fn(),
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
  useLocalSearchParams: () => mocks.params,
  useNavigation: () => ({ addListener: () => () => {} }),
}));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: mocks.picker,
  launchCameraAsync: mocks.picker,
}));
vi.mock("@mizyun/observability", async (original) => ({
  ...(await original<typeof import("@mizyun/observability")>()),
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
    session: { user: { id: mocks.owner }, accessToken: mocks.token },
    profile: null,
  }),
}));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: {
    createFlowScope: () => ({ flowId: "test-flow" }),
    track: vi.fn().mockResolvedValue({ recorded: true }),
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
    enabled: mocks.pro,
    refresh: mocks.refresh,
  }),
}));
vi.mock("./log-meal-data", () => ({
  submitLogMeal: mocks.submit,
  snapMealPhoto: mocks.photoDraft,
  draftMealFromText: mocks.textDraft,
}));
vi.mock("./meal-photo", () => ({ normalizeMealPhoto: mocks.normalize }));
vi.mock("./meal-lifecycle-data", () => ({ fetchFoodHistory: mocks.history }));
vi.mock("./first-meal-reminders", () => ({
  loadFirstMealReminders: async () => ({ enabled: true }),
  reconcileFirstMealReminders: mocks.reminders,
}));
vi.mock("./evening-catch-up-reminders", () => ({
  reconcileEveningReminders: vi.fn(),
}));
vi.mock("./first-meal-routine-modal", () => ({
  FirstMealRoutineModal: "FirstMealRoutineModal",
}));

import { LogMealScreen } from "./log-meal-screen";
import { Keyboard } from "react-native";
import { router } from "expo-router";

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
  mocks.params = {};
  mocks.pro = true;
  mocks.owner = "synthetic-user";
  mocks.token = "synthetic-token";
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: "synthetic-one" },
      { uri: "synthetic-two" },
      { uri: "synthetic-three" },
    ],
  });
  mocks.normalize.mockResolvedValue(new Blob());
  mocks.load.mockResolvedValue({ ...draft });
  mocks.persist.mockResolvedValue(true);
  mocks.history.mockResolvedValue({ entries: [] });
  mocks.refresh.mockResolvedValue(true);
  mocks.submit.mockResolvedValue({ ok: true });
  render();
  await flush();
  render();
});

it("closes meal entry without submitting or clearing its retained draft", async () => {
  byId("meal-name-input").props.onChangeText("Retained manual meal");
  render();
  await flush();
  const close = find(
    render(),
    (node) => node.type === "StackScreen",
  ).props.options.headerLeft();

  expect(close.props.disabled).toBe(false);
  expect(mocks.persist).toHaveBeenLastCalledWith(
    "synthetic-user",
    "meal",
    expect.objectContaining({ name: "Retained manual meal" }),
  );
  close.props.onPress();
  expect(router.back).toHaveBeenCalledOnce();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
});

it("shares the save guard between the header and footer while a meal is saving", async () => {
  let finishSave!: (value: { ok: true }) => void;
  mocks.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  );
  const headerSave = () =>
    find(
      render(),
      (node) => node.type === "StackScreen",
    ).props.options.headerRight();

  headerSave().props.onPress();
  byId("submit-meal-button").props.onPress();
  await flush();

  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(headerSave().props.disabled).toBe(true);
  expect(
    find(
      render(),
      (node) => node.type === "StackScreen",
    ).props.options.headerLeft().props.disabled,
  ).toBe(true);
  expect(byId("submit-meal-button").props.disabled).toBe(true);
  finishSave({ ok: true });
  await flush();
});

it("reveals repeated validation failures from the header Save action", async () => {
  const scrollTo = vi.fn();
  const scroll = find(render(), (node) => node.type === "ScrollView");
  scroll.props.ref.current = { scrollTo };
  byId("meal-portion-weight-input").props.onChangeText("");
  const pressHeaderSave = () =>
    find(render(), (node) => node.type === "StackScreen")
      .props.options.headerRight()
      .props.onPress();

  pressHeaderSave();
  await flush();
  render();
  expect(mocks.submit).not.toHaveBeenCalled();
  scrollTo.mockClear();
  vi.mocked(Keyboard.dismiss).mockClear();

  pressHeaderSave();
  await flush();
  render();
  expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  expect(Keyboard.dismiss).toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
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

describe("previous-day meal logging", () => {
  async function openPreviousDay() {
    hooks.slots = [];
    hooks.effects = [];
    mocks.params = { date: "2026-09-12" };
    mocks.load.mockResolvedValue(null);
    render();
    await flush();
    render();
    byId("meal-name-input").props.onChangeText("Synthetic past meal");
  }
  it("saves on the selected local calendar day", async () => {
    await openPreviousDay();
    await submit();
    const consumed = new Date(mocks.submit.mock.calls[0][0].consumedAt);
    expect([
      consumed.getFullYear(),
      consumed.getMonth(),
      consumed.getDate(),
    ]).toEqual([2026, 8, 12]);
    expect(mocks.persist).toHaveBeenLastCalledWith(
      "synthetic-user",
      "meal",
      expect.objectContaining({ mealDate: "2026-09-12" }),
    );
  });
  it("keeps the selected date after clearing the form", async () => {
    await openPreviousDay();
    byId("clear-meal-button").props.onPress();
    await flush();
    byId("meal-name-input").props.onChangeText("Synthetic past meal");
    await submit();
    expect(new Date(mocks.submit.mock.calls[0][0].consumedAt).getDate()).toBe(
      12,
    );
  });
  it("does not suppress today's reminder for a historical save", async () => {
    await openPreviousDay();
    await submit();
    expect(mocks.reminders).not.toHaveBeenCalled();
  });
});

describe("selected meal day recovery and retries", () => {
  async function open(value: unknown, date: string | string[] = "2026-09-12") {
    hooks.slots = [];
    hooks.effects = [];
    mocks.params = { date };
    mocks.load.mockResolvedValue(value);
    render();
    await flush();
    render();
  }
  it("recovers a historical timestamp and retries the exact payload", async () => {
    const timestamp = new Date(2026, 8, 12, 12).toISOString();
    await open({ ...draft, mealDate: "2026-09-12", consumedAt: timestamp });
    mocks.submit.mockResolvedValueOnce({ ok: false, message: "network error" });
    await submit();
    const first = mocks.submit.mock.calls[0][0];
    expect(first.consumedAt).toBe(timestamp);
    expect(first.clientOperationId).toBe(draft.clientOperationId);
    await submit();
    expect(mocks.submit.mock.calls[1][0]).toEqual(first);
  });
  it("preserves a draft for another day and requires explicit Clear before saving to this heading", async () => {
    await open({
      ...draft,
      mealDate: "2026-09-11",
      consumedAt: new Date(2026, 8, 11, 12).toISOString(),
    });
    expect(byId("meal-name-input").props.value).toBe(draft.name);
    await submit();
    expect(mocks.submit).not.toHaveBeenCalled();
    byId("clear-meal-button").props.onPress();
    await flush();
    byId("meal-name-input").props.onChangeText("New synthetic meal");
    await submit();
    expect(new Date(mocks.submit.mock.calls[0][0].consumedAt).getDate()).toBe(
      12,
    );
  });
  it.each(["invalid", "2026-02-30", ["2026-09-12"], "9999-12-31"])(
    "blocks invalid/future route %s",
    async (date) => {
      await open(null, date);
      byId("meal-name-input").props.onChangeText("Synthetic meal");
      await submit();
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it("retains the historical date after an AI text draft replacement", async () => {
    await open(null);
    mocks.textDraft.mockResolvedValue({
      ok: true,
      draft: {
        name: "Synthetic AI meal",
        portionWeightG: 100,
        caloriesKcal: 200,
        proteinG: 10,
        carbohydrateG: 20,
        fatG: 5,
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
      (n) => n.props?.accessibilityLabel === "Draft from description",
    ).props.onPress();
    await flush();
    render();
    await submit();
    expect(new Date(mocks.submit.mock.calls[0][0].consumedAt).getDate()).toBe(
      12,
    );
  });
});

it("rejects a restored future day even without route parameters", async () => {
  hooks.slots = [];
  hooks.effects = [];
  mocks.params = {};
  mocks.load.mockResolvedValue({
    ...draft,
    mealDate: "9999-12-31",
    consumedAt: new Date(9999, 11, 31, 12).toISOString(),
  });
  render();
  await flush();
  render();
  mocks.persist.mockClear();
  await submit();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.persist).not.toHaveBeenCalled();
});

it("offers Clear even when the recovered draft from another day is empty", async () => {
  hooks.slots = [];
  hooks.effects = [];
  mocks.params = { date: "2026-09-12" };
  mocks.load.mockResolvedValue({
    name: "",
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
    mealDate: "2026-09-11",
    consumedAt: new Date(2026, 8, 11, 12).toISOString(),
  });
  render();
  await flush();
  render();
  expect(byId("clear-meal-button")).toBeTruthy();
});

const syntheticPhotoDraft = {
  name: "Synthetic meal",
  caloriesKcal: 250,
  proteinG: 10,
  carbohydrateG: 30,
  fatG: 8,
  calorieRangeKcal: null,
  proteinRangeG: null,
  carbohydrateRangeG: null,
  fatRangeG: null,
  confidence: 0.5,
  warnings: [],
  assumptions: [],
  provenance: {
    inputKind: "photo" as const,
    provider: "synthetic",
    model: "synthetic",
    promptVersion: "test",
  },
};
it("selects three photos for Pro and submits them together after explicit Process", async () => {
  mocks.photoDraft.mockResolvedValue({ ok: true, draft: syntheticPhotoDraft });
  await byId("snap-meal-button").props.onPress();
  await flush();
  expect(mocks.picker).toHaveBeenCalledWith(
    expect.objectContaining({
      allowsMultipleSelection: true,
      selectionLimit: 3,
    }),
  );
  expect(mocks.photoDraft).not.toHaveBeenCalled();
  byId("process-meal-photo-button").props.onPress();
  await flush();
  expect(mocks.normalize).toHaveBeenCalledTimes(3);
  expect(mocks.photoDraft).toHaveBeenCalledWith(
    expect.any(Blob),
    "image/jpeg",
    undefined,
    [
      expect.objectContaining({ photo: expect.any(Blob) }),
      expect.objectContaining({ photo: expect.any(Blob) }),
    ],
  );
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("rejects picker results over three without silently dropping photos", async () => {
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [1, 2, 3, 4].map((n) => ({ uri: `synthetic-${n}` })),
  });
  await byId("snap-meal-button").props.onPress();
  await flush();
  expect(byId("process-meal-photo-button")).toBeFalsy();
  expect(mocks.photoDraft).not.toHaveBeenCalled();
});
it("rechecks downgraded access before sending retained multiple photos", async () => {
  await byId("snap-meal-button").props.onPress();
  await flush();
  render();
  mocks.refresh.mockResolvedValue(false);
  byId("process-meal-photo-button").props.onPress();
  await flush();
  expect(mocks.photoDraft).not.toHaveBeenCalled();
  expect(mocks.normalize).not.toHaveBeenCalled();
});
it("saves each separate photo meal only after its own confirmation and persists the next draft", async () => {
  mocks.photoDraft.mockResolvedValue({
    ok: true,
    draft: syntheticPhotoDraft,
    drafts: [
      syntheticPhotoDraft,
      { ...syntheticPhotoDraft, name: "Second meal" },
      { ...syntheticPhotoDraft, name: "Third meal" },
    ],
  });
  await byId("snap-meal-button").props.onPress();
  await flush();
  byId("process-meal-photo-button").props.onPress();
  await flush();
  render();
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(router.back).not.toHaveBeenCalled();
  expect(byId("meal-name-input").props.value).toBe("Second meal");
  expect(mocks.persist).toHaveBeenCalledWith(
    "synthetic-user",
    "meal",
    expect.objectContaining({
      name: "Second meal",
      pendingPhotoDrafts: [expect.objectContaining({ name: "Third meal" })],
    }),
  );
  await submit();
  expect(byId("meal-name-input").props.value).toBe("Third meal");
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(3);
  const ids = mocks.submit.mock.calls.map(([form]) => form.clientOperationId);
  expect(new Set(ids).size).toBe(3);
  expect(router.back).toHaveBeenCalledOnce();
});
it("retains batch and idempotency values after a lost save response", async () => {
  mocks.photoDraft.mockResolvedValue({
    ok: true,
    draft: syntheticPhotoDraft,
    drafts: [
      syntheticPhotoDraft,
      { ...syntheticPhotoDraft, name: "Second meal" },
    ],
  });
  await byId("snap-meal-button").props.onPress();
  await flush();
  byId("process-meal-photo-button").props.onPress();
  await flush();
  render();
  mocks.submit.mockResolvedValueOnce({
    ok: false,
    message: "Network unavailable",
  });
  await submit();
  expect(byId("meal-name-input").props.value).toBe("Synthetic meal");
  const first = mocks.submit.mock.calls[0][0];
  await submit();
  expect(mocks.submit.mock.calls[1][0]).toEqual(first);
  expect(byId("meal-name-input").props.value).toBe("Second meal");
});

it("does not duplicate a saved meal when persisting the next batch draft fails", async () => {
  mocks.photoDraft.mockResolvedValue({
    ok: true,
    draft: syntheticPhotoDraft,
    drafts: [
      syntheticPhotoDraft,
      { ...syntheticPhotoDraft, name: "Second meal" },
    ],
  });
  await byId("snap-meal-button").props.onPress();
  await flush();
  byId("process-meal-photo-button").props.onPress();
  await flush();
  render();
  mocks.persist.mockImplementation(
    async (_user, _kind, value) => value.name !== "Second meal",
  );
  await submit();
  const saved = mocks.submit.mock.calls[0][0];
  byId("meal-name-input").props.onChangeText("Edited after save");
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  byId("meal-name-input").props.onChangeText(saved.name);
  mocks.persist.mockResolvedValue(true);
  await submit();
  expect(mocks.submit.mock.calls[1][0]).toEqual(saved);
  expect(byId("meal-name-input").props.value).toBe("Second meal");
});
it("recovers the remaining photo meals without selecting photos again", async () => {
  hooks.slots = [];
  hooks.effects = [];
  mocks.load.mockResolvedValue({
    ...draft,
    nutritionBasis: "total",
    aiDraft: syntheticPhotoDraft,
    pendingPhotoDrafts: [{ ...syntheticPhotoDraft, name: "Remaining meal" }],
    attachedPhotoUris: ["synthetic-1", "synthetic-2"],
  });
  render();
  await flush();
  render();
  await submit();
  expect(byId("meal-name-input").props.value).toBe("Remaining meal");
  expect(router.back).not.toHaveBeenCalled();
});

it("masks queued advanced nutrients if Pro is revoked between confirmed meals", async () => {
  mocks.photoDraft.mockResolvedValue({
    ok: true,
    draft: syntheticPhotoDraft,
    drafts: [
      syntheticPhotoDraft,
      { ...syntheticPhotoDraft, name: "Second meal", fibreG: 4 },
    ],
  });
  await byId("snap-meal-button").props.onPress();
  await flush();
  byId("process-meal-photo-button").props.onPress();
  await flush();
  render();
  mocks.pro = false;
  mocks.refresh.mockResolvedValue(false);
  await submit();
  expect(byId("meal-name-input").props.value).toBe("Second meal");
  const nextStored = mocks.persist.mock.calls.find(
    ([, , value]) => value.name === "Second meal",
  )![2];
  expect(nextStored.aiDraft.fibreG).toBeUndefined();
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(2);
  expect(mocks.submit.mock.calls[1][0].fibreG).toBeUndefined();
});

it("allows a token refresh during Save without locking the meal form", async () => {
  let resolveSave!: (value: unknown) => void;
  mocks.submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  byId("submit-meal-button").props.onPress();
  await flush();
  mocks.token = "refreshed-synthetic-token";
  render();
  resolveSave({ ok: false, message: "Network unavailable" });
  await flush();
  render();
  expect(byId("submit-meal-button").props.disabled).toBe(false);
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(2);
});
it("does not send the previous account's form if ownership changes during draft persistence", async () => {
  let resolveStore!: (value: boolean) => void;
  mocks.persist.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveStore = resolve;
      }),
  );
  byId("submit-meal-button").props.onPress();
  await flush();
  mocks.owner = "another-synthetic-user";
  mocks.load.mockResolvedValue(null);
  render();
  await flush();
  resolveStore(true);
  await flush();
  render();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(byId("submit-meal-button").props.disabled).toBe(false);
});
