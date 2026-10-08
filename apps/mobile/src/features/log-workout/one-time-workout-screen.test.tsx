import { beforeEach, expect, it, vi } from "vitest";
import type {
  CoachWorkoutProposal,
  Workout,
  WorkoutSet,
} from "@mizyun/contracts";
import { getExerciseFromCatalog } from "@mizyun/core";

// Follow the existing logger hook harness: retain state between explicit renders,
// while isolating native effects. Persistence and user callbacks stay observable.
const mocks = vi.hoisted(() => ({
  cells: [] as any[],
  context: null as any,
  index: 0,
  workspace: null as any,
  load: vi.fn(),
  persist: vi.fn(),
  createExercise: vi.fn(),
  addSet: vi.fn(),
  complete: vi.fn(),
  abandon: vi.fn(),
  progression: vi.fn(),
  alert: vi.fn(),
  back: vi.fn(),
  clearDraft: vi.fn(),
  effects: [] as (() => void | (() => void))[],
  communityEnrolled: false,
  loadPreferences: vi.fn(),
  appState: vi.fn(),
  cancelRest: vi.fn(),
  dismissNotification: vi.fn(),
  measurement: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const i = mocks.index++;
    if (!(i in mocks.cells)) {
      const value = typeof initial === "function" ? initial() : initial;
      mocks.cells[i] =
        value?.sets && "workout" in value
          ? mocks.workspace
          : i === 3
            ? false // Initial workspace load is already complete.
            : value;
    }
    return [
      mocks.cells[i],
      (next: any) => {
        mocks.cells[i] =
          typeof next === "function" ? next(mocks.cells[i]) : next;
      },
    ];
  },
  useRef: (initial: unknown) =>
    (mocks.cells[mocks.index++] ??= { current: initial }),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => void | (() => void)) => {
    mocks.effects.push(effect);
  },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: mocks.alert },
  AppState: { addEventListener: mocks.appState },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios", select: (x: any) => x.ios ?? x.default },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (x: unknown) => x },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-router", () => ({
  router: { back: mocks.back, replace: vi.fn() },
  Stack: { Screen: "StackScreen" },
  useLocalSearchParams: () => ({ workoutId: "workout-one-time" }),
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({
  BottomTabInset: 0,
  MaxContentWidth: 600,
  Spacing: {},
}));
vi.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "dark" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "workout-owner" } },
    profile: { unitSystem: "metric" },
  }),
}));
vi.mock("@/features/analytics/flow-measurement", () => ({
  useLoggingFlowMeasurement: (...args: any[]) => {
    mocks.measurement(...args);
    return {
      current: {
        tap: vi.fn(),
        fail: vi.fn(),
        retry: vi.fn(),
        complete: vi.fn(),
        exit: vi.fn(),
      },
    };
  },
}));
vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => "production",
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: vi.fn() },
}));
vi.mock("@/features/community", () => ({
  ShareWorkoutModal: "ShareWorkoutModal",
  useCommunityProfile: () => ({ isEnrolled: mocks.communityEnrolled }),
}));
vi.mock("@/features/logging-draft-storage", () => ({
  clearLoggingDraft: mocks.clearDraft,
  loadLoggingDraft: vi.fn(),
  saveLoggingDraft: vi.fn(),
}));
vi.mock("@/features/workouts", async () => ({
  findCatalogExerciseRecord: (
    await import("../workouts/catalog-exercise-record")
  ).findCatalogExerciseRecord,
  useOptionalActiveWorkout: () => mocks.context,
  restTimerNextAction: (await import("../workouts/rest-timer-presentation"))
    .restTimerNextAction,
  calculateWorkoutVolume: (
    await vi.importActual<typeof import("../workouts/workouts-hub-data")>(
      "../workouts/workouts-hub-data",
    )
  ).calculateWorkoutVolume,
  formatStopwatch: (await import("../workouts/active-workout-state"))
    .formatStopwatch,
}));
vi.mock("@/features/workouts/exercise-library-modal", () => ({
  ExerciseLibraryModal: "ExerciseLibraryModal",
}));
vi.mock("@/features/workouts/exercise-progression-modal", () => ({
  ExerciseProgressionModal: "ExerciseProgressionModal",
}));
vi.mock("@/features/workouts/exercise-progression-data", () => ({
  updateExerciseTargetLoad: vi.fn(),
}));
vi.mock("@/features/workouts/reorder-exercises-modal", () => ({
  ReorderExercisesModal: "ReorderExercisesModal",
}));
vi.mock("@/features/workouts/set-type-modal", () => ({
  SetTypeModal: "SetTypeModal",
}));
vi.mock("@/features/workouts/workouts-hub-data", () => ({
  startRoutineSession: vi.fn(),
  syncRoutineExerciseTargets: vi.fn(),
}));
vi.mock("@/features/workouts/workout-preferences", () => ({
  DEFAULT_REST_SECONDS: 75,
  loadWorkoutPreferences: mocks.loadPreferences,
}));
vi.mock("@/features/workouts/rest-timer-notifications", () => ({
  cancelRestNotification: mocks.cancelRest,
  scheduleRestNotification: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/features/workouts/workout-notification", () => ({
  completedSetsForNotificationEntry: () => [],
  dismissActiveWorkoutNotification: mocks.dismissNotification,
  formatNextSetSummary: vi.fn(),
  selectNextExerciseIndexForNotification: () => null,
  shouldSyncActiveWorkoutNotification: () => false,
  updateActiveWorkoutNotification: vi.fn(),
}));
vi.mock("./log-workout-data", async (original) => ({
  ...(await original<typeof import("./log-workout-data")>()),
  abandonWorkout: mocks.abandon,
  completeWorkout: mocks.complete,
  loadWorkoutWorkspace: mocks.load,
  startWorkout: vi.fn(),
  addWorkoutSet: mocks.addSet,
  applyCompletedWorkoutProgressions: mocks.progression,
  createExercise: mocks.createExercise,
  deleteWorkoutSet: vi.fn(),
  loadRecentPerformance: vi.fn(),
  reorderWorkoutExercises: mocks.persist,
}));

