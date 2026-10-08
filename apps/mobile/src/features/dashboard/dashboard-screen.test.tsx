import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedDashboardSnapshot } from "../offline-cache/offline-cache-storage";

const mocks = vi.hoisted(() => ({
  daily: vi.fn(),
  weight: vi.fn(),
  energy: vi.fn(),
  workouts: vi.fn(),
  history: vi.fn(),
  mealDateHistory: vi.fn(),
  mealCopy: vi.fn(),
  reminders: vi.fn(),
  secureRead: vi.fn(),
  secureWrite: vi.fn(),
  secureDelete: vi.fn(),
  cache: vi.fn(),
  save: vi.fn(),
  invalidate: vi.fn(),
  networkQuery: vi.fn(),
  appRemove: vi.fn(),
  networkRemove: vi.fn(),
  owner: "synthetic-owner",
  fontScale: 1,
  tokenRevision: 0,
  activeWorkout: null as { id: string } | null,
  createBlank: vi.fn(),
  push: vi.fn(),
  alert: vi.fn(),
  uuid: vi.fn(),
  appState: null as ((state: string) => void) | null,
  network: null as ((state: any) => void) | null,
  networkState: {
    isConnected: true,
    isInternetReachable: true,
    type: "WIFI",
  } as any,
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  focus: null as (() => (() => void) | void) | null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    const slots = hooks.slots;
    if (!(index in slots)) slots[index] = initial;
    return [
      slots[index],
      (next: any) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      },
    ];
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (callback: () => unknown) => callback(),
  useEffect: (callback: () => void, dependencies: any[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index];
    if (
      !previous ||
      previous.length !== dependencies.length ||
      previous.some(
        (value: any, i: number) => !Object.is(value, dependencies[i]),
      )
    ) {
      hooks.slots[index] = dependencies;
      hooks.effects.push(callback);
    }
  },
}));
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  ActivityIndicator: "ActivityIndicator",
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.appState = callback;
      return { remove: mocks.appRemove };
    },
  },
  Platform: {
    OS: "ios",
    select: (options: any) => options.ios ?? options.default,
  },
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ fontScale: mocks.fontScale }),
}));
vi.mock("expo-network", () => ({
  NetworkStateType: {
    NONE: "NONE",
    UNKNOWN: "UNKNOWN",
    WIFI: "WIFI",
    CELLULAR: "CELLULAR",
  },
  getNetworkStateAsync: mocks.networkQuery,
  addNetworkStateListener: (callback: (state: any) => void) => {
    mocks.network = callback;
    return { remove: mocks.networkRemove };
  },
}));
vi.mock("expo-router", () => ({
  router: { push: mocks.push },
  useFocusEffect: (callback: typeof hooks.focus) => {
    hooks.focus = callback;
  },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: mocks.secureRead,
  setItemAsync: mocks.secureWrite,
  deleteItemAsync: mocks.secureDelete,
}));
vi.mock("expo-crypto", () => ({ randomUUID: mocks.uuid }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/tab-header", () => ({
  TabHeader: "TabHeader",
  useTabHeaderLayout: () => ({ headerHeight: 96, onHeaderLayout: () => {} }),
}));
vi.mock("@/components/brand-wordmark", () => ({
  BrandWordmark: "BrandWordmark",
}));
vi.mock("@/components/account-header-button", () => ({
  AccountHeaderActions: "AccountHeaderActions",
}));
vi.mock("@/components/ui/ios-time-picker", () => ({
  formatTime12: () => "9 am",
}));
vi.mock("@/constants/theme", () => ({
  BottomTabInset: 0,
  MaxContentWidth: 600,
  Spacing: {},
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: { track: vi.fn().mockResolvedValue({ recorded: true }) },
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: {},
  invalidateSessionReads: mocks.invalidate,
}));
vi.mock("@/composition/app-variant", () => ({
  isProgressPhotosEnabled: () => true,
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    profile: { displayName: "Synthetic person", unitSystem: "metric" },
    session: {
      user: { id: mocks.owner },
      accessToken: `synthetic-token-${mocks.owner}-${mocks.tokenRevision}`,
    },
    openOnboarding: vi.fn(),
  }),
}));
vi.mock("@/features/workouts", () => ({
  useOptionalActiveWorkout: () => ({
    activeWorkout: mocks.activeWorkout,
    elapsedSeconds: 0,
  }),
  formatStopwatch: () => "00:00",
  createBlankWorkout: mocks.createBlank,
}));
vi.mock("@/features/health-steps/health-steps", () => ({
  readTodaySteps: vi.fn().mockResolvedValue({ kind: "off" }),
}));
vi.mock("@/features/log-meal/meal-photo-retention", () => ({
  clearAllMealPhotoRetries: vi.fn(),
}));
vi.mock("@/features/log-meal/meal-lifecycle-data", async (original) => ({
  ...(await original<
    typeof import("@/features/log-meal/meal-lifecycle-data")
  >()),
  copyFoodEntry: mocks.mealCopy,
  fetchFoodDateHistory: mocks.mealDateHistory,
}));
vi.mock("@/features/log-meal/first-meal-reminders", () => ({
  loadFirstMealReminders: vi.fn().mockResolvedValue(null),
  reconcileFirstMealReminders: mocks.reminders,
}));
vi.mock("@/features/log-meal/evening-catch-up-reminders", () => ({
  reconcileEveningReminders: vi.fn(),
}));
vi.mock("@/features/offline-cache/offline-cache-storage", () => ({
  loadCachedDashboard: mocks.cache,
  saveCachedDashboard: mocks.save,
}));
vi.mock("./dashboard-data", async (original) => ({
  ...(await original<typeof import("./dashboard-data")>()),
  fetchDailySummary: mocks.daily,
  fetchLatestWeight: mocks.weight,
  fetchEnergySummary: mocks.energy,
  fetchWorkoutCountForPeriod: mocks.workouts,
  fetchNutritionReviewSummaries: mocks.history,
}));

