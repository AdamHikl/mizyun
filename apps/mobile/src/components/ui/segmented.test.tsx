import { beforeEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ fontScale: 1 }));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ fontScale: environment.fontScale }),
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    backgroundSelected: "#eee",
    backgroundElement: "#fff",
    primary: "#0a0",
    onPrimary: "#fff",
    primaryLight: "#dfd",
    text: "#111",
  }),
}));
vi.mock("./icon", () => ({ Icon: "Icon" }));
vi.mock("@/constants/theme", () => ({
  MinTouchTarget: 44,
  Radius: { sm: 8, md: 12, pill: 999 },
  Spacing: { two: 8 },
}));

import { Chip, SegmentedControl } from "./segmented";

const options = [
  { value: "all", label: "All", count: 3 },
  { value: "history", label: "History", accessibilityLabel: "Show history" },
] as const;

beforeEach(() => {
  environment.fontScale = 1;
});

describe("SegmentedControl", () => {
  it("exposes a tab list with one selected tab and only reports changes", () => {
    const onChange = vi.fn();
    const control = SegmentedControl({
      options,
      value: "all",
      onChange,
      accessibilityLabel: "Workout view",
    });
    expect(control.props.accessibilityRole).toBe("tablist");
    expect(control.props.accessibilityLabel).toBe("Workout view");
    const [all, history] = control.props.children;
    expect(all.props.accessibilityRole).toBe("tab");
    expect(all.props.accessibilityLabel).toBe("All 3");
    expect(all.props.accessibilityState).toEqual({ selected: true });
    expect(history.props.accessibilityLabel).toBe("Show history");
    expect(history.props.accessibilityState).toEqual({ selected: false });
    all.props.onPress();
    expect(onChange).not.toHaveBeenCalled();
    history.props.onPress();
    expect(onChange).toHaveBeenCalledWith("history");
  });

  it("wraps segments into rows at large text sizes", () => {
    environment.fontScale = 2;
    const control = SegmentedControl({
      options,
      value: "all",
      onChange: () => {},
    });
    expect(control.props.style).toContainEqual({ flexWrap: "wrap" });
  });
});

describe("Chip", () => {
  it("renders static chips as views and pressable chips as labelled buttons", () => {
    expect(Chip({ label: "Ready" }).type).toBe("View");
    const onPress = vi.fn();
    const chip = Chip({ label: "Strength", selected: true, onPress });
    expect(chip.props.accessibilityRole).toBe("button");
    expect(chip.props.accessibilityLabel).toBe("Strength");
    expect(chip.props.accessibilityState).toEqual({ selected: true });
    chip.props.onPress();
    expect(onPress).toHaveBeenCalled();
  });
});
