import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("./icon", () => ({ Icon: "Icon" }));
vi.mock("@/constants/theme", () => ({
  MinTouchTarget: 44,
  Radius: { sm: 8, md: 12, pill: 999 },
  Spacing: { two: 8, four: 24 },
}));

import { Button, IconButton } from "./button";

describe("Button accessibility state", () => {
  it("keeps a caller's busy state and disables while loading", () => {
    const finishing = Button({
      label: "Finish",
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(finishing.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    const loading = Button({ label: "Save", loading: true });
    expect(loading.props.disabled).toBe(true);
    expect(loading.props.accessibilityState.busy).toBe(true);
  });
});

describe("IconButton", () => {
  it("has a 48pt target and exposes selected and disabled state", () => {
    const button = IconButton({
      icon: "info",
      accessibilityLabel: "Info",
      selected: true,
      accessibilityState: { expanded: true },
    });
    expect(button.props.hitSlop).toBe(6);
    expect(button.props.accessibilityState).toEqual({
      expanded: true,
      disabled: false,
      selected: true,
    });
    const disabled = IconButton({
      icon: "add",
      accessibilityLabel: "Add",
      disabled: true,
    });
    expect(disabled.props.accessibilityState.disabled).toBe(true);
  });
});
