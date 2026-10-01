import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enrolled: true,
  list: "incoming",
  rows: [] as any[],
  error: null as string | null,
  loading: false,
  pending: false,
  load: vi.fn(),
  act: vi.fn(),
  alert: vi.fn(),
  appState: null as null | ((s: string) => void),
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const same = (a: any[], b: any[]) =>
    a?.length === b?.length &&
    a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory: () => any, deps: any[]) => {
    const index = hooks.index++;
    if (!hooks.slots[index] || !same(hooks.slots[index].deps, deps))
      hooks.slots[index] = { deps, value: factory() };
    return hooks.slots[index].value;
  };
  return {
    ...actual,
    useRef: (current: unknown) => {
      const index = hooks.index++;
      return (hooks.slots[index] ??= { current });
    },
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: unknown) => {
          hooks.slots[index] = next;
        },
      ];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: any[]) => memo(() => callback, deps),
    useEffect: (callback: () => any, deps: any[]) => {
      const index = hooks.index++;
      const previous = hooks.slots[index];
      if (!previous || !same(previous.deps, deps)) {
        hooks.slots[index] = { deps };
        hooks.effects.push(() => {
          previous?.cleanup?.();
          hooks.slots[index].cleanup = callback();
        });
      }
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
      snapshot(),
  };
});
vi.mock("react-native", () => ({
  StyleSheet: {
    create: (styles: unknown) => styles,
    flatten: (styles: any) =>
      Array.isArray(styles) ? Object.assign({}, ...styles) : styles,
  },
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  FlatList: "FlatList",
  ScrollView: "ScrollView",
  RefreshControl: "RefreshControl",
  ActivityIndicator: "ActivityIndicator",
  Platform: { OS: "ios", select: (values: any) => values.ios },
  Alert: { alert: mocks.alert },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.appState = callback;
      return { remove: vi.fn() };
    },
  },
}));

vi.mock("expo-router", () => ({ Link: "Link", useFocusEffect: () => {} }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ primary: "#10B981", text: "#fff" }),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "a" } }, profile: {} }),
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("../use-community-profile", () => ({
  useCommunityProfile: () => ({ isEnrolled: mocks.enrolled }),
}));
vi.mock("../safety", () => ({ ReportModal: "ReportModal" }));
vi.mock("../safety/safety-api", () => ({ captureSafetyReceipt: vi.fn() }));
vi.mock("../initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
vi.mock("./controller", () => ({
  RelationshipsController: class {
    subscribe = vi.fn();
    getState = () => ({
      list: mocks.list,
      rows: mocks.rows,
      cursor: null,
      loading: mocks.loading,
      pending: mocks.pending,
      error: mocks.error,
    });
    resume = vi.fn();
    pause = vi.fn();
    load = mocks.load;
    act = mocks.act;
    captureIntent = () => () => true;
  },
}));
import { RelationshipsScreen } from "./screen";
function render(): any {
  hooks.index = 0;
  const outer = RelationshipsScreen();
  return (outer.type as any)(outer.props);
}
function nodes(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string") return node;
  return node?.props ? text(node.props.children) : "";
}
function control(tree: any, label: string): any {
  return nodes(tree).find(
    (n) =>
      ["Pressable", "Link"].includes(n.type) &&
      (n.props.accessibilityLabel === label || text(n) === label),
  );
}
beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  mocks.enrolled = true;
  mocks.list = "incoming";
  mocks.rows = [];
  mocks.error = null;
  mocks.loading = false;
  vi.clearAllMocks();
});
describe("friends navigation and actions", () => {
  it("selects Requests and Received, with a useful empty state and no giant Refresh button", () => {
    const tree = render();
    expect(control(tree, "Requests").props.accessibilityState.selected).toBe(
      true,
    );
    expect(control(tree, "Received").props.accessibilityState.selected).toBe(
      true,
    );
    expect(text(tree)).toContain("No follow requests");
    expect(control(tree, "Refresh")).toBeUndefined();
    control(tree, "Following").props.onPress();
    expect(mocks.load).toHaveBeenCalledWith("following");
  });
  it("keeps blocked/muted and safety contact available after leaving", () => {
    mocks.enrolled = false;
    let tree = render();
    expect(control(tree, "Requests").props.disabled).toBe(true);
    control(tree, "Safety & preferences +").props.onPress();
    tree = render();
    expect(control(tree, "Blocked").props.disabled).toBe(false);
    expect(control(tree, "Muted").props.disabled).toBe(false);
    expect(
      control(tree, "Reports, appeals & safety contact →").props.href,
    ).toBe("/community/safety");
  });
  it("shows Retry rather than a misleading empty list on errors, and refresh is explicit", () => {
    mocks.error = "Offline";
    const tree = render();
    expect(text(tree)).not.toContain("No follow requests");
    control(tree, "Try again").props.onPress();
    expect(mocks.load).toHaveBeenCalledOnce();
    tree.props.refreshControl.props.onRefresh();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it("keeps approval confirmation and past-card/directional warning", () => {
    mocks.rows = [
      {
        user: {
          userId: "b",
          displayName: "Partner",
          handle: "partner",
          avatarSymbol: "P",
        },
        relationshipId: "r",
      },
    ];
    const tree = render();
    control(tree, "Approve").props.onPress();
    expect(mocks.alert.mock.calls[0][1]).toContain("including past cards");
    expect(mocks.alert.mock.calls[0][1]).toContain("does not follow them back");
    expect(mocks.act).not.toHaveBeenCalled();
  });
  it("reveals every Following option without an Android multi-button Alert", () => {
    mocks.list = "following";
    mocks.rows = [
      {
        user: {
          userId: "b",
          displayName: "Partner",
          handle: "partner",
          avatarSymbol: "P",
        },
        relationshipId: "r",
      },
    ];
    let tree = render();
    control(tree, "Options for @partner").props.onPress();
    tree = render();
    for (const label of [
      "Mute",
      "Unfollow",
      "Block",
      "Report profile or handle",
    ])
      expect(control(tree, label)).toBeTruthy();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(
      control(tree, "Options for @partner").props.accessibilityState.expanded,
    ).toBe(true);
  });
});
