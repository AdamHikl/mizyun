import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  track: vi.fn().mockResolvedValue({ recorded: true }),
  push: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) =>
    (state.slots[state.index++] ??= { current: initial }),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.slots))
      state.slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      state.slots[index],
      (next: any) => {
        state.slots[index] =
          typeof next === "function" ? next(state.slots[index]) : next;
      },
    ];
  },
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: vi.fn(),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  AppState: { currentState: "active" },
  Platform: {
    OS: "ios",
    select: (options: any) => options.ios ?? options.default,
  },
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  Alert: { alert: vi.fn() },
  StyleSheet: { create: (x: unknown) => x },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("expo-router", () => ({
  router: { push: state.push },
  useFocusEffect: vi.fn(),
}));
vi.mock("expo-network", () => ({}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/tab-header", () => ({
  TabHeader: "TabHeader",
  useTabHeaderLayout: () => ({ headerHeight: 96, onHeaderLayout: () => {} }),
}));
vi.mock("@/components/brand-wordmark", () => ({
  BrandWordmark: "BrandWordmark",
}));
vi.mock("@/components/account-header-button", () => ({
  AccountHeaderActions: "AccountHeaderActions",
}));
vi.mock("@/components/feedback-header-button", () => ({
  FeedbackHeaderButton: "FeedbackHeaderButton",
}));
vi.mock("@/components/ui/ios-time-picker", () => ({
  formatTime12: () => "9 am",
}));
vi.mock("@/constants/theme", () => ({
  BottomTabInset: 0,
  MaxContentWidth: 600,
  MinTouchTarget: 44,
  PageGutter: 20,
  Radius: {},
  Spacing: {},
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Chip: "Chip",
  EmptyState: "EmptyState",
  IconButton: "IconButton",
  Icon: "Icon",
  IconBadge: "IconBadge",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  Notice: "Notice",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: { track: state.track },
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: {},
  invalidateSessionReads: vi.fn(),
  getSessionReadVersion: () => "synthetic-read-version",
  peekSessionRead: () => null,
}));
vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => "dev",
  isProgressPhotosEnabled: () => true,
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    profile: {
      displayName: "Private person",
      unitSystem: "metric",
      heightCm: 170,
    },
    session: {
      user: { id: "private-user", email: "private@example.invalid" },
      accessToken: "private-token",
    },
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
    openOnboarding: vi.fn(),
  }),
}));
vi.mock("@/features/theme/theme-context", () => ({
  useThemePreference: () => ({ preference: "auto" }),
}));
vi.mock("@/features/workouts", () => ({
  useOptionalActiveWorkout: () => ({
    activeWorkout: { id: "private-workout" },
    elapsedSeconds: 30,
  }),
  formatStopwatch: () => "00:30",
}));
vi.mock("@/features/health-steps/health-steps", () => ({
  readTodaySteps: vi.fn(),
}));
vi.mock("@/features/log-meal/meal-lifecycle-data", () => ({
  copyFoodEntry: vi.fn(),
  fetchFoodHistory: vi.fn(),
  fetchFoodDateHistory: vi.fn(),
}));
vi.mock("@/features/log-meal/first-meal-reminders", () => ({
  loadFirstMealReminders: vi.fn(),
  reconcileFirstMealReminders: vi.fn(),
}));
vi.mock("@/features/log-meal/evening-catch-up-reminders", () => ({
  reconcileEveningReminders: vi.fn(),
}));
vi.mock("@/features/weekly-review/weekly-review-modal", () => ({
  WeeklyReviewPopup: "WeeklyReviewPopup",
}));
vi.mock("@/features/weekly-review/weekly-review-notification", () => ({
  reconcileWeeklyReviewReminder: vi.fn(),
}));
vi.mock("@/features/coach/coach-reminders", () => ({
  applyCoachReminders: vi.fn(),
  loadCoachReminders: vi.fn(),
}));
vi.mock("@/features/offline-cache/offline-cache-storage", () => ({
  loadCachedDashboard: vi.fn(),
  saveCachedDashboard: vi.fn(),
}));
vi.mock("@/features/settings/settings-destinations", () => ({
  navigateToSetting: state.navigate,
}));

