import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodEntry } from "@mizyun/contracts";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  day: vi.fn(),
  copy: vi.fn().mockResolvedValue({ ok: true }),
  reminders: vi.fn().mockResolvedValue(undefined),
  eveningReminders: vi.fn(),
  owner: "user-a",
  visuals: true,
  version: "0:today:0",
  appState: null as ((state: string) => void) | null,
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  cleanups: new Map<number, () => void>(),
  focus: null as (() => void) | null,
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
  useEffect: (callback: () => void | (() => void), dependencies: any[]) => {
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
      hooks.effects.push(() => {
        hooks.cleanups.get(index)?.();
        const cleanup = callback();
        if (cleanup) hooks.cleanups.set(index, cleanup);
        else hooks.cleanups.delete(index);
      });
    }
  },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  AppState: {
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.appState = callback;
      return { remove: vi.fn() };
    },
  },
  Alert: { alert: vi.fn() },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  Stack: { Screen: "StackScreen" },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => void) => {
    hooks.focus = callback;
  },
}));
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
vi.mock("@/constants/theme", () => ({
  BottomTabInset: 0,
  MaxContentWidth: 600,
  Spacing: {},
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: { track: vi.fn() },
}));
vi.mock("@/composition/api-client", () => ({
  getSessionReadVersion: () => mocks.version,
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.owner }, accessToken: `token-${mocks.owner}` },
  }),
}));
vi.mock("./advanced-nutrition", () => ({
  useAdvancedNutritionCapability: () => ({
    enabled: false,
    refresh: mocks.refresh,
  }),
  fetchCurrentWeekSummaries: vi.fn(),
}));
vi.mock("./meal-visual-capability", () => ({
  useMealVisualCapability: () => ({ enabled: mocks.visuals, refresh: vi.fn() }),
}));
vi.mock("./evening-catch-up-reminders", () => ({
  reconcileEveningReminders: mocks.eveningReminders,
}));
vi.mock("./first-meal-reminders", () => ({
  reconcileFirstMealReminders: mocks.reminders,
}));
vi.mock("./meal-lifecycle-data", async (original) => ({
  ...(await original<typeof import("./meal-lifecycle-data")>()),
  fetchFoodHistory: mocks.fetch,
  fetchFoodDateHistory: mocks.day,
  copyFoodEntry: mocks.copy,
}));

import { router } from "expo-router";
import {
  groupFoodEntriesByDay,
  type FoodHistoryResult,
} from "./meal-lifecycle-data";

import { MealListScreen } from "./meal-list-screen";

const entry = (id: string): FoodEntry => ({
  id,
  userId: "user-a",
  name: "Synthetic oats",
  caloriesKcal: 300,
  proteinG: 10,
  carbohydrateG: 40,
  fatG: 10,
  fibreG: null,
  saturatedFatG: null,
  totalSugarsG: null,
  sodiumMg: null,
  cholesterolMg: null,
  consumedAt: "2026-10-02T10:00:00Z",
  createdAt: "2026-10-02T10:00:00Z",
  updatedAt: "2026-10-02T10:00:00Z",
  source: "manual",
  confidence: null,
  confirmedByUser: true,
  details: {},
});
const response = (entries: FoodEntry[], nextCursor: string | null = null) => ({
  groups: groupFoodEntriesByDay(entries),
  entries,
  nextCursor,
  message: null,
});
function render(): any {
  hooks.index = 0;
  const tree = MealListScreen();
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const history = () =>
  hooks.slots.find(
    (value) =>
      value && Array.isArray(value.entries) && Array.isArray(value.groups),
  );
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  mocks.visuals = true;
  hooks.cleanups.forEach((cleanup) => cleanup());
  hooks.cleanups.clear();
  hooks.slots = [];
  hooks.effects = [];
  hooks.index = 0;
  hooks.focus = null;
  mocks.fetch.mockReset();
  mocks.refresh.mockReset();
  mocks.day.mockReset();
  mocks.copy.mockReset().mockResolvedValue({ ok: true });
  mocks.reminders.mockReset().mockResolvedValue(undefined);
  mocks.eveningReminders.mockReset();
  mocks.owner = "user-a";
  mocks.version = "0:today:0";
});

