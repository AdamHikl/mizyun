import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  fontScale: 1,
  canGoBack: false,
  back: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: { select: (values: any) => values.ios },
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  ActivityIndicator: "ActivityIndicator",
  useWindowDimensions: () => ({ fontScale: mocks.fontScale }),
  StyleSheet: {
    create: (s: any) => s,
    hairlineWidth: 1,
    flatten: (s: any) =>
      Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s,
  },
}));
vi.mock("expo-router", () => ({
  Link: "Link",
  useRouter: () => ({
    canGoBack: () => mocks.canGoBack,
    back: mocks.back,
    replace: mocks.replace,
  }),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-symbols", () => ({ SymbolView: "SymbolView" }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    primary: "#059669",
    text: "#0f172a",
    background: "#fff",
    border: "#ccc",
  }),
}));
vi.mock("@/components/tab-header", () => ({ TabHeader: "TabHeader" }));
vi.mock("../initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
import {
  CommunityNavigation,
  CommunityPage,
  CommunityIdentityLink,
  CommunityRootHeader,
} from "./index";
function nodes(tree: any, type: string): any[] {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap((n) => nodes(n, type));
  return [
    ...(tree.type === type ? [tree] : []),
    ...nodes(tree.props?.children, type),
  ];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fontScale = 1;
  mocks.canGoBack = false;
});
describe("Community route shell", () => {
  it("retains four destinations with 48-point links and explicit current state", () => {
    const links = nodes(CommunityNavigation({ selected: "messages" }), "Link");
    expect(links.map((l) => l.props.href)).toEqual([
      "/(tabs)/community",
      "/(tabs)/community/people",
      "/(tabs)/community/messages",
      "/(tabs)/community/me",
    ]);
    expect(
      links.map((l) => l.props.children.props.accessibilityState.selected),
    ).toEqual([false, false, true, false]);
    for (const link of links) {
      expect(link.props.children.props.style.minHeight).toBeGreaterThanOrEqual(
        48,
      );
      expect(Array.isArray(link.props.children.props.style)).toBe(false);
    }
  });
  it("wraps navigation at large text sizes without truncating the destination labels", () => {
    mocks.fontScale = 2;
    const links = nodes(CommunityNavigation({ selected: "people" }), "Link");
    for (const link of links) {
      expect(link.props.children.props.style.flexBasis).toBe("50%");
      expect(
        link.props.children.props.children.props.numberOfLines,
      ).toBeUndefined();
    }
  });
  it("provides a parent destination for cold-opened tasks and normal Back for pushed tasks", () => {
    const page = () =>
      CommunityPage({
        title: "Shared workout",
        backHref: "/(tabs)/community",
        children: null,
      });
    nodes(page(), "Pressable")[0].props.onPress();
    expect(mocks.replace).toHaveBeenCalledWith("/(tabs)/community");
    mocks.canGoBack = true;
    nodes(page(), "Pressable")[0].props.onPress();
    expect(mocks.back).toHaveBeenCalledOnce();
  });
  it("uses stable identity for profiles and gives updates its separate inbox destination", () => {
    const identity = CommunityIdentityLink({
      userId: "stable-user",
      displayName: "Maya",
      handle: "maya",
    });
    expect(identity.props.href).toEqual({
      pathname: "/community/profile/[userId]",
      params: { userId: "stable-user" },
    });
    expect(identity.props.children.props.accessibilityLabel).toBe(
      "View Maya's profile",
    );
    const inbox = nodes(CommunityRootHeader({ selected: "feed" }), "Link")[0];
    expect(inbox.props.href).toBe("/community/inbox");
    expect(inbox.props.children.props.accessibilityLabel).toBe(
      "Community updates",
    );
  });
});