import { LogWorkoutScreen } from "./log-workout-screen";
import { extractPlannedExercises } from "./log-workout-data";
import { CompletedWorkoutFeed } from "./completed-workout-feed";

const exercise = {
  id: "exercise-squat",
  name: "Squat",
  metadata: null,
};
const secondExercise = {
  id: "exercise-row",
  name: "Barbell Row",
  metadata: null,
};
const catalogExercise = {
  id: "catalog-squat",
  name: exercise.name,
  instructions: ["Squat with control."],
};
const secondCatalogExercise = {
  id: "catalog-row",
  name: secondExercise.name,
  instructions: ["Row with control."],
};
const workout: Workout = {
  id: "workout-one-time",
  userId: "workout-owner",
  source: "manual",
  name: "One-time Workout",
  startedAt: "2026-10-04T10:00:00.000Z",
  completedAt: null,
  notes: null,
  details: { workoutLifecycle: { kind: "session" }, sessionMode: "one_time" },
  createdAt: "2026-10-04T10:00:00.000Z",
  updatedAt: "2026-10-04T10:00:00.000Z",
};
function render(): any {
  mocks.index = 0;
  return LogWorkoutScreen();
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function textContent(node: any): string {
  if (Array.isArray(node))
    return node.map(textContent).join(" ").replace(/\s+/g, " ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object"
    ? textContent(node.props?.children)
    : "";
}
const recordedSet: WorkoutSet = {
  id: "saved-set",
  userId: workout.userId,
  workoutId: workout.id,
  exerciseId: exercise.id,
  sequence: 1,
  setType: "normal",
  loadKg: 50,
  repetitions: 6,
  durationSeconds: null,
  distanceMeters: null,
  perceivedExertion: null,
  completedAt: "2026-10-04T10:10:00.000Z",
  createdAt: "2026-10-04T10:10:00.000Z",
};
function completedFeed(
  overrides: Partial<Parameters<typeof CompletedWorkoutFeed>[0]> = {},
) {
  return CompletedWorkoutFeed({
    workout: {
      ...workout,
      completedAt: "2026-10-04T10:42:30.000Z",
      notes: "Saved workout note",
    },
    exercises: [exercise],
    allExercises: [exercise] as any,
    savedSets: [recordedSet],
    unitSystem: "metric",
    onOpenHistory: vi.fn(),
    ...overrides,
  });
}
function feed(tree = render()): any {
  return find(tree, (node) => typeof node.props?.onLogSet === "function");
}
function openLibrary(): any {
  feed().props.onOpenLibrary();
  return find(render(), (node) => node.type === "ExerciseLibraryModal");
}
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function persistedWorkout(entries: any[]): Workout {
  return {
    ...workout,
    details: {
      ...workout.details,
      sessionExercises: entries.map((entry) => ({
        name: entry.name,
        catalogId: entry.catalogId,
        restSeconds: entry.restSeconds,
      })),
    },
  };
}

beforeEach(() => {
  mocks.cells = [];
  mocks.context = null;
  mocks.effects = [];
  mocks.communityEnrolled = false;
  mocks.workspace = {
    workout,
    sets: [],
    exercises: [exercise, secondExercise],
    message: null,
  };
  vi.clearAllMocks();
  mocks.persist.mockReset().mockImplementation(async (_workout, entries) => {
    const saved = persistedWorkout(entries);
    mocks.workspace = { ...mocks.workspace, workout: saved };
    return { ok: true, workout: saved };
  });
  mocks.createExercise.mockReset();
  mocks.load.mockReset().mockImplementation(async () => mocks.workspace);
  mocks.complete.mockReset().mockResolvedValue({
    ok: true,
    workout: { ...workout, completedAt: "2026-10-04T10:42:30.000Z" },
  });
  mocks.loadPreferences.mockResolvedValue({
    defaultRestSeconds: 75,
    liveNotificationEnabled: false,
    autoAdvanceTargetWeights: false,
  });
  mocks.appState.mockReturnValue({ remove: vi.fn() });
  mocks.addSet.mockReset();
  mocks.abandon.mockReset().mockResolvedValue({ ok: true });
});

const plannedTypeSet: WorkoutSet = {
  id: "planned-type-set",
  userId: workout.userId,
  workoutId: workout.id,
  exerciseId: exercise.id,
  sequence: 1,
  setType: "normal",
  loadKg: 50,
  repetitions: 6,
  durationSeconds: null,
  distanceMeters: null,
  perceivedExertion: null,
  completedAt: "2026-10-04T10:10:00.000Z",
  createdAt: "2026-10-04T10:10:00.000Z",
};

function plannedRoutineWorkspace(types: string[]) {
  mocks.workspace.workout = {
    ...workout,
    details: {
      workoutLifecycle: { kind: "session", routineId: "routine-origin" },
      coachPlan: {
        exercises: [
          {
            name: exercise.name,
            catalogId: "squat",
            targetSets: types.length,
            targetReps: "6",
            setTypes: types,
          },
        ],
      },
    },
  };
}

function plannedCard() {
  const active = feed();
  const card = find(
    active.type(active.props),
    (node) => node.type?.name === "LiveExerciseCard",
  );
  return { active, card };
}

it.each(["warmup", "normal", "failure", "drop"])(
  "shows a visible %s set type control that opens the picker without logging",
  (type) => {
    plannedRoutineWorkspace([type]);
    const { card } = plannedCard();
    const content = card.type(card.props);
    const control = find(
      content,
      (node) => node.props?.testID === "pending-set-type-control",
    );
    const label = type[0]!.toUpperCase() + type.slice(1);
    expect(textContent(control)).toContain("Set 1 type");
    expect(textContent(control)).toContain(label);
    expect(control.props.accessibilityLabel).toBe(`Set 1 type: ${label}`);
    control.props.onPress();
    expect(
      find(render(), (node) => node.type === "SetTypeModal").props.currentType,
    ).toBe(type);
    expect(mocks.addSet).not.toHaveBeenCalled();
  },
);

it("disables both type selectors during a pending set save and restores them after failure", async () => {
  plannedRoutineWorkspace(["normal"]);
  let { active, card } = plannedCard();
  active.props.onUpdatePendingInput(exercise.id, { load: "50", reps: "6" });
  let resolveSave!: (result: any) => void;
  mocks.addSet.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  const saving = active.props.onLogSet(active.props.exercises[0]);
  await settle();
  ({ card } = plannedCard());
  const busyContent = card.type(card.props);
  const selectors = [
    find(
      busyContent,
      (node) => node.props?.testID === "pending-set-type-control",
    ),
    find(busyContent, (node) =>
      node.props?.accessibilityLabel?.includes("Tap to change set type."),
    ),
  ];
  for (const selector of selectors) {
    expect(selector.props.disabled).toBe(true);
    expect(selector.props.accessibilityState.disabled).toBe(true);
  }
  resolveSave({ ok: false, message: "retry" });
  await saving;
  ({ card } = plannedCard());
  expect(
    find(
      card.type(card.props),
      (node) => node.props?.testID === "pending-set-type-control",
    ).props.disabled,
  ).toBe(false);
});

it("prefills and submits each planned type, advancing from warmup to normal to failure", async () => {
  plannedRoutineWorkspace(["warmup", "normal", "failure"]);
  mocks.addSet.mockImplementation(async (_id, form) => {
    const set = {
      ...plannedTypeSet,
      id: `set-${mocks.workspace.sets.length + 1}`,
      sequence: mocks.workspace.sets.length + 1,
      setType: form.setType,
    };
    mocks.workspace = {
      ...mocks.workspace,
      sets: [...mocks.workspace.sets, set],
    };
    return { ok: true, workoutSet: set };
  });
  for (const type of ["warmup", "normal", "failure"]) {
    let { active, card } = plannedCard();
    expect(card.props.pendingInput.setType).toBe(type);
    // Editing load/reps must not replace the planned type with an implicit normal.
    active.props.onUpdatePendingInput(exercise.id, { load: "50", reps: "6" });
    ({ active, card } = plannedCard());
    await active.props.onLogSet(active.props.exercises[0]);
    await settle();
    expect(mocks.addSet.mock.lastCall?.[1].setType).toBe(type);
  }
  expect(plannedCard().card.props.pendingInput.setType).toBe("normal");
});

it("restores planned defaults after reload and allows a manual override for the pending ordinal", async () => {
  plannedRoutineWorkspace(["warmup", "normal", "failure"]);
  mocks.workspace.sets = [{ ...plannedTypeSet, setType: "warmup" }];
  let { active, card } = plannedCard();
  expect(card.props.pendingInput.setType).toBe("normal");
  active.props.onOpenSetTypeModal(active.props.exercises[0]);
  const modal = find(render(), (node) => node.type === "SetTypeModal");
  expect(modal.props.currentType).toBe("normal");
  modal.props.onSelectType("drop");
  mocks.addSet.mockResolvedValue({ ok: false, message: "retry" });
  ({ active, card } = plannedCard());
  expect(card.props.pendingInput.setType).toBe("drop");
  await active.props.onLogSet(active.props.exercises[0]);
  expect(mocks.addSet.mock.lastCall?.[1].setType).toBe("drop");
  expect(plannedCard().card.props.pendingInput.setType).toBe("drop");
});

it.each(["one_time", "routine"])(
  "opens a completed %s workout for review and closes without saving again",
  (mode) => {
    mocks.workspace.workout = {
      ...workout,
      completedAt: "2026-10-04T10:42:30.000Z",
      details: {
        workoutLifecycle: { kind: "session" },
        ...(mode === "one_time" ? { sessionMode: "one_time" } : {}),
      },
    };
    const tree = render();
    const header = find(tree, (node) => node.type === "StackScreen");
    const close = header.props.options.headerRight();
    expect(close.props.accessibilityLabel).toBe("Close workout");
    close.props.onPress();
    expect(mocks.back).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.abandon).not.toHaveBeenCalled();
    expect(mocks.progression).not.toHaveBeenCalled();
    expect(feed(tree)).toBeFalsy();
    expect(header.props.options.headerLeft()).toBeNull();
    expect(mocks.measurement).toHaveBeenLastCalledWith(
      "workout",
      "workout-owner",
      false,
    );
  },
);

it("does not disturb another active workout or its rest timer while reviewing history", async () => {
  const restTimer = {
    endsAt: Date.now() + 60000,
    total: 60,
    exerciseName: "Active row",
    notificationId: "active-rest",
  };
  mocks.context = {
    activeWorkout: { id: "another-active-workout" },
    restTimer,
    setActiveWorkout: vi.fn(),
    startRestTimer: vi.fn(),
    clearRestTimer: vi.fn(),
  };
  mocks.workspace.workout = {
    ...workout,
    completedAt: "2026-10-04T10:42:30.000Z",
  };
  const interval = vi.spyOn(globalThis, "setInterval");
  const tree = render();
  for (const effect of mocks.effects) effect();
  await settle();
  mocks.effects = [];
  render();
  for (const effect of mocks.effects) effect();
  await settle();
  expect(mocks.context.setActiveWorkout).not.toHaveBeenCalled();
  expect(mocks.context.startRestTimer).not.toHaveBeenCalled();
  expect(mocks.context.clearRestTimer).not.toHaveBeenCalled();
  expect(mocks.cancelRest).not.toHaveBeenCalled();
  expect(mocks.dismissNotification).not.toHaveBeenCalled();
  expect(mocks.appState).not.toHaveBeenCalled();
  expect(interval).not.toHaveBeenCalled();
  expect(
    find(tree, (node) => typeof node.props?.onAdjust === "function"),
  ).toBeFalsy();
  interval.mockRestore();
});

it("switches to review immediately after saving when the sharing prompt keeps the screen open", async () => {
  mocks.communityEnrolled = true;
  const header = find(render(), (node) => node.type === "StackScreen");
  await header.props.options.headerRight().props.onPress();
  mocks.alert.mock.calls
    .at(-1)![2]
    .find((button: any) => button.text === "Finish & Save")
    .onPress();
  await settle();
  const next = render();
  expect(feed(next)).toBeFalsy();
  expect(
    find(
      next,
      (node) => node.type === "StackScreen",
    ).props.options.headerRight().props.accessibilityLabel,
  ).toBe("Close workout");
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(mocks.back).not.toHaveBeenCalled();
});

it("does not offer a new workout editor when an explicit history record cannot be loaded", () => {
  mocks.workspace.workout = null;
  const tree = render();
  expect(
    find(tree, (node) => typeof node.props?.onStart === "function"),
  ).toBeFalsy();
  expect(feed(tree)).toBeFalsy();
});

it("shows the recorded completion date and a fixed duration instead of a live timer", () => {
  const tree = completedFeed();
  const text = textContent(tree);
  expect(text).toContain("Completed workout");
  expect(text).toContain("42:30");
  expect(text).toContain(
    new Date("2026-10-04T10:42:30.000Z").toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  );
  expect(text).toContain("300 kg working-set volume");
  expect(text).toContain("Saved workout note");
  const now = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.parse("2030-01-01T10:00:00Z"));
  expect(textContent(completedFeed())).toBe(text);
  now.mockRestore();
  expect(find(tree, (node) => node.type === "TextInput")).toBeFalsy();
  expect(
    find(tree, (node) =>
      /Finish|Log Set|Delete|Reorder|Move |Discard|Add Exercise/.test(
        node.props?.accessibilityLabel ?? "",
      ),
    ),
  ).toBeFalsy();
  expect(text).not.toContain("PREVIOUS");
});