describe("meal tab read lifecycle", () => {
  it("displays saved evening meals without cancelling reminders from stale history", async () => {
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const meal = {
      ...entry("saved-evening"),
      consumedAt: `${localDate}T19:00:00`,
    };
    mocks.fetch.mockResolvedValue({
      ...response([meal]),
      savedAt: now.getTime() - 60_000,
    });
    render();
    hooks.focus!();
    await settle();
    render();
    expect(history().entries).toHaveLength(1);
    expect(mocks.eveningReminders).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue(response([meal]));
    mocks.version = "fresh-version";
    hooks.focus!();
    await settle();
    expect(mocks.eveningReminders).toHaveBeenCalledWith("user-a", {
      hasMealAfter6Pm: true,
    });
  });
  it("suppresses the first-meal reminder after Copy to Today from history", async () => {
    mocks.fetch.mockResolvedValue(response([entry("copy-source")]));
    mocks.refresh.mockResolvedValue(false);
    render();
    hooks.focus!();
    await settle();
    const card = find(
      render(),
      (node) => typeof node.props?.onCopy === "function",
    );
    card.props.onCopy();
    await settle();
    expect(mocks.copy).toHaveBeenCalledWith(entry("copy-source"), false, {
      expectedUserId: "user-a",
    });
    expect(mocks.reminders).toHaveBeenCalledWith("user-a", {
      todayLogged: true,
    });
  });
  it("does not dispatch a history copy after an account switch during entitlement refresh", async () => {
    mocks.fetch.mockResolvedValue(response([entry("copy-source")]));
    let resolve!: (enabled: boolean) => void;
    mocks.refresh.mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    render();
    hooks.focus!();
    await settle();
    const card = find(
      render(),
      (node) => typeof node.props?.onCopy === "function",
    );
    card.props.onCopy();
    await settle();
    mocks.owner = "user-b";
    render();
    resolve(false);
    await settle();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.reminders).not.toHaveBeenCalled();
  });
  it("revalidates the focused tab after returning from the background", async () => {
    mocks.fetch.mockResolvedValueOnce(response([entry("before")]));
    render();
    hooks.focus!();
    await settle();
    mocks.version = "1:today:0";
    mocks.fetch.mockResolvedValueOnce(response([entry("after")]));
    mocks.appState!("background");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    mocks.appState!("active");
    await settle();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(history().entries[0].id).toBe("after");
  });

  it("retains loaded older pages when revisiting a fresh tab", async () => {
    mocks.fetch.mockResolvedValueOnce(response([entry("first")], "older"));
    render();
    hooks.focus!();
    await settle();
    mocks.fetch.mockResolvedValueOnce(response([entry("older")]));
    const tree = render();
    find(
      tree,
      (node) => node.props?.accessibilityLabel === "Load older meals",
    ).props.onPress();
    await settle();
    expect(history().entries).toHaveLength(2);
    render();
    hooks.focus!();
    await settle();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(history().entries).toHaveLength(2);
    expect(history().loading).toBe(false);
  });

  it("refreshes after a write invalidates reads and retains data during that request", async () => {
    mocks.fetch.mockResolvedValueOnce(response([entry("first")]));
    render();
    hooks.focus!();
    await settle();
    mocks.version = "1:today:0";
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render();
    hooks.focus!();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(history().loading).toBe(false);
    expect(history().entries[0].id).toBe("first");
    resolve(response([entry("new")]));
    await settle();
    expect(history().entries[0].id).toBe("new");
  });

  it("discards a delayed read when another account becomes current", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render();
    hooks.focus!();
    mocks.owner = "user-b";
    render();
    resolve(response([entry("private-a")]));
    await settle();
    expect(history().entries).toEqual([]);
  });
});

