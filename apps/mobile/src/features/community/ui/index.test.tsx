import { beforeEach, describe, expect, it, vi } from "vitest";
import { View } from "react-native";
const mocks = vi.hoisted(() => ({
  fontScale: 1,
  width: 402,
  horizontalInset: 0,
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
  useWindowDimensions: () => ({
    fontScale: mocks.fontScale,
    width: mocks.width,
  }),
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
  useSafeAreaInsets: () => ({
    top: 0,
    right: mocks.horizontalInset,
    bottom: 0,
    left: mocks.horizontalInset,
  }),
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
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Card: "Card",
  Icon: "Icon",
  IconBadge: "IconBadge",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/components/tab-header", () => ({ TabHeader: "TabHeader" }));
vi.mock("../initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
import {
  CommunityNavigation,
  CommunityPage,
  CommunityRow,
  CommunitySection,
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
  mocks.width = 402;
  mocks.horizontalInset = 0;
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
  it.each([
    [402, 1, "23%"],
    [402, 1.23, "48%"],
    [402, 2, "48%"],
    [320, 2, "100%"],
  ] as const)(
    "keeps complete scaled tab labels at width %s and scale %s",
    (width, fontScale, flexBasis) => {
      mocks.width = width;
      mocks.fontScale = fontScale;
      const links = nodes(CommunityNavigation({ selected: "people" }), "Link");
      for (const link of links) {
        expect(link.props.children.props.style.flexBasis).toBe(flexBasis);
        expect(
          link.props.children.props.children.props.numberOfLines,
        ).toBeUndefined();
        expect(
          link.props.children.props.children.props.allowFontScaling,
        ).not.toBe(false);
      }
    },
  );
  it("keeps four destinations on a single non-wrapping row when they fit", () => {
    mocks.width = 402;
    mocks.fontScale = 1;
    const navigation = CommunityNavigation({ selected: "feed" });
    expect(navigation.props.style).toContainEqual({ flexWrap: "nowrap" });
    mocks.fontScale = 2;
    expect(
      CommunityNavigation({ selected: "feed" }).props.style,
    ).not.toContainEqual({ flexWrap: "nowrap" });
  });
  it("allows for landscape safe-area gutters before choosing tab columns", () => {
    mocks.width = 420;
    mocks.horizontalInset = 32;
    const links = nodes(CommunityNavigation({ selected: "messages" }), "Link");
    expect(links[2].props.children.props.style.flexBasis).toBe("48%");
    expect(links[2].props.children.props.accessibilityLabel).toBe("Messages");
  });
  it("keeps the shared tab header off pushed screens and off the content of root destinations", () => {
    const pushed = CommunityPage({ title: "Shared workout", children: null });
    expect(nodes(pushed, "TabHeader")).toHaveLength(0);
    const titles = nodes(pushed, "ThemedText").filter(
      (n) => n.props.accessibilityRole === "header",
    );
    expect(titles.map((n) => n.props.children)).toEqual(["Shared workout"]);
    const root = CommunityPage({
      title: "Messages",
      destination: "messages",
      children: null,
    });
    expect(root.props.children[0].type).toBe(CommunityRootHeader);
    expect(root.props.children[0].props.selected).toBe("messages");
    expect(
      nodes(root, "ThemedText").filter(
        (n) => n.props.accessibilityRole === "header",
      ),
    ).toHaveLength(0);
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
    const header = CommunityRootHeader({ selected: "feed" });
    expect(header.type).toBe("TabHeader");
    expect(header.props.title).toBe("Community");
    const inbox = nodes(header.props.actions, "Link")[0];
    expect(inbox.props.href).toBe("/community/inbox");
    expect(inbox.props.children.props.accessibilityLabel).toBe(
      "Community updates",
    );
    expect(inbox.props.children.props.style.minHeight).toBeGreaterThanOrEqual(
      48,
    );
  });
  it("shows row separators only between rows of a section card", () => {
    const rows = CommunitySection({
      title: "Spaces",
      children: [
        <CommunityRow key="a" title="Groups" href="/community/groups" />,
        <CommunityRow
          key="b"
          title="Challenges"
          href="/community/challenges"
        />,
      ],
    });
    const card = nodes(rows, "Card")[0];
    expect(card.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paddingVertical: 0, overflow: "hidden" }),
      ]),
    );
    const clip = card.props.children;
    expect(clip.type).toBe("View");
    expect(clip.props.style.marginBottom).toBe(-1);
    expect(clip.props.children).toHaveLength(2);
    const mixed = CommunitySection({
      title: "Profile options",
      children: [<View key="a" />],
    });
    const mixedCard = nodes(mixed, "Card")[0];
    expect(mixedCard.props.style).toEqual({ paddingVertical: 8 });
    expect(mixedCard.props.children).toHaveLength(1);
  });
});
