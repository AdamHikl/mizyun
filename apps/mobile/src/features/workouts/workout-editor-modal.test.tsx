import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => {},
  useCallback: (callback: unknown) => callback,
  useMemo: (callback: () => unknown) => callback(),
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
}));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "black" }) }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("./exercise-progression-modal", () => ({
  ExerciseProgressionModal: "ExerciseProgressionModal",
}));

vi.mock("./exercise-library-modal", () => ({
  ExerciseLibraryModal: "ExerciseLibraryModal",
}));
vi.mock("./set-type-modal", async (original) => ({
  ...(await original<typeof import("./set-type-modal")>()),
  SetTypeModal: "SetTypeModal",
}));
vi.mock("./workout-preferences", () => ({
  DEFAULT_REST_SECONDS: 75,
  loadWorkoutPreferences: async () => ({ defaultRestSeconds: 75 }),
}));
vi.mock("./workouts-hub-data", () => ({
  createCustomWorkout: mocks.save,
  updateWorkoutDetails: mocks.save,
}));
import { WorkoutEditorModal } from "./workout-editor-modal";
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function render(): any {
  hooks.index = 0;
  return WorkoutEditorModal({ visible: true, onClose: vi.fn() });
}
it("appends a batch to a routine while retaining custom names and edited targets", async () => {
  hooks.slots = [];
  mocks.save.mockResolvedValue({ ok: true, workout: { id: "saved" } });
  let tree = render();
  hooks.slots[0] = "My routine";
  hooks.slots[2] = [
    {
      name: "My custom movement",
      targetSets: 5,
      targetReps: "6-8",
      targetLoad: "22 kg",
      restSeconds: 90,
    },
  ];
  tree = render();
  const library = find(tree, (node) => node.type === "ExerciseLibraryModal");
  expect(
    library.props.onSelectExercises([
      { id: "squat", name: "Squat", movementPattern: "knee_dominant" },
      { id: "row", name: "Row", movementPattern: "horizontal_pull" },
    ]),
  ).toBe(true);
  tree = render();
  await find(
    tree,
    (node) => node.props?.accessibilityLabel === "Save workout routine",
  ).props.onPress();
  expect(mocks.save).toHaveBeenCalled();
  expect(hooks.slots[2]).toEqual([
    {
      name: "My custom movement",
      targetSets: 5,
      targetReps: "6-8",
      targetLoad: "22 kg",
      restSeconds: 90,
    },
    expect.objectContaining({
      name: "Squat",
      targetSets: 3,
      targetReps: "8-12",
      restSeconds: 75,
    }),
    expect.objectContaining({
      name: "Row",
      targetSets: 3,
      targetReps: "8-12",
      restSeconds: 75,
    }),
  ]);
});

it("saves per-set routine types and preserves existing choices when the set count changes", async () => {
  hooks.slots = [];
  mocks.save
    .mockReset()
    .mockResolvedValue({ ok: true, workout: { id: "saved" } });
  render();
  hooks.slots[0] = "My routine";
  hooks.slots[2] = [
    {
      name: "Squat",
      targetSets: 3,
      targetReps: "6-8",
      setTypes: ["warmup", "normal", "failure"],
    },
  ];
  const row = () => {
    const element = find(
      render(),
      (node) => node.type?.name === "PlannedExerciseRow",
    );
    hooks.index = 100;
    return element.type(element.props);
  };
  let tree = row();
  find(
    tree,
    (node) =>
      node.props?.accessibilityLabel === "Squat, planned set 2 type: Normal",
  ).props.onPress();
  tree = row();
  const modal = find(tree, (node) => node.type === "SetTypeModal");
  expect(modal.props.currentType).toBe("normal");
  modal.props.onSelectType("drop");
  tree = row();
  find(
    tree,
    (node) => node.props?.accessibilityLabel === "Increase sets",
  ).props.onPress();
  expect(hooks.slots[2][0].setTypes).toEqual([
    "warmup",
    "drop",
    "failure",
    "normal",
  ]);
  tree = row();
  find(
    tree,
    (node) => node.props?.accessibilityLabel === "Decrease sets",
  ).props.onPress();
  expect(hooks.slots[2][0].setTypes).toEqual(["warmup", "drop", "failure"]);
  await find(
    render(),
    (node) => node.props?.accessibilityLabel === "Save workout routine",
  ).props.onPress();
  expect(mocks.save.mock.lastCall?.[0].plannedExercises[0].setTypes).toEqual([
    "warmup",
    "drop",
    "failure",
  ]);
});