afterEach(() => {
  hooks.cleanups.forEach((cleanup) => cleanup());
  hooks.cleanups.clear();
  vi.useRealTimers();
});
it("refreshes due meals each focused minute, retains older pages and stops polling on blur", async () => {
  vi.useFakeTimers();
  mocks.fetch.mockResolvedValueOnce(response([entry("first")], "older"));
  render();
  const cleanup = hooks.focus!() as unknown as () => void;
  await settle();
  const older = { ...entry("older"), consumedAt: "2026-10-01T10:00:00Z" };
  mocks.fetch.mockResolvedValueOnce(response([older], "even-older"));
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Load older meals",
  ).props.onPress();
  await settle();
  let resolve!: (value: ReturnType<typeof response>) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  expect(history().loading).toBe(false);
  expect(history().entries).toHaveLength(2);
  resolve(response([entry("automatic")]));
  await settle();
  expect(history().entries.map((value: FoodEntry) => value.id)).toEqual([
    "automatic",
    "older",
  ]);
  expect(history().nextCursor).toBe("even-older");
  cleanup();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});

it("retains older paginated rows tied on consumed-at time using cursor id ordering", async () => {
  vi.useFakeTimers();
  mocks.fetch.mockResolvedValueOnce(response([entry("z")], "older"));
  render();
  const cleanup = hooks.focus!() as unknown as () => void;
  await settle();
  mocks.fetch.mockResolvedValueOnce(response([entry("a")], "even-older"));
  find(
    render(),
    (node) => node.props?.accessibilityLabel === "Load older meals",
  ).props.onPress();
  await settle();
  mocks.fetch.mockResolvedValueOnce(
    response([entry("z"), entry("y")], "first-page-cursor"),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  await settle();
  expect(history().entries.map((value: FoodEntry) => value.id)).toEqual([
    "z",
    "y",
    "a",
  ]);
  expect(history().nextCursor).toBe("even-older");
  cleanup();
});

it("skips periodic refresh while a pagination read is pending and blocks a second page request", async () => {
  vi.useFakeTimers();
  mocks.fetch.mockResolvedValueOnce(response([entry("first")], "older"));
  render();
  const cleanup = hooks.focus!() as unknown as () => void;
  await settle();
  let resolve!: (value: ReturnType<typeof response>) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const button = find(
    render(),
    (node) => node.props?.accessibilityLabel === "Load older meals",
  );
  button.props.onPress();
  await settle();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(history().loadingMore).toBe(true);
  button.props.onPress();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  resolve(
    response(
      [{ ...entry("older"), consumedAt: "2026-10-01T10:00:00Z" }],
      "even-older",
    ),
  );
  await settle();
  expect(history().nextCursor).toBe("even-older");
  cleanup();
});

it("adds on the heading date and refreshes the older day while retaining paginated history", async () => {
  mocks.fetch.mockResolvedValueOnce(response([entry("newest")], "older"));
  render();
  hooks.focus!();
  await settle();
  const old = { ...entry("older"), consumedAt: "2026-03-29T10:00:00Z" };
  mocks.fetch.mockResolvedValueOnce(response([old], "remaining"));
  find(
    render(),
    (n) => n.props?.accessibilityLabel === "Load older meals",
  ).props.onPress();
  await settle();
  const date = groupFoodEntriesByDay([old])[0].date;
  find(render(), (n) => n.props?.testID === `add-meal-${date}`).props.onPress();
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/log-meal",
    params: { date },
  });
  const added = { ...old, id: "added", caloriesKcal: 200 };
  mocks.fetch.mockResolvedValueOnce(response([entry("newest")], "older"));
  mocks.day.mockResolvedValueOnce(response([old, added]));
  mocks.version = "1:today:0";
  render();
  hooks.focus!();
  await settle();
  expect(mocks.day).toHaveBeenCalledWith(date);
  expect(history().entries.map((e: FoodEntry) => e.id)).toContain("added");
  expect(history().nextCursor).toBe("remaining");
  expect(
    history().groups.find((g: any) => g.date === date).summary.caloriesKcal,
  ).toBe(500);
});

