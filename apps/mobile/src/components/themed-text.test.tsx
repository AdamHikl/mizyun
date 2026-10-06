import { beforeEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({
  fontScale: 1,
  width: 393,
  color: "#0F172A",
}));
vi.mock("react-native", () => ({
  Platform: { select: (options: any) => options.ios ?? options.default },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  useWindowDimensions: () => ({
    fontScale: environment.fontScale,
    width: environment.width,
  }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ text: environment.color }),
}));
vi.mock("@/constants/theme", () => ({ Fonts: { mono: "monospace" } }));

import { ThemedText } from "./themed-text";

beforeEach(() => {
  environment.fontScale = 1;
  environment.width = 393;
  environment.color = "#0F172A";
});

describe("live system text size", () => {
  it("recreates native paragraph identity for increases and decreases in font scale", () => {
    const initial = ThemedText({ children: "Guidance that must wrap" });
    environment.fontScale = 1.353;
    const increased = ThemedText({ children: "Guidance that must wrap" });
    expect(increased.key).not.toBe(initial.key);
    environment.fontScale = 3.571;
    const accessibilitySize = ThemedText({
      children: "Guidance that must wrap",
    });
    expect(accessibilitySize.key).not.toBe(increased.key);
    environment.fontScale = 1;
    expect(ThemedText({}).key).toBe(initial.key);
  });

  it("retains paragraph identity for ordinary content, theme and width changes", () => {
    const initial = ThemedText({ children: "Timer: 00:01" });
    environment.width = 320;
    environment.color = "#F8FAFC";
    expect(ThemedText({ children: "Timer: 00:02" }).key).toBe(initial.key);
  });

  it("preserves native scaling defaults, typography and selectable/accessibility props", () => {
    environment.fontScale = 3.571;
    const text = ThemedText({
      type: "small",
      children: "Full guidance",
      selectable: true,
      accessibilityLabel: "Full guidance",
      style: { fontSize: 15, lineHeight: 22 },
    });
    expect(text.props.allowFontScaling).toBeUndefined();
    expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    expect(text.props.numberOfLines).toBeUndefined();
    expect(text.props.selectable).toBe(true);
    expect(text.props.accessibilityLabel).toBe("Full guidance");
    expect(text.props.style.at(-1)).toEqual({ fontSize: 15, lineHeight: 22 });
    expect(text.props.children).toBe("Full guidance");
  });
});
