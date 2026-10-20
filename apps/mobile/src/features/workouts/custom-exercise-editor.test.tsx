import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Exercise } from "@mizyun/contracts";

const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as Array<() => unknown>,
}));
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  usage: vi.fn(),
  alert: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (callback: () => unknown) => {
    hooks.effects.push(callback);
  },
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
}));
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  Modal: "Modal",
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  ChoiceChip: "ChoiceChip",
  ChoiceGroup: "ChoiceGroup",
  FormField: "FormField",
  FormStatus: "FormStatus",
  FormTextInput: "FormTextInput",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ separator: "gray" }),
}));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("./custom-exercises-data", () => ({
  createCustomExercise: mocks.create,
  updateCustomExercise: mocks.update,
  deleteCustomExercise: mocks.remove,
  loadExerciseUsage: mocks.usage,
}));

import { CustomExerciseEditor } from "./custom-exercise-editor";

const EXERCISE: Exercise = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  name: "Sled push",
  instructions: "Low hips",
  metadata: { custom: true, trackingMode: "load_reps" },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const onClose = vi.fn();
const onSaved = vi.fn();
const onDeleted = vi.fn();
let props: Record<string, unknown> = {};

const baseProps = () => ({
  visible: true,
  exercise: null,
  savedExercises: [],
  onClose,
  onSaved,
  onDeleted,
});

function render(): any {
  hooks.index = 0;
  hooks.effects = [];
  return CustomExerciseEditor(props as any);
}
/** Renders, runs the open effect once (as React does on mount), re-renders. */
function open(overrides: Record<string, unknown> = {}): any {
  props = { ...baseProps(), ...overrides };
  render();
  reopen();
  return render();
}
/** Runs the effects collected by the latest render again (close + reopen). */
function reopen() {
  for (const effect of hooks.effects) effect();
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function all(node: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(node))
    return node.flatMap((child) => all(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...all(node.props?.children, predicate),
  ];
}
const byLabel = (tree: any, label: string) =>
  all(tree, (node) => node.props?.accessibilityLabel === label)[0];
const chips = (tree: any) => all(tree, (node) => node.type === "ChoiceChip");
const chip = (tree: any, label: string) =>
  chips(tree).find((node) => node.props.label === label);
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
const statuses = (tree: any) =>
  all(tree, (node) => node.type === "FormStatus").map(text);
const press = async (tree: any, label: string) => {
  byLabel(tree, label).props.onPress();
  await flush();
  return render();
};

beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  hooks.effects = [];
  for (const mock of Object.values(mocks)) mock.mockReset();
  onClose.mockReset();
  onSaved.mockReset();
  onDeleted.mockReset();
  mocks.usage.mockResolvedValue({ ok: true, hasLoggedSets: false });
});

