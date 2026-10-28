vi.mock("@/features/workout-companion", () => ({
  WatchWorkoutControls: "WatchWorkoutControls",
}));
import { beforeEach, expect, it, vi } from "vitest";

// VoiceOver announcements are covered by src/lib/announce.test.ts.
vi.mock("@/lib/announce", () => ({
  announce: vi.fn(),
  useAnnouncement: vi.fn(),
  textOfChildren: () => "",
}));
const mocks = vi.hoisted(() => ({
  // Sets the durable queue holds; the default sync confirms them all.
  queued: [] as any[],
  refs: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  remove: null as (() => void) | null,
  scopes: 0,
  owner: "owner-a",
  track: vi.fn().mockResolvedValue({ recorded: true }),
  abandon: vi.fn(),
  complete: vi.fn(),
  addSet: vi.fn(),
  alert: vi.fn(),
  back: vi.fn(),
}));
const workspace = {
  workout: {
    id: "private-workout-id",
    name: "Private workout name",
    startedAt: new Date().toISOString(),
    completedAt: null,
    details: null,
  },
  sets: [],
  exercises: [],
  message: null,
};
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const i = mocks.index++;
    if (!(i in mocks.refs)) {
      const value = typeof initial === "function" ? initial() : initial;
      mocks.refs[i] =
        value?.sets && "workout" in value
          ? workspace
          : value === true
            ? false
            : value;
    }
    return [
      mocks.refs[i],
      (next: any) => {
        mocks.refs[i] = typeof next === "function" ? next(mocks.refs[i]) : next;
      },
    ];
  },
  useRef: (initial: unknown) =>
    (mocks.refs[mocks.index++] ??= { current: initial }),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => {
    mocks.effects.push(fn);
  },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: mocks.alert },
  AppState: {},
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios", select: (x: any) => x.ios ?? x.default },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (x: unknown) => x },
}));
vi.mock("@/components/keyboard-inset", () => ({
  useAndroidKeyboardInset: () => undefined,
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-router", () => ({
  router: { back: mocks.back, replace: vi.fn() },
  Stack: { Screen: "StackScreen" },
  useLocalSearchParams: () => ({ workoutId: "private-workout-id" }),
  useNavigation: () => navigation,
}));
const navigation = {
  addListener: (_name: string, listener: () => void) => {
    mocks.remove = listener;
    return () => {
      mocks.remove = null;
    };
  },
};
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
  EmptyState: "EmptyState",
  Icon: "Icon",
  IconButton: "IconButton",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.owner } },
    profile: { unitSystem: "metric" },
  }),
}));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: {
    createFlowScope: () => ({ flowId: `scope-${++mocks.scopes}` }),
    track: mocks.track,
  },
}));
vi.mock("@/composition/app-variant", () => ({ getAppVariant: () => "dev" }));
vi.mock("@/features/community", () => ({
  ShareWorkoutModal: "ShareWorkoutModal",
  useCommunityProfile: () => ({ isEnrolled: false }),
}));
vi.mock("@/features/logging-draft-storage", () => ({
  clearLoggingDraft: vi.fn(),
  loadLoggingDraft: vi.fn(),
  saveLoggingDraft: vi.fn(),
}));
vi.mock("@/features/workouts", () => ({
  useOptionalActiveWorkout: () => null,
  restTimerNextAction: vi.fn(),
}));
vi.mock("@/features/workouts/exercise-library-modal", () => ({
  ExerciseLibraryModal: "ExerciseLibraryModal",
}));
vi.mock("@/features/workouts/exercise-progression-modal", () => ({
  ExerciseProgressionModal: "ExerciseProgressionModal",
}));
vi.mock("@/features/workouts/reorder-exercises-modal", () => ({
  ReorderExercisesModal: "ReorderExercisesModal",
}));
vi.mock("@/features/workouts/set-type-modal", () => ({
  SetTypeModal: "SetTypeModal",
}));
vi.mock("@/features/workouts/workouts-hub-data", () => ({
  startRoutineSession: vi.fn(),
}));
vi.mock("@/features/workouts/workout-preferences", () => ({
  DEFAULT_REST_SECONDS: 90,
  loadWorkoutPreferences: vi.fn(),
}));
vi.mock("@/features/workouts/rest-timer-notifications", () => ({
  cancelRestNotification: vi.fn(),
  scheduleRestNotification: vi.fn(),
}));
vi.mock("@/features/workouts/workout-notification", () => ({
  completedSetsForNotificationEntry: vi.fn(),
  dismissActiveWorkoutNotification: vi.fn(),
  formatNextSetSummary: vi.fn(),
  selectNextExerciseIndexForNotification: vi.fn(),
  shouldSyncActiveWorkoutNotification: vi.fn(),
  updateActiveWorkoutNotification: vi.fn(),
}));
vi.mock("./log-workout-data", () => ({
  abandonWorkout: mocks.abandon,
  completeWorkout: mocks.complete,
  extractPlannedExercises: () => [],
  loadWorkoutWorkspace: vi.fn(),
  startWorkout: vi.fn(),
  // The durable set queue (REL-02) keeps the old (workoutId, form) seam here.
  queueWorkoutSet: async (workoutId: string, form: unknown) => {
    const result = await mocks.addSet(workoutId, form);
    if (!result?.ok) return result;
    const command = {
      kind: "create",
      workoutId,
      body: { clientOperationId: result.workoutSet.id },
      queuedAt: "2026-10-27T10:00:00.000Z",
    };
    mocks.queued.push({ command, workoutSet: result.workoutSet });
    return { ...result, command };
  },
  loadPendingWorkoutSets: async () => [],
  syncPendingWorkoutSets: async () => ({
    synced: mocks.queued.splice(0),
    dropped: [],
    blocked: null,
    remaining: [],
  }),
  applyCompletedWorkoutProgressions: vi.fn(),
  createExercise: vi.fn(),
  deleteWorkoutSet: vi.fn(),
  loadRecentPerformance: vi.fn(),
  reorderWorkoutExercises: vi.fn(),
}));
import { LogWorkoutScreen } from "./log-workout-screen";
function render(): any {
  mocks.index = 0;
  const tree = LogWorkoutScreen();
  mocks.effects.shift()!();
  mocks.effects = [];
  return tree;
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
beforeEach(() => {
  mocks.refs = [];
  mocks.effects = [];
  mocks.scopes = 0;
  mocks.owner = "owner-a";
  mocks.track.mockClear();
  mocks.alert.mockClear();
  mocks.abandon.mockReset().mockResolvedValue({ ok: true });
  mocks.complete.mockReset().mockResolvedValue({ ok: true });
  mocks.addSet.mockReset();
  mocks.back.mockReset().mockImplementation(() => mocks.remove?.());
});

it("minimizing a resumed workout exits the visit without deleting the durable session", async () => {
  const tree = render();
  find(tree, (node) => node.type === "StackScreen")
    .props.options.headerLeft()
    .props.onPress();
  await settle();
  expect(mocks.abandon).not.toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
    "logging_flow_started",
    "logging_flow_exited",
  ]);
  expect(mocks.track.mock.calls[1][0].properties.exit).toBe("navigate_away");
  expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("private");
});

