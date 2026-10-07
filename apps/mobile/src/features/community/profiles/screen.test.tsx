import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  profile: null as any,
  canMessage: false,
  error: null as string | null,
  activityError: null as string | null,
  loading: false,
  pending: false,
  activities: [] as any[],
  current: true,
  act: vi.fn(),
  alert: vi.fn(),
  token: "token-one",
  refs: [] as any[],
  refIndex: 0,
  report: null as any,
  focus: null as null | (() => void),
  load: vi.fn(),
  pause: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => {
    const index = mocks.refIndex++;
    return (mocks.refs[index] ??= { current });
  },
  useState: (value: unknown) =>
    value === null
      ? [
          mocks.report,
          (next: unknown) => {
            mocks.report = next;
          },
        ]
      : [value, vi.fn()],
  useEffect: () => {},
  useCallback: (fn: unknown) => fn,
  useSyncExternalStore: (_sub: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  Text: "Text",
  View: "View",
  Alert: { alert: mocks.alert },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: vi.fn() }),
  },
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void) => {
    mocks.focus = callback;
  },
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ text: "black", textSecondary: "grey" }),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "owner" }, accessToken: mocks.token },
  }),
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("../initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
vi.mock("../ui", () => ({
  CommunityPage: "CommunityPage",
  CommunityButton: "CommunityButton",
  CommunityRow: "CommunityRow",
  CommunitySection: "CommunitySection",
  CommunityState: "CommunityState",
}));
vi.mock("../safety", () => ({ ReportModal: "ReportModal" }));
vi.mock("../safety/safety-api", () => ({ captureSafetyReceipt: vi.fn() }));
vi.mock("./controller", () => ({
  ProfileViewController: class {
    subscribe = vi.fn();
    getState = () => ({
      profile: mocks.profile,
      activities: mocks.activities,
      error: mocks.error,
      activityError: mocks.activityError,
      loading: mocks.loading,
      pending: mocks.pending,
      nextCursor: null,
      canMessage: mocks.canMessage,
    });
    captureIntent = () => () => mocks.current;
    captureReceiptIntent = () => () => mocks.current;
    act = mocks.act;
    pause = mocks.pause;
    resume = vi.fn();
    load = mocks.load;
  },
}));
import { CommunityPersonProfileScreen } from "./screen";
function render(own = false) {
  mocks.refIndex = 0;
  const outer = CommunityPersonProfileScreen({
    userId: own ? "owner" : "peer",
    own,
  });
  return (outer.type as any)(outer.props);
}
function nodes(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return typeof node === "object"
    ? [node, ...nodes(node.props?.children), ...nodes(node.props?.action)]
    : [];
}
const button = (tree: any, label: string) =>
  nodes(tree).find(
    (node) => node.type === "CommunityButton" && node.props.label === label,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = "token-one";
  mocks.refs = [];
  mocks.refIndex = 0;
  mocks.report = null;
  mocks.focus = null;
  mocks.current = true;
  mocks.canMessage = false;
  mocks.error = null;
  mocks.activityError = null;
  mocks.loading = false;
  mocks.pending = false;
  mocks.activities = [];
  mocks.profile = {
    userId: "peer",
    handle: "friend",
    displayName: "Friend",
    avatarSymbol: "F",
    bio: null,
    relationshipWithViewer: "following",
    relationshipContext: {
      outgoing: { id: "out", status: "approved" },
      incoming: { id: "in", status: "pending" },
    },
  };
});
describe("profile navigation and directional approval", () => {
  it("keeps received approval visible beside approved outgoing follow without exposing a public graph", () => {
    const tree = render();
    expect(button(tree, "Approve")).toBeTruthy();
    expect(button(tree, "Decline")).toBeTruthy();
    expect(button(tree, "Request to follow")).toBeUndefined();
    expect(
      nodes(tree).some(
        (node) => node.props?.title === "They requested to follow you",
      ),
    ).toBe(true);
    expect(
      nodes(tree).filter(
        (node) =>
          node.type === "CommunityRow" &&
          ["Followers", "Following"].includes(node.props.title),
      ),
    ).toHaveLength(0);
  });
  it("offers a direct conversation only after current messaging eligibility is proven", () => {
    expect(button(render(), "Message")).toBeUndefined();
    mocks.canMessage = true;
    expect(button(render(), "Message").props.href).toBe(
      "/community/conversation/peer",
    );
  });
  it("rejects an approval confirmation after target authority retires", () => {
    button(render(), "Approve").props.onPress();
    expect(mocks.act).not.toHaveBeenCalled();
    expect(mocks.alert.mock.calls[0][1]).toContain("including past cards");
    mocks.current = false;
    mocks.alert.mock.calls[0][2][1].onPress();
    expect(mocks.act).not.toHaveBeenCalled();
  });
  it("shows own profile as a view with a separate identity editor and owner graph entry points", () => {
    mocks.profile = {
      ...mocks.profile,
      userId: "owner",
      relationshipWithViewer: "self",
      relationshipContext: { outgoing: null, incoming: null },
    };
    const tree = render();
    expect(button(tree, "Edit profile").props.href).toBe(
      "/community/settings?task=identity",
    );
    expect(button(tree, "Invite")).toBeTruthy();
    expect(
      nodes(tree).some(
        (node) =>
          node.type === "CommunityRow" && node.props.title === "Followers",
      ),
    ).toBe(true);
    expect(button(tree, "Approve")).toBeUndefined();
  });
  it("keeps independently authorized owner settings and safety reachable on a failed profile read, with one retry", () => {
    mocks.profile = null;
    mocks.error = "Community profile could not be loaded. Try again.";
    const tree = render(true);
    const rows = nodes(tree).filter((node) => node.type === "CommunityRow");
    expect(rows.map((node) => node.props.href)).toEqual([
      "/community/settings",
      "/community/safety",
    ]);
    expect(
      nodes(tree).filter((node) => node.props?.label === "Try again"),
    ).toHaveLength(1);
    expect(button(tree, "Refresh profile")).toBeUndefined();
    expect(
      nodes(tree).some((node) => node.props?.title === "Profile unavailable"),
    ).toBe(false);
    expect(
      nodes(tree).some((node) => node.props?.title === "No shared workouts"),
    ).toBe(false);
    expect(button(tree, "Edit profile")).toBeUndefined();
    expect(
      nodes(tree).find((node) => node.props?.accessibilityRole === "alert")
        .props.children,
    ).toBe(mocks.error);
    mocks.focus!();
    vi.clearAllMocks();
    button(tree, "Try again").props.onPress();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledOnce();
  });
  it("keeps owner settings reachable while access is being checked without offering another refresh", () => {
    mocks.profile = null;
    mocks.loading = true;
    const tree = render(true);
    expect(
      nodes(tree).some((node) => node.props?.href === "/community/settings"),
    ).toBe(true);
    expect(
      nodes(tree).some((node) => node.props?.href === "/community/safety"),
    ).toBe(true);
    expect(button(tree, "Refresh profile")).toBeUndefined();
    expect(button(tree, "Try again")).toBeUndefined();
  });
  it("does not show owner controls or an empty timeline for an unavailable other person's profile", () => {
    mocks.profile = null;
    mocks.error = "Profile unavailable.";
    const tree = render();
    expect(nodes(tree).some((node) => node.type === "CommunityRow")).toBe(
      false,
    );
    expect(button(tree, "Approve")).toBeUndefined();
    expect(button(tree, "Message")).toBeUndefined();
    expect(button(tree, "Refresh profile")).toBeUndefined();
    expect(button(tree, "Try again")).toBeTruthy();
  });
  it("offers one timeline retry while preserving authorized identity and directional actions", () => {
    mocks.activityError = "Shared workouts could not be loaded.";
    const tree = render();
    expect(button(tree, "Check again")).toBeTruthy();
    expect(button(tree, "Refresh profile")).toBeUndefined();
    expect(button(tree, "Approve")).toBeTruthy();
    expect(nodes(tree).some((node) => node.type === "InitialsAvatar")).toBe(
      true,
    );
    expect(
      nodes(tree).some((node) => node.props?.title === "No shared workouts"),
    ).toBe(false);
  });
  it("preserves the authorized shared workout destination", () => {
    mocks.activities = [
      {
        id: "published-card",
        category: "running",
        sharedDay: "2026-10-07",
        durationSeconds: 1200,
      },
    ];
    const tree = render();
    expect(
      nodes(tree).find(
        (node) => node.props?.href === "/community/activity/published-card",
      ).props.description,
    ).toBe("2026-10-07 · 20 min");
  });
  it("retires the old person lifetime on same-principal token change without exposing the token in its key", () => {
    mocks.refIndex = 0;
    const before = CommunityPersonProfileScreen({ userId: "peer" });
    expect(before.props.isLifetimeCurrent()).toBe(true);
    mocks.token = "token-two";
    mocks.refIndex = 0;
    const after = CommunityPersonProfileScreen({ userId: "peer" });
    expect(after.key).not.toBe(before.key);
    expect(before.props.isLifetimeCurrent()).toBe(false);
    expect(after.props.isLifetimeCurrent()).toBe(true);
    expect(after.key).not.toContain("token-two");
  });
  it("checks profile authorization again after closing a report modal", () => {
    render();
    mocks.focus!();
    vi.clearAllMocks();
    mocks.report = { profile: mocks.profile, receiptId: "receipt" };
    const modal = nodes(render()).find((node) => node.type === "ReportModal");
    expect(modal).toBeTruthy();
    modal.props.onClose();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.report).toBeNull();
  });
});
