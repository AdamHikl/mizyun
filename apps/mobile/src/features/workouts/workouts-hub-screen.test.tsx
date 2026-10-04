import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessedWorkout, WorkoutsHubResult } from "./workouts-hub-data";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  createBlank: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  owner: "user-a",
  tokenVersion: 0,
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
  RefreshControl: "RefreshControl",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("expo-router", () => ({
  router: { push: mocks.push },
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
  invalidateSessionReads: vi.fn(),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: {
      user: { id: mocks.owner },
      accessToken: `token-${mocks.owner}-${mocks.tokenVersion}`,
    },
  }),
}));
vi.mock("@/features/community", () => ({
  ShareWorkoutModal: "ShareWorkoutModal",
  useCommunityProfile: () => ({ isEnrolled: false }),
}));
vi.mock("./exercise-library-modal", () => ({
  ExerciseLibraryModal: "ExerciseLibraryModal",
}));
vi.mock("./workout-editor-modal", () => ({
  WorkoutEditorModal: "WorkoutEditorModal",
}));
vi.mock("./exercise-progression-modal", () => ({
  ExerciseProgressionModal: "ExerciseProgressionModal",
}));
vi.mock("./active-workout-context", () => ({
  useOptionalActiveWorkout: () => null,
}));
vi.mock("./workouts-hub-data", () => ({
  fetchWorkoutsHubData: mocks.fetch,
  createBlankWorkout: mocks.createBlank,
  deleteWorkout: vi.fn(),
  startRoutineSession: vi.fn(),
}));

import { WorkoutsHubScreen } from "./workouts-hub-screen";

const workout = (id: string): ProcessedWorkout => ({
  workout: {
    id,
    userId: "user-a",
    name: "Synthetic routine",
    startedAt: "2026-10-02T10:00:00Z",
    completedAt: null,
    notes: null,
    source: "manual",
    details: {},
    createdAt: "2026-10-02T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
  },
  status: "planned",
  displayDate: "2026-10-02",
  plannedExercises: [],
  sets: [],
  completedSetCount: 0,
  totalVolumeKg: 0,
  exerciseSummaries: [],
  durationMinutes: null,
});
const response = (id: string): WorkoutsHubResult => ({
  activeAndPlanned: [workout(id)],
  completed: [],
  exercises: [],
  message: null,
});
function render(): any {
  hooks.index = 0;
  const tree = WorkoutsHubScreen();
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const hasLoader = (tree: any) =>
  !!find(tree, (node) => node.props?.children === "Loading workouts…");
const hasWorkout = (tree: any, id: string) =>
  !!find(tree, (node) => node.props?.item?.workout.id === id);
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  hooks.index = 0;
  hooks.focus = null;
  mocks.fetch.mockReset();
  mocks.createBlank.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.owner = "user-a";
  mocks.tokenVersion = 0;
  mocks.version = "0:today:0";
  mocks.appState = null;
});

describe("workouts tab read lifecycle", () => {
  it("reuses a loaded fresh tab without another fetch or loading message", async () => {
    mocks.fetch.mockResolvedValueOnce(response("first"));
    render();
    hooks.focus!();
    await settle();
    let tree = render();
    expect(hasWorkout(tree, "first")).toBe(true);
    expect(hasLoader(tree)).toBe(false);
    hooks.focus!();
    await settle();
    tree = render();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(hasWorkout(tree, "first")).toBe(true);
    expect(hasLoader(tree)).toBe(false);
  });

  it("reloads after invalidation while retaining the visible list", async () => {
    mocks.fetch.mockResolvedValueOnce(response("first"));
    render();
    hooks.focus!();
    await settle();
    mocks.version = "1:today:0";
    let resolve!: (value: WorkoutsHubResult) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render();
    hooks.focus!();
    const pendingTree = render();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(hasWorkout(pendingTree, "first")).toBe(true);
    expect(hasLoader(pendingTree)).toBe(false);
    resolve(response("updated"));
    await settle();
    expect(hasWorkout(render(), "updated")).toBe(true);
  });

  it("discards a delayed previous-account list after switching accounts", async () => {
    let resolve!: (value: WorkoutsHubResult) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render();
    hooks.focus!();
    mocks.owner = "user-b";
    render();
    resolve(response("private-a"));
    await settle();
    expect(hasWorkout(render(), "private-a")).toBe(false);
  });

  it("revalidates the visible tab on foreground resume", async () => {
    mocks.fetch.mockResolvedValueOnce(response("before"));
    render();
    hooks.focus!();
    await settle();
    mocks.version = "1:today:0";
    mocks.fetch.mockResolvedValueOnce(response("after"));
    mocks.appState!("background");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    mocks.appState!("active");
    await settle();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(hasWorkout(render(), "after")).toBe(true);
  });
});

const oneTimeAction = (tree: any) =>
  find(
    tree,
    (node) => node.props?.accessibilityLabel === "Start one-time workout",
  );

describe("one-time workout start", () => {
  it("starts a blank session once despite concurrent taps and opens the existing logger", async () => {
    let resolve!: (value: unknown) => void;
    mocks.createBlank.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const action = oneTimeAction(render());
    expect(action).toBeTruthy();
    const first = action.props.onPress();
    const second = action.props.onPress();
    expect(mocks.createBlank).toHaveBeenCalledTimes(1);
    resolve({ ok: true, workout: workout("session").workout });
    await Promise.all([first, second]);
    expect(mocks.createBlank.mock.calls[0][0]).toBe("One-time Workout");
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: "/log-workout",
      params: { workoutId: "session" },
    });
  });

  it("keeps the operation ID after an uncertain response so retry cannot create another session", async () => {
    mocks.createBlank
      .mockResolvedValueOnce({ ok: false, message: "Network unavailable" })
      .mockResolvedValueOnce({
        ok: true,
        workout: workout("replayed").workout,
      });
    await oneTimeAction(render()).props.onPress();
    await oneTimeAction(render()).props.onPress();
    expect(mocks.createBlank.mock.calls[0][1]).toBe(
      mocks.createBlank.mock.calls[1][1],
    );
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it("does not navigate with a late result after the account changes", async () => {
    let resolve!: (value: unknown) => void;
    mocks.createBlank.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = oneTimeAction(render()).props.onPress();
    mocks.owner = "user-b";
    render();
    resolve({ ok: true, workout: workout("old-session").workout });
    await pending;
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

it("retains the uncertain start operation across a token refresh for the same account", async () => {
  mocks.createBlank
    .mockResolvedValueOnce({ ok: false, message: "Response lost" })
    .mockResolvedValueOnce({
      ok: true,
      workout: workout("same-session").workout,
    });
  await oneTimeAction(render()).props.onPress();
  mocks.tokenVersion++;
  await oneTimeAction(render()).props.onPress();
  expect(mocks.createBlank.mock.calls[0][1]).toBe(
    mocks.createBlank.mock.calls[1][1],
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