it("retains the selected day when an earlier history request completes after the add button", async () => {
  mocks.fetch.mockResolvedValueOnce(response([entry("first")]));
  render();
  hooks.focus!();
  await settle();
  let resolve!: (v: ReturnType<typeof response>) => void;
  mocks.version = "1:today:0";
  mocks.fetch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render();
  hooks.focus!();
  const date = groupFoodEntriesByDay([entry("first")])[0].date;
  find(render(), (n) => n.props?.testID === `add-meal-${date}`).props.onPress();
  resolve(response([entry("first")]));
  await settle();
  mocks.fetch.mockResolvedValueOnce(response([entry("first")]));
  mocks.day.mockResolvedValueOnce(response([entry("first"), entry("added")]));
  render();
  hooks.focus!();
  await settle();
  expect(mocks.day).toHaveBeenCalledWith(date);
  expect(history().entries.map((e: FoodEntry) => e.id)).toContain("added");
});

it("keeps the common account bar outside scrolling tab content", () => {
  const tree = render();
  const safeArea = find(tree, (node) => node.type === "SafeAreaView");
  const scroll = find(safeArea, (node) => node.type === "ScrollView");
  expect(safeArea.props.children[0].type).toBe("TabHeader");
  expect(scroll).toBeTruthy();
  expect(find(scroll, (node) => node.type === "TabHeader")).toBeFalsy();
});

function textContent(node: any): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  return textContent(node.props?.children);
}

it("keeps grouping selection and cancellation usable from the day actions", async () => {
  mocks.fetch.mockResolvedValueOnce(response([entry("a"), entry("b")]));
  render();
  hooks.focus!();
  await settle();
  const groupButton = find(render(), (node) =>
    node.props?.accessibilityLabel?.startsWith("Group meals on "),
  );
  expect(textContent(groupButton)).toBe("Group meals");
  groupButton.props.onPress();
  let tree = render();
  const confirm = () =>
    find(
      tree,
      (node) =>
        node.props?.accessibilityLabel === "Confirm grouping selected meals",
    );
  expect(confirm().props.disabled).toBe(true);
  const selection = find(
    tree,
    (node) =>
      node.props?.isGrouping &&
      typeof node.props?.onToggleSelect === "function",
  );
  selection.props.onToggleSelect();
  tree = render();
  expect(confirm().props.disabled).toBe(true);
  find(
    tree,
    (node) =>
      node.props?.isGrouping &&
      typeof node.props?.onToggleSelect === "function" &&
      !node.props?.isSelected,
  ).props.onToggleSelect();
  tree = render();
  expect(confirm().props.disabled).toBe(false);
  find(
    tree,
    (node) => node.props?.accessibilityLabel === "Cancel grouping meals",
  ).props.onPress();
  tree = render();
  expect(
    find(tree, (node) =>
      node.props?.accessibilityLabel?.startsWith("Group meals on "),
    ),
  ).toBeTruthy();
  expect(
    find(tree, (node) => node.props?.testID === "add-meal-2026-10-02"),
  ).toBeTruthy();
});

it("qualifies partial totals and does not invent missing nutrients", async () => {
  const missing = {
    ...entry("unknown"),
    caloriesKcal: null,
    proteinG: null,
    carbohydrateG: null,
    fatG: null,
  };
  const result = response([missing]);
  mocks.fetch.mockResolvedValueOnce({
    ...result,
    groups: result.groups.map((group) => ({ ...group, isPartial: true })),
  });
  render();
  hooks.focus!();
  await settle();
  const tree = render();
  expect(textContent(tree)).toContain("Partial totals");
  expect(textContent(tree)).toContain("No nutrition totals");
  expect(textContent(tree)).not.toContain("0g protein");
  expect(
    find(tree, (node) =>
      node.props?.accessibilityLabel?.startsWith("Group meals on "),
    ),
  ).toBeFalsy();
});

