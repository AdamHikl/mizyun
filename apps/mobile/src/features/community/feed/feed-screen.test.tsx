import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enrollmentOpen: true,
  signedOut: false,
  authRead: vi.fn(),
  profileRead: vi.fn(),
  controllerCreated: vi.fn(),
  realController: false,
  navigationValid: false,
  deadline: undefined as number | undefined,
  epoch: 0,
  responseEpoch: undefined as number | undefined,
  token: "token-a",
  enrolled: false,
  generation: 1,
  feedError: null as string | null,
  feedStatus: "idle",
  feedItems: [] as any[],
  status: "ready",
  refresh: vi.fn(),
  pause: vi.fn(),
  suspend: vi.fn(),
  request: vi.fn(),
  load: vi.fn(),
  focus: null as null | (() => () => void),
  cleanup: null as null | (() => void),
  appState: null as null | ((state: string) => void),
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
  useWindowDimensions: () => ({ fontScale: 1, width: 390 }),
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  FlatList: "FlatList",
  ScrollView: "ScrollView",
  RefreshControl: "RefreshControl",
  ActivityIndicator: "ActivityIndicator",
  Platform: { OS: "ios", select: (values: any) => values.ios },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.appState = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("expo-symbols", () => ({ SymbolView: "SymbolView" }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
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
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    Link: "Link",
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ push: vi.fn() }),
    useFocusEffect: (callback: () => () => void) => {
      mocks.focus = callback;
      React.useEffect(() => {
        mocks.cleanup = callback();
        return () => mocks.cleanup?.();
      }, [callback]);
    },
  };
});
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/composition/community-admission", () => ({
  get COMMUNITY_ENROLLMENT_OPEN() {
    return mocks.enrollmentOpen;
  },
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => {
    mocks.authRead();
    return {
      session: mocks.signedOut
        ? null
        : { user: { id: "account-a" }, accessToken: mocks.token },
      profile: {},
    };
  },
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("../use-community-profile", () => ({
  useCommunityProfile: () => {
    mocks.profileRead();
    return {
      profile: { generation: mocks.generation },
      status: mocks.status,
      isEnrolled: mocks.enrolled,
      actions: { load: mocks.load },
    };
  },
}));
vi.mock("./activity-card", () => ({ ActivityCard: "ActivityCard" }));
vi.mock("./controller", async (original) => {
  const actual = await original<typeof import("./controller")>();
  return {
    FeedController: function (
      ...args: ConstructorParameters<typeof actual.FeedController>
    ) {
      mocks.controllerCreated();
      if (mocks.realController) return new actual.FeedController(...args);
      return {
        subscribe: vi.fn(),
        getSnapshot: () => ({
          status: mocks.feedStatus,
          items: mocks.feedItems,
          hasMore: false,
          error: mocks.feedError,
        }),
        canRetainForNavigation: () => mocks.navigationValid,
        suspend: mocks.suspend,
        pause: mocks.pause,
        resume: vi.fn(),
        refresh: mocks.refresh,
      };
    },
  };
});
vi.mock("../community-settings-screen", () => ({
  CommunitySettingsScreen: "CommunitySettingsScreen",
}));
vi.mock("../state/read-cache", () => ({
  getCommunityReadDeadline: () => mocks.deadline,
  getCommunityReadEpoch: () => mocks.epoch,
  getCommunityResponseEpoch: () => mocks.responseEpoch,
  invalidateCommunityReads: () => {
    mocks.epoch++;
  },
}));
import { FeedScreen } from "./feed-screen";