it("retains timed sets, distance, effort, set types and sets with an unavailable exercise", () => {
  const text = textContent(
    completedFeed({
      savedSets: [
        {
          ...recordedSet,
          exerciseId: "unavailable-exercise",
          setType: "failure",
          loadKg: null,
          repetitions: null,
          durationSeconds: 90,
          distanceMeters: 500,
          perceivedExertion: 8,
        },
      ],
    }),
  );
  expect(text).toContain("Recorded exercise");
  expect(text).toContain("failure");
  expect(text).toContain("01:30 duration");
  expect(text).toContain("500 m distance");
  expect(text).toContain("RPE 8");
});

it("shows saved values in imperial units and excludes warmups from working-set volume", () => {
  const text = textContent(
    completedFeed({
      unitSystem: "imperial",
      savedSets: [
        recordedSet,
        {
          ...recordedSet,
          id: "warmup",
          sequence: 2,
          setType: "warmup",
          loadKg: 10,
        },
      ],
    }),
  );
  expect(text).toContain("661.4 lb working-set volume");
  expect(text).toContain("110.2");
  expect(text).toContain("warmup");
});

it("uses historical empty copy and keeps exercise history available without logging controls", () => {
  const onOpenHistory = vi.fn();
  const tree = completedFeed({ savedSets: [], onOpenHistory });
  expect(textContent(tree)).toContain(
    "No sets were recorded for this workout.",
  );
  expect(textContent(tree)).not.toContain("Add an exercise");
  find(
    tree,
    (node) => node.props?.accessibilityLabel === "View history for Squat",
  ).props.onPress();
  expect(onOpenHistory).toHaveBeenCalledWith("Squat");
});