import { DashboardScreen } from "./dashboard-screen";

const summary = {
  date: "2026-10-04",
  entryCount: 3,
  caloriesKcal: 750,
  proteinG: 40,
  carbohydrateG: 80,
  fatG: 30,
};
const energy = {
  dailyTargetKcal: 2200,
  bmrKcal: 1600,
  tdeeKcal: 2200,
  complete: true,
};
const snapshot = {
  version: 1,
  userId: "synthetic-owner",
  cachedAt: "2026-10-04T09:54:00Z",
  localDate: "2026-10-04",
  reviewPeriod: "week",
  data: {
    caloriesToday: 750,
    macros: summary,
    latestWeightKg: 81.5,
    workoutsInReview: 2,
    energy,
    nutritionReview: null,
  },
} as CachedDashboardSnapshot;
const success = (value: unknown) => ({ value, error: null });
const serverFailure = {
  value: null,
  error: {
    kind: "http_error",
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Synthetic server failure",
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function render(): any {
  hooks.index = 0;
  const tree = DashboardScreen();
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node)
    ? node
    : find(
        node.type?.name === "RefreshNotice"
          ? node.type(node.props)
          : node.props?.children,
        predicate,
      );
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return text(
    node.type?.name === "RefreshNotice"
      ? node.type(node.props)
      : node.props?.children,
  );
}
const nutrition = (tree: any) =>
  find(
    tree,
    (node) => "caloriesToday" in (node.props ?? {}) && "summary" in node.props,
  );
const weight = (tree: any) =>
  find(tree, (node) => node.props?.label === "Current weight");
const retry = (tree: any) =>
  find(tree, (node) =>
    /(?:Refresh dashboard|Retry dashboard refresh)/.test(
      node.props?.accessibilityLabel ?? "",
    ),
  );
async function settle() {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}
let cleanupFocus: (() => void) | void;
function focus() {
  cleanupFocus = hooks.focus!();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T10:18:00Z"));
  hooks.slots = [];
  hooks.index = 0;
  hooks.effects = [];
  hooks.focus = null;
  mocks.appState = null;
  mocks.network = null;
  mocks.networkState = {
    isConnected: true,
    isInternetReachable: true,
    type: "WIFI",
  };
  mocks.daily.mockReset().mockResolvedValue(success(summary));
  mocks.weight.mockReset().mockResolvedValue(success({ weightKg: 81.5 }));
  mocks.energy.mockReset().mockResolvedValue(success(energy));
  mocks.workouts.mockReset().mockResolvedValue(success(2));
  mocks.history.mockReset().mockResolvedValue(success([]));
  mocks.mealDateHistory
    .mockReset()
    .mockResolvedValue({ entries: [], message: null });
  mocks.mealCopy.mockReset().mockResolvedValue({ ok: true });
  mocks.reminders.mockReset().mockResolvedValue(undefined);
  mocks.secureRead.mockReset().mockResolvedValue(null);
  mocks.secureWrite.mockReset().mockResolvedValue(undefined);
  mocks.secureDelete.mockReset().mockResolvedValue(undefined);
  mocks.cache.mockReset().mockResolvedValue(snapshot);
  mocks.save.mockReset().mockResolvedValue(true);
  mocks.invalidate.mockReset();
  mocks.networkQuery
    .mockReset()
    .mockImplementation(async () => mocks.networkState);
  mocks.appRemove.mockReset();
  mocks.networkRemove.mockReset();
  mocks.owner = "synthetic-owner";
  mocks.fontScale = 1;
  mocks.tokenRevision = 0;
  mocks.activeWorkout = null;
  mocks.createBlank
    .mockReset()
    .mockResolvedValue({ ok: true, workout: { id: "one-time-session" } });
  mocks.push.mockReset();
  mocks.alert.mockReset();
  let operation = 0;
  mocks.uuid.mockReset().mockImplementation(() => `operation-${++operation}`);
  cleanupFocus = undefined;
});
afterEach(() => {
  cleanupFocus?.();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const workoutAction = (tree: any) =>
  find(tree, (node) =>
    /^(Start workout|Resume workout)$/.test(
      node.props?.accessibilityLabel ?? "",
    ),
  );

describe("Home one-time workout shortcut", () => {
  it("creates one one-time session despite concurrent taps and opens its exact ID", async () => {
    const pending = deferred<any>();
    mocks.createBlank.mockReturnValue(pending.promise);
    const action = workoutAction(render());
    action.props.onPress();
    action.props.onPress();
    expect(mocks.createBlank).toHaveBeenCalledTimes(1);
    expect(mocks.createBlank).toHaveBeenCalledWith(
      "One-time Workout",
      "operation-1",
    );
    expect(workoutAction(render()).props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(mocks.push).not.toHaveBeenCalled();
    pending.resolve({ ok: true, workout: { id: "created-session" } });
    await settle();
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: "/log-workout",
      params: { workoutId: "created-session" },
    });
  });

  it.each(["failure", "throw"])(
    "retains the operation on %s for a safe retry even after a token refresh",
    async (kind) => {
      if (kind === "throw")
        mocks.createBlank.mockRejectedValueOnce(new Error("lost response"));
      else
        mocks.createBlank.mockResolvedValueOnce({
          ok: false,
          message: "Network unavailable",
        });
      workoutAction(render()).props.onPress();
      await settle();
      expect(mocks.push).not.toHaveBeenCalled();
      expect(mocks.alert).toHaveBeenCalled();
      expect(workoutAction(render()).props.disabled).toBe(false);
      mocks.tokenRevision += 1;
      workoutAction(render()).props.onPress();
      await settle();
      expect(mocks.createBlank.mock.calls[0][1]).toBe(
        mocks.createBlank.mock.calls[1][1],
      );
      expect(mocks.push).toHaveBeenCalledTimes(1);
    },
  );

  it("ignores a late result after account switch and uses a new operation for the new account", async () => {
    const pending = deferred<any>();
    mocks.createBlank.mockReturnValueOnce(pending.promise);
    workoutAction(render()).props.onPress();
    mocks.owner = "second-owner";
    render();
    pending.resolve({ ok: true, workout: { id: "old-owner-session" } });
    await settle();
    expect(mocks.push).not.toHaveBeenCalled();
    workoutAction(render()).props.onPress();
    await settle();
    expect(mocks.createBlank.mock.calls[1][1]).not.toBe(
      mocks.createBlank.mock.calls[0][1],
    );
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it("resumes the active session without creating another workout", async () => {
    mocks.activeWorkout = { id: "active-session" };
    const action = workoutAction(render());
    expect(action.props.accessibilityLabel).toBe("Resume workout");
    action.props.onPress();
    await settle();
    expect(mocks.createBlank).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith(
      "/log-workout?workoutId=active-session",
    );
  });
});

describe("dashboard cached display and refresh status", () => {
  it("keeps one populated nutrition summary and the quick meal action", async () => {
    render();
    focus();
    await settle();
    const tree = render();
    expect(
      find(tree, (node) => node.type?.name === "FirstMealDashboardCard"),
    ).toBeFalsy();
    expect(nutrition(tree).props.caloriesToday).toBe(750);
    expect(mocks.mealCopy).not.toHaveBeenCalled();
    expect(text(tree)).toContain("First meal saved! ✨");
    expect(
      find(tree, (node) => node.props?.accessibilityLabel === "Log a meal"),
    ).not.toBeNull();
  });

  it("retains first-meal setup and reminders for an empty day", async () => {
    mocks.cache.mockResolvedValue(null);
    mocks.daily.mockResolvedValue(
      success({ ...summary, entryCount: 0, caloriesKcal: 0 }),
    );
    render();
    focus();
    await settle();
    const tree = render();
    const firstMeal = find(
      tree,
      (node) => node.type?.name === "FirstMealDashboardCard",
    );
    expect(firstMeal).not.toBeNull();
    const card = firstMeal.type(firstMeal.props);
    expect(text(card)).toContain("Start with your first meal");
    expect(text(card)).not.toContain("Copy to Today");
    expect(text(card)).toContain("Log a meal");
    expect(
      find(
        card,
        (node) => node.props?.accessibilityLabel === "Set reminder in settings",
      ),
    ).not.toBeNull();
  });

  it("suggests the first meal from the complete previous local day, including beyond five recent entries", async () => {
    vi.setSystemTime(new Date(2026, 9, 1, 0, 30));
    mocks.cache.mockResolvedValue(null);
    mocks.daily.mockResolvedValue(
      success({ ...summary, entryCount: 0, caloriesKcal: 0 }),
    );
    mocks.uuid.mockReturnValue("00000000-0000-4000-8000-000000000123");
    const entries = Array.from({ length: 9 }, (_, index) => ({
      id: `synthetic-meal-${index}`,
      name: index === 8 ? "Synthetic breakfast" : "Synthetic later meal",
      consumedAt: new Date(2026, 8, 30, 20 - index * 1.5).toISOString(),
      caloriesKcal: 350,
      proteinG: 15,
    }));
    mocks.mealDateHistory.mockResolvedValue({ entries, message: null });
    render();
    focus();
    await settle();
    expect(mocks.mealDateHistory).toHaveBeenCalledWith("2026-09-30");
    const firstMeal = find(
      render(),
      (node) => node.type?.name === "FirstMealDashboardCard",
    );
    expect(firstMeal.props.yesterdayFirstMeal).toBe(entries[8]);
    const card = firstMeal.type(firstMeal.props);
    expect(text(card)).toContain("Synthetic breakfast");
    expect(text(card)).not.toContain("Synthetic later meal");
    const copyButton = find(
      card,
      (node) =>
        node.props?.accessibilityLabel === "Copy Synthetic breakfast to today",
    );
    expect(copyButton).not.toBeNull();
    copyButton.props.onPress();
    await settle();
    expect(mocks.mealCopy).toHaveBeenCalledWith(entries[8], false, {
      expectedUserId: mocks.owner,
      payload: expect.objectContaining({
        name: entries[8].name,
        clientOperationId: expect.any(String),
      }),
    });
  });

  it("clears the prior day's first-meal suggestion during a local-day rollover and failed read", async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 10));
    mocks.cache.mockResolvedValue(null);
    mocks.daily.mockResolvedValue(
      success({ ...summary, entryCount: 0, caloriesKcal: 0 }),
    );
    mocks.mealDateHistory.mockResolvedValue({
      entries: [
        {
          id: "synthetic-breakfast",
          name: "Synthetic breakfast",
          consumedAt: new Date(2026, 9, 3, 8).toISOString(),
        },
      ],
      message: null,
    });
    render();
    focus();
    await settle();
    const firstMeal = (tree: any) =>
      find(tree, (node) => node.type?.name === "FirstMealDashboardCard");
    expect(firstMeal(render()).props.yesterdayFirstMeal?.name).toBe(
      "Synthetic breakfast",
    );
    const pending = deferred<any>();
    mocks.mealDateHistory.mockReturnValueOnce(pending.promise);
    vi.setSystemTime(new Date(2026, 9, 5, 0, 30));
    mocks.appState!("background");
    mocks.appState!("active");
    await settle();
    expect(mocks.mealDateHistory).toHaveBeenLastCalledWith("2026-10-04");
    expect(firstMeal(render()).props.yesterdayFirstMeal).toBeNull();
    pending.resolve({ entries: [], message: "Synthetic read failure" });
    await settle();
    const cardNode = firstMeal(render());
    expect(cardNode.props.yesterdayFirstMeal).toBeNull();
    const card = cardNode.type(cardNode.props);
    expect(text(card)).not.toContain("Copy to Today");
    expect(text(card)).toContain("Log a meal");
  });

  it("adapts mounted nutrition to a font-scale increase and decrease while retaining totals", async () => {
    render();
    focus();
    await settle();
    const defaultCard = nutrition(render());
    const normal = defaultCard.type(defaultCard.props);
    const macroRow = (tree: any) =>
      find(
        tree,
        (node) =>
          Array.isArray(node.props?.children) &&
          node.props.children.some(
            (child: any) => child?.type?.name === "MacroBar",
          ),
      );
    const layout = (node: any) =>
      Object.assign({}, ...node.props.style.filter(Boolean));
    expect(layout(macroRow(normal)).flexDirection).toBe("row");
    mocks.fontScale = 3.571;
    const enlargedCard = nutrition(render());
    expect(enlargedCard.props.caloriesToday).toBe(
      defaultCard.props.caloriesToday,
    );
    const enlarged = enlargedCard.type(enlargedCard.props);
    expect(layout(macroRow(enlarged)).flexDirection).toBe("column");
    expect(text(enlarged)).toContain("750");
    mocks.fontScale = 1;
    const restoredCard = nutrition(render());
    expect(
      layout(macroRow(restoredCard.type(restoredCard.props))).flexDirection,
    ).toBe("row");
    expect(mocks.daily).toHaveBeenCalledTimes(1);
  });

  it("places More nutrients beside the Meals navigation control and resets the card scope", async () => {
    render();
    focus();
    await settle();
    let card = nutrition(render());
    const priorKey = card.key;
    const tree = card.type(card.props);
    const panel = find(tree, (node) => node.type?.name === "DailyNutrients");
    const mealsButton = find(
      tree,
      (node) => node.props?.accessibilityLabel === "View Meals Hub",
    );
    expect(panel.props.summary).toEqual(summary);
    expect(panel.props.dailyTargetKcal).toBe(2200);
    expect(
      find(mealsButton, (node) => node.type?.name === "DailyNutrients"),
    ).toBeFalsy();
    mealsButton.props.onPress();
    expect(mocks.push).toHaveBeenLastCalledWith("/meals");
    mocks.owner = "other-owner";
    card = nutrition(render());
    expect(card.key).not.toBe(priorKey);
    expect(card.props.summary).toBeNull();
  });

  it("shows cached numbers immediately without claiming offline before the live read settles", async () => {
    const pending = deferred<any>();
    mocks.daily.mockReturnValueOnce(pending.promise);
    render();
    focus();
    await settle();
    const tree = render();
    expect(nutrition(tree).props.caloriesToday).toBe(750);
    expect(weight(tree).props.value).toContain("81.5");
    expect(text(tree)).not.toMatch(
      /offline|could not be refreshed|couldn.t update/i,
    );
    pending.resolve(success({ ...summary, caloriesKcal: 1400 }));
    await settle();
    expect(nutrition(render()).props.caloriesToday).toBe(1400);
  });

  it("describes a server failure without calling the whole dashboard offline", async () => {
    mocks.weight.mockResolvedValueOnce(serverFailure);
    mocks.daily.mockResolvedValueOnce(
      success({ ...summary, caloriesKcal: 1400 }),
    );
    render();
    focus();
    await settle();
    const tree = render();
    expect(nutrition(tree).props.caloriesToday).toBe(1400);
    expect(weight(tree).props.value).toContain("81.5");
    expect(text(tree)).not.toMatch(/offline/i);
    expect(text(tree)).toMatch(/couldn.t update|could not be refreshed/i);
    expect(
      find(
        tree,
        (node) =>
          node.props?.accessibilityLabel === "Couldn’t update Current weight",
      ),
    ).toBeTruthy();
    expect(
      find(
        tree,
        (node) =>
          node.props?.accessibilityLabel ===
          "Couldn’t update Today’s nutrition",
      ),
    ).toBeFalsy();
  });

  it("retains visible successful data when a later refresh fails", async () => {
    mocks.daily.mockResolvedValueOnce(
      success({ ...summary, caloriesKcal: 1400 }),
    );
    render();
    focus();
    await settle();
    mocks.daily.mockResolvedValueOnce(serverFailure);
    await vi.advanceTimersByTimeAsync(60_000);
    const tree = render();
    expect(nutrition(tree).props.caloriesToday).toBe(1400);
    expect(nutrition(tree).props.loading).toBe(false);
    expect(weight(tree).props.value).toContain("81.5");
  });

  it("invalidates session reads when the user retries a failed update", async () => {
    mocks.weight.mockResolvedValueOnce(serverFailure);
    render();
    focus();
    await settle();
    retry(render()).props.onPress();
    await settle();
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.weight).toHaveBeenCalledTimes(2);
  });

  it("refreshes on foreground resume while retaining the previous numbers", async () => {
    render();
    focus();
    await settle();
    const pending = deferred<any>();
    mocks.daily.mockReturnValueOnce(pending.promise);
    mocks.appState!("background");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.daily).toHaveBeenCalledTimes(1);
    mocks.appState!("active");
    await settle();
    const tree = render();
    expect(mocks.daily).toHaveBeenCalledTimes(2);
    expect(nutrition(tree).props.caloriesToday).toBe(750);
    expect(text(nutrition(tree).type(nutrition(tree).props))).toContain("750");
    pending.resolve(success({ ...summary, caloriesKcal: 1400 }));
    await settle();
    expect(nutrition(render()).props.caloriesToday).toBe(1400);
  });
  it("records a successful section timestamp even when no persistent snapshot exists", async () => {
    mocks.cache.mockResolvedValue(null);
    render();
    focus();
    await settle();
    mocks.weight.mockResolvedValueOnce(serverFailure);
    await vi.advanceTimersByTimeAsync(60_000);
    const tree = render();
    expect(weight(tree).props.value).toContain("81.5");
    expect(text(tree)).toMatch(/saved/i);
    const notice = find(
      tree,
      (node) =>
        node.type?.name === "RefreshNotice" &&
        node.props?.label === "Current weight",
    );
    expect(notice.props.status.savedAt).toBe("2026-10-04T10:18:00.000Z");
    expect(text(tree)).not.toMatch(/offline/i);
  });

  it("uses neutral failure wording when the connectivity state is unknown", async () => {
    mocks.networkState = {
      isConnected: false,
      isInternetReachable: false,
      type: "UNKNOWN",
    };
    mocks.weight.mockResolvedValueOnce(serverFailure);
    render();
    focus();
    await settle();
    expect(text(render())).not.toMatch(/offline/i);
    expect(text(render())).toMatch(/couldn.t update|could not be refreshed/i);
  });

  it("revalidates immediately when confirmed connectivity returns", async () => {
    mocks.networkState = {
      isConnected: false,
      isInternetReachable: false,
      type: "NONE",
    };
    mocks.daily.mockResolvedValueOnce(serverFailure);
    render();
    focus();
    await settle();
    expect(text(render())).toMatch(/you.re offline/i);
    expect(mocks.daily).toHaveBeenCalledTimes(1);
    mocks.daily.mockResolvedValueOnce(
      success({ ...summary, caloriesKcal: 1400 }),
    );
    mocks.network!({
      isConnected: true,
      isInternetReachable: true,
      type: "WIFI",
    });
    await settle();
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.daily).toHaveBeenCalledTimes(2);
    expect(nutrition(render()).props.caloriesToday).toBe(1400);
    expect(text(render())).not.toMatch(/offline|couldn.t update/i);
  });
  it("clears yesterday's nutrition while today's read is pending and when it fails", async () => {
    render();
    focus();
    await settle();
    mocks.cache.mockResolvedValue(null);
    const pending = deferred<any>();
    mocks.daily.mockReturnValueOnce(pending.promise);
    vi.setSystemTime(new Date("2026-10-05T10:18:00Z"));
    mocks.appState!("background");
    mocks.appState!("active");
    await settle();
    expect(nutrition(render()).props.caloriesToday).toBeNull();
    pending.resolve(serverFailure);
    await settle();
    expect(nutrition(render()).props.caloriesToday).toBeNull();
    expect(nutrition(render()).props.summary).toBeNull();
  });

  it("clears the old review when the selected period changes and the new review fails", async () => {
    render();
    focus();
    await settle();
    const review = (tree: any) =>
      find(tree, (node) => typeof node.props?.onChangePeriod === "function");
    expect(review(render()).props.workouts).toBe(2);
    const countPending = deferred<any>();
    const historyPending = deferred<any>();
    mocks.cache.mockResolvedValue(null);
    mocks.workouts.mockReturnValueOnce(countPending.promise);
    mocks.history.mockReturnValueOnce(historyPending.promise);
    review(render()).props.onChangePeriod("month");
    cleanupFocus?.();
    render();
    focus();
    await settle();
    expect(review(render()).props.period).toBe("month");
    expect(review(render()).props.workouts).toBeNull();
    expect(review(render()).props.nutrition).toBeNull();
    countPending.resolve(serverFailure);
    historyPending.resolve(serverFailure);
    await settle();
    expect(review(render()).props.workouts).toBeNull();
    expect(review(render()).props.nutrition).toBeNull();
    expect(nutrition(render()).props.caloriesToday).toBe(750);
  });

  it("rejects a late previous-account result after switching accounts", async () => {
    const pending = deferred<any>();
    mocks.daily.mockReturnValueOnce(pending.promise);
    render();
    focus();
    await settle();
    expect(nutrition(render()).props.caloriesToday).toBe(750);
    mocks.owner = "second-owner";
    mocks.cache.mockResolvedValue(null);
    cleanupFocus?.();
    render();
    render();
    pending.resolve(success({ ...summary, caloriesKcal: 9999 }));
    await settle();
    expect(nutrition(render()).props.caloriesToday).toBeNull();
    mocks.daily.mockResolvedValueOnce(
      success({ ...summary, caloriesKcal: 350 }),
    );
    focus();
    await settle();
    expect(nutrition(render()).props.caloriesToday).toBe(350);
  });

  it("removes focus listeners and stops scheduled work after leaving Home", async () => {
    render();
    focus();
    await settle();
    cleanupFocus?.();
    cleanupFocus = undefined;
    expect(mocks.appRemove).toHaveBeenCalledTimes(1);
    expect(mocks.networkRemove).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.daily).toHaveBeenCalledTimes(1);
    mocks.network!({ isConnected: false, type: "NONE" });
    mocks.network!({ isConnected: true, type: "WIFI" });
    await settle();
    expect(mocks.daily).toHaveBeenCalledTimes(1);
  });
  it("retries when internet reachability returns on a still-connected WiFi network", async () => {
    mocks.networkState = {
      isConnected: true,
      isInternetReachable: false,
      type: "WIFI",
    };
    mocks.daily.mockResolvedValueOnce(serverFailure);
    render();
    focus();
    await settle();
    expect(text(render())).not.toMatch(/offline/i);
    mocks.daily.mockResolvedValueOnce(
      success({ ...summary, caloriesKcal: 1400 }),
    );
    mocks.network!({
      isConnected: true,
      isInternetReachable: true,
      type: "WIFI",
    });
    await settle();
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.daily).toHaveBeenCalledTimes(2);
    expect(nutrition(render()).props.caloriesToday).toBe(1400);
  });

  it("does not replace a newer connectivity event with a delayed initial network sample", async () => {
    const initial = deferred<any>();
    mocks.networkQuery.mockReturnValueOnce(initial.promise);
    mocks.weight.mockResolvedValueOnce(serverFailure);
    render();
    focus();
    await settle();
    mocks.network!({
      isConnected: true,
      isInternetReachable: true,
      type: "WIFI",
    });
    initial.resolve({
      isConnected: false,
      isInternetReachable: false,
      type: "NONE",
    });
    await settle();
    expect(text(render())).not.toMatch(/offline/i);
    expect(text(render())).toMatch(/couldn.t update/i);
    expect(mocks.daily).toHaveBeenCalledTimes(1);
  });
  it.each(["UNKNOWN", undefined])(
    "continues polling after a successful backend read when connectivity type is %s",
    async (type) => {
      mocks.networkState = {
        isConnected: false,
        isInternetReachable: false,
        ...(type === undefined ? {} : { type }),
      };
      render();
      focus();
      await settle();
      expect(nutrition(render()).props.caloriesToday).toBe(750);
      mocks.weight.mockResolvedValueOnce(serverFailure);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.daily).toHaveBeenCalledTimes(2);
      expect(text(render())).not.toMatch(/offline/i);
      expect(text(render())).toMatch(/couldn.t update/i);
    },
  );
});

