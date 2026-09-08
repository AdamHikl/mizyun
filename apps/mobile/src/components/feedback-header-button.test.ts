import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (s: unknown) => s },
  View: "View",
}));

vi.mock("expo-router", () => ({
  router: {
    push: vi.fn(),
  },
}));

vi.mock("@/components/themed-text", () => ({
  ThemedText: "ThemedText",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    backgroundElement: "#EEF3F0",
    border: "#CBD5E1",
    text: "#0F172A",
    textSecondary: "#64748B",
  }),
}));

vi.mock("@/constants/theme", () => ({
  Spacing: { one: 4, two: 8, three: 16, four: 24, half: 2 },
}));

import { router } from "expo-router";
import { FeedbackHeaderButton } from "./feedback-header-button";

describe("FeedbackHeaderButton", () => {
  it("defines the component", () => {
    expect(FeedbackHeaderButton).toBeDefined();
    const element = FeedbackHeaderButton({});
    expect(element).toBeDefined();
    expect(element.type).toBe("Pressable");
    expect(element.props.accessibilityRole).toBe("button");
    expect(element.props.accessibilityLabel).toBe(
      "Send feedback or report an issue",
    );

    // Call onPress handler
    element.props.onPress();
    expect(router.push).toHaveBeenCalledWith("/feedback");
  });
});