import { DashboardScreen } from "../dashboard/dashboard-screen";
import { SettingsScreen } from "../settings/settings-screen";
import {
  trackDashboardControl,
  trackSettingsSearchSelected,
} from "./ui-analytics";

function render(screen: () => any): any {
  state.index = 0;
  return screen();
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const input = (tree: any) =>
  find(tree, (node) => node.props?.accessibilityLabel === "Search settings");

beforeEach(() => {
  state.slots = [];
  state.index = 0;
  state.track.mockReset().mockResolvedValue({ recorded: true });
  state.push.mockReset();
  state.navigate.mockReset();
});

describe("dashboard and settings usage telemetry", () => {
  it("opens Health steps settings directly from the disabled steps card", () => {
    const tree = render(DashboardScreen);
    const steps = find(tree, (node) => node.props?.label === "Steps today");
    expect(steps.props.detail).toBe("Turn on in Settings");

    steps.props.onPress();

    expect(state.push.mock.calls).toEqual([["/account-settings/health-steps"]]);
    expect(state.track).toHaveBeenCalledWith({
      name: "dashboard_control_clicked",
      properties: { control: "steps_card" },
    });
  });

  it("tracks dashboard card/quick-log controls without health data or navigation parameters", () => {
    const tree = render(DashboardScreen);
    find(
      tree,
      (node) => node.props?.label === "Current weight",
    ).props.onPress();
    find(
      tree,
      (node) => node.props?.accessibilityLabel === "Resume workout",
    ).props.onPress();
    expect(state.push.mock.calls).toEqual([
      ["/body"],
      ["/log-workout?workoutId=private-workout"],
    ]);
    expect(state.track.mock.calls).toEqual([
      [
        {
          name: "dashboard_control_clicked",
          properties: { control: "weight_card" },
        },
      ],
      [
        {
          name: "dashboard_control_clicked",
          properties: { control: "quick_log_workout" },
        },
      ],
    ]);
    expect(JSON.stringify(state.track.mock.calls)).not.toContain("private");
  });

  it("keeps every keystroke local and records only submitted result buckets and selected destination", () => {
    let tree = render(SettingsScreen);
    input(tree).props.onChangeText("dark");
    tree = render(SettingsScreen);
    input(tree).props.onChangeText("dark mode");
    tree = render(SettingsScreen);
    expect(state.track).not.toHaveBeenCalled();
    input(tree).props.onSubmitEditing();
    const results = find(
      tree,
      (node) => typeof node.props?.onSelectResult === "function",
    );
    results.props.onSelectResult(results.props.results[0]);
    expect(state.navigate).toHaveBeenCalledTimes(1);
    expect(state.track.mock.calls).toEqual([
      [{ name: "settings_search_used", properties: { resultCount: "1_to_5" } }],
      [
        {
          name: "settings_search_selected",
          properties: { destination: "appearance" },
        },
      ],
    ]);
    expect(JSON.stringify(state.track.mock.calls)).not.toContain("dark");
  });

  it("records no-result search without the submitted private phrase; empty submit is ignored", () => {
    let tree = render(SettingsScreen);
    input(tree).props.onSubmitEditing();
    expect(state.track).not.toHaveBeenCalled();
    input(tree).props.onChangeText("private@example.invalid secret diagnosis");
    tree = render(SettingsScreen);
    input(tree).props.onSubmitEditing();
    expect(state.track).toHaveBeenCalledWith({
      name: "settings_search_used",
      properties: { resultCount: "none" },
    });
    expect(JSON.stringify(state.track.mock.calls)).not.toContain("private");
    trackSettingsSearchSelected("private@example.invalid");
    expect(state.track).toHaveBeenCalledTimes(1);
  });

  it("continues navigation when analytics fails", async () => {
    state.track.mockRejectedValue(new Error("unavailable"));
    const tree = render(DashboardScreen);
    find(
      tree,
      (node) => node.props?.label === "Current weight",
    ).props.onPress();
    expect(state.push).toHaveBeenCalledWith("/body");
    await Promise.resolve();
    state.track.mockImplementation(() => {
      throw new Error("synchronous failure");
    });
    expect(() => trackDashboardControl("weight_card")).not.toThrow();
  });
});
