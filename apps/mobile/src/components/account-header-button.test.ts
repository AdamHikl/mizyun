import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  profile: null as null | { displayName: string },
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => state }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ backgroundElement: "#fff", border: "#000" }),
}));
vi.mock("./themed-text", () => ({ ThemedText: "Text" }));
vi.mock("./feedback-header-button", () => ({
  FeedbackHeaderButton: "Feedback",
}));
import { router } from "expo-router";
import { AccountHeaderButton } from "./account-header-button";

beforeEach(() => {
  state.profile = null;
  vi.clearAllMocks();
});
describe("Account navigation after leaving the tab bar", () => {
  it("keeps Account reachable without a loaded profile and with an accessible touch target", () => {
    const button = AccountHeaderButton();
    expect(button.props.accessibilityLabel).toBe("Open Account");
    const styles = button.props.style({ pressed: false }).flat();
    expect(styles).toContainEqual(
      expect.objectContaining({ minWidth: 48, minHeight: 48 }),
    );
    button.props.onPress();
    expect(router.push).toHaveBeenCalledWith("/settings");
  });
  it("updates local initials with the current private profile without navigating on render", () => {
    state.profile = { displayName: "Adam Hikl" };
    const first = AccountHeaderButton();
    expect(first.props.children.props.children.props.children).toBe("AH");
    state.profile = { displayName: "Jane Doe" };
    expect(
      AccountHeaderButton().props.children.props.children.props.children,
    ).toBe("JD");
    expect(router.push).not.toHaveBeenCalled();
  });
});
