import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  alert: vi.fn(),
  track: vi.fn().mockResolvedValue({ recorded: true }),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: () => {},
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
}));
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  ScrollView: "ScrollView",
  StyleSheet: { create: (value: unknown) => value },
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("expo-router", () => ({ router: { push: mocks.push } }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Chip: "Chip",
  Icon: "Icon",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 800,
  MinTouchTarget: 44,
  PageGutter: 20,
  Radius: {},
  Spacing: {},
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => "production",
  isProgressPhotosEnabled: () => false,
}));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: { track: mocks.track, resetLocalSession: vi.fn() },
}));
vi.mock("@/features/analytics/ui-analytics", () => ({
  trackSettingsSearchSelected: vi.fn(),
  trackSettingsSearchUsed: vi.fn(),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
    openOnboarding: vi.fn(),
    profile: { displayName: "Synthetic Person", planTier: "free" },
    session: { user: { id: "synthetic-owner", email: "owner@example.test" } },
  }),
}));
vi.mock("@/features/coach/coach-reminders", () => ({
  applyCoachReminders: vi.fn(),
  loadCoachReminders: vi.fn(),
}));
vi.mock("./settings-search-results", () => ({
  SettingsSearchResults: "SettingsSearchResults",
}));

import { SettingsScreen } from "./settings-screen";

function findAll(node: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(node))
    return node.flatMap((child) => findAll(child, predicate));
  if (!node || typeof node !== "object") return [];
  const own = predicate(node) ? [node] : [];
  return [...own, ...findAll(node.props?.children, predicate)];
}

beforeEach(() => {
  mocks.push.mockClear();
  mocks.alert.mockClear();
});

it("keeps Feedback & reviews reachable from Settings and opens the feedback route", () => {
  const rows = findAll(
    SettingsScreen(),
    (node) =>
      node.type === "ListRow" && node.props.title === "Feedback & reviews",
  );
  expect(rows).toHaveLength(1);
  rows[0].props.onPress();
  expect(mocks.push).toHaveBeenCalledWith("/feedback");
});

it("keeps the analytics prompt row and the confirmed sign-out action", () => {
  const tree = SettingsScreen();
  const analytics = findAll(
    tree,
    (node) =>
      node.type === "ListRow" && node.props.title === "Help improve Mizyun",
  )[0];
  analytics.props.onPress();
  expect(mocks.push).toHaveBeenCalledWith("/account-settings/analytics");

  const signOut = findAll(
    tree,
    (node) =>
      node.type === "Button" && node.props.accessibilityLabel === "Sign out",
  )[0];
  expect(signOut.props.variant).toBe("destructive");
  signOut.props.onPress();
  expect(mocks.alert).toHaveBeenCalledWith(
    "Sign out of Mizyun?",
    expect.any(String),
    expect.any(Array),
  );
});

it("does not repeat the screen title, wordmark or Feedback pill in content", () => {
  const texts = findAll(SettingsScreen(), (node) => node.type === "ThemedText")
    .map((node) => node.props.children)
    .flat();
  expect(texts).not.toContain("Settings");
  expect(texts).not.toContain("SETTINGS CATEGORIES");
});
