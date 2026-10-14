import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessedWorkout, WorkoutsHubResult } from "./workouts-hub-data";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  peek: vi.fn(),
  apiRequest: vi.fn(),
  createBlank: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  owner: "user-a",
  tokenVersion: 0,
  activeWorkout: null as { id: string } | null,
  version: "0:today:0",
  appState: null as ((state: string) => void) | null,
  readListeners: new Set<(path: string) => void>(),
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
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? initial() : initial;
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
  invalidateSessionReads: vi.fn(),
  apiClient: {
    status: () => ({ configured: false, reason: "fixture" }),
    request: mocks.apiRequest,
  },
}));
vi.mock("@/composition/personal-read-events", () => ({
  subscribeSessionReadUpdates: (listener: (path: string) => void) => {
    mocks.readListeners.add(listener);
    return () => mocks.readListeners.delete(listener);
  },
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
  useOptionalActiveWorkout: () => ({ activeWorkout: mocks.activeWorkout }),
}));
vi.mock("./workouts-hub-data", () => ({
  fetchWorkoutsHubData: mocks.fetch,
  peekWorkoutsHubData: mocks.peek,
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
  mocks.activeWorkout = null;
  hooks.slots = [];
  hooks.effects = [];
  hooks.index = 0;
  hooks.focus = null;
  mocks.fetch.mockReset();
  mocks.peek.mockReset().mockReturnValue(null);
  mocks.apiRequest.mockReset();
  mocks.apiRequest.mockResolvedValue({
    ok: true,
    value: { runs: [], nextCursor: null },
  });
  mocks.createBlank.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.owner = "user-a";
  mocks.tokenVersion = 0;
  mocks.version = "0:today:0";
  mocks.appState = null;
  mocks.readListeners.clear();
});

describe("workouts tab read lifecycle", () => {
  it("renders warmed workouts before effects or promises settle and keeps them during live refresh", () => {
    mocks.peek.mockReturnValue(response("warm-first"));
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    const first = render();
    expect(hasWorkout(first, "warm-first")).toBe(true);
    expect(hasLoader(first)).toBe(false);
    hooks.focus!();
    expect(hasWorkout(render(), "warm-first")).toBe(true);
    expect(hasLoader(render())).toBe(false);
  });

  it("treats a conclusively empty warm snapshot as loaded on the first render", () => {
    mocks.peek.mockReturnValue({
      activeAndPlanned: [],
      completed: [],
      exercises: [],
      message: null,
    });
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    expect(hasLoader(render())).toBe(false);
  });
  it("uses startup data that arrives after an unfocused cold mount without waiting for live reads", () => {
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    expect(hasLoader(render())).toBe(true);
    mocks.peek.mockReturnValue(response("later-warm"));
    for (const listener of mocks.readListeners)
      listener("/v1/workouts?limit=200");
    // Initial cache fills do not change the invalidation version.
    const firstFocusedFrame = render();
    expect(hasWorkout(firstFocusedFrame, "later-warm")).toBe(true);
    expect(hasLoader(firstFocusedFrame)).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
    hooks.focus!();
    expect(hasWorkout(render(), "later-warm")).toBe(true);
    expect(hasLoader(render())).toBe(false);
  });
  it.each(["account", "token"])(
    "never reuses the warm snapshot after %s changes",
    (change) => {
      mocks.peek.mockImplementation((session) =>
        session?.user.id === "user-a" &&
        session?.accessToken === "token-user-a-0"
          ? response("private-warm")
          : null,
      );
      mocks.fetch.mockReturnValue(new Promise(() => {}));
      expect(hasWorkout(render(), "private-warm")).toBe(true);
      if (change === "account") mocks.owner = "user-b";
      else mocks.tokenVersion++;
      const next = render();
      expect(hasWorkout(next, "private-warm")).toBe(false);
      expect(hasLoader(next)).toBe(true);
    },
  );
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

it("gives each account-scoped root modal a distinct sibling key", () => {
  const children = [render().props.children].flat(Infinity);
  const keys = children
    .filter((child: any) => child && typeof child === "object" && child.key)
    .map((child: any) => child.key);
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(keys).size).toBe(keys.length);
});

it("announces the selected workout filter after switching views", () => {
  const filter = (tree: any, label: string) =>
    find(tree, (node) => node.props?.accessibilityLabel === label);
  let tree = render();
  expect(
    filter(tree, "Show all workouts").props.accessibilityState.selected,
  ).toBe(true);
  filter(tree, "Show completed workout history").props.onPress();
  tree = render();
  expect(
    filter(tree, "Show all workouts").props.accessibilityState.selected,
  ).toBe(false);
  expect(
    filter(tree, "Show completed workout history").props.accessibilityState
      .selected,
  ).toBe(true);
  expect(
    filter(tree, "Show available routines").props.accessibilityState.selected,
  ).toBe(false);
});

it("resumes the active workout from the primary action without creating another", async () => {
  mocks.activeWorkout = { id: "already-active" };
  const tree = render();
  const resume = find(
    tree,
    (node) => node.props?.accessibilityLabel === "Resume workout",
  );
  expect(resume).toBeDefined();
  await resume.props.onPress();
  expect(mocks.createBlank).not.toHaveBeenCalled();
  expect(mocks.push).toHaveBeenCalledWith({
    pathname: "/log-workout",
    params: { workoutId: "already-active" },
  });
});

describe("running inside Workouts", () => {
  it("opens Log run directly while preserving the active strength workout", () => {
    mocks.activeWorkout = { id: "active-strength" };
    const tree = render();
    const logRun = find(
      tree,
      (node) => node.props?.accessibilityLabel === "Log run",
    );
    expect(logRun).toBeTruthy();
    logRun.props.onPress();
    expect(mocks.push).toHaveBeenCalledWith("/log-run");
    expect(mocks.activeWorkout.id).toBe("active-strength");
  });
  it("mixes run cards with strength cards and supports a Running history filter", async () => {
    const run = {
      id: "run-id",
      name: "Run",
      summary: {
        activityDate: "2026-10-05",
        durationSeconds: 1500,
        distanceMeters: null,
      },
    };
    mocks.fetch.mockResolvedValue({ ...response("strength"), runs: [run] });
    render();
    hooks.focus!();
    await settle();
    let tree = render();
    expect(find(tree, (node) => node.props?.run?.id === "run-id")).toBeTruthy();
    const filter = find(
      tree,
      (node) => node.props?.accessibilityLabel === "Running",
    );
    filter.props.onPress();
    tree = render();
    expect(find(tree, (node) => node.props?.run?.id === "run-id")).toBeTruthy();
    expect(
      find(
        tree,
        (node) =>
          node.props?.item?.workout?.id === "strength" &&
          node.props?.item?.status === "completed",
      ),
    ).toBeFalsy();
  });
});

describe("running history ownership before effects settle", () => {
  it("hides an open personal editor and progression in the first next-account render", () => {
    mocks.peek.mockImplementation((session) =>
      session?.user.id === "user-a" ? response("private-editor") : null,
    );
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    render();
    const card = find(
      render(),
      (node) => node.props?.item?.workout.id === "private-editor",
    );
    card.props.onEdit();
    card.props.onPressExercise("Private exercise");
    expect(
      find(render(), (node) => node.type === "WorkoutEditorModal").props
        .visible,
    ).toBe(true);
    expect(
      find(render(), (node) => node.type === "ExerciseProgressionModal").props
        .exerciseName,
    ).toBe("Private exercise");
    mocks.owner = "user-b";
    const first = render();
    const editor = find(first, (node) => node.type === "WorkoutEditorModal");
    expect(editor.props.visible).toBe(false);
    expect(editor.props.workoutToEdit).toBeNull();
    expect(
      find(first, (node) => node.type === "ExerciseProgressionModal"),
    ).toBeUndefined();
  });
  it("hides account A run and strength cards on the first B render", async () => {
    const run = {
      id: "private-run-a",
      name: "Private run A",
      summary: {
        activityDate: "2026-10-05",
        durationSeconds: 1500,
        distanceMeters: null,
      },
    };
    const strength = {
      ...workout("private-strength-a"),
      status: "completed" as const,
    };
    mocks.fetch.mockResolvedValue({
      activeAndPlanned: [],
      completed: [strength],
      runs: [run],
      exercises: [],
      message: null,
    });
    render();
    hooks.focus!();
    await settle();
    let tree = render();
    expect(
      find(tree, (node) => node.props?.run?.id === "private-run-a"),
    ).toBeTruthy();
    expect(hasWorkout(tree, "private-strength-a")).toBe(true);
    mocks.owner = "user-b";
    tree = render();
    expect(
      find(tree, (node) => node.props?.run?.id === "private-run-a"),
    ).toBeFalsy();
    expect(hasWorkout(tree, "private-strength-a")).toBe(false);
  });
  it("binds display reads to their originating principal and retires completion after switch", async () => {
    let complete!: (value: WorkoutsHubResult) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render();
    hooks.focus!();
    const client = mocks.fetch.mock.calls[0]?.[0];
    expect(client).toBeTruthy();
    await client.request({ method: "GET", path: "/v1/runs?limit=50" });
    const scopedOptions = mocks.apiRequest.mock.calls[0]?.[0];
    expect(scopedOptions.expectedUserId).toBe("user-a");
    expect(scopedOptions.isCurrent()).toBe(true);
    mocks.owner = "user-b";
    render();
    complete({
      ...response("old-strength"),
      runs: [{ id: "old-run", summary: { activityDate: "2026-10-05" } }] as any,
    });
    await settle();
    const tree = render();
    expect(hasWorkout(tree, "old-strength")).toBeFalsy();
    expect(find(tree, (node) => node.props?.run?.id === "old-run")).toBeFalsy();
    expect(scopedOptions.isCurrent()).toBe(false);
  });
});
