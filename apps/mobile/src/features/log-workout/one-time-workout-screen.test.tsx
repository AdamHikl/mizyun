import { beforeEach, expect, it, vi } from "vitest";
import type { CoachWorkoutProposal, Workout } from "@mizyun/contracts";
import { getExerciseFromCatalog } from "@mizyun/core";

// Follow the existing logger hook harness: retain state between explicit renders,
// while isolating native effects. Persistence and user callbacks stay observable.
const mocks = vi.hoisted(() => ({
  cells: [] as any[],
  index: 0,
  workspace: null as any,
  load: vi.fn(),
  persist: vi.fn(),
  createExercise: vi.fn(),
  addSet: vi.fn(),
  complete: vi.fn(),
  progression: vi.fn(),
  alert: vi.fn(),
  back: vi.fn(),
  clearDraft: vi.fn(),
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
  useEffect: () => {},
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
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "workout-owner" } },
    profile: { unitSystem: "metric" },
  }),
}));
vi.mock("@/features/analytics/flow-measurement", () => ({
  useLoggingFlowMeasurement: () => ({
    current: { tap: vi.fn(), fail: vi.fn(), retry: vi.fn(), complete: vi.fn() },
  }),
}));
vi.mock("@/composition/app-variant", () => ({ getAppVariant: () => "dev" }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: vi.fn() },
}));
vi.mock("@/features/community", () => ({
  ShareWorkoutModal: "ShareWorkoutModal",
  useCommunityProfile: () => ({ isEnrolled: false }),
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
  useOptionalActiveWorkout: () => null,
  restTimerNextAction: vi.fn(),
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
  loadWorkoutPreferences: vi.fn(),
}));
vi.mock("@/features/workouts/rest-timer-notifications", () => ({
  cancelRestNotification: vi.fn(),
  scheduleRestNotification: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/features/workouts/workout-notification", () => ({
  completedSetsForNotificationEntry: () => [],
  dismissActiveWorkoutNotification: vi.fn(),
  formatNextSetSummary: vi.fn(),
  selectNextExerciseIndexForNotification: () => null,
  shouldSyncActiveWorkoutNotification: () => false,
  updateActiveWorkoutNotification: vi.fn(),
}));
vi.mock("./log-workout-data", async (original) => ({
  ...(await original<typeof import("./log-workout-data")>()),
  abandonWorkout: vi.fn(),
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
  mocks.complete.mockReset().mockResolvedValue({ ok: true });
  mocks.addSet.mockReset();
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
  openLibrary().props.onSelectExercise(getExerciseFromCatalog("barbell-rdl"));
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
  openLibrary().props.onSelectExercise(getExerciseFromCatalog("barbell-rdl"));
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
  openLibrary().props.onSelectExercise(getExerciseFromCatalog("barbell-rdl"));
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
  openLibrary().props.onSelectExercise(selected);
  await settle();
  expect(mocks.createExercise.mock.calls[0][1]).toContain("1. ");
  expect(mocks.createExercise.mock.calls[0][1]).toContain("\n2. ");
  expect(mocks.persist).toHaveBeenCalledTimes(1);
});

it("persists a selected exercise before its first set and restores it on reopening", async () => {
  const pending = deferred<any>();
  mocks.persist.mockReturnValueOnce(pending.promise);
  openLibrary().props.onSelectExercise(catalogExercise);
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
  openLibrary().props.onSelectExercise(catalogExercise);
  await settle();
  expect(feed().props.exercises).toEqual([]);

  const pending = deferred<any>();
  mocks.persist.mockReturnValueOnce(pending.promise);
  const library = openLibrary();
  library.props.onSelectExercise(catalogExercise);
  library.props.onSelectExercise(catalogExercise);
  await settle();
  expect(mocks.persist).toHaveBeenCalledTimes(2);
  expect(feed().props.exercises).toEqual([]);
  pending.resolve({
    ok: true,
    workout: persistedWorkout(mocks.persist.mock.calls[1][1]),
  });
  await settle();
  expect(feed().props.exercises).toHaveLength(1);

  openLibrary().props.onSelectExercise(catalogExercise);
  await settle();
  expect(mocks.persist).toHaveBeenCalledTimes(2);
  expect(feed().props.exercises).toHaveLength(1);
});

it("preserves the full existing exercise list when adding another exercise", async () => {
  openLibrary().props.onSelectExercise(catalogExercise);
  await settle();
  openLibrary().props.onSelectExercise(secondCatalogExercise);
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
  openLibrary().props.onSelectExercise(catalogExercise);
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
  active.props.onFinish();
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
  openLibrary().props.onSelectExercise(catalogExercise);
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