it("reuses the saved UUID and original name when the catalog label is clearer", async () => {
  mocks.workspace.exercises = [
    {
      ...exercise,
      id: "saved-rdl",
      name: "Romanian Deadlift",
      metadata: { targetLoadKg: 80 },
    },
  ];
  openLibrary().props.onSelectExercises([
    getExerciseFromCatalog("barbell-rdl"),
  ]);
  await settle();
  expect(mocks.createExercise).not.toHaveBeenCalled();
  expect(mocks.persist.mock.calls[0][1][0]).toEqual(
    expect.objectContaining({
      id: "saved-rdl",
      name: "Romanian Deadlift",
      catalogId: "barbell-rdl",
    }),
  );
});

it("does not create a third UUID when previous labels are ambiguous", async () => {
  mocks.workspace.exercises = [
    { ...exercise, id: "first-rdl", name: "Romanian Deadlift" },
    { ...exercise, id: "second-rdl", name: "Romanian Deadlift" },
  ];
  openLibrary().props.onSelectExercises([
    getExerciseFromCatalog("barbell-rdl"),
  ]);
  await settle();
  expect(mocks.createExercise).not.toHaveBeenCalled();
  expect(mocks.persist).not.toHaveBeenCalled();
});

it("does not create a duplicate after a truncated saved-exercise page", async () => {
  mocks.workspace.exercises = Array.from({ length: 200 }, (_, index) => ({
    ...exercise,
    id: `saved-${index}`,
    name: `Custom ${index}`,
  }));
  openLibrary().props.onSelectExercises([
    getExerciseFromCatalog("barbell-rdl"),
  ]);
  await settle();
  expect(mocks.createExercise).not.toHaveBeenCalled();
  expect(mocks.persist).not.toHaveBeenCalled();
});

