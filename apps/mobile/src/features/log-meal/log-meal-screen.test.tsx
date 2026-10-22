import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  picker: vi.fn(),
  photoDraft: vi.fn(),
  normalize: vi.fn(),
  retention: false,
  sourceCopy: vi.fn(),
  keepOnDevice: vi.fn(),
  backUp: vi.fn(),
  backupEnabled: vi.fn(),
  photoDiscard: vi.fn(),
  visuals: true,
  visualRefresh: vi.fn(),
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
  MinTouchTarget: 44,
  PageGutter: 20,
  Radius: {},
  Spacing: {},
}));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Chip: "Chip",
  FormStatus: "FormStatus",
  FormTextInput: "FormTextInput",
  Icon: "Icon",
  IconButton: "IconButton",
  SectionHeader: "SectionHeader",
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
  loadRequiredLoggingDraft: mocks.load,
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
vi.mock("./meal-visual-capability", () => ({
  useMealVisualCapability: () => ({
    enabled: mocks.visuals,
    refresh: mocks.visualRefresh,
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
  mocks.retention = false;
  mocks.visuals = true;
  mocks.visualRefresh.mockResolvedValue(true);
  mocks.sourceCopy.mockImplementation(async (assetOwner, asset) => ({
    uri: `owned-${asset.uri}`,
  }));
  mocks.keepOnDevice.mockResolvedValue(true);
  mocks.backUp.mockResolvedValue(true);
  mocks.backupEnabled.mockResolvedValue(false);
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
  mocks.clear.mockResolvedValue(true);
  mocks.history.mockResolvedValue({
    groups: [],
    entries: [],
    nextCursor: null,
    message: null,
  });
  mocks.refresh.mockResolvedValue(true);
  mocks.submit.mockResolvedValue({ ok: true });
  mocks.reminders.mockResolvedValue(undefined);
  render();
  await flush();
  render();
});
it("keeps a confirmed meal saved when local reminder reconciliation fails", async () => {
  mocks.reminders.mockRejectedValueOnce(new Error("Keychain locked"));
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mocks.reminders).toHaveBeenCalledWith("synthetic-user", {
    todayLogged: true,
  });
  expect(byId("submit-meal-button").props.disabled).toBe(true);
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
    undefined,
    expect.objectContaining({ isCurrent: expect.any(Function) }),
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
      expect.objectContaining({
        expectedUserId: "synthetic-user",
        isCurrent: expect.any(Function),
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
      undefined,
      expect.objectContaining({ isCurrent: expect.any(Function) }),
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
          id: "00000000-0000-4000-8000-000000000001",
          consumedAt: new Date(Date.now() - 3_600_000).toISOString(),
          confirmedByUser: true,
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
    expect(mocks.submit.mock.calls[0]?.[0].healthExportFirstParty).toBe(false);
  });
  describe("quick-add chips", () => {
    const DAY = 86_400_000;
    const meal = (id: number, name: string, ageMs: number) => ({
      id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
      consumedAt: new Date(Date.now() - ageMs).toISOString(),
      confirmedByUser: true,
      name,
      caloriesKcal: 100 + id,
      proteinG: 5,
      carbohydrateG: 10,
      fatG: 2,
      details: {},
    });
    const chips = (): any[] => {
      const out: any[] = [];
      const walk = (n: any) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (
          n.type === "Pressable" &&
          String(n.props?.accessibilityLabel).startsWith("Reuse meal ")
        )
          out.push(n);
        walk(n.props?.children);
      };
      walk(render());
      return out;
    };
    const load = async (entries: unknown[]) => {
      hooks.slots = [];
      hooks.effects = [];
      mocks.history.mockResolvedValue({ entries });
      render();
      await flush();
    };
    it("ranks habits first, labels the usual-now item and caps at six", async () => {
      await load([
        meal(1, "One-off", 3_600_000),
        meal(2, "Habit", 1 * DAY),
        meal(3, "Habit", 2 * DAY),
        meal(4, "Habit", 3 * DAY),
        ...[5, 6, 7, 8, 9, 10].map((i) =>
          meal(i, `Filler ${i}`, i * 3_600_000),
        ),
      ]);
      const list = chips();
      expect(list).toHaveLength(6);
      expect(list[0].props.accessibilityLabel).toBe(
        "Reuse meal Habit, usual now",
      );
      expect(list[1].props.accessibilityLabel).not.toContain("usual now");
      expect(mocks.history).toHaveBeenCalledWith({ limit: 200 });
    });
    it("shows a single Usual now label and reuses the chip selection path", async () => {
      await load([meal(2, "Habit", DAY), meal(3, "Habit", 2 * DAY)]);
      const [chip] = chips();
      expect(
        find(chip, (n) => n.props?.testID === "quick-meal-reason"),
      ).toBeTruthy();
      chip.props.onPress();
      expect(byId("meal-name-input").props.value).toBe("Habit");
    });
    it("shows no chips when history fails or rejects", async () => {
      await load([]);
      expect(chips()).toHaveLength(0);
      hooks.slots = [];
      hooks.effects = [];
      mocks.history.mockRejectedValue(new Error("offline"));
      render();
      await flush();
      expect(chips()).toHaveLength(0);
    });
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
    expect(mocks.submit.mock.calls[0]?.[0].healthExportTimeBasis).toBe(
      "date_only",
    );
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
      undefined,
      expect.objectContaining({ isCurrent: expect.any(Function) }),
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
it("recovers an unreadable photo with a short reselect message and preserves meal values", async () => {
  mocks.retention = true;
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "missing-photo" }],
  });
  await byId("snap-meal-button").props.onPress();
  await flush();
  mocks.normalize.mockRejectedValueOnce(
    new Error(
      "FunctionCallException: NSCocoaErrorDomain Code=260 file:///private/synthetic-missing.jpg",
    ),
  );
  byId("process-meal-photo-button").props.onPress();
  await flush();
  expect(
    find(
      render(),
      (node) =>
        node.props?.children ===
        "Couldn't read this photo. Remove it and choose it again, or enter the meal by hand.",
    ),
  ).toBeTruthy();
  expect(
    find(
      render(),
      (node) =>
        typeof node.props?.children === "string" &&
        node.props.children.includes("NSCocoaErrorDomain"),
    ),
  ).toBeFalsy();
  expect(byId("meal-name-input").props.value).toBe(draft.name);
  expect(mocks.photoDraft).not.toHaveBeenCalled();
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Remove attached photo 1",
  ).props.onPress();
  await flush();
  expect(mocks.photoDiscard).toHaveBeenCalledWith(
    "synthetic-user",
    "owned-missing-photo",
  );
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "replacement-photo" }],
  });
  mocks.photoDraft.mockResolvedValueOnce({
    ok: true,
    draft: syntheticPhotoDraft,
  });
  await byId("snap-meal-button").props.onPress();
  await flush();
  byId("process-meal-photo-button").props.onPress();
  await flush();
  expect(mocks.photoDraft).toHaveBeenCalledTimes(1);
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
    undefined,
    expect.objectContaining({ isCurrent: expect.any(Function) }),
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
  const scope = mocks.submit.mock.calls[0][1];
  expect(scope.expectedUserId).toBe("synthetic-user");
  expect(scope.isCurrent()).toBe(true);
  mocks.token = "refreshed-synthetic-token";
  render();
  expect(scope.isCurrent()).toBe(false);
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