it("records explicit cancellation only after discard succeeds", async () => {
  let acknowledge!: (result: { ok: boolean }) => void;
  mocks.abandon.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  const tree = render();
  find(
    tree,
    (node) => typeof node.props?.onAbandon === "function",
  ).props.onAbandon();
  const buttons = mocks.alert.mock.calls[0][2];
  buttons.find((button: any) => button.text === "Discard").onPress();
  await settle();
  expect(mocks.abandon).toHaveBeenCalledWith("private-workout-id");
  expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
    "logging_flow_started",
  ]);
  acknowledge({ ok: true });
  await settle();
  expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
    "logging_flow_started",
    "logging_flow_exited",
  ]);
  expect(mocks.track.mock.calls[1][0].properties.exit).toBe("cancel");
});

it("records completion and core creation only after confirmed workout save", async () => {
  const tree = render();
  find(tree, (node) => node.type === "StackScreen")
    .props.options.headerRight()
    .props.onPress();
  mocks.alert.mock.calls[0][2]
    .find((button: any) => button.text === "Finish & Save")
    .onPress();
  await settle();
  expect(mocks.complete).toHaveBeenCalledTimes(1);
  expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
    "logging_flow_started",
    "logging_flow_completed",
    "core_record_created",
  ]);
  expect(
    new Set(mocks.track.mock.calls.map(([, scope]) => scope.flowId)).size,
  ).toBe(1);
});

it("keeps a failed workout save unfinished with a correlated coarse failure", async () => {
  mocks.complete.mockResolvedValueOnce({
    ok: false,
    message: "Network unavailable",
  });
  const tree = render();
  find(tree, (node) => node.type === "StackScreen")
    .props.options.headerRight()
    .props.onPress();
  mocks.alert.mock.calls[0][2]
    .find((button: any) => button.text === "Finish & Save")
    .onPress();
  await settle();
  expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
    "logging_flow_started",
    "logging_flow_failed",
  ]);
  expect(
    new Set(mocks.track.mock.calls.map(([, scope]) => scope.flowId)).size,
  ).toBe(1);
  expect(mocks.back).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.track.mock.calls)).not.toContain(
    "Network unavailable",
  );
});

it("keeps a delayed A set-save failure on A's captured attempt after rendering owner B", async () => {
  let resolve!: (result: { ok: false; message: string }) => void;
  mocks.addSet.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const tree = render();
  const feed = find(tree, (node) => typeof node.props?.onLogSet === "function");
  const pending = feed.props.onLogSet({
    id: "private-exercise-id",
    name: "Private exercise",
    targetSets: 3,
    repsMin: 8,
    repsMax: 12,
    restSeconds: 90,
  });
  expect(mocks.addSet).toHaveBeenCalledTimes(1);
  mocks.owner = "owner-b";
  render();
  resolve({ ok: false, message: "Network unavailable for private exercise" });
  await pending;
  const failed = mocks.track.mock.calls.find(
    ([event]) => event.name === "logging_flow_failed",
  )!;
  expect(failed[1].flowId).toBe("scope-1");
  expect(mocks.scopes).toBe(2);
  expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("private");
});