it("saves new form instructions as numbered separate lines", async () => {
  mocks.workspace.exercises = [];
  const selected = getExerciseFromCatalog("barbell-rdl")!;
  mocks.createExercise.mockResolvedValue({
    ok: true,
    exercise: { ...exercise, id: "new-rdl", name: selected.name },
  });
  openLibrary().props.onSelectExercises([selected]);
  await settle();
  expect(mocks.createExercise.mock.calls[0][1]).toContain("1. ");
  expect(mocks.createExercise.mock.calls[0][1]).toContain("\n2. ");
  expect(mocks.persist).toHaveBeenCalledTimes(1);
});

it("persists a selected exercise before its first set and restores it on reopening", async () => {
  const pending = deferred<any>();
  mocks.persist.mockReturnValueOnce(pending.promise);
  openLibrary().props.onSelectExercises([catalogExercise]);
  await settle();
  expect(mocks.persist).toHaveBeenCalledTimes(1);
  expect(feed().props.exercises).toEqual([]);
  expect(mocks.addSet).not.toHaveBeenCalled();

  const entries = mocks.persist.mock.calls[0][1];
  expect(entries).toEqual([
    expect.objectContaining({
      id: exercise.id,
      name: exercise.name,
      isPlanned: false,
      repsMin: null,
      repsMax: null,
      restSeconds: 75,
    }),
  ]);
  const saved = persistedWorkout(entries);
  pending.resolve({ ok: true, workout: saved });
  await settle();
  expect(feed().props.exercises.map((entry: any) => entry.name)).toEqual([
    exercise.name,
  ]);

  // Simulate termination: drop every local state/ref and reload only saved data.
  mocks.workspace = { ...mocks.workspace, workout: saved };
  mocks.cells = [];
  mocks.context = null;
  const reopened = feed();
  expect(reopened.props.savedSets).toEqual([]);
  expect(reopened.props.exercises).toEqual([
    expect.objectContaining({
      name: exercise.name,
      isPlanned: false,
      repsMin: null,
      repsMax: null,
      restSeconds: 75,
    }),
  ]);
});