vi.mock("./meal-visual", () => ({
  MealVisual: "MealVisual",
}));

it("passes screen-owned Pro authority to the meal row and its visual", async () => {
  mocks.fetch.mockResolvedValue(response([entry("visual-meal")]));
  render();
  hooks.focus!();
  await settle();
  const row = find(
    render(),
    (node) =>
      typeof node.type === "function" && node.type.name === "MealEntryRow",
  );
  expect(row.props.mealVisualsEnabled).toBe(true);
  expect(
    find(row.type(row.props), (node) => node.type === "MealVisual").props
      .enabled,
  ).toBe(true);
  mocks.visuals = false;
  const downgraded = find(
    render(),
    (node) =>
      typeof node.type === "function" && node.type.name === "MealEntryRow",
  );
  expect(
    find(
      downgraded.type(downgraded.props),
      (node) => node.type === "MealVisual",
    ).props.enabled,
  ).toBe(false);
});

describe("older meal history search", () => {
  const searchState = () =>
    hooks.slots.find((value) => value && typeof value.query === "string");
  const changeSearch = (query: string) => {
    find(
      render(),
      (node) => node.props?.accessibilityLabel === "Search meal history",
    ).props.onChangeText(query);
    render();
  };
  const matchingPage = (
    start: number,
    count: number,
    cursor: string | null,
  ) => {
    const entries = Array.from({ length: count }, (_, index) =>
      entry(`oats-${String(start + index).padStart(4, "0")}`),
    );
    return {
      ...response(entries, cursor),
      cutoffDateIsPartial: cursor !== null,
      groups: groupFoodEntriesByDay(entries, new Date(), {
        cutoffDateIsPartial: cursor !== null,
      }),
    };
  };
  async function startSearch(
    result: FoodHistoryResult = matchingPage(0, 1, "next-match"),
  ) {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(response([entry("recent")]));
    render();
    hooks.focus!();
    await settle();
    mocks.fetch.mockResolvedValueOnce(result);
    changeSearch("oats");
    await vi.advanceTimersByTimeAsync(250);
    await settle();
  }
  const moreButton = () =>
    find(
      render(),
      (node) => node.props?.accessibilityLabel === "Load more matching meals",
    );

  it("refreshes matching meals after a successful copy without changing the query", async () => {
    await startSearch(matchingPage(0, 1, null));
    mocks.refresh.mockResolvedValue(false);
    mocks.fetch.mockResolvedValueOnce(response([entry("recent")]));
    mocks.fetch.mockResolvedValueOnce(matchingPage(0, 2, null));
    find(
      render(),
      (node) => typeof node.props?.onCopy === "function",
    ).props.onCopy();
    await settle();
    render();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(searchState().query).toBe("oats");
    expect(searchState().entries).toHaveLength(2);
    expect(mocks.fetch).toHaveBeenLastCalledWith({ search: "oats" });
  });

  it("labels matching totals and retains the split-day warning beyond 200 results", async () => {
    await startSearch(matchingPage(0, 200, "match-page-2"));
    expect(searchState().groups[0].isPartial).toBe(true);
    mocks.fetch.mockResolvedValueOnce(matchingPage(200, 200, "match-page-3"));
    moreButton().props.onPress();
    await settle();
    expect(mocks.fetch).toHaveBeenLastCalledWith({
      search: "oats",
      cursor: "match-page-2",
    });
    expect(searchState().entries).toHaveLength(400);
    expect(searchState().groups[0].isPartial).toBe(true);
    expect(textContent(render())).toContain("Partial matching-meal totals");
    mocks.fetch.mockResolvedValueOnce(matchingPage(400, 1, null));
    moreButton().props.onPress();
    await settle();
    expect(searchState().entries).toHaveLength(401);
    expect(searchState().groups[0].isPartial).toBe(false);
    expect(textContent(render())).toContain("Matching-meal totals");
    expect(textContent(render())).not.toContain("Partial matching-meal totals");
    expect(textContent(render())).toContain(
      "All matching meals loaded (401 total)",
    );
  });

  it("prevents two presses from requesting the same matching page", async () => {
    await startSearch();
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValue(new Promise((done) => (resolve = done)));
    const button = moreButton();
    button.props.onPress();
    button.props.onPress();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    resolve(response([entry("older-match")]));
    await settle();
    expect(searchState().entries).toHaveLength(2);
  });

  it("labels device-only filtered nutrition when the full-history search fails", async () => {
    await startSearch({
      ...matchingPage(0, 0, null),
      message: "Search is unavailable.",
    });
    const tree = render();
    expect(textContent(tree)).toContain(
      "Showing matches from meals already loaded on this device.",
    );
    expect(textContent(tree)).toContain("Matching-meal totals");
    expect(textContent(tree)).not.toContain("No meals match");
    expect(textContent(tree)).not.toContain("All matching meals loaded");
  });

  it("retains failed-page matches and cursor, offers retry, and does not claim all matches are loaded", async () => {
    await startSearch();
    mocks.fetch.mockResolvedValueOnce({
      ...response([]),
      message: "More matches could not be loaded.",
    });
    moreButton().props.onPress();
    await settle();
    expect(searchState().entries).toHaveLength(1);
    expect(searchState().nextCursor).toBe("next-match");
    const tree = render();
    expect(textContent(tree)).not.toContain("All matching meals loaded");
    mocks.fetch.mockResolvedValueOnce(response([entry("retried-match")]));
    find(
      tree,
      (node) =>
        node.props?.accessibilityLabel === "Retry loading more matching meals",
    ).props.onPress();
    await settle();
    expect(mocks.fetch).toHaveBeenLastCalledWith({
      search: "oats",
      cursor: "next-match",
    });
    expect(searchState().entries).toHaveLength(2);
    expect(searchState().error).toBeNull();
  });

  it("ignores the old page after switching oats to rice and back to oats", async () => {
    await startSearch();
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    moreButton().props.onPress();
    changeSearch("rice");
    mocks.fetch.mockResolvedValueOnce(response([entry("current-oats")]));
    changeSearch("oats");
    await vi.advanceTimersByTimeAsync(250);
    resolve(response([entry("stale-page")]));
    await settle();
    expect(searchState().entries.map((value: FoodEntry) => value.id)).toEqual([
      "current-oats",
    ]);
  });

  it("discards a delayed matching page after the account changes", async () => {
    await startSearch();
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    moreButton().props.onPress();
    mocks.owner = "user-b";
    render();
    render();
    resolve(response([entry("private-a")]));
    await settle();
    expect(searchState()).toBeUndefined();
    expect(history().entries).toEqual([]);
  });

  it("keeps the new-query page locked when an older request settles", async () => {
    await startSearch();
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValueOnce(new Promise((done) => (resolveOld = done)));
    moreButton().props.onPress();
    mocks.fetch.mockResolvedValueOnce(
      response([entry("new-query")], "new-page"),
    );
    changeSearch("rice");
    await vi.advanceTimersByTimeAsync(250);
    let resolveNew!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValueOnce(new Promise((done) => (resolveNew = done)));
    const newButton = moreButton();
    newButton.props.onPress();
    resolveOld(response([entry("old-query")]));
    await settle();
    newButton.props.onPress();
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
    resolveNew(response([entry("new-page")]));
    await settle();
    expect(searchState().entries.map((value: FoodEntry) => value.id)).toEqual([
      "new-query",
      "new-page",
    ]);
  });
});

vi.mock("./meal-photo-retention", () => ({
  removeMealPhotoRetry: vi.fn(),
  mealPhotoRetentionEnabled: () => false,
}));