it("keeps the common account bar outside scrolling tab content", () => {
  const tree = render();
  const safeArea = find(tree, (node) => node.type === "SafeAreaView");
  const scroll = find(safeArea, (node) => node.type === "ScrollView");
  expect(safeArea.props.children[0].type).toBe("TabHeader");
  expect(scroll).toBeTruthy();
  expect(find(scroll, (node) => node.type === "TabHeader")).toBeFalsy();
});

function renderFirstMeal(node: any, state: any[]): any {
  const previous = {
    slots: hooks.slots,
    index: hooks.index,
    effects: hooks.effects,
  };
  hooks.slots = state;
  hooks.index = 0;
  hooks.effects = [];
  const tree = node.type(node.props);
  hooks.effects.splice(0).forEach((effect) => effect());
  Object.assign(hooks, previous);
  return tree;
}
async function setupRepeat() {
  mocks.uuid.mockReturnValue("00000000-0000-4000-8000-000000000123");
  mocks.cache.mockResolvedValue(null);
  mocks.daily.mockResolvedValue(
    success({ ...summary, entryCount: 0, caloriesKcal: 0 }),
  );
  mocks.mealDateHistory.mockResolvedValue({
    entries: [
      {
        id: "synthetic-breakfast",
        name: "Synthetic breakfast",
        consumedAt: new Date(2026, 9, 3, 8).toISOString(),
        caloriesKcal: 200,
      },
    ],
    message: null,
  });
  render();
  focus();
  await settle();
  const node = find(
    render(),
    (candidate) => candidate.type?.name === "FirstMealDashboardCard",
  );
  const state: any[] = [];
  const repeat = {
    node,
    state,
    card: () => renderFirstMeal(repeat.node, state),
  };
  return repeat;
}
const copyAction = (tree: any) =>
  find(
    tree,
    (node) =>
      node.props?.accessibilityLabel === "Copy Synthetic breakfast to today",
  );