it("keeps failed selections out of the session, retries, and guards concurrent duplicate taps", async () => {
  mocks.persist.mockResolvedValueOnce({
    ok: false,
    message: "Exercise could not be saved",
  });
  openLibrary().props.onSelectExercises([catalogExercise]);
  await settle();
  expect(feed().props.exercises).toEqual([]);

  const pending = deferred<any>();
  mocks.persist.mockReturnValueOnce(pending.promise);
  const library = openLibrary();
  library.props.onSelectExercises([catalogExercise]);
  library.props.onSelectExercises([catalogExercise]);
  await settle();
  expect(mocks.persist).toHaveBeenCalledTimes(2);
  expect(feed().props.exercises).toEqual([]);
  pending.resolve({
    ok: true,
    workout: persistedWorkout(mocks.persist.mock.calls[1][1]),
  });
  await settle();
  expect(feed().props.exercises).toHaveLength(1);

  openLibrary().props.onSelectExercises([catalogExercise]);
  await settle();
  expect(mocks.persist).toHaveBeenCalledTimes(2);
  expect(feed().props.exercises).toHaveLength(1);
});

it("preserves the full existing exercise list when adding another exercise", async () => {
  openLibrary().props.onSelectExercises([catalogExercise]);
  await settle();
  openLibrary().props.onSelectExercises([secondCatalogExercise]);
  await settle();
  expect(mocks.persist).toHaveBeenCalledTimes(2);
  const entries = mocks.persist.mock.calls[1][1];
  expect(entries.map((entry: any) => entry.name)).toEqual([
    exercise.name,
    secondExercise.name,
  ]);
  mocks.workspace = {
    ...mocks.workspace,
    workout: persistedWorkout(entries),
  };
  mocks.cells = [];
  mocks.context = null;
  expect(feed().props.exercises.map((entry: any) => entry.name)).toEqual([
    exercise.name,
    secondExercise.name,
  ]);
});

it("ignores a stale Coach proposal when an existing blank session is opened", () => {
  const staleProposal = {
    session: {
      exercises: [
        {
          name: "Stale plan",
          catalogId: "stale",
          sets: 5,
          repsMin: 6,
          repsMax: 8,
        },
      ],
    },
  } as unknown as CoachWorkoutProposal;
  expect(extractPlannedExercises(workout, staleProposal)).toEqual([]);
  expect(extractPlannedExercises(null, staleProposal)).toEqual([
    expect.objectContaining({ name: "Stale plan" }),
  ]);
});

