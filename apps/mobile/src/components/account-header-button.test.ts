import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-symbols", () => ({ SymbolView: "SymbolView" }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ backgroundElement: "#fff", border: "#000", text: "#123" }),
}));
vi.mock("./feedback-header-button", () => ({
  FeedbackHeaderButton: "Feedback",
}));
import { router } from "expo-router";
import { AccountHeaderButton } from "./account-header-button";

beforeEach(() => {
  vi.clearAllMocks();
});
describe("Account navigation after leaving the tab bar", () => {
  it("keeps Account reachable without a loaded profile and with an accessible touch target", () => {
    const button = AccountHeaderButton();
    expect(button.props.accessibilityLabel).toBe("Open settings");
    const styles = button.props.style({ pressed: false }).flat();
    expect(styles).toContainEqual(
      expect.objectContaining({ minWidth: 48, minHeight: 48 }),
    );
    button.props.onPress();
    expect(router.push).toHaveBeenCalledWith("/settings");
  });
  it("renders a themed settings symbol on every supported platform without navigating on render", () => {
    const icon = AccountHeaderButton().props.children.props.children;
    expect(icon.type).toBe("SymbolView");
    expect(icon.props.name).toEqual({
      ios: "gearshape",
      android: "settings",
      web: "settings",
    });
    expect(icon.props.tintColor).toBe("#123");
    expect(icon.props.accessible).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });
});