vi.mock("./meal-photo-retention", () => ({
  mealPhotoRetentionEnabled: () => mocks.retention,
  persistMealPhotoSource: mocks.sourceCopy,
  keepMealPhotoOnDevice: mocks.keepOnDevice,
  backUpLocalMealPhoto: mocks.backUp,
  discardOwnedMealPhoto: mocks.photoDiscard,
}));
vi.mock("@/features/private-photos/photo-backup-preference", () => ({
  loadPhotoBackupEnabled: mocks.backupEnabled,
}));

it("saves a manual meal and keeps its photo on this phone without any upload while Back up photos is off", async () => {
  mocks.retention = true;
  mocks.picker.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "manual-photo" }],
  });
  mocks.submit.mockResolvedValueOnce({ ok: true, id: "saved-meal" });
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Choose a meal photo",
  ).props.onPress();
  await flush();
  render();
  await submit();
  expect(mocks.photoDraft).not.toHaveBeenCalled();
  expect(mocks.keepOnDevice).toHaveBeenCalledWith(
    "synthetic-user",
    "saved-meal",
    "owned-manual-photo",
  );
  expect(mocks.backupEnabled).toHaveBeenCalledWith("synthetic-user");
  expect(mocks.backUp).not.toHaveBeenCalled();
  expect(mocks.visualRefresh).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalled();
});
it("requires an explicit photo for each queued meal and keeps choices after the first save", async () => {
  mocks.retention = true;
  mocks.photoDraft.mockResolvedValueOnce({
    ok: true,
    draft: syntheticPhotoDraft,
    drafts: [
      syntheticPhotoDraft,
      { ...syntheticPhotoDraft, name: "Second meal" },
    ],
  });
  mocks.submit.mockResolvedValue({ ok: true, id: "saved-meal" });
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Choose a meal photo",
  ).props.onPress();
  await flush();
  render();
  byId("process-meal-photo-button").props.onPress();
  await flush();
  render();
  await submit();
  expect(mocks.submit).not.toHaveBeenCalled();
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Keep photo 2 with this meal",
  ).props.onPress();
  render();
  await submit();
  expect(mocks.keepOnDevice.mock.calls[0][2]).toBe("owned-synthetic-two");
  expect(byId("meal-name-input").props.value).toBe("Second meal");
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Keep photo 3 with this meal",
  ).props.onPress();
  render();
  await submit();
  expect(mocks.keepOnDevice.mock.calls[1][2]).toBe("owned-synthetic-three");
});
it("drops late source-copy completion after Clear", async () => {
  mocks.retention = true;
  let resolve!: (value: { uri: string }) => void;
  mocks.picker.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "late-photo" }],
  });
  mocks.sourceCopy.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Choose a meal photo",
  ).props.onPress();
  await flush();
  render();
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Clear meal",
  ).props.onPress();
  await flush();
  resolve({ uri: "owned-late-photo" });
  await flush();
  render();
  expect(byId("keep-meal-photo-toggle")).toBeFalsy();
  expect(mocks.photoDiscard).toHaveBeenCalledWith(
    "synthetic-user",
    "owned-late-photo",
  );
});

