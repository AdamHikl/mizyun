import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedDashboardSnapshot } from "../offline-cache/offline-cache-storage";

const mocks = vi.hoisted(() => ({
  daily: vi.fn(),
  weight: vi.fn(),
  energy: vi.fn(),
  workouts: vi.fn(),
  history: vi.fn(),
  cache: vi.fn(),
  save: vi.fn(),
  invalidate: vi.fn(),
  networkQuery: vi.fn(),
  appRemove: vi.fn(),
  networkRemove: vi.fn(),
  owner: "synthetic-owner",
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
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: any) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
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
  router: { push: vi.fn() },
  useFocusEffect: (callback: typeof hooks.focus) => {
    hooks.focus = callback;
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/tab-header", () => ({ TabHeader: "TabHeader" }));
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
      accessToken: `synthetic-token-${mocks.owner}`,
    },
    openOnboarding: vi.fn(),
  }),
}));
vi.mock("@/features/workouts", () => ({
  useOptionalActiveWorkout: () => null,
  formatStopwatch: () => "00:00",
}));
vi.mock("@/features/health-steps/health-steps", () => ({
  readTodaySteps: vi.fn().mockResolvedValue({ kind: "off" }),
}));
vi.mock("@/features/log-meal/meal-lifecycle-data", () => ({
  copyFoodEntry: vi.fn(),
  fetchFoodHistory: vi.fn().mockResolvedValue({ entries: [] }),
}));
vi.mock("@/features/log-meal/first-meal-reminders", () => ({
  loadFirstMealReminders: vi.fn().mockResolvedValue(null),
  reconcileFirstMealReminders: vi.fn(),
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
  for (let i = 0; i < 12; i++) await Promise.resolve();
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
  mocks.cache.mockReset().mockResolvedValue(snapshot);
  mocks.save.mockReset().mockResolvedValue(true);
  mocks.invalidate.mockReset();
  mocks.networkQuery
    .mockReset()
    .mockImplementation(async () => mocks.networkState);
  mocks.appRemove.mockReset();
  mocks.networkRemove.mockReset();
  mocks.owner = "synthetic-owner";
  cleanupFocus = undefined;
});
afterEach(() => {
  cleanupFocus?.();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("dashboard cached display and refresh status", () => {
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
