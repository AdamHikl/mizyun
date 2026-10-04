import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodEntry } from "@mizyun/contracts";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  day: vi.fn(),
  owner: "user-a",
  version: "0:today:0",
  appState: null as ((state: string) => void) | null,
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
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
vi.mock("@/components/tab-header", () => ({ TabHeader: "TabHeader" }));
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
vi.mock("./evening-catch-up-reminders", () => ({
  reconcileEveningReminders: vi.fn(),
}));
vi.mock("./meal-lifecycle-data", async (original) => ({
  ...(await original<typeof import("./meal-lifecycle-data")>()),
  fetchFoodHistory: mocks.fetch,
  fetchFoodDateHistory: mocks.day,
}));

import { router } from "expo-router";
import { groupFoodEntriesByDay } from "./meal-lifecycle-data";

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
  hooks.slots = [];
  hooks.effects = [];
  hooks.index = 0;
  hooks.focus = null;
  mocks.fetch.mockReset();
  mocks.refresh.mockReset();
  mocks.day.mockReset();
  mocks.owner = "user-a";
  mocks.version = "0:today:0";
});

describe("meal tab read lifecycle", () => {
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

afterEach(() => vi.useRealTimers());
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