it("logs entered load and reps through the existing set API and finishes without advancing arbitrary targets", async () => {
  openLibrary().props.onSelectExercises([catalogExercise]);
  await settle();
  let active = feed();
  const entry = active.props.exercises[0];
  active.props.onUpdatePendingInput(entry.id, { load: "42.5", reps: "7" });
  active = feed();
  mocks.addSet.mockImplementationOnce(async () => {
    const saved = {
      id: "set-one",
      exerciseId: exercise.id,
      loadKg: 42.5,
      repetitions: 7,
      completedAt: "2026-10-04T10:01:00.000Z",
    };
    mocks.workspace = { ...mocks.workspace, sets: [saved] };
    return { ok: true, workoutSet: saved };
  });
  await active.props.onLogSet(entry);
  await settle();
  expect(mocks.addSet).toHaveBeenCalledWith(
    workout.id,
    expect.objectContaining({
      exerciseId: exercise.id,
      repetitions: "7",
      load: "42.5",
      unitSystem: "metric",
    }),
  );

  active = feed();
  expect(active.props.exercises[0].isPlanned).toBe(false);
  expect(active.props.savedSets).toHaveLength(1);
  headerFinish().props.onPress();
  expect(mocks.alert.mock.calls.at(-1)![1]).not.toContain("targets updated");
  mocks.alert.mock.calls
    .at(-1)![2]
    .find((button: any) => button.text === "Finish & Save")
    .onPress();
  await settle();
  expect(mocks.complete).toHaveBeenCalledWith(workout.id, workout.startedAt);
  expect(mocks.progression).not.toHaveBeenCalled();
  expect(mocks.clearDraft).toHaveBeenCalledWith("workout-owner", "workout");
  expect(mocks.back).toHaveBeenCalledTimes(1);
});

it("keeps one-time exercise cards consistent while showing actual sets instead of prescribed targets", async () => {
  mocks.workspace = {
    ...mocks.workspace,
    exercises: [
      { ...exercise, metadata: { targetLoadKg: 100 } },
      secondExercise,
    ],
  };
  openLibrary().props.onSelectExercises([catalogExercise]);
  await settle();
  const active = feed();
  expect(active.props.exercises[0].targetLoad).toBeUndefined();
  const renderedFeed = active.type(active.props);
  const card = find(
    renderedFeed,
    (node) => node.type?.name === "LiveExerciseCard",
  );
  const renderedCard = card.type(card.props);
  function text(node: any): string {
    if (typeof node === "string" || typeof node === "number")
      return String(node);
    if (Array.isArray(node)) return node.map(text).join("");
    return node && typeof node === "object" ? text(node.props?.children) : "";
  }
  expect(text(renderedCard)).toContain("0 sets logged · 75s rest");
  expect(text(renderedCard)).not.toContain("Target:");
  const repsInput = find(
    renderedCard,
    (node) => node.props?.testID === `set-reps-input-${exercise.id}`,
  );
  expect(repsInput.props.placeholder).toBe("—");
});

function headerFinish(tree = render()): any {
  return find(
    tree,
    (node) => node.type === "StackScreen",
  ).props.options.headerRight();
}
function renderedAction(label: string, tree = render()): any {
  const active = feed(tree);
  return find(
    active.type(active.props),
    (node) =>
      node.props?.accessibilityLabel === label || node.props?.label === label,
  );
}

it.each(["one_time", "routine"])(
  "keeps %s finish and discard unavailable during exercise persistence",
  async (mode) => {
    if (mode === "routine")
      mocks.workspace.workout = {
        ...workout,
        details: {
          workoutLifecycle: { kind: "session", routineId: "saved-routine" },
        },
      };
    const pending = deferred<any>();
    mocks.persist.mockReturnValueOnce(pending.promise);
    openLibrary().props.onSelectExercises([catalogExercise]);
    await settle();
    const tree = render();
    const finish = headerFinish(tree);
    const discard = renderedAction("Discard Session", tree);
    // Exercise the handler boundary too: stale queued taps must not open dialogs.
    finish.props.onPress();
    feed(tree).props.onAbandon();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(finish.props.disabled).toBe(true);
    expect(finish.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(discard.props.disabled).toBe(true);
    pending.resolve({ ok: false, message: "Exercise could not be saved" });
    await settle();
    expect(headerFinish().props.disabled).toBe(false);
    expect(renderedAction("Discard Session").props.disabled).toBe(false);
  },
);

it.each(["one_time", "routine"])(
  "keeps %s discard confirmed and targets the session rather than its routine",
  async (mode) => {
    if (mode === "routine")
      mocks.workspace.workout = {
        ...workout,
        details: {
          workoutLifecycle: { kind: "session", routineId: "saved-routine" },
        },
      };
    renderedAction("Discard Session").props.onPress();
    expect(mocks.abandon).not.toHaveBeenCalled();
    const dialog = mocks.alert.mock.calls.at(-1)!;
    expect(dialog[0]).toBe("Discard Session?");
    expect(dialog[1]).toContain(
      mode === "routine"
        ? "Your saved routine will remain available"
        : "permanently deleted",
    );
    expect(
      dialog[2].find((button: any) => button.style === "cancel").text,
    ).toBe("Keep Logging");
    const pending = deferred<any>();
    mocks.abandon.mockReturnValueOnce(pending.promise);
    dialog[2].find((button: any) => button.text === "Discard").onPress();
    await settle();
    expect(headerFinish().props.disabled).toBe(true);
    expect(mocks.back).not.toHaveBeenCalled();
    pending.resolve({ ok: true });
    await settle();
    expect(mocks.abandon).toHaveBeenCalledWith(workout.id);
    expect(mocks.back).toHaveBeenCalledTimes(1);
  },
);

it("restores action availability when discarding unexpectedly rejects", async () => {
  mocks.abandon.mockRejectedValueOnce(new Error("session lookup failed"));
  renderedAction("Discard Session").props.onPress();
  mocks.alert.mock.calls
    .at(-1)![2]
    .find((button: any) => button.text === "Discard")
    .onPress();
  await settle();
  expect(headerFinish().props.disabled).toBe(false);
  expect(renderedAction("Discard Session").props.disabled).toBe(false);
  expect(mocks.back).not.toHaveBeenCalled();
  expect(
    find(render(), (node) => node.props?.accessibilityRole === "alert"),
  ).not.toBeNull();
});

it.each(["one_time", "routine"])(
  "opens the existing exercise library from the visible %s Add action",
  (mode) => {
    if (mode === "routine") {
      mocks.workspace.workout = {
        ...workout,
        details: {
          workoutLifecycle: { kind: "session", routineId: "saved-routine" },
        },
      };
    }
    const tree = render();
    expect(
      find(tree, (node) => node.type === "ExerciseLibraryModal"),
    ).toBeFalsy();
    renderedAction("Add Exercise to Workout", tree).props.onPress();
    expect(
      find(render(), (node) => node.type === "ExerciseLibraryModal").props
        .visible,
    ).toBe(true);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.abandon).not.toHaveBeenCalled();
  },
);