// Inspect the actual render output; native layout/device acceptance is separate.
function render(): any {
  hooks.index = 0;
  let tree = FeedScreen();
  while (typeof tree.type === "function") tree = (tree.type as any)(tree.props);
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, label: string): any {
  if (!node) return null;
  if (typeof node.type === "function")
    return find(node.type(node.props), label);
  if (node.props?.accessibilityLabel === label) return node;
  if (Array.isArray(node))
    return node.map((child) => find(child, label)).find(Boolean);
  return find(node.props?.children, label);
}
function linkFor(node: any, label: string): any {
  if (!node) return null;
  if (typeof node.type === "function")
    return linkFor(node.type(node.props), label);
  if (node.type === "Link" && find(node.props.children, label)) return node;
  if (Array.isArray(node))
    return node.map((child) => linkFor(child, label)).find(Boolean);
  return linkFor(node.props?.children, label);
}

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  mocks.enrollmentOpen = true;
  mocks.signedOut = false;
  mocks.realController = false;
  mocks.navigationValid = false;
  mocks.deadline = undefined;
  mocks.epoch = 0;
  mocks.responseEpoch = undefined;
  mocks.token = "token-a";
  mocks.enrolled = false;
  mocks.generation = 1;
  mocks.feedError = null;
  mocks.feedStatus = "idle";
  mocks.feedItems = [];
  mocks.status = "ready";
  hooks.slots = [];
  hooks.effects = [];
  mocks.focus = null;
  mocks.cleanup = null;
  mocks.appState = null;
  vi.clearAllMocks();
  mocks.load.mockImplementation(async () => undefined);
  mocks.pause.mockImplementation(() => undefined);
  mocks.refresh.mockImplementation(async () => undefined);
});
async function flushAsync() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
async function settledRender() {
  render();
  await flushAsync();
  await flushAsync();
  return render();
}
describe("Community home participation and navigation", () => {
  it.each([
    {
      scenario: "signed out",
      signedOut: true,
      status: "ready",
      enrolled: false,
    },
    {
      scenario: "status error",
      signedOut: false,
      status: "error",
      enrolled: false,
    },
    {
      scenario: "loading",
      signedOut: false,
      status: "loading",
      enrolled: false,
    },
    {
      scenario: "stale enrollment",
      signedOut: false,
      status: "ready",
      enrolled: true,
    },
  ])(
    "shows coming soon without Community reads when closed and $scenario",
    async ({ signedOut, status, enrolled }) => {
      mocks.enrollmentOpen = false;
      mocks.signedOut = signedOut;
      mocks.status = status;
      mocks.enrolled = enrolled;
      const tree = await settledRender();
      expect(find(tree, "Community is coming soon").props.children).toBe(
        "Community is coming soon",
      );
      expect(tree.props.children[0].type).toBe("TabHeader");
      expect(linkFor(tree, "Keep tracking privately").props.href).toBe("/");
      expect(find(tree, "Check Community status")).toBeFalsy();
      expect(find(tree, "Join Community")).toBeFalsy();
      expect(find(tree, "Leave Community")).toBeFalsy();
      expect(mocks.authRead).not.toHaveBeenCalled();
      expect(mocks.profileRead).not.toHaveBeenCalled();
      expect(mocks.controllerCreated).not.toHaveBeenCalled();
      expect(mocks.load).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.focus).toBeNull();
      expect(mocks.appState).toBeNull();
    },
  );
  it("hosts deliberate joining inside the tab without enrollment or feed loading", async () => {
    const tree = await settledRender();
    const form = tree.props.children[1];
    expect(form.type).toBe("CommunitySettingsScreen");
    expect(form.props.embedded).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("revalidates membership after explicit inline enrollment succeeds", async () => {
    const tree = await settledRender();
    mocks.enrolled = true;
    tree.props.children[1].props.onJoined();
    await flushAsync();
    const joined = render();
    expect(joined.props.children[1].type).toBe("FlatList");
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it.each(["loading", "idle"])(
    "does not present joining as available while profile status is %s",
    async (status) => {
      mocks.status = status;
      const tree = await settledRender();
      expect(tree.props.children[1].type).toBe("ScrollView");
      expect(find(tree, "Keep tracking privately")).toBeTruthy();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it("hosts status recovery inline after a failed membership read", async () => {
    mocks.status = "error";
    const tree = await settledRender();
    expect(tree.props.children[1].type).toBe("CommunitySettingsScreen");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("separates the updates bell from messaging and connects the four root destinations", async () => {
    mocks.enrolled = true;
    const header = (await settledRender()).props.children[1].props
      .ListHeaderComponent;
    expect(linkFor(header, "Community updates").props.href).toBe(
      "/community/inbox",
    );
    for (const [label, destination] of [
      ["People", "people"],
      ["Messages", "messages"],
      ["Me", "me"],
    ])
      expect(linkFor(header, label).props.href).toBe(
        `/(tabs)/community/${destination}`,
      );
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("keeps sharing deliberate and Spaces reachable without navigation cards", async () => {
    mocks.enrolled = true;
    const header = (await settledRender()).props.children[1].props
      .ListHeaderComponent;
    expect(linkFor(header, "Share workout").props.href).toBe(
      "/community/share",
    );
    expect(linkFor(header, "Spaces").props.href).toBe("/community/more");
    expect(find(header, "Feed").props.accessibilityState.selected).toBe(true);
  });
  it("passes flat native styles through router links with accessible targets", async () => {
    mocks.enrolled = true;
    const list = (await settledRender()).props.children[1];
    for (const label of [
      "Feed",
      "People",
      "Messages",
      "Me",
      "Community updates",
      "Share workout",
      "Spaces",
    ]) {
      const action = find(list.props.ListHeaderComponent, label);
      expect(Array.isArray(action.props.style)).toBe(false);
      expect(action.props.style.minHeight).toBeGreaterThanOrEqual(48);
    }
    expect(
      find(list.props.ListEmptyComponent, "Find people").props.style.minHeight,
    ).toBeGreaterThanOrEqual(48);
  });
  it("keeps navigation stable and shows the checking placeholder during automatic feed refresh", async () => {
    mocks.enrolled = true;
    const before = (await settledRender()).props.children[1].props
      .ListHeaderComponent;
    mocks.feedStatus = "refreshing";
    const list = render().props.children[1];
    expect(JSON.stringify(list.props.ListHeaderComponent)).toBe(
      JSON.stringify(before),
    );
    expect(JSON.stringify(list.props.ListEmptyComponent)).toContain(
      "Checking shared workouts",
    );
    expect(JSON.stringify(list.props.ListEmptyComponent)).not.toContain(
      "No shared workouts yet",
    );
    expect(list.props.refreshControl.props.refreshing).toBe(false);
    expect(list.props.data).toEqual([]);
  });
  it("does not describe a failed feed read as an empty friends feed", async () => {
    mocks.enrolled = true;
    mocks.feedError = "Could not load activity";
    const tree = await settledRender();
    const empty = tree.props.children[1].props.ListEmptyComponent;
    expect(JSON.stringify(empty)).toContain("Activity is unavailable");
    expect(JSON.stringify(empty)).not.toContain("No shared workouts yet");
    expect(linkFor(empty, "Find people")).toBeFalsy();
  });
});

describe("Community retained tab membership freshness", () => {
  it("does not flash encouragement in the actual unloaded blur reset frame before refocus", async () => {
    mocks.enrolled = true;
    mocks.feedItems = [{ id: "previous-card" }];
    await settledRender();
    render();
    mocks.pause.mockImplementation(() => {
      mocks.feedStatus = "unloaded";
      mocks.feedItems = [];
    });
    mocks.cleanup?.();
    // A retained tab can render its cleared controller snapshot before the
    // next focus effect begins its membership/feed revalidation.
    const reset = render().props.children[1];
    expect(reset.props.data).toEqual([]);
    expect(JSON.stringify(reset.props.ListEmptyComponent)).not.toContain(
      "No shared workouts yet",
    );
    expect(JSON.stringify(reset.props.ListEmptyComponent)).toContain(
      "Checking shared workouts",
    );
    let finishMembership!: () => void;
    let finishFeed!: () => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishMembership = resolve;
        }),
    );
    mocks.refresh.mockImplementationOnce(() => {
      mocks.feedStatus = "loading";
      return new Promise<void>((resolve) => {
        finishFeed = () => {
          mocks.feedStatus = "idle";
          mocks.feedItems = [{ id: "current-card" }];
          resolve();
        };
      });
    });
    mocks.cleanup = mocks.focus!();
    const pending = render().props.children[1];
    expect(pending.props.data).toEqual([]);
    expect(JSON.stringify(pending.props.ListEmptyComponent)).not.toContain(
      "No shared workouts yet",
    );
    finishMembership();
    finishFeed();
    await flushAsync();
    await flushAsync();
    expect(render().props.children[1].props.data).toEqual([
      { id: "current-card" },
    ]);
  });
  it("does not show encouragement in the first membership-ready frame before the feed has loaded", async () => {
    mocks.enrolled = true;
    mocks.feedStatus = "unloaded";
    const list = (await settledRender()).props.children[1];
    expect(list.props.data).toEqual([]);
    expect(JSON.stringify(list.props.ListEmptyComponent)).not.toContain(
      "No shared workouts yet",
    );
    expect(JSON.stringify(list.props.ListEmptyComponent)).toContain(
      "Checking shared workouts",
    );
  });
  it("shows encouragement after a successful conclusively empty feed read", async () => {
    mocks.enrolled = true;
    mocks.feedStatus = "idle";
    const list = (await settledRender()).props.children[1];
    expect(list.props.data).toEqual([]);
    expect(JSON.stringify(list.props.ListEmptyComponent)).toContain(
      "No shared workouts yet",
    );
  });
  it("rebinds visible card intents after a fast refocus without an intermediate render", async () => {
    mocks.enrolled = true;
    mocks.feedItems = [{ id: "card-a" }];
    mocks.request.mockResolvedValue({ ok: true, value: "current" });
    const list = (await settledRender()).props.children[1];
    const before = list.props.renderItem({ item: mocks.feedItems[0] }).props
      .scopedClient;
    mocks.cleanup?.();
    mocks.cleanup = mocks.focus!();
    await flushAsync();
    const after = render().props.children[1].props.renderItem({
      item: mocks.feedItems[0],
    }).props.scopedClient;
    expect(after).not.toBe(before);
    expect(await before.request({ method: "GET", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect(await after.request({ method: "GET", path: "/unused" })).toEqual({
      ok: true,
      value: "current",
    });
  });

  it("discards a prefetched feed when fresh membership has a different generation", async () => {
    mocks.enrolled = true;
    mocks.feedItems = [{ id: "old-generation-card" }];
    await settledRender();
    render();
    mocks.cleanup?.();
    mocks.load.mockImplementationOnce(async () => {
      mocks.generation = 2;
    });
    mocks.cleanup = mocks.focus!();
    await flushAsync();
    expect(render().props.children[1].props.data).toEqual([]);
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
  });

  it("checks membership and the returning feed concurrently without exposing old cards", async () => {
    mocks.enrolled = true;
    mocks.feedItems = [{ id: "previous-card" }];
    await settledRender();
    render();
    mocks.cleanup?.();
    mocks.feedItems = [];
    mocks.feedStatus = "refreshing";
    let finish!: () => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const previousReads = mocks.refresh.mock.calls.length;
    mocks.cleanup = mocks.focus!();
    expect(mocks.refresh).toHaveBeenCalledTimes(previousReads + 1);
    const list = render().props.children[1];
    expect(list.props.data).toEqual([]);
    expect(JSON.stringify(list.props.ListEmptyComponent)).toContain(
      "Checking shared workouts",
    );
    expect(JSON.stringify(list.props.ListEmptyComponent)).not.toContain(
      "No shared workouts yet",
    );
    finish();
    await flushAsync();
    await flushAsync();
    render();
    expect(mocks.refresh).toHaveBeenCalledTimes(previousReads + 1);
  });

  it("ignores an active event when already foregrounded", async () => {
    mocks.enrolled = true;
    await settledRender();
    const profileReads = mocks.load.mock.calls.length;
    const feedReads = mocks.refresh.mock.calls.length;
    mocks.appState!("active");
    await flushAsync();
    render();
    expect(mocks.load).toHaveBeenCalledTimes(profileReads);
    expect(mocks.refresh).toHaveBeenCalledTimes(feedReads);
  });

  it("keeps public navigation on refocus without spinner or stale cards", async () => {
    mocks.enrolled = true;
    const previousHeader = (await settledRender()).props.children[1].props
      .ListHeaderComponent;
    mocks.cleanup?.();
    mocks.feedItems = [{ id: "stale-card" }];
    mocks.feedStatus = "refreshing";
    let finish!: () => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.cleanup = mocks.focus!();
    const tree = render();
    const list = tree.props.children[1];
    expect(list.type).toBe("FlatList");
    expect(list.props.data).toEqual([]);
    expect(JSON.stringify(list.props.ListHeaderComponent)).toBe(
      JSON.stringify(previousHeader),
    );
    expect(JSON.stringify(list.props.ListEmptyComponent)).toContain(
      "Checking shared workouts",
    );
    expect(JSON.stringify(list.props.ListEmptyComponent)).not.toContain(
      "No shared workouts yet",
    );
    expect(list.props.refreshControl.props.refreshing).toBe(false);
    expect(JSON.stringify(list.props.ListEmptyComponent)).not.toContain(
      "No shared workouts yet",
    );
    expect(JSON.stringify(tree)).not.toContain("ActivityIndicator");
    finish();
    await flushAsync();
  });

  it("shows refresh progress only for a deliberate pull", async () => {
    mocks.enrolled = true;
    await settledRender();
    mocks.feedStatus = "refreshing";
    let tree = render();
    expect(tree.props.children[1].props.refreshControl.props.refreshing).toBe(
      false,
    );
    expect(
      JSON.stringify(tree.props.children[1].props.ListEmptyComponent),
    ).not.toContain("No shared workouts yet");
    let finish!: () => void;
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending =
      tree.props.children[1].props.refreshControl.props.onRefresh();
    tree = render();
    expect(tree.props.children[1].props.refreshControl.props.refreshing).toBe(
      true,
    );
    finish();
    await pending;
    expect(
      render().props.children[1].props.refreshControl.props.refreshing,
    ).toBe(false);
  });
  it("replaces the public shell with recovery after a failed fresh membership check", async () => {
    mocks.enrolled = true;
    await settledRender();
    mocks.cleanup?.();
    mocks.load.mockImplementationOnce(async () => {
      mocks.enrolled = false;
      mocks.status = "error";
    });
    mocks.cleanup = mocks.focus!();
    expect(render().props.children[1].type).toBe("FlatList");
    await flushAsync();
    expect(render().props.children[1].type).toBe("CommunitySettingsScreen");
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
  it("rechecks joining in settings before loading the following feed", async () => {
    await settledRender();
    expect(mocks.refresh).not.toHaveBeenCalled();
    mocks.cleanup?.();
    let finish!: () => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            mocks.enrolled = true;
            resolve();
          };
        }),
    );
    mocks.cleanup = mocks.focus!();
    let tree = render();
    expect(find(tree, "Join Community")).toBeFalsy();
    expect(mocks.refresh).not.toHaveBeenCalled();
    finish();
    await flushAsync();
    tree = render();
    expect(tree.props.children[1].type).toBe("FlatList");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it("hides the retained feed until withdrawal in settings is freshly checked", async () => {
    mocks.enrolled = true;
    await settledRender();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    mocks.cleanup?.();
    let finish!: () => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            mocks.enrolled = false;
            resolve();
          };
        }),
    );
    mocks.cleanup = mocks.focus!();
    let tree = render();
    expect(tree.props.children[1].type).toBe("FlatList");
    expect(tree.props.children[1].props.data).toEqual([]);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    finish();
    await flushAsync();
    tree = render();
    expect(tree.props.children[1].type).toBe("CommunitySettingsScreen");
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
});

describe("Community foreground verification", () => {
  it("rechecks membership after backgrounding and hides feed until the check finishes", async () => {
    mocks.enrolled = true;
    await settledRender();
    mocks.appState!("background");
    expect(render().props.children[1].type).toBe("FlatList");
    expect(render().props.children[1].props.data).toEqual([]);
    let finish!: () => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            mocks.enrolled = false;
            resolve();
          };
        }),
    );
    mocks.appState!("active");
    expect(render().props.children[1].type).toBe("FlatList");
    expect(render().props.children[1].props.data).toEqual([]);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    finish();
    await flushAsync();
    expect(render().props.children[1].type).toBe("CommunitySettingsScreen");
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
  it("does not restore a feed from a verification result after leaving the tab", async () => {
    let finish!: () => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            mocks.enrolled = true;
            resolve();
          };
        }),
    );
    render();
    mocks.cleanup?.();
    finish();
    await flushAsync();
    expect(render().props.children[1].type).toBe("ScrollView");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("Community completed navigation snapshot", () => {
  it("keeps the actual FeedController snapshot across return without placeholder frames or another request", async () => {
    mocks.realController = true;
    mocks.enrolled = true;
    mocks.deadline = Date.now() + 10_000;
    mocks.responseEpoch = mocks.epoch;
    const items = [{ id: "actual-controller-card" }];
    mocks.request.mockResolvedValue({
      ok: true,
      value: { items, nextCursor: null },
    });
    for (let i = 0; i < 4; i++) {
      render();
      await flushAsync();
    }
    expect(render().props.children[1].props.data).toEqual(items);
    const requests = mocks.request.mock.calls.length;
    mocks.load.mockClear();
    mocks.cleanup?.();
    expect(render().props.children[1].props.data).toEqual(items);
    mocks.cleanup = mocks.focus!();
    expect(render().props.children[1].props.data).toEqual(items);
    await flushAsync();
    expect(render().props.children[1].props.data).toEqual(items);
    expect(mocks.request).toHaveBeenCalledTimes(requests);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  async function populated() {
    mocks.enrolled = true;
    mocks.navigationValid = true;
    mocks.deadline = Date.now() + 10_000;
    mocks.responseEpoch = mocks.epoch;
    mocks.feedItems = [{ id: "retained-card" }];
    await settledRender();
    render();
    mocks.load.mockClear();
    mocks.refresh.mockClear();
    mocks.pause.mockClear();
  }
  it("preserves the already loaded feed across blur and the very first return frame without loading", async () => {
    await populated();
    mocks.request.mockResolvedValue({ ok: true, value: "current" });
    const before = render().props.children[1].props.renderItem({
      item: mocks.feedItems[0],
    }).props.scopedClient;
    mocks.cleanup?.();
    const hidden = render().props.children[1];
    expect(hidden.props.data).toEqual([{ id: "retained-card" }]);
    expect(mocks.suspend).toHaveBeenCalledOnce();
    expect(mocks.pause).not.toHaveBeenCalled();
    mocks.cleanup = mocks.focus!();
    const returned = render().props.children[1];
    expect(returned.props.data).toEqual([{ id: "retained-card" }]);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    const after = returned.props.renderItem({ item: mocks.feedItems[0] }).props
      .scopedClient;
    expect(after).not.toBe(before);
    expect(await before.request({ method: "GET", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect(await after.request({ method: "GET", path: "/unused" })).toEqual({
      ok: true,
      value: "current",
    });
  });
  it.each(["expiry", "write", "token", "background"])(
    "rechecks after %s instead of reusing retired content",
    async (cause) => {
      await populated();
      mocks.cleanup?.();
      if (cause === "expiry")
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_001);
      if (cause === "write") mocks.epoch++;
      if (cause === "token") mocks.token = "token-b";
      if (cause === "background") {
        mocks.appState?.("background");
        mocks.appState?.("active");
      }
      const retired = render().props.children[1];
      expect(retired.props.data).toEqual([]);
      mocks.cleanup = mocks.focus!();
      await flushAsync();
      expect(mocks.load).toHaveBeenCalled();
    },
  );
});

vi.mock("../profiles", () => ({
  CommunityMyProfileScreen: "CommunityMyProfileScreen",
}));
vi.mock("../relationships/screen", () => ({
  CommunityPeopleScreen: "CommunityPeopleScreen",
}));
vi.mock("../messaging", () => ({
  CommunityMessagingScreen: "CommunityMessagingScreen",
}));