describe("first-meal copy recovery", () => {
  it("refreshes a confirmed meal copy even when reminder cleanup fails", async () => {
    const repeat = await setupRepeat();
    repeat.card();
    await settle();
    mocks.daily.mockResolvedValue(success(summary));
    mocks.reminders.mockRejectedValueOnce(new Error("Keychain locked"));
    copyAction(repeat.card()).props.onPress();
    await settle();
    await settle();
    expect(mocks.mealCopy).toHaveBeenCalledTimes(1);
    expect(text(render())).toContain("First meal saved! ✨");
    expect(
      find(render(), (node) => node.type?.name === "FirstMealDashboardCard"),
    ).toBeFalsy();
  });
  it("guards rapid taps before a render and keeps acknowledgement after refreshed totals remove the card", async () => {
    const stored = new Map<string, string>();
    mocks.secureRead.mockImplementation(async (key) => stored.get(key) ?? null);
    mocks.secureWrite.mockImplementation(async (key, value) => {
      stored.set(key, value);
    });
    const repeat = await setupRepeat();
    mocks.daily.mockResolvedValue(success(summary));
    const button = copyAction(repeat.card());
    button.props.onPress();
    button.props.onPress();
    await settle();
    await settle();
    expect(mocks.secureWrite).toHaveBeenCalledTimes(2);
    expect(mocks.mealCopy).toHaveBeenCalledTimes(1);
    const tree = render();
    expect(
      find(tree, (node) => node.type?.name === "FirstMealDashboardCard"),
    ).toBeFalsy();
    expect(text(tree)).toContain("First meal saved! ✨");
  });

  it("hydrates a failed copy after remount without yesterday's source and retries only on a tap", async () => {
    const stored = new Map<string, string>();
    mocks.secureRead.mockImplementation(async (key) => stored.get(key) ?? null);
    mocks.secureWrite.mockImplementation(async (key, value) => {
      stored.set(key, value);
    });
    const repeat = await setupRepeat();
    mocks.mealCopy.mockResolvedValueOnce({
      ok: false,
      message: "Connection lost. Try again.",
    });
    copyAction(repeat.card()).props.onPress();
    await settle();
    expect(text(repeat.card())).toContain("Connection lost. Try again.");
    const firstPayload = mocks.mealCopy.mock.calls[0][2];
    repeat.node = {
      ...repeat.node,
      props: { ...repeat.node.props, yesterdayFirstMeal: null },
    };
    vi.setSystemTime(new Date("2026-10-04T10:28:00Z"));
    const remountedState: any[] = [];
    renderFirstMeal(repeat.node, remountedState);
    await settle();
    expect(mocks.mealCopy).toHaveBeenCalledTimes(1);
    const remounted = renderFirstMeal(repeat.node, remountedState);
    expect(text(remounted)).toContain("Synthetic breakfast");
    copyAction(remounted).props.onPress();
    await settle();
    expect(mocks.mealCopy.mock.calls[1][2]).toEqual(firstPayload);
    expect(mocks.secureWrite).toHaveBeenCalledTimes(2);
  });

  it("avoids another POST after confirmed success and remount with stale empty totals", async () => {
    const stored = new Map<string, string>();
    mocks.secureRead.mockImplementation(async (key) => stored.get(key) ?? null);
    mocks.secureWrite.mockImplementation(async (key, value) => {
      stored.set(key, value);
    });
    const repeat = await setupRepeat();
    copyAction(repeat.card()).props.onPress();
    await settle();
    await settle();
    expect(mocks.mealCopy).toHaveBeenCalledTimes(1);
    mocks.reminders.mockClear();
    copyAction(renderFirstMeal(repeat.node, [])).props.onPress();
    await settle();
    expect(mocks.mealCopy).toHaveBeenCalledTimes(1);
    expect(text(render())).toContain("First meal saved!");
    expect(mocks.reminders).toHaveBeenCalledWith("synthetic-owner", {
      todayLogged: true,
    });
    expect([...stored.values()][0]).not.toContain("breakfast");
  });

  it("offers recovery after a failed mount read with no history source and never posts automatically", async () => {
    const repeat = await setupRepeat();
    repeat.node = {
      ...repeat.node,
      props: { ...repeat.node.props, yesterdayFirstMeal: null },
    };
    mocks.secureRead.mockRejectedValueOnce(new Error("locked"));
    repeat.card();
    await settle();
    const recovery = find(
      repeat.card(),
      (node) => node.props?.accessibilityLabel === "Retry saved meal recovery",
    );
    expect(recovery).toBeTruthy();
    mocks.secureRead.mockResolvedValue(
      JSON.stringify({
        owner: mocks.owner,
        localDate: "2026-10-04",
        sourceEntryId: "retained-source",
        completed: false,
        payload: {
          name: "Retained breakfast",
          consumedAt: "2026-10-04T08:00:00.000Z",
          clientOperationId: "00000000-0000-4000-8000-000000000123",
          caloriesKcal: 200,
        },
      }),
    );
    recovery.props.onPress();
    await settle();
    expect(text(repeat.card())).toContain("Retained breakfast");
    expect(mocks.mealCopy).not.toHaveBeenCalled();
  });

  it("fails closed when pending storage cannot be read or written", async () => {
    const repeat = await setupRepeat();
    mocks.secureRead.mockRejectedValueOnce(new Error("locked"));
    copyAction(repeat.card()).props.onPress();
    await settle();
    expect(mocks.mealCopy).not.toHaveBeenCalled();
    expect(text(repeat.card())).toContain("Try again safely");
    mocks.secureWrite.mockRejectedValueOnce(new Error("full"));
    copyAction(repeat.card()).props.onPress();
    await settle();
    expect(mocks.mealCopy).not.toHaveBeenCalled();
  });

  it("does not dispatch an old-account operation after delayed storage hydration", async () => {
    const repeat = await setupRepeat();
    const pending = deferred<string | null>();
    mocks.secureRead.mockReturnValueOnce(pending.promise);
    copyAction(repeat.card()).props.onPress();
    await settle();
    mocks.owner = "second-synthetic-owner";
    render();
    pending.resolve(null);
    await settle();
    expect(mocks.mealCopy).not.toHaveBeenCalled();
    expect(text(render())).not.toContain("First meal saved!");
  });

  it.each(["account", "day"])(
    "ignores a late successful response after %s changes",
    async (change) => {
      const repeat = await setupRepeat();
      const pending = deferred<any>();
      mocks.mealCopy.mockReturnValueOnce(pending.promise);
      copyAction(repeat.card()).props.onPress();
      await settle();
      if (change === "account") {
        mocks.owner = "second-synthetic-owner";
        render();
      } else vi.setSystemTime(new Date(2026, 9, 5, 0, 1));
      pending.resolve({ ok: true });
      await settle();
      expect(text(render())).not.toContain("First meal saved!");
      expect(mocks.secureDelete).not.toHaveBeenCalled();
    },
  );
});
