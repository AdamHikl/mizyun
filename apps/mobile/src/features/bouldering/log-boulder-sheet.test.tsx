import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
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
}));
vi.mock("react-native", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Chip: "Chip",
  FormTextInput: "FormTextInput",
  Icon: "Icon",
  IconButton: "IconButton",
  Notice: "Notice",
  SegmentedControl: "SegmentedControl",
}));
vi.mock("@/constants/theme", () => ({
  MinTouchTarget: 44,
  Radius: { sm: 8, md: 12, pill: 999 },
  Spacing: { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32 },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("./boulder-photo-picker", () => ({ pickBoulderPhoto: vi.fn() }));

import { GradeChips } from "./grade-chips";
import { blankBoulderForm } from "./log-boulder-form";
import { LogBoulderSheet } from "./log-boulder-sheet";

type Props = Parameters<typeof LogBoulderSheet>[0];

function render(props: Props): any {
  hooks.index = 0;
  return LogBoulderSheet(props);
}
function findAll(node: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(node)) return node.flatMap((c) => findAll(c, predicate));
  if (!node || typeof node !== "object") return [];
  const here = predicate(node) ? [node] : [];
  const children = node.props?.children;
  // Function components (e.g. GradeChips) are expanded so their chips are visible.
  if (typeof node.type === "function") {
    const saved = hooks.index;
    const rendered = node.type(node.props);
    hooks.index = saved;
    return [...here, ...findAll(rendered, predicate)];
  }
  return [...here, ...findAll(children, predicate)];
}
const find = (node: any, predicate: (node: any) => boolean) =>
  findAll(node, predicate)[0];
const byLabel = (tree: any, label: string) =>
  find(tree, (n) => n.props?.label === label);

const baseProps = (over: Partial<Props> = {}): Props => ({
  visible: true,
  mode: "create",
  initialForm: blankBoulderForm("6B"),
  lastAscent: { grade: "6C+", holdColour: "yellow" },
  onClose: vi.fn(),
  onSave: vi.fn(async () => null),
  ...over,
});

beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
});

describe("LogBoulderSheet", () => {
  it("pre-selects the given grade and keeps Save disabled until a result is chosen", () => {
    const tree = render(baseProps());
    const grades = find(tree, (n) => n.type === GradeChips);
    expect(grades.props.value).toBe("6B");
    expect(byLabel(tree, "Save").props.disabled).toBe(true);
    expect(
      find(tree, (n) => n.props?.accessibilityLabel === "More attempts"),
    ).toBeUndefined();
  });

  it("shows the attempts stepper for Sent starting at 2 and hides it for Flash", () => {
    const props = baseProps();
    let tree = render(props);
    find(tree, (n) => n.type === "SegmentedControl").props.onChange("sent");
    tree = render(props);
    const value = find(
      tree,
      (n) => n.props?.accessibilityLabel === "2 attempts",
    );
    expect(value).toBeTruthy();
    expect(byLabel(tree, "Save").props.disabled).toBe(false);
    find(tree, (n) => n.type === "SegmentedControl").props.onChange("flash");
    tree = render(props);
    expect(
      find(tree, (n) => n.props?.accessibilityLabel === "More attempts"),
    ).toBeUndefined();
  });

  it("Same again repeats the last grade and colour with the result unselected", () => {
    const props = baseProps();
    let tree = render(props);
    find(tree, (n) => n.type === "SegmentedControl").props.onChange("flash");
    tree = render(props);
    byLabel(tree, "Same again").props.onPress();
    tree = render(props);
    expect(find(tree, (n) => n.type === GradeChips).props.value).toBe("6C+");
    expect(find(tree, (n) => n.type === "SegmentedControl").props.value).toBe(
      "none",
    );
    expect(byLabel(tree, "Save").props.disabled).toBe(true);
  });

  it("keeps the sheet open with the explanation when the device write fails", async () => {
    const onSave = vi.fn(
      async () =>
        "Couldn't keep this boulder on this device, so nothing was sent. Try saving again.",
    );
    const props = baseProps({ onSave });
    let tree = render(props);
    find(tree, (n) => n.type === "SegmentedControl").props.onChange("flash");
    tree = render(props);
    await byLabel(tree, "Save").props.onPress();
    await Promise.resolve();
    tree = render(props);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ grade: "6B", result: "flash", attempts: 1 }),
      { kind: "keep" },
    );
    expect(props.onClose).not.toHaveBeenCalled();
    expect(find(tree, (n) => n.type === "Notice")?.props.message).toMatch(
      /nothing was sent/,
    );
  });

  it("does not offer Same again when editing", () => {
    const tree = render(baseProps({ mode: "edit" }));
    expect(byLabel(tree, "Same again")).toBeUndefined();
  });
});

describe("GradeChips", () => {
  it("announces the selected grade and keeps 44 pt targets", () => {
    hooks.index = 0;
    const tree: any = GradeChips({ value: "6A+", onChange: vi.fn() });
    const chips = findAll(tree, (n) => n.props?.accessibilityRole === "radio");
    expect(chips).toHaveLength(23);
    const selected = chips.filter((c) => c.props.accessibilityState.selected);
    expect(selected.map((c) => c.props.accessibilityLabel)).toEqual([
      "Font 6A plus",
    ]);
    const style = Object.assign(
      {},
      ...selected[0].props.style({ pressed: false }).filter(Boolean),
    );
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });
});
