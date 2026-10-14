import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  onHeaderLayout: () => undefined,
  enrolled: true,
  membershipStatus: "ready",
  membershipError: null as string | null,
  membershipLoad: vi.fn(),
  membershipOptions: null as any,
  list: "incoming",
  rows: [] as any[],
  error: null as string | null,
  loading: false,
  pending: false,
  load: vi.fn(),
  act: vi.fn(),
  intentCurrent: true,
  alert: vi.fn(),
  appState: null as null | ((s: string) => void),
  token: "token-one",
  focus: null as null | (() => void),
  pause: vi.fn(),
  receipt: vi.fn(),
  insets: { top: 62, bottom: 34, left: 0, right: 0 },
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
  TextInput: "TextInput",
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

vi.mock("expo-router", () => ({
  Link: "Link",
  useFocusEffect: (callback: () => void) => {
    mocks.focus = callback;
  },
  useLocalSearchParams: () => ({}),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mocks.insets,
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ primary: "#10B981", text: "#fff" }),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "a" }, accessToken: mocks.token },
    profile: {},
  }),
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("../use-community-profile", () => ({
  useCommunityProfile: (options: any) => {
    mocks.membershipOptions = options;
    return {
      isEnrolled: mocks.enrolled,
      status: mocks.membershipStatus,
      error: mocks.membershipError,
      actions: { load: mocks.membershipLoad },
    };
  },
}));
vi.mock("../safety", () => ({ ReportModal: "ReportModal" }));
vi.mock("../safety/safety-api", () => ({
  captureSafetyReceipt: mocks.receipt,
}));
vi.mock("../ui", () => ({
  CommunityButton: "CommunityButton",
  CommunityRootHeader: "CommunityRootHeader",
  CommunityRow: "CommunityRow",
}));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Chip: "Chip",
  EmptyState: "EmptyState",
  Icon: "Icon",
  IconButton: "IconButton",
  ListRow: "ListRow",
  Notice: "Notice",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/components/tab-header", () => ({
  useTabHeaderLayout: () => ({
    headerHeight: 140,
    onHeaderLayout: mocks.onHeaderLayout,
  }),
}));
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
    pause = mocks.pause;
    load = mocks.load;
    act = mocks.act;
    captureIntent = () => () => mocks.intentCurrent;
    captureReceiptIntent = () => () => true;
  },
}));
import { RelationshipsScreen } from "./screen";
function render(): any {
  hooks.index = 0;
  const outer = RelationshipsScreen();
  return (outer.type as any)(outer.props);
}
function flushEffects() {
  for (const effect of hooks.effects.splice(0)) effect();
}
async function settleMembership() {
  await Promise.resolve();
  await Promise.resolve();
  const tree = render();
  flushEffects();
  return tree;
}
function nodes(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  // Also walk `action` slots (SectionHeader, EmptyState, Notice).
  return typeof node === "object"
    ? [node, ...nodes(node.props?.action), ...nodes(node.props?.children)]
    : [];
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string") return node;
  if (!node?.props) return "";
  // Design-system primitives carry their copy in props rather than children.
  const { label, title, message } = node.props;
  return [label, title, message]
    .filter((value) => typeof value === "string")
    .concat(text(node.props.children))
    .join("");
}
function control(tree: any, label: string): any {
  return nodes(tree).find(
    (n) =>
      [
        "Pressable",
        "Link",
        "Button",
        "Chip",
        "IconButton",
        "ListRow",
        "CommunityButton",
        "CommunityRow",
      ].includes(n.type) &&
      (n.props.accessibilityLabel === label || text(n) === label),
  );
}
beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  mocks.token = "token-one";
  mocks.insets = { top: 62, bottom: 34, left: 0, right: 0 };
  mocks.focus = null;
  mocks.receipt.mockResolvedValue({ ok: true, value: { id: "receipt" } });
  mocks.enrolled = true;
  mocks.membershipStatus = "ready";
  mocks.membershipError = null;
  mocks.membershipLoad.mockReset();
  mocks.membershipLoad.mockImplementation(async () => {});
  mocks.list = "incoming";
  mocks.rows = [];
  mocks.error = null;
  mocks.loading = false;
  mocks.pending = false;
  mocks.intentCurrent = true;
  vi.clearAllMocks();
});
describe("friends navigation and actions", () => {
  it("keeps the header and refresh area below device chrome, including after rotation", () => {
    let tree = render();
    expect(tree.type).toBe("View");
    expect(tree.props.style).toMatchObject({
      paddingTop: 62,
      paddingLeft: 0,
      paddingRight: 0,
    });
    let scroll = nodes(tree).find((node) => node.type === "ScrollView");
    expect(scroll.props.contentContainerStyle[1].paddingBottom).toBe(124);
    // The tab header stays fixed above the scroller; content scrolls beneath.
    const header = tree.props.children.find(
      (node: any) => node?.type === "CommunityRootHeader",
    );
    expect(header.props.selected).toBe("people");
    expect(header.props.onLayout).toBe(mocks.onHeaderLayout);
    expect(
      tree.props.children.indexOf(header) < tree.props.children.indexOf(scroll),
    ).toBe(true);
    expect(
      nodes(scroll).some((node: any) => node?.type === "CommunityRootHeader"),
    ).toBe(false);
    expect(scroll.props.style.marginTop).toBe(-140);
    expect(scroll.props.contentContainerStyle[1].paddingTop).toBeGreaterThan(
      140,
    );
    mocks.insets = { top: 0, bottom: 21, left: 62, right: 62 };
    tree = render();
    expect(tree.props.style).toMatchObject({
      paddingTop: 0,
      paddingLeft: 62,
      paddingRight: 62,
    });
    scroll = nodes(tree).find((node) => node.type === "ScrollView");
    expect(scroll.props.contentContainerStyle[1].paddingBottom).toBe(111);
  });
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
  it("keeps Find friends in the empty state and the find action disabled until a handle is typed", () => {
    const tree = render();
    expect(control(tree, "Find friends").props.href).toBe("/community/invite");
    const find = control(tree, "Find exact handle");
    expect(find.type).toBe("Button");
    expect(find.props.disabled).toBe(true);
    const empty = nodes(tree).find((node) => node.type === "EmptyState");
    expect(empty.props.title).toBe("No follow requests");
  });
  it("uses one compact main navigation row and a smaller Requests-only direction filter with 48-point controls", () => {
    let tree = render();
    const tablists = nodes(tree).filter(
      (node) => node.props?.accessibilityRole === "tablist",
    );
    expect(tablists).toHaveLength(1);
    expect(
      nodes(tablists[0])
        .filter((node) => node.props?.accessibilityRole === "tab")
        .map(text),
    ).toEqual(["Requests", "Following", "Followers"]);
    expect(tablists[0].props.style.flexWrap).toBeUndefined();
    expect(control(tree, "Requests").props.style[0]).toMatchObject({
      minHeight: 48,
      flexBasis: 0,
      flexGrow: 1,
    });
    const received = control(tree, "Received");
    expect(received.type).toBe("Chip");
    expect(received.props.accessibilityRole).toBe("button");
    expect(received.props.selected).toBe(true);
    expect(received.props.accessibilityState).toMatchObject({
      selected: true,
      disabled: false,
    });
    control(tree, "Sent").props.onPress();
    expect(mocks.load).toHaveBeenCalledWith("outgoing");
    mocks.list = "outgoing";
    expect(control(render(), "Sent").props.accessibilityState.selected).toBe(
      true,
    );
    mocks.list = "following";
    tree = render();
    expect(control(tree, "Received")).toBeUndefined();
    expect(control(tree, "Sent")).toBeUndefined();
  });
  it("keeps finding a person prominent and safety navigation reachable when the relationship list fails", () => {
    mocks.error = "Unable to load requests.";
    let tree = render();
    const all = nodes(tree);
    const field = all.find((node) => node.type === "TextInput");
    expect(field.props.accessibilityLabel).toBe("Exact friend handle");
    expect(all.indexOf(field)).toBeLessThan(
      all.indexOf(control(tree, "Requests")),
    );
    expect(control(tree, "Find exact handle")).toBeTruthy();
    expect(control(tree, "Invite a friend").props.href).toBe(
      "/community/invite",
    );
    expect(all.indexOf(control(tree, "Safety & preferences"))).toBeGreaterThan(
      all.indexOf(control(tree, "Try again")),
    );
    control(tree, "Safety & preferences").props.onPress();
    tree = render();
    expect(control(tree, "Blocked").props.disabled).toBe(false);
    expect(control(tree, "Muted").props.disabled).toBe(false);
    expect(control(tree, "Reports, appeals & safety contact").props.href).toBe(
      "/community/safety",
    );
    expect(text(tree)).not.toContain("No follow requests");
  });
  it("keeps blocked/muted and safety contact available after leaving", () => {
    mocks.enrolled = false;
    let tree = render();
    expect(control(tree, "Requests").props.disabled).toBe(true);
    control(tree, "Safety & preferences").props.onPress();
    tree = render();
    expect(control(tree, "Blocked").props.disabled).toBe(false);
    expect(control(tree, "Muted").props.disabled).toBe(false);
    expect(control(tree, "Reports, appeals & safety contact").props.href).toBe(
      "/community/safety",
    );
  });
  it("shows Retry rather than a misleading empty list on errors, and refresh rechecks membership", async () => {
    mocks.error = "Offline";
    const tree = render();
    expect(text(tree)).not.toContain("No follow requests");
    mocks.focus!();
    await settleMembership();
    vi.clearAllMocks();
    control(render(), "Try again").props.onPress();
    expect(mocks.membershipLoad).toHaveBeenCalledOnce();
    expect(mocks.load).not.toHaveBeenCalled();
    await settleMembership();
    expect(mocks.load).toHaveBeenCalledOnce();
    nodes(render())
      .find((node) => node.type === "ScrollView")
      .props.refreshControl.props.onRefresh();
    expect(mocks.membershipLoad).toHaveBeenCalledTimes(2);
    await settleMembership();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it.each(["retry", "refocus"])(
    "recovers from a failed first membership read through %s, then loads the graph once without revalidation loops",
    async (recovery) => {
      mocks.enrolled = false;
      mocks.membershipStatus = "idle";
      mocks.membershipLoad
        .mockImplementationOnce(async () => {
          mocks.membershipStatus = "error";
          mocks.membershipError = "Community access could not be checked.";
        })
        .mockImplementationOnce(async () => {
          mocks.membershipStatus = "ready";
          mocks.membershipError = null;
          mocks.enrolled = true;
        });
      render();
      flushEffects();
      const leave = mocks.focus!() as unknown as () => void;
      let tree = await settleMembership();
      expect(mocks.membershipOptions.autoLoad).toBe(false);
      expect(mocks.membershipLoad).toHaveBeenCalledOnce();
      expect(mocks.load).not.toHaveBeenCalled();
      expect(control(tree, "Requests").props.disabled).toBe(true);
      expect(text(tree)).not.toContain("No follow requests");
      expect(
        nodes(tree).find((node) => node.type === "ScrollView").props
          .refreshControl.props.enabled,
      ).toBe(true);
      if (recovery === "retry") control(tree, "Try again").props.onPress();
      else {
        leave();
        mocks.focus!();
      }
      tree = await settleMembership();
      expect(mocks.membershipLoad).toHaveBeenCalledTimes(2);
      expect(mocks.load).toHaveBeenCalledOnce();
      expect(control(tree, "Requests").props.disabled).toBe(false);
      for (let i = 0; i < 3; i++) {
        render();
        flushEffects();
        await Promise.resolve();
      }
      expect(mocks.membershipLoad).toHaveBeenCalledTimes(2);
      expect(mocks.load).toHaveBeenCalledOnce();
    },
  );
  it("rejects a late membership completion after blur, and loads only from the new focus read", async () => {
    let finishOld!: () => void;
    let finishNew!: () => void;
    mocks.enrolled = false;
    mocks.membershipStatus = "loading";
    mocks.membershipLoad
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishNew = resolve;
          }),
      );
    render();
    flushEffects();
    const leave = mocks.focus!() as unknown as () => void;
    leave();
    mocks.focus!();
    finishOld();
    await settleMembership();
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.enrolled = true;
    mocks.membershipStatus = "ready";
    finishNew();
    await settleMembership();
    expect(mocks.load).toHaveBeenCalledOnce();
  });
  it.each(["background", "token"])(
    "rejects late membership success after the %s boundary",
    async (boundary) => {
      let finish!: () => void;
      mocks.enrolled = false;
      mocks.membershipStatus = "loading";
      mocks.membershipLoad.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      render();
      flushEffects();
      mocks.focus!();
      if (boundary === "background") mocks.appState!("background");
      else {
        mocks.token = "replacement-token";
        render();
      }
      mocks.enrolled = true;
      mocks.membershipStatus = "ready";
      finish();
      await settleMembership();
      expect(mocks.load).not.toHaveBeenCalled();
      expect(mocks.membershipLoad).toHaveBeenCalledOnce();
    },
  );
  it("keeps safety reads independent of a stalled membership revalidation", async () => {
    mocks.enrolled = false;
    mocks.membershipStatus = "loading";
    mocks.membershipLoad.mockImplementationOnce(
      () => new Promise<void>(() => {}),
    );
    render();
    flushEffects();
    mocks.focus!();
    let tree = render();
    expect(control(tree, "Requests").props.disabled).toBe(true);
    control(tree, "Safety & preferences").props.onPress();
    tree = render();
    expect(control(tree, "Blocked").props.disabled).toBe(false);
    control(tree, "Blocked").props.onPress();
    expect(mocks.load).toHaveBeenCalledWith("blocked");
    expect(mocks.membershipLoad).toHaveBeenCalledOnce();
  });
  it("opens the actual profile from a relationship identity, without granting blocked-profile navigation", () => {
    mocks.rows = [
      {
        user: { userId: "peer-id", handle: "partner", displayName: "Partner" },
      },
    ];
    const identity = control(render(), "View @partner profile");
    expect(identity.props.disabled).toBe(false);
    const link = nodes(render()).find(
      (node) =>
        node.type === "Link" &&
        node.props.href === "/community/profile/peer-id",
    );
    expect(link).toBeTruthy();
    mocks.list = "blocked";
    expect(control(render(), "View @partner profile").props.disabled).toBe(
      true,
    );
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
  it("explains an expired approval confirmation without acting or reloading", async () => {
    mocks.rows = [
      {
        user: { userId: "b", displayName: "Partner", handle: "partner" },
        relationshipId: "r",
      },
    ];
    render();
    flushEffects();
    mocks.focus!();
    await settleMembership();
    control(render(), "Approve").props.onPress();
    const confirm = mocks.alert.mock.calls[0][2][1].onPress;
    mocks.intentCurrent = false;
    vi.clearAllMocks();
    confirm();
    expect(mocks.act).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.membershipLoad).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      "Relationship needs refreshing",
      "No action was sent. Refresh the list, then review and confirm your choice again.",
    );
  });
  it.each(["background", "token", "blur"])(
    "keeps an old approval confirmation silent after %s",
    async (boundary) => {
      mocks.rows = [
        {
          user: { userId: "b", displayName: "Partner", handle: "partner" },
          relationshipId: "r",
        },
      ];
      render();
      flushEffects();
      const blur = mocks.focus!() as unknown as () => void;
      await settleMembership();
      control(render(), "Approve").props.onPress();
      const confirm = mocks.alert.mock.calls[0][2][1].onPress;
      if (boundary === "background") mocks.appState!("background");
      else if (boundary === "blur") blur();
      else {
        mocks.token = "replacement-token";
        render();
      }
      mocks.intentCurrent = false;
      vi.clearAllMocks();
      confirm();
      expect(mocks.act).not.toHaveBeenCalled();
      expect(mocks.alert).not.toHaveBeenCalled();
    },
  );
  it("offers follow back directly on a follower card without opening options", () => {
    mocks.list = "followers";
    mocks.rows = [
      {
        user: { userId: "b", displayName: "Partner", handle: "partner" },
        relationshipId: "r",
        outgoingFollowStatus: "none",
      },
    ];
    const tree = render();
    const follow = control(tree, "Follow back @partner");
    expect(follow).toBeTruthy();
    expect(follow.props.accessibilityHint).toContain("approve");
    follow.props.onPress();
    expect(mocks.act).toHaveBeenCalledWith("follow", mocks.rows[0]);
    expect(mocks.alert).not.toHaveBeenCalled();
  });
  it.each(["pending", "approved"])(
    "shows %s outgoing state without offering another request",
    (status) => {
      mocks.list = "followers";
      mocks.rows = [
        {
          user: { userId: "b", displayName: "Partner", handle: "partner" },
          outgoingFollowStatus: status,
        },
      ];
      const tree = render();
      expect(text(tree)).toContain(
        status === "pending" ? "Requested" : "Following",
      );
      expect(control(tree, "Follow back @partner")).toBeUndefined();
    },
  );
  it("disables follow back during a mutation and hides it after leaving", () => {
    mocks.list = "followers";
    mocks.rows = [
      {
        user: { userId: "b", handle: "partner" },
        outgoingFollowStatus: "none",
      },
    ];
    mocks.pending = true;
    expect(control(render(), "Follow back @partner").props.disabled).toBe(true);
    mocks.enrolled = false;
    expect(control(render(), "Follow back @partner")).toBeUndefined();
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
  it("retires the old root lifetime without putting session tokens into the React key", () => {
    hooks.index = 0;
    const before = RelationshipsScreen();
    expect(before.props.isLifetimeCurrent()).toBe(true);
    mocks.token = "token-two";
    hooks.index = 0;
    const after = RelationshipsScreen();
    expect(after.key).not.toBe(before.key);
    expect(before.props.isLifetimeCurrent()).toBe(false);
    expect(after.props.isLifetimeCurrent()).toBe(true);
    expect(after.key).not.toContain("token-two");
  });
  it("clears protected relationship state and checks access again when a report modal closes", async () => {
    mocks.list = "following";
    mocks.rows = [
      {
        user: { userId: "peer", handle: "friend", displayName: "Friend" },
        relationshipId: "edge",
      },
    ];
    render();
    mocks.focus!();
    await settleMembership();
    vi.clearAllMocks();
    control(render(), "Options for @friend").props.onPress();
    control(render(), "Report profile or handle").props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    const modal = nodes(render()).find((node) => node.type === "ReportModal");
    expect(modal).toBeTruthy();
    modal.props.onClose();
    expect(mocks.pause).toHaveBeenCalled();
    expect(mocks.membershipLoad).toHaveBeenCalled();
    await settleMembership();
    expect(mocks.load).toHaveBeenCalled();
    expect(nodes(render()).some((node) => node.type === "ReportModal")).toBe(
      false,
    );
  });
});
