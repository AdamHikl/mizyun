import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PastWorkoutDraft } from "./past-workout";

// Same hook harness as the run and one-time workout screen tests: state is
// retained between explicit renders and effects are run by hand.
const mocks = vi.hoisted(() => ({
  owner: "user-a",
  store: new Map<string, string>(),
  request: vi.fn(),
  invalidate: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  dispatch: vi.fn(),
  alert: vi.fn(),
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
  useState: (initial: any) => {
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
  useEffect: (callback: () => void, dependencies: any[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index];
    if (
      !previous ||
      previous.some((v: any, i: number) => !Object.is(v, dependencies[i]))
    ) {
      hooks.slots[index] = dependencies;
      hooks.effects.push(callback);
    }
  },
}));
vi.mock("react-native", () => ({
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
  Alert: { alert: mocks.alert },
}));
vi.mock("expo-router", () => ({
  router: {
    back: mocks.back,
    replace: mocks.replace,
    canGoBack: () => true,
  },
  Stack: { Screen: "StackScreen" },
  useNavigation: () => ({
    addListener: () => () => {},
    dispatch: mocks.dispatch,
  }),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => mocks.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mocks.store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mocks.store.delete(key);
  },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 600,
  Spacing: { two: 8, three: 12, four: 16 },
}));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  FormField: "FormField",
  FormStatus: "FormStatus",
  FormTextInput: "FormTextInput",
}));
vi.mock("@/components/ui/native-date-time-picker", () => ({
  NativeDatePicker: "NativeDatePicker",
  NativeTimePicker: "NativeTimePicker",
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.owner }, accessToken: `token-${mocks.owner}` },
    profile: { unitSystem: "metric" },
  }),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: {
    status: () => ({ configured: false, reason: "test" }),
    request: mocks.request,
  },
  invalidateSessionReads: mocks.invalidate,
}));
vi.mock("@/features/workouts/exercise-library-modal", () => ({
  ExerciseLibraryModal: "ExerciseLibraryModal",
}));
vi.mock("@/features/log-workout/log-workout-data", () => ({
  createExerciseWith: vi.fn(),
}));
import { LogPastWorkoutScreen } from "./log-past-workout-screen";

function render() {
  hooks.index = 0;
  const tree = LogPastWorkoutScreen();
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node) return null;
  if (Array.isArray(node))
    return node.map((n) => find(n, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const button = (tree: any, label: string) =>
  find(tree, (n) => n.type === "Button" && n.props.label === label);
const field = (tree: any, label: string) =>
  find(
    tree,
    (n) => n.type === "FormTextInput" && n.props.accessibilityLabel === label,
  );
const text = (tree: any, message: string) =>
  find(tree, (n) => n.type === "FormStatus" && n.props.children === message);
const flush = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};
const draftKey = (userId: string) =>
  `mizyun.logging-draft.${userId}.past-workout`;
const EXERCISE_ID = "22222222-2222-4222-8222-222222222222";
const restored: PastWorkoutDraft = {
  version: 1,
  form: {
    name: "Leg day",
    date: "2020-01-15",
    startTime: "18:00",
    durationMinutes: "60",
    notes: "",
    unitSystem: "metric",
    exercises: [
      {
        key: "ex-1",
        exerciseId: EXERCISE_ID,
        name: "Squat",
        sets: [{ key: "set-1", setType: "normal", reps: "5", load: "100" }],
      },
    ],
  },
  pending: null,
};
const workoutResponse = {
  workout: { id: "33333333-3333-4333-8333-333333333333" },
};
const posts = (method: string, path: string) =>
  mocks.request.mock.calls.filter(
    ([o]) => o.method === method && o.path === path,
  );

async function open() {
  render();
  await flush();
  return render();
}

beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  hooks.index = 0;
  mocks.owner = "user-a";
  mocks.store.clear();
  vi.clearAllMocks();
  mocks.request.mockImplementation(async (o: any) => {
    if (o.method === "GET" && o.path.startsWith("/v1/exercises"))
      return { ok: true, value: { exercises: [], nextCursor: null } };
    return { ok: false, error: { kind: "network_error" } };
  });
});

