import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  recall: vi.fn(),
  slots: [] as any[],
  index: 0,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => (mocks.slots[mocks.index++] ??= { current }),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.slots))
      mocks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [mocks.slots[index], vi.fn()];
  },
  useEffect: () => undefined,
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("react-native", () => ({
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-router", () => ({
  router: {
    replace: mocks.replace,
    push: mocks.push,
    back: vi.fn(),
    canGoBack: () => true,
  },
  Stack: { Screen: "Stack.Screen" },
  useFocusEffect: () => undefined,
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  EmptyState: "EmptyState",
  Icon: "Icon",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  Notice: "Notice",
}));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 640,
  Radius: { sm: 8 },
  Spacing: { half: 2, one: 4, two: 8, three: 16, four: 24 },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("@/composition/app-variant", () => ({
  isBoulderingEnabled: () => true,
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "synthetic-owner" } },
    profile: { birthYear: 1990 },
  }),
}));
vi.mock("@/features/community", () => ({
  useCommunityProfile: () => ({ isEnrolled: false, profile: null }),
}));
vi.mock("@/features/share-card", () => ({
  ShareCardButton: "ShareCardButton",
}));
vi.mock("./client", () => ({
  getBoulderSession: vi.fn(),
  listBoulderProjects: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));
vi.mock("./session-rows", () => ({ recallFinish: mocks.recall }));

import type { BoulderSessionRecord } from "@mizyun/contracts";
import { SessionSummaryScreen } from "./session-summary-screen";

const session = (completedAt: string | null): BoulderSessionRecord => ({
  id: "33333333-3333-4333-8333-333333333333",
  clientOperationId: "11111111-1111-4111-8111-111111111111",
  name: "Bouldering",
  notes: null,
  startedAt: "2026-10-30T08:00:00.000Z",
  completedAt,
  session: {
    version: 1,
    gradeScale: "font",
    recordingTimezone: "Europe/Bratislava",
    activityDate: "2026-10-30",
    gymName: null,
  },
  summary: {
    boulders: 4,
    sends: 3,
    flashes: 1,
    attempts: 7,
    attemptsComplete: true,
    topGrade: "6C",
  },
});

function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

function render(completedAt: string | null): any {
  mocks.slots = [];
  mocks.index = 0;
  mocks.recall.mockReturnValue({
    session: session(completedAt),
    ascents: [],
    achievements: [],
  });
  return SessionSummaryScreen({
    sessionId: "33333333-3333-4333-8333-333333333333",
  });
}

const nextStepRow = (tree: any) =>
  find(tree, (node) => node.props?.title === "Log your next session");

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.push.mockReset();
});

describe("session summary next step", () => {
  it("offers one next step after a finished session and opens the session screen", () => {
    const row = nextStepRow(render("2026-10-30T10:00:00.000Z"));
    expect(row.props.subtitle).toBe(
      "Start a new one when you're back at the wall",
    );
    row.props.onPress();
    expect(mocks.replace).toHaveBeenCalledWith("/bouldering/session");
    expect(mocks.replace).not.toHaveBeenCalledWith(
      expect.stringContaining("start=1"),
    );
  });

  it("keeps Done and View progress beside the next step", () => {
    const tree = render("2026-10-30T10:00:00.000Z");
    expect(find(tree, (node) => node.props?.label === "Done")).toBeTruthy();
    expect(
      find(tree, (node) => node.props?.label === "View progress"),
    ).toBeTruthy();
  });

  it("offers none while the session is still in progress", () => {
    expect(nextStepRow(render(null))).toBeFalsy();
  });
});
