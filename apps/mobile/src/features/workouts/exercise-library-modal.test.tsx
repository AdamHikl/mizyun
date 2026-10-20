import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  loadSaved: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  // Effects are collected per render and only run when a test asks.
  useEffect: (effect: () => void) => {
    hooks.effects.push(effect);
  },
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
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Chip: "Chip",
  FormField: "FormField",
  FormStatus: "FormStatus",
  FormTextInput: "FormTextInput",
  Icon: "Icon",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  Notice: "Notice",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "black" }) }));
vi.mock("@/constants/theme", () => ({
  MinTouchTarget: 44,
  Radius: {},
  Spacing: {},
}));
vi.mock("./exercise-progression-modal", () => ({
  ExerciseProgressionModal: "ExerciseProgressionModal",
}));
vi.mock("./custom-exercise-editor", () => ({
  CustomExerciseEditor: "CustomExerciseEditor",
  TRACKING_MODE_LABELS: {
    load_reps: "Weight & reps",
    duration: "Time",
    duration_distance: "Time & distance",
  },
}));
vi.mock("./custom-exercises-data", () => ({
  loadSavedExercises: mocks.loadSaved,
}));
vi.mock("@mizyun/core", () => ({
  searchExerciseCatalog: mocks.search,
  EXERCISE_CATALOG: Array(125),
  customExerciseTrackingMode: (exercise: any) =>
    exercise.metadata?.trackingMode ?? "load_reps",
  searchCustomExercises: (records: any[], query: string) =>
    records.filter((record) =>
      record.name.toLowerCase().includes(query.trim().toLowerCase()),
    ),
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
  hooks.effects = [];
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
  hooks.effects = [];
  mocks.loadSaved
    .mockReset()
    .mockResolvedValue({ ok: true, exercises: [], truncated: false });
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

it("adds an exercise on a single tap and stays open in add-on-tap mode", async () => {
  const add = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const close = vi.fn();
  const renderLive = () => {
    hooks.index = 0;
    return ExerciseLibraryModal({
      visible: true,
      onClose: close,
      onSelectExercises: add,
      addOnTap: true,
    });
  };
  let tree = renderLive();
  expect(
    all(tree, (node) => node.props?.accessibilityLabel?.startsWith("Add ")),
  ).toHaveLength(0);
  action(tree, "Quick select Exercise 0").props.onPress();
  await Promise.resolve();
  await Promise.resolve();
  tree = renderLive();
  expect(add).toHaveBeenLastCalledWith([entries[0]]);
  expect(text(tree)).toContain("Could not add Exercise 0. Try again.");
  expect(
    action(tree, "Quick select Exercise 0").props.accessibilityState.selected,
  ).toBe(false);
  action(tree, "Quick select Exercise 0").props.onPress();
  await Promise.resolve();
  await Promise.resolve();
  tree = renderLive();
  const added = action(tree, "Quick select Exercise 0");
  expect(added.props.accessibilityState.selected).toBe(true);
  expect(added.props.disabled).toBe(true);
  expect(text(tree)).toContain("Added");
  action(tree, "Quick select Exercise 1").props.onPress();
  await Promise.resolve();
  await Promise.resolve();
  expect(add).toHaveBeenLastCalledWith([entries[1]]);
  expect(add).toHaveBeenCalledTimes(3);
  expect(close).not.toHaveBeenCalled();
});

describe("custom exercises", () => {
  const custom = (id: string, name: string, trackingMode = "load_reps") => ({
    id,
    userId: "user-1",
    name,
    instructions: null,
    metadata: { custom: true, trackingMode },
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-19T10:00:00.000Z",
  });
  const sled = custom(
    "00000000-0000-4000-8000-000000000001",
    "Sled push",
    "duration",
  );
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  /** Render, run that render's effects (the open load), and settle. */
  const open = async (props: Record<string, unknown> = {}) => {
    const renderWith = () => {
      hooks.index = 0;
      hooks.effects = [];
      return ExerciseLibraryModal({
        visible: true,
        onClose: vi.fn(),
        ...props,
      } as any);
    };
    renderWith();
    hooks.effects.forEach((effect) => effect());
    await flush();
    return renderWith;
  };
  const editor = (tree: any) =>
    all(tree, (node) => node.type === "CustomExerciseEditor")[0];

  it("lists my exercises with their tracking type and opens one for editing", async () => {
    mocks.loadSaved.mockResolvedValue({
      ok: true,
      exercises: [sled],
      truncated: false,
    });
    const renderWith = await open();
    let tree = renderWith();
    const header = (tree: any) =>
      all(tree, (node) => node.props?.title === "My exercises");
    expect(header(tree)).toHaveLength(1);
    expect(text(tree)).toContain("Custom · Time");
    expect(action(tree, "Quick select Sled push")).toBeUndefined();
    expect(editor(tree)).toBeUndefined();
    action(tree, "Edit Sled push").props.onPress();
    tree = renderWith();
    expect(editor(tree).props.exercise).toBe(sled);
  });

  it("searches my exercises and hides them under a movement filter", async () => {
    mocks.loadSaved.mockResolvedValue({
      ok: true,
      exercises: [
        sled,
        custom("00000000-0000-4000-8000-000000000002", "Atlas carry"),
      ],
      truncated: true,
    });
    const renderWith = await open();
    let tree = renderWith();
    expect(text(tree)).toContain("Showing your first 200 saved exercises.");
    action(tree, "Search exercise library").props.onChangeText("atlas");
    tree = renderWith();
    expect(action(tree, "Edit Atlas carry")).toBeDefined();
    expect(action(tree, "Edit Sled push")).toBeUndefined();
    action(tree, "Filter Core").props.onPress();
    tree = renderWith();
    expect(
      all(tree, (node) => node.props?.title === "My exercises"),
    ).toHaveLength(0);
    expect(action(tree, "Edit Atlas carry")).toBeUndefined();
  });

  it("shows a load failure and retries", async () => {
    mocks.loadSaved.mockResolvedValueOnce({ ok: false, message: "Offline." });
    const renderWith = await open();
    let tree = renderWith();
    expect(text(tree)).toContain("Offline.");
    mocks.loadSaved.mockResolvedValueOnce({
      ok: true,
      exercises: [sled],
      truncated: false,
    });
    action(tree, "Retry loading my exercises").props.onPress();
    await flush();
    tree = renderWith();
    expect(text(tree)).not.toContain("Offline.");
    expect(action(tree, "Edit Sled push")).toBeDefined();
  });

  it("selects custom and catalog exercises together in tap order", async () => {
    mocks.loadSaved.mockResolvedValue({
      ok: true,
      exercises: [sled],
      truncated: false,
    });
    const add = vi.fn().mockResolvedValue(true);
    const renderWith = await open({ onSelectExercises: add });
    let tree = renderWith();
    action(tree, "Quick select Exercise 0").props.onPress();
    tree = renderWith();
    action(tree, "Quick select Sled push").props.onPress();
    tree = renderWith();
    await action(tree, "Add 2 exercises").props.onPress();
    await flush();
    expect(add).toHaveBeenCalledWith([entries[0], sled]);
  });

  it("creates from the search text, selects the new exercise and drops a deleted one", async () => {
    const add = vi.fn().mockResolvedValue(true);
    const renderWith = await open({ onSelectExercises: add });
    let tree = renderWith();
    expect(text(tree)).toContain("Exercises you create appear here.");
    action(tree, "Search exercise library").props.onChangeText("sled");
    tree = renderWith();
    action(tree, "Create custom exercise").props.onPress();
    tree = renderWith();
    expect(editor(tree).props).toMatchObject({
      exercise: null,
      initialName: "sled",
    });
    editor(tree).props.onSaved(sled, true);
    tree = renderWith();
    expect(editor(tree)).toBeUndefined();
    expect(
      action(tree, "Quick select Sled push").props.accessibilityState.selected,
    ).toBe(true);
    expect(action(tree, "Add 1 exercises")).toBeDefined();
    action(tree, "Edit Sled push").props.onPress();
    tree = renderWith();
    editor(tree).props.onDeleted(sled.id);
    tree = renderWith();
    expect(action(tree, "Edit Sled push")).toBeUndefined();
    expect(action(tree, "Add 0 exercises").props.disabled).toBe(true);
  });

  it("adds a newly created exercise at once in add-on-tap mode", async () => {
    const add = vi.fn().mockResolvedValue(true);
    const renderWith = await open({ onSelectExercises: add, addOnTap: true });
    let tree = renderWith();
    action(tree, "Create custom exercise").props.onPress();
    tree = renderWith();
    editor(tree).props.onSaved(sled, true);
    await flush();
    expect(add).toHaveBeenCalledWith([sled]);
    tree = renderWith();
    expect(
      action(tree, "Quick select Sled push").props.accessibilityState.selected,
    ).toBe(true);
  });

  it("keeps a renamed exercise selected under its new name", async () => {
    mocks.loadSaved.mockResolvedValue({
      ok: true,
      exercises: [sled],
      truncated: false,
    });
    const add = vi.fn().mockResolvedValue(true);
    const renderWith = await open({ onSelectExercises: add });
    let tree = renderWith();
    action(tree, "Quick select Sled push").props.onPress();
    tree = renderWith();
    action(tree, "Edit Sled push").props.onPress();
    tree = renderWith();
    const renamed = { ...sled, name: "Heavy sled push" };
    editor(tree).props.onSaved(renamed, false);
    tree = renderWith();
    await action(tree, "Add 1 exercises").props.onPress();
    await flush();
    expect(add).toHaveBeenCalledWith([renamed]);
  });

  it("keeps Create off until the complete saved list has loaded", async () => {
    let tree = render();
    expect(action(tree, "Create custom exercise").props.disabled).toBe(true);
    expect(text(tree)).toContain("Loading your exercises…");

    hooks.slots = [];
    mocks.loadSaved.mockResolvedValueOnce({ ok: false, message: "Offline." });
    let renderWith = await open();
    expect(action(renderWith(), "Create custom exercise").props.disabled).toBe(
      true,
    );

    hooks.slots = [];
    mocks.loadSaved.mockResolvedValueOnce({
      ok: true,
      exercises: [sled],
      truncated: true,
    });
    renderWith = await open();
    tree = renderWith();
    expect(action(tree, "Create custom exercise").props.disabled).toBe(true);
    expect(text(tree)).toContain("new names can't be checked for duplicates");

    hooks.slots = [];
    renderWith = await open();
    expect(action(renderWith(), "Create custom exercise").props.disabled).toBe(
      false,
    );
  });

  it("opens exercises already in the workout read-only", async () => {
    const other = custom("00000000-0000-4000-8000-000000000003", "Atlas carry");
    mocks.loadSaved.mockResolvedValue({
      ok: true,
      exercises: [sled, other],
      truncated: false,
    });
    const add = vi.fn().mockResolvedValue(true);
    const renderWith = await open({
      onSelectExercises: add,
      addOnTap: true,
      inUseExerciseIds: [sled.id],
    });
    let tree = renderWith();
    action(tree, "Edit Sled push").props.onPress();
    tree = renderWith();
    expect(editor(tree).props.inCurrentWorkout).toBe(true);
    editor(tree).props.onClose();
    tree = renderWith();
    action(tree, "Edit Atlas carry").props.onPress();
    tree = renderWith();
    expect(editor(tree).props.inCurrentWorkout).toBe(false);
    editor(tree).props.onClose();
    tree = renderWith();
    action(tree, "Quick select Atlas carry").props.onPress();
    await flush();
    tree = renderWith();
    action(tree, "Edit Atlas carry").props.onPress();
    tree = renderWith();
    expect(editor(tree).props.inCurrentWorkout).toBe(true);
  });

  it("does not let a late list load drop a just-created exercise", async () => {
    let finish!: (value: unknown) => void;
    mocks.loadSaved
      .mockResolvedValueOnce({ ok: true, exercises: [], truncated: false })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    const renderWith = await open();
    let tree = renderWith();
    // A second load (e.g. Retry) is still in flight when the create lands.
    hooks.effects.forEach((effect) => effect());
    action(tree, "Create custom exercise").props.onPress();
    tree = renderWith();
    editor(tree).props.onSaved(sled, true);
    finish({ ok: true, exercises: [], truncated: false });
    await flush();
    tree = renderWith();
    expect(action(tree, "Edit Sled push")).toBeDefined();
  });
});
