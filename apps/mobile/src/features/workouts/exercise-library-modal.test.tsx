import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => {},
  useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
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
vi.mock("@mizyun/core", () => ({
  searchExerciseCatalog: mocks.search,
  EXERCISE_CATALOG: Array(125),
}));

import { ExerciseLibraryModal } from "./exercise-library-modal";

const entries = Array.from({ length: 125 }, (_, index) => ({
  id: `exercise-${index}`,
  name: `Exercise ${index}`,
  movementPattern: "core",
  equipment: ["bodyweight"],
  primaryMuscles: ["abdominals"],
  secondaryMuscles: [],
  category: "strength",
  description: "A controlled core movement.",
  instructions: ["Lie on your back.", "Return with control."],
  tips: ["Breathe steadily."],
  commonMistakes: ["Do not pull your neck."],
  demonstration: null,
}));
function render(): any {
  hooks.index = 0;
  return ExerciseLibraryModal({ visible: true, onClose: vi.fn() });
}
function all(node: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(node))
    return node.flatMap((child) => all(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...all(node.props?.children, predicate),
  ];
}
const action = (tree: any, label: string) =>
  all(tree, (node) => node.props?.accessibilityLabel === label)[0];
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
const cards = (tree: any) =>
  all(tree, (node) => node.props?.accessibilityLabel?.startsWith("Toggle "));

beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  mocks.search
    .mockReset()
    .mockImplementation(
      ({ query, limit }: { query?: string; limit?: number }) => {
        const matches = query === "specific" ? entries.slice(0, 2) : entries;
        return matches.slice(0, limit ?? matches.length);
      },
    );
});
describe("exercise library browsing", () => {
  it("makes every matching exercise reachable beyond the first 60", () => {
    let tree = render();
    expect(cards(tree)).toHaveLength(60);
    expect(text(tree)).toContain("Showing 60 of 125 exercises");
    action(tree, "Load more exercises").props.onPress();
    tree = render();
    expect(cards(tree)).toHaveLength(120);
    action(tree, "Load more exercises").props.onPress();
    tree = render();
    expect(cards(tree)).toHaveLength(125);
    expect(action(tree, "Load more exercises")).toBeUndefined();
  });
  it("resets the visible page when search or the movement filter changes", () => {
    action(render(), "Load more exercises").props.onPress();
    let tree = render();
    all(tree, (node) => node.type === "TextInput")[0].props.onChangeText(
      "specific",
    );
    tree = render();
    expect(cards(tree)).toHaveLength(2);
    all(tree, (node) => node.type === "TextInput")[0].props.onChangeText("");
    tree = render();
    expect(cards(tree)).toHaveLength(60);
    action(tree, "Load more exercises").props.onPress();
    action(render(), "Filter Core").props.onPress();
    expect(cards(render())).toHaveLength(60);
  });
  it("separates the summary, numbered steps, tips and common mistakes", () => {
    action(render(), "Toggle Exercise 0").props.onPress();
    const tree = render();
    const strings = all(tree, (node) => node.type === "ThemedText").map(text);
    expect(strings).toContain("A controlled core movement.");
    expect(strings).toContain("1. Lie on your back.");
    expect(strings).toContain("2. Return with control.");
    expect(strings).toContain("Form tips");
    expect(strings).toContain("• Breathe steadily.");
    expect(strings).toContain("Common mistakes");
    expect(strings).toContain("• Do not pull your neck.");
    expect(text(tree)).not.toContain("science-backed");
  });
});