async function attachPhotoForRetention(photos = ["manual-photo"]) {
  mocks.retention = true;
  mocks.picker.mockResolvedValueOnce({
    canceled: false,
    assets: photos.map((uri) => ({ uri })),
  });
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Choose a meal photo",
  ).props.onPress();
  await flush();
  render();
}

it("keeps the photo on this phone for a Free account without Pro checks, uploads or retries", async () => {
  mocks.visuals = false;
  mocks.pro = false;
  mocks.refresh.mockResolvedValue(false);
  mocks.visualRefresh.mockResolvedValue(false);
  mocks.photoDraft.mockResolvedValueOnce({
    ok: true,
    draft: syntheticPhotoDraft,
  });
  mocks.submit.mockResolvedValueOnce({ ok: true, id: "free-meal" });
  await attachPhotoForRetention();
  // Keeping a photo is free; only its backup needs Pro (ADR-0079).
  expect(byId("keep-meal-photo-toggle")).toBeTruthy();
  byId("process-meal-photo-button").props.onPress();
  await flush();
  render();
  expect(mocks.photoDraft).toHaveBeenCalledTimes(1);
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mocks.keepOnDevice).toHaveBeenCalledWith(
    "synthetic-user",
    "free-meal",
    "owned-manual-photo",
  );
  expect(mocks.backUp).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalled();
});

it("does not refresh Pro for the multi-photo choice and still requires choosing which photo to keep", async () => {
  await attachPhotoForRetention(["one", "two"]);
  mocks.visualRefresh.mockResolvedValue(false);
  await submit();
  expect(mocks.visualRefresh).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(
    find(
      render(),
      (node) =>
        node.props?.tone === "error" &&
        typeof node.props.children === "string" &&
        node.props.children.startsWith("Choose which photo to keep"),
    ),
  ).toBeTruthy();
  mocks.submit.mockResolvedValueOnce({ ok: true, id: "chosen-meal" });
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Keep photo 2 with this meal",
  ).props.onPress();
  render();
  await submit();
  expect(mocks.keepOnDevice).toHaveBeenCalledWith(
    "synthetic-user",
    "chosen-meal",
    "owned-two",
  );
});