describe("creating a custom exercise", () => {
  it("prefills the trimmed initial name and defaults to weight and reps", () => {
    const tree = open({ initialName: "  Sled push  " });
    expect(byLabel(tree, "Exercise name").props.value).toBe("Sled push");
    expect(chip(tree, "Weight & reps").props.selected).toBe(true);
    expect(chip(tree, "Time").props.selected).toBe(false);
    expect(chip(tree, "Weight & reps").props.disabled).toBe(false);
    expect(byLabel(tree, "Delete Sled push")).toBeUndefined();
    expect(mocks.usage).not.toHaveBeenCalled();
  });

  it("blocks a blank name without making a request", async () => {
    let tree = open({ initialName: "   " });
    tree = await press(tree, "Save exercise");
    expect(statuses(tree)).toContain("Name the exercise.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves the normalized value and reports the created exercise", async () => {
    mocks.create.mockResolvedValue({ ok: true, exercise: EXERCISE });
    let tree = open();
    byLabel(tree, "Exercise name").props.onChangeText("  Sled   push ");
    byLabel(tree, "Exercise notes").props.onChangeText("  Low hips ");
    chip(render(), "Time & distance").props.onPress();
    tree = render();
    await press(tree, "Save exercise");
    expect(mocks.create).toHaveBeenCalledWith({
      name: "Sled push",
      instructions: "Low hips",
      trackingMode: "duration_distance",
    });
    expect(onSaved).toHaveBeenCalledWith(EXERCISE, true);
  });

  it("shows the server message and stays open when the save fails", async () => {
    mocks.create.mockResolvedValue({
      ok: false,
      message: "Please double-check the exercise.",
    });
    let tree = open({ initialName: "Sled push" });
    tree = await press(tree, "Save exercise");
    expect(statuses(tree)).toContain("Please double-check the exercise.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(byLabel(tree, "Save exercise").props.disabled).toBe(false);
  });

  it("rejects a catalog exercise name", async () => {
    let tree = open({ initialName: "Forearm plank" });
    tree = await press(tree, "Save exercise");
    expect(statuses(tree).join()).toContain("already in the library");
    expect(statuses(tree).join()).toContain("Forearm plank");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a name that duplicates a saved exercise", async () => {
    let tree = open({
      initialName: "sled  PUSH",
      savedExercises: [EXERCISE],
    });
    tree = await press(tree, "Save exercise");
    expect(statuses(tree)).toContain(
      "You already have an exercise called “Sled push”.",
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("closes through Cancel", () => {
    const tree = open();
    byLabel(tree, "Cancel exercise changes").props.onPress();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("editing a custom exercise", () => {
  it("loads the exercise values and checks usage", async () => {
    mocks.usage.mockResolvedValue({ ok: true, hasLoggedSets: false });
    let tree = open({ exercise: EXERCISE, savedExercises: [EXERCISE] });
    expect(mocks.usage).toHaveBeenCalledWith(EXERCISE.id);
    await flush();
    tree = render();
    expect(byLabel(tree, "Exercise name").props.value).toBe("Sled push");
    expect(byLabel(tree, "Exercise notes").props.value).toBe("Low hips");
    expect(chip(tree, "Weight & reps").props.selected).toBe(true);
    expect(chip(tree, "Weight & reps").props.disabled).toBe(false);
    expect(byLabel(tree, "Delete Sled push").props.disabled).toBe(false);
    expect(statuses(tree)).toEqual([]);
  });

  it("locks tracking and delete while the usage check is pending", () => {
    mocks.usage.mockReturnValue(new Promise(() => {}));
    const tree = open({ exercise: EXERCISE });
    expect(text(tree)).toContain("Checking for logged sets");
    expect(chips(tree).every((node) => node.props.disabled)).toBe(true);
    expect(byLabel(tree, "Delete Sled push").props.disabled).toBe(true);
  });

  it("locks tracking and delete when the exercise has logged sets", async () => {
    mocks.usage.mockResolvedValue({ ok: true, hasLoggedSets: true });
    open({ exercise: EXERCISE, savedExercises: [EXERCISE] });
    await flush();
    const tree = render();
    expect(chips(tree)).toHaveLength(3);
    expect(chips(tree).every((node) => node.props.disabled)).toBe(true);
    expect(byLabel(tree, "Delete Sled push").props.disabled).toBe(true);
    expect(statuses(tree).join()).toContain("has logged sets");
  });

  it("locks tracking and delete when usage cannot be checked", async () => {
    mocks.usage.mockResolvedValue({ ok: false });
    open({ exercise: EXERCISE });
    await flush();
    const tree = render();
    expect(chips(tree).every((node) => node.props.disabled)).toBe(true);
    expect(byLabel(tree, "Delete Sled push").props.disabled).toBe(true);
    expect(statuses(tree).join()).toContain("Couldn't check");
  });

  it("keeps the original tracking mode on save when it is locked", async () => {
    mocks.usage.mockResolvedValue({ ok: true, hasLoggedSets: true });
    const updated = { ...EXERCISE, name: "Sled drag" };
    mocks.update.mockResolvedValue({ ok: true, exercise: updated });
    open({ exercise: EXERCISE, savedExercises: [EXERCISE] });
    await flush();
    let tree = render();
    // A disabled chip cannot be pressed in the app; force the state anyway.
    chip(tree, "Time").props.onPress();
    byLabel(render(), "Exercise name").props.onChangeText("Sled drag");
    tree = render();
    expect(chip(tree, "Time").props.selected).toBe(true);
    await press(tree, "Save exercise");
    expect(mocks.update).toHaveBeenCalledWith(EXERCISE, {
      name: "Sled drag",
      instructions: "Low hips",
      trackingMode: "load_reps",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(updated, false);
  });

  it("allows an unused exercise to change tracking mode", async () => {
    mocks.update.mockResolvedValue({ ok: true, exercise: EXERCISE });
    open({ exercise: EXERCISE, savedExercises: [EXERCISE] });
    await flush();
    chip(render(), "Time").props.onPress();
    const tree = render();
    await press(tree, "Save exercise");
    expect(mocks.update).toHaveBeenCalledWith(
      EXERCISE,
      expect.objectContaining({ trackingMode: "duration" }),
    );
  });

  it("deletes after the confirmation and reports the id", async () => {
    mocks.remove.mockResolvedValue({ ok: true });
    open({ exercise: EXERCISE });
    await flush();
    let tree = render();
    byLabel(tree, "Delete Sled push").props.onPress();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.alert.mock.calls[0]?.[0]).toBe("Delete Sled push?");
    expect(mocks.remove).not.toHaveBeenCalled();
    const buttons = mocks.alert.mock.calls[0]?.[2] as Array<{
      style?: string;
      onPress?: () => void;
    }>;
    buttons.find((button) => button.style === "destructive")?.onPress?.();
    await flush();
    tree = render();
    expect(mocks.remove).toHaveBeenCalledWith(EXERCISE.id);
    expect(onDeleted).toHaveBeenCalledWith(EXERCISE.id);
  });

  it("does not delete when the confirmation is cancelled", async () => {
    open({ exercise: EXERCISE });
    await flush();
    byLabel(render(), "Delete Sled push").props.onPress();
    const buttons = mocks.alert.mock.calls[0]?.[2] as Array<{
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons.find((button) => button.style === "cancel")?.onPress).toBe(
      undefined,
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("shows the in-use message and disables delete after a 409", async () => {
    const message =
      "This exercise has logged sets, so it stays to keep your history.";
    mocks.remove.mockResolvedValue({ ok: false, inUse: true, message });
    open({ exercise: EXERCISE });
    await flush();
    byLabel(render(), "Delete Sled push").props.onPress();
    const buttons = mocks.alert.mock.calls[0]?.[2] as Array<{
      style?: string;
      onPress?: () => void;
    }>;
    buttons.find((button) => button.style === "destructive")?.onPress?.();
    await flush();
    const tree = render();
    expect(statuses(tree)).toContain(message);
    expect(byLabel(tree, "Delete Sled push").props.disabled).toBe(true);
    expect(chips(tree).every((node) => node.props.disabled)).toBe(true);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("ignores a usage check that finishes after close and reopen", async () => {
    let finishStale!: (value: unknown) => void;
    mocks.usage
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishStale = resolve;
        }),
      )
      .mockResolvedValueOnce({ ok: true, hasLoggedSets: false });
    let tree = open({ exercise: EXERCISE });
    byLabel(tree, "Cancel exercise changes").props.onPress();
    expect(onClose).toHaveBeenCalledTimes(1);
    reopen();
    await flush();
    tree = render();
    expect(byLabel(tree, "Delete Sled push").props.disabled).toBe(false);
    finishStale({ ok: true, hasLoggedSets: true });
    await flush();
    tree = render();
    expect(byLabel(tree, "Delete Sled push").props.disabled).toBe(false);
    expect(chips(tree).every((node) => !node.props.disabled)).toBe(true);
    expect(statuses(tree)).toEqual([]);
  });

  it("ignores a usage check that finishes after close", async () => {
    let finishStale!: (value: unknown) => void;
    mocks.usage.mockReturnValueOnce(
      new Promise((resolve) => {
        finishStale = resolve;
      }),
    );
    let tree = open({ exercise: EXERCISE });
    byLabel(tree, "Cancel exercise changes").props.onPress();
    finishStale({ ok: true, hasLoggedSets: false });
    await flush();
    tree = render();
    expect(text(tree)).toContain("Checking for logged sets");
  });

  it("shows an exercise in the open workout read-only", async () => {
    open({
      exercise: EXERCISE,
      savedExercises: [EXERCISE],
      inCurrentWorkout: true,
    });
    await flush();
    const tree = render();
    expect(statuses(tree)).toContain(
      "This exercise is in your open workout. Edit or delete it after you finish.",
    );
    expect(byLabel(tree, "Exercise name").props.editable).toBe(false);
    expect(byLabel(tree, "Exercise notes").props.editable).toBe(false);
    expect(chips(tree).every((node) => node.props.disabled)).toBe(true);
    expect(byLabel(tree, "Save exercise").props.disabled).toBe(true);
    expect(byLabel(tree, `Delete ${EXERCISE.name}`).props.disabled).toBe(true);
    byLabel(tree, "Save exercise").props.onPress();
    await flush();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("lets an unchanged name through even when another record shares it", async () => {
    const twin = { ...EXERCISE, id: "99999999-9999-4999-8999-999999999999" };
    mocks.update.mockResolvedValue({ ok: true, exercise: EXERCISE });
    open({ exercise: EXERCISE, savedExercises: [EXERCISE, twin] });
    await flush();
    byLabel(render(), "Exercise notes").props.onChangeText("New cue");
    await press(render(), "Save exercise");
    expect(mocks.update).toHaveBeenCalledWith(
      EXERCISE,
      expect.objectContaining({ instructions: "New cue" }),
    );
  });
});
