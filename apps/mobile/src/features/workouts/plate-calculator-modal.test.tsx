import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (callback: () => unknown) => callback(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots))
      hooks.slots[index] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
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
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("@/components/ui", () => ({
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  SegmentedControl: "SegmentedControl",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "black" }) }));
vi.mock("@/constants/theme", () => ({
  MinTouchTarget: 44,
  Radius: {},
  Spacing: {},
}));

import { PlateCalculatorModal } from "./plate-calculator-modal";

const props = {
  exercises: [
    { id: "bench", name: "Bench Press" },
    { id: "squat", name: "Back Squat" },
  ],
  onUseWeight: vi.fn(),
  onClose: vi.fn(),
};
function render(unitSystem: "metric" | "imperial" = "metric"): any {
  hooks.index = 0;
  return PlateCalculatorModal({ visible: true, unitSystem, ...props });
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
const byTestId = (tree: any, id: string) =>
  all(tree, (node) => node.props?.testID === id)[0];
const byLabel = (tree: any, label: string) =>
  all(tree, (node) => node.props?.accessibilityLabel === label)[0];
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
const total = (tree: any) => text(byTestId(tree, "plate-calculator-total"));

beforeEach(() => {
  props.onUseWeight.mockReset();
  props.onClose.mockReset();
  hooks.slots = [];
  hooks.index = 0;
});

describe("plate calculator", () => {
  it("starts at the empty Olympic bar in the user's unit", () => {
    expect(total(render())).toBe("20 kg");
    hooks.slots = [];
    expect(total(render("imperial"))).toBe("45 lb");
  });

  it("totals plates added to each side", () => {
    byLabel(render(), "Add a 20 kg plate to each side").props.onPress();
    byLabel(render(), "Add a 2.5 kg plate to each side").props.onPress();
    expect(total(render())).toBe("65 kg");
    byLabel(render(), "Remove a 20 kg plate from each side").props.onPress();
    expect(total(render())).toBe("25 kg");
  });

  it("fills plates from a target and flags unloadable remainders", () => {
    byTestId(render(), "plate-calculator-target").props.onChangeText("102.5");
    let tree = render();
    expect(total(tree)).toBe("102.5 kg");
    expect(text(byTestId(tree, "plate-calculator-count-25"))).toBe("1");
    expect(text(byTestId(tree, "plate-calculator-count-1.25"))).toBe("1");

    byTestId(tree, "plate-calculator-target").props.onChangeText("101");
    tree = render();
    expect(total(tree)).toBe("100 kg");
    expect(text(tree)).toContain("1 kg short");
  });

  it("recalculates the target when the bar changes", () => {
    byTestId(render(), "plate-calculator-target").props.onChangeText("60");
    all(render(), (n) => n.type === "SegmentedControl")[0].props.onChange("15");
    const tree = render();
    expect(total(tree)).toBe("60 kg");
    expect(text(byTestId(tree, "plate-calculator-count-20"))).toBe("1");
    expect(text(byTestId(tree, "plate-calculator-count-2.5"))).toBe("1");
  });

  it("returns to the empty bar for targets it cannot load", () => {
    const cases: [string, string][] = [
      ["10", "lighter than the bar"],
      ["1e9", "Enter a number"],
      ["5000", "Enter 1000 kg or less"],
    ];
    for (const [input, warning] of cases) {
      byTestId(render(), "plate-calculator-target").props.onChangeText("100");
      expect(total(render())).toBe("100 kg");
      byTestId(render(), "plate-calculator-target").props.onChangeText(input);
      const tree = render();
      expect(text(tree)).toContain(warning);
      expect(total(tree)).toBe("20 kg");
    }
  });

  it("accepts a decimal comma", () => {
    byTestId(render(), "plate-calculator-target").props.onChangeText("62,5");
    expect(total(render())).toBe("62.5 kg");
  });

  it("copies the total into the chosen exercise's next set and closes", () => {
    byTestId(render(), "plate-calculator-target").props.onChangeText("62,5");
    const row = byLabel(render(), "Use 62.5 kg for the next Back Squat set");
    row.props.onPress();
    expect(props.onUseWeight).toHaveBeenCalledWith("squat", "62.5");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("explains how to copy when the session has no exercises", () => {
    hooks.index = 0;
    const tree = PlateCalculatorModal({
      ...props,
      visible: true,
      unitSystem: "metric",
      exercises: [],
    });
    expect(text(tree)).toContain(
      "Add a weight-and-reps exercise to copy this weight",
    );
    expect(all(tree, (n) => n.type === "ListRow")).toHaveLength(0);
  });
});