it("shows the next exercise and set in the Production iOS rest timer", () => {
  mocks.context = {
    restTimer: {
      endsAt: Date.now() + 60_000,
      total: 60,
      exerciseName: "Squat",
      nextExerciseName: "Barbell Row",
      nextSetSummary: "40 kg × 8 reps",
      allPlannedSetsCompleted: false,
    },
  };
  const timer = find(
    render(),
    (node) => node.props?.rest?.exerciseName === "Squat",
  );
  const tree = timer.type(timer.props);
  expect(
    find(tree, (node) => node.props?.children === "40 kg × 8 reps"),
  ).not.toBeNull();
  expect(
    find(tree, (node) => String(node.props?.children).includes("Barbell Row")),
  ).not.toBeNull();
  expect(
    find(tree, (node) => node.props?.accessibilityLabel === "Skip rest timer"),
  ).not.toBeNull();
});

it("persists a batch together before any set and avoids duplicates within the batch", async () => {
  const result = await openLibrary().props.onSelectExercises([
    catalogExercise,
    secondCatalogExercise,
    catalogExercise,
  ]);
  await settle();
  expect(result).toBe(true);
  expect(mocks.persist).toHaveBeenCalledTimes(1);
  expect(
    mocks.persist.mock.calls[0][1].map((entry: any) => entry.name),
  ).toEqual([exercise.name, secondExercise.name]);
  expect(feed().props.exercises).toHaveLength(2);
  expect(mocks.addSet).not.toHaveBeenCalled();
});

it("retries a partially prepared batch without recreating a saved exercise", async () => {
  mocks.workspace = { ...mocks.workspace, exercises: [] };
  mocks.createExercise
    .mockResolvedValueOnce({ ok: true, exercise })
    .mockResolvedValueOnce({ ok: false, message: "Could not save row" });
  expect(
    await openLibrary().props.onSelectExercises([
      catalogExercise,
      secondCatalogExercise,
    ]),
  ).toBe(false);
  await settle();
  expect(mocks.persist).not.toHaveBeenCalled();
  expect(feed().props.exercises).toEqual([]);
  mocks.createExercise.mockResolvedValueOnce({
    ok: true,
    exercise: secondExercise,
  });
  expect(
    await openLibrary().props.onSelectExercises([
      catalogExercise,
      secondCatalogExercise,
    ]),
  ).toBe(true);
  await settle();
  expect(mocks.createExercise.mock.calls.map((call) => call[0])).toEqual([
    exercise.name,
    secondExercise.name,
    secondExercise.name,
  ]);
  expect(mocks.persist).toHaveBeenCalledTimes(1);
  expect(feed().props.exercises).toHaveLength(2);
});

it("keeps an earlier set error on screen without showing it as an add failure", async () => {
  await openLibrary().props.onSelectExercises([catalogExercise]);
  let active = feed();
  const entry = active.props.exercises[0];
  active.props.onUpdatePendingInput(entry.id, { load: "42.5", reps: "7" });
  mocks.addSet.mockResolvedValueOnce({
    ok: false,
    message: "Earlier set save failed",
  });
  await feed().props.onLogSet(entry);
  await settle();
  const library = openLibrary();
  expect(library.props.errorMessage).toBeNull();
  expect(
    find(
      render(),
      (node) => node.props?.children === "Earlier set save failed",
    ),
  ).toBeTruthy();
});