describe("log past workout screen", () => {
  it("renders defaults and rejects a save with no exercises without sending", async () => {
    const tree = await open();
    expect(button(tree, "Add exercise")).toBeTruthy();
    const time = find(tree, (n) => n.type === "NativeTimePicker");
    expect([time.props.hour, time.props.minute]).toEqual([18, 0]);
    const now = new Date();
    const date = find(tree, (n) => n.type === "NativeDatePicker");
    expect(date.props.maximumDate).toEqual({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    });
    expect(field(tree, "Duration in minutes").props.value).toBe("60");

    button(tree, "Save workout").props.onPress();
    await flush();
    const after = render();
    expect(text(after, "Add at least one exercise with a set.")).toBeTruthy();
    expect(posts("POST", "/v1/workouts")).toHaveLength(0);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("saves a restored draft as a completed past workout and returns to the workouts tab", async () => {
    mocks.store.set(draftKey("user-a"), JSON.stringify(restored));
    mocks.request.mockImplementation(async (o: any) => {
      if (o.method === "GET" && o.path.startsWith("/v1/exercises"))
        return { ok: true, value: { exercises: [], nextCursor: null } };
      if (o.method === "POST" && o.path === "/v1/workouts")
        return { ok: true, value: workoutResponse };
      if (o.method === "GET" && o.path.endsWith("/sets"))
        return { ok: true, value: { workoutSets: [] } };
      if (o.method === "POST" && o.path.endsWith("/sets"))
        return { ok: true, value: { workoutSet: { id: "set" } } };
      throw new Error(`unexpected ${o.method} ${o.path}`);
    });
    let tree = await open();
    expect(field(tree, "Squat set 1 reps").props.value).toBe("5");
    expect(button(tree, "Save workout · 1 set")).toBeTruthy();
    const date = find(tree, (n) => n.type === "NativeDatePicker");
    expect(date.props.value).toEqual({ year: 2020, month: 1, day: 15 });
    date.props.onChange({ year: 2020, month: 1, day: 14 });
    tree = render();
    find(tree, (n) => n.type === "NativeTimePicker").props.onChange(7, 30);
    tree = render();

    button(tree, "Save workout · 1 set").props.onPress();
    await flush();

    const [create] = posts("POST", "/v1/workouts");
    // Picked 14 Jan 2020 at 07:30, plus the 60-minute duration.
    expect(Date.parse(create?.[0].body.completedAt)).toBe(
      new Date(2020, 0, 14, 8, 30).getTime(),
    );
    expect(create?.[0].body.details.entryMode).toBe("past");
    expect(create?.[0].expectedUserId).toBe("user-a");
    const setPath = `/v1/workouts/${workoutResponse.workout.id}/sets`;
    const [set] = posts("POST", setPath);
    expect(set?.[0].body).toMatchObject({
      exerciseId: EXERCISE_ID,
      sequence: 1,
      repetitions: 5,
      loadKg: 100,
    });
    expect(mocks.replace).toHaveBeenCalledWith({
      pathname: "/(tabs)/workouts",
      params: { pastWorkoutSaved: "true" },
    });
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.store.has(draftKey("user-a"))).toBe(false);
  });

  it("keeps the screen open with Retry save and locked inputs after a set network failure", async () => {
    mocks.store.set(draftKey("user-a"), JSON.stringify(restored));
    mocks.request.mockImplementation(async (o: any) => {
      if (o.method === "GET" && o.path.startsWith("/v1/exercises"))
        return { ok: true, value: { exercises: [], nextCursor: null } };
      if (o.method === "POST" && o.path === "/v1/workouts")
        return { ok: true, value: workoutResponse };
      if (o.method === "GET" && o.path.endsWith("/sets"))
        return { ok: true, value: { workoutSets: [] } };
      return { ok: false, error: { kind: "network_error" } };
    });
    const tree = await open();
    button(tree, "Save workout · 1 set").props.onPress();
    await flush();

    const after = render();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(button(after, "Retry save")).toBeTruthy();
    expect(button(after, "Retry save").props.disabled).toBe(false);
    expect(
      find(after, (n) => n.type === "FormStatus" && n.props.tone === "error")
        ?.props.children,
    ).toContain("Network unavailable");
    expect(field(after, "Workout name").props.editable).toBe(false);
    expect(field(after, "Squat set 1 reps").props.editable).toBe(false);
    expect(field(after, "Squat set 1 weight in kg").props.editable).toBe(false);
    expect(button(after, "Add exercise").props.disabled).toBe(true);
    // The confirmed workout and frozen request are retained for the retry.
    const kept = JSON.parse(mocks.store.get(draftKey("user-a"))!);
    expect(kept.pending.workoutId).toBe(workoutResponse.workout.id);
  });

  it("adds a saved custom exercise from the library without creating a record", async () => {
    const custom = {
      id: "44444444-4444-4444-8444-444444444444",
      userId: "user-a",
      name: "Sled push",
      instructions: null,
      metadata: { custom: true, trackingMode: "load_reps" },
      createdAt: "2026-10-19T10:00:00.000Z",
      updatedAt: "2026-10-19T10:00:00.000Z",
    };
    let tree = await open();
    const library = find(tree, (n) => n.type === "ExerciseLibraryModal");
    await expect(library.props.onSelectExercises([custom])).resolves.toBe(true);
    tree = render();
    expect(field(tree, "Sled push set 1 reps")).toBeTruthy();
    const { createExerciseWith } =
      await import("@/features/log-workout/log-workout-data");
    expect(createExerciseWith).not.toHaveBeenCalled();
    expect(posts("POST", "/v1/exercises")).toHaveLength(0);
  });

  it("refuses a timed custom exercise, since past workouts record weight and reps", async () => {
    const plank = {
      id: "55555555-5555-4555-8555-555555555555",
      userId: "user-a",
      name: "Wall hold",
      instructions: null,
      metadata: { custom: true, trackingMode: "duration" },
      createdAt: "2026-10-19T10:00:00.000Z",
      updatedAt: "2026-10-19T10:00:00.000Z",
    };
    let tree = await open();
    const library = find(tree, (n) => n.type === "ExerciseLibraryModal");
    await expect(library.props.onSelectExercises([plank])).resolves.toBe(false);
    tree = render();
    expect(
      find(tree, (n) => n.type === "ExerciseLibraryModal").props.errorMessage,
    ).toBe(
      "Past workouts record weight and reps, so Wall hold can't be added here. Use Log activity for timed exercises.",
    );
    expect(field(tree, "Wall hold set 1 reps")).toBeFalsy();
  });
});