it("selects across searches and submits multiple exercises together", async () => {
  const add = vi.fn().mockResolvedValue(true);
  const close = vi.fn();
  const renderBatch = () => {
    hooks.index = 0;
    return ExerciseLibraryModal({
      visible: true,
      onClose: close,
      onSelectExercises: add,
    });
  };
  let tree = renderBatch();
  action(tree, "Quick select Exercise 0").props.onPress();
  tree = renderBatch();
  action(tree, "Search exercise library").props.onChangeText("specific");
  tree = renderBatch();
  expect(
    action(tree, "Quick select Exercise 0").props.accessibilityState.selected,
  ).toBe(true);
  action(tree, "Quick select Exercise 1").props.onPress();
  tree = renderBatch();
  await action(tree, "Add 2 exercises").props.onPress();
  await Promise.resolve();
  expect(add).toHaveBeenCalledWith([entries[0], entries[1]]);
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps a failed batch selected for retry and permits deselection", async () => {
  const add = vi.fn().mockResolvedValue(false);
  const close = vi.fn();
  const renderBatch = () => {
    hooks.index = 0;
    return ExerciseLibraryModal({
      visible: true,
      onClose: close,
      onSelectExercises: add,
    });
  };
  let tree = renderBatch();
  action(tree, "Quick select Exercise 0").props.onPress();
  tree = renderBatch();
  action(tree, "Add 1 exercises").props.onPress();
  await Promise.resolve();
  await Promise.resolve();
  tree = renderBatch();
  expect(close).not.toHaveBeenCalled();
  expect(text(tree)).toContain("Could not add all selected exercises");
  expect(
    action(tree, "Quick select Exercise 0").props.accessibilityState.selected,
  ).toBe(true);
  action(tree, "Quick select Exercise 0").props.onPress();
  tree = renderBatch();
  expect(action(tree, "Add 0 exercises").props.disabled).toBe(true);
});

it("guards repeated calls before rerender and releases the guard for retry", async () => {
  let finish!: (success: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const add = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(true);
  const close = vi.fn();
  const renderBatch = () => {
    hooks.index = 0;
    return ExerciseLibraryModal({
      visible: true,
      onClose: close,
      onSelectExercises: add,
    });
  };
  let tree = renderBatch();
  action(tree, "Quick select Exercise 0").props.onPress();
  tree = renderBatch();
  const submit = action(tree, "Add 1 exercises").props.onPress;
  submit();
  submit();
  expect(add).toHaveBeenCalledTimes(1);
  action(tree, "Close library").props.onPress();
  expect(close).not.toHaveBeenCalled();
  finish(false);
  await Promise.resolve();
  await Promise.resolve();
  tree = renderBatch();
  expect(
    action(tree, "Quick select Exercise 0").props.accessibilityState.selected,
  ).toBe(true);
  action(tree, "Add 1 exercises").props.onPress();
  await Promise.resolve();
  await Promise.resolve();
  expect(add).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(1);
});

it("exposes independent details and selection controls to native accessibility", () => {
  const renderBatch = () => {
    hooks.index = 0;
    return ExerciseLibraryModal({
      visible: true,
      onClose: vi.fn(),
      onSelectExercises: vi.fn(),
    });
  };
  let tree = renderBatch();
  const details = action(tree, "Toggle Exercise 0");
  const select = action(tree, "Quick select Exercise 0");
  expect(select.props.style.minHeight).toBe(48);
  expect(select.props.style.minWidth).toBe(48);
  expect(all(details.props.children, (node) => node === select)).toHaveLength(
    0,
  );
  expect(all(select.props.children, (node) => node === details)).toHaveLength(
    0,
  );
  details.props.onPress();
  tree = renderBatch();
  expect(
    action(tree, "Toggle Exercise 0").props.accessibilityState.expanded,
  ).toBe(true);
  expect(
    action(tree, "Quick select Exercise 0").props.accessibilityState.selected,
  ).toBe(false);
  action(tree, "Quick select Exercise 0").props.onPress();
  tree = renderBatch();
  expect(
    action(tree, "Toggle Exercise 0").props.accessibilityState.expanded,
  ).toBe(true);
  expect(
    action(tree, "Quick select Exercise 0").props.accessibilityState.selected,
  ).toBe(true);
  expect(action(tree, "Add 1 exercises")).toBeDefined();
});