it("uploads the device copy and records it only when Back up photos is on and Pro is freshly confirmed", async () => {
  await attachPhotoForRetention();
  mocks.backupEnabled.mockResolvedValue(true);
  mocks.visualRefresh.mockResolvedValue(true);
  mocks.submit.mockResolvedValueOnce({ ok: true, id: "backed-up-meal" });
  await submit();
  expect(mocks.visualRefresh).toHaveBeenCalledTimes(1);
  expect(mocks.backUp).toHaveBeenCalledTimes(1);
  expect(mocks.backUp.mock.calls[0]!.slice(0, 2)).toEqual([
    "synthetic-user",
    "backed-up-meal",
  ]);
  expect(mocks.backUp.mock.calls[0]![2]()).toBe(true);
  expect(router.back).toHaveBeenCalled();
});

it("saves the meal and keeps the device photo when backup is on but Pro is denied after submission", async () => {
  await attachPhotoForRetention();
  mocks.backupEnabled.mockResolvedValue(true);
  mocks.visualRefresh.mockResolvedValue(false);
  mocks.submit.mockResolvedValueOnce({ ok: true, id: "saved-no-backup" });
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mocks.keepOnDevice).toHaveBeenCalledTimes(1);
  expect(mocks.visualRefresh).toHaveBeenCalledTimes(1);
  expect(mocks.backUp).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalled();
});

it("does not check Pro or upload when Back up photos is off, however Pro stands", async () => {
  await attachPhotoForRetention();
  mocks.submit.mockResolvedValueOnce({ ok: true, id: "device-only-meal" });
  await submit();
  expect(mocks.visualRefresh).not.toHaveBeenCalled();
  expect(mocks.backUp).not.toHaveBeenCalled();
});

it("does not surface a failed backup upload and never leaves a retry", async () => {
  await attachPhotoForRetention();
  mocks.backupEnabled.mockResolvedValue(true);
  mocks.backUp.mockResolvedValue(false);
  mocks.submit.mockResolvedValueOnce({ ok: true, id: "backup-fails" });
  await submit();
  expect(mocks.backUp).toHaveBeenCalledTimes(1);
  expect(find(render(), (node) => node.props?.tone === "error")).toBeFalsy();
  expect(router.back).toHaveBeenCalled();
});

it("saves the meal but stops with a retry message when the photo cannot be kept on this phone", async () => {
  await attachPhotoForRetention();
  mocks.backupEnabled.mockResolvedValue(true);
  mocks.keepOnDevice.mockResolvedValue(false);
  mocks.submit.mockResolvedValueOnce({ ok: true, id: "kept-failed-meal" });
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(
    find(
      render(),
      (node) =>
        node.props?.tone === "error" &&
        node.props.children ===
          "Meal saved. The photo couldn't be kept on this phone. Retry Save to finish attaching the photo.",
    ),
  ).toBeTruthy();
  expect(mocks.backUp).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  expect(byId("submit-meal-button").props.disabled).toBe(false);
});

it("abandons the photo backup and navigation when the account changes while the photo is kept on the device", async () => {
  await attachPhotoForRetention();
  mocks.backupEnabled.mockResolvedValue(true);
  let finish!: (value: boolean) => void;
  mocks.keepOnDevice.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mocks.submit.mockResolvedValueOnce({ ok: true, id: "owner-change-meal" });
  byId("submit-meal-button").props.onPress();
  await flush();
  expect(mocks.keepOnDevice).toHaveBeenCalledTimes(1);
  mocks.owner = "other-user";
  mocks.token = "other-token";
  render();
  finish(true);
  await flush();
  expect(mocks.backUp).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
});

it("invalidates the backup upload's current fence on a token change and still treats the meal as saved", async () => {
  await attachPhotoForRetention();
  mocks.backupEnabled.mockResolvedValue(true);
  let finish!: (value: boolean) => void;
  mocks.backUp.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mocks.submit.mockResolvedValueOnce({
    ok: true,
    id: "saved-during-token-change",
  });
  byId("submit-meal-button").props.onPress();
  await flush();
  const isCurrent = mocks.backUp.mock.calls[0]![2];
  expect(isCurrent()).toBe(true);
  mocks.token = "rotated-token";
  render();
  expect(isCurrent()).toBe(false);
  finish(false);
  await flush();
  expect(router.back).not.toHaveBeenCalled();
});

it("recovers the exact frozen request after a lost response, edits and a restart over 24 hours later", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-09-08T12:00:00.000Z"));
    hooks.slots = [];
    hooks.effects = [];
    mocks.load.mockResolvedValue({
      ...draft,
      consumedAt: new Date().toISOString(),
    });
    render();
    await flush();
    render();
    mocks.submit.mockResolvedValueOnce({
      ok: false,
      message: "Network unavailable",
    });
    await submit();
    const original = mocks.submit.mock.calls[0][0];
    const persisted = mocks.persist.mock.calls.find(
      (call) => call[2].submittedMeal,
    )?.[2];
    expect(persisted).toMatchObject({
      submittedMeal: original,
      submissionStatus: "outcome_unknown",
    });
    byId("meal-name-input").props.onChangeText("Edited while unresolved");
    render();
    const edited = mocks.persist.mock.calls.at(-1)![2];
    expect(edited.submittedMeal).toEqual(original);
    vi.setSystemTime(new Date("2026-09-09T13:00:00.000Z"));
    hooks.slots = [];
    hooks.effects = [];
    mocks.load.mockResolvedValue(edited);
    render();
    await flush();
    render();
    expect(byId("meal-name-input").props.value).toBe(original.name);
    mocks.pro = false;
    mocks.refresh.mockResolvedValue(false);
    await submit();
    expect(mocks.submit.mock.calls[1][0]).toEqual(original);
    expect(mocks.clear).toHaveBeenCalledWith(
      "synthetic-user",
      "meal",
      undefined,
      expect.objectContaining({
        resolvedOperationId: original.clientOperationId,
      }),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the frozen operation when Clear is pressed after a lost response", async () => {
  mocks.submit.mockResolvedValueOnce({
    ok: false,
    message: "Network unavailable",
  });
  await submit();
  const original = mocks.submit.mock.calls[0][0];
  mocks.clear.mockClear();
  byId("meal-name-input").props.onChangeText("Changed while outcome unknown");
  byId("clear-meal-button").props.onPress();
  await flush();
  render();
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(byId("meal-name-input").props.value).toBe(original.name);
  await submit();
  expect(mocks.submit.mock.calls[1][0]).toEqual(original);
});

it("blocks Save when required storage recovery is unavailable", async () => {
  hooks.slots = [];
  hooks.effects = [];
  mocks.load.mockRejectedValueOnce(Error("locked"));
  render();
  await flush();
  render();
  expect(byId("submit-meal-button").props.disabled).toBe(true);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("does not replay changed description details under the frozen identity", async () => {
  mocks.submit.mockResolvedValueOnce({
    ok: false,
    message: "Network unavailable",
  });
  await submit();
  const description = find(
    render(),
    (node) => node.props?.testID === "meal-description-input",
  );
  expect(description).toBeTruthy();
  description.props.onChangeText("Changed description");
  await submit();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});

it("does not autosave the previous account's rendered values into a newly selected account", async () => {
  mocks.persist.mockClear();
  mocks.owner = "new-owner";
  mocks.token = "new-token";
  mocks.load.mockResolvedValue(null);
  render();
  expect(mocks.persist).not.toHaveBeenCalled();
  await flush();
  render();
  expect(
    mocks.persist.mock.calls.every(
      (call) => call[0] !== "new-owner" || call[2].name === "",
    ),
  ).toBe(true);
});

it("keeps Save retryable when a confirmed meal completion receipt cannot be persisted", async () => {
  mocks.clear.mockResolvedValueOnce(false);
  await submit();
  const original = mocks.submit.mock.calls[0][0];
  expect(router.back).not.toHaveBeenCalled();
  expect(byId("submit-meal-button").props.disabled).toBe(false);
  await submit();
  expect(mocks.submit.mock.calls[1][0]).toEqual(original);
  expect(router.back).toHaveBeenCalled();
});
