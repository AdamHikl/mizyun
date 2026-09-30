import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enrolled: false,
  status: "ready",
  refresh: vi.fn(),
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
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  FlatList: "FlatList",
  ScrollView: "ScrollView",
  RefreshControl: "RefreshControl",
  ActivityIndicator: "ActivityIndicator",
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.appState = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/account-header-button", () => ({
  AccountHeaderActions: "AccountHeaderActions",
}));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    Link: "Link",
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
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "account-a" } }, profile: {} }),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("../use-community-profile", () => ({
  useCommunityProfile: () => ({
    status: mocks.status,
    isEnrolled: mocks.enrolled,
    actions: { load: mocks.load },
  }),
}));
vi.mock("./activity-card", () => ({ ActivityCard: "ActivityCard" }));
vi.mock("./controller", () => ({
  FeedController: class {
    subscribe = vi.fn();
    getSnapshot = () => ({ status: "idle", items: [], hasMore: false });
    pause = vi.fn();
    resume = vi.fn();
    refresh = mocks.refresh;
  },
}));
vi.mock("../community-settings-screen", () => ({
  CommunitySettingsScreen: "CommunitySettingsScreen",
}));
import { FeedScreen } from "./feed-screen";

// Inspect the actual render output; native layout/device acceptance is separate.
function render(): any {
  hooks.index = 0;
  const outer = FeedScreen();
  const tree = (outer.type as any)(outer.props);
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, label: string): any {
  if (!node) return null;
  if (node.props?.accessibilityLabel === label) return node;
  if (Array.isArray(node))
    return node.map((child) => find(child, label)).find(Boolean);
  return find(node.props?.children, label);
}
function linkFor(node: any, label: string): any {
  if (!node) return null;
  if (node.type === "Link" && find(node.props.children, label)) return node;
  if (Array.isArray(node))
    return node.map((child) => linkFor(child, label)).find(Boolean);
  return linkFor(node.props?.children, label);
}

beforeEach(() => {
  mocks.enrolled = false;
  mocks.status = "ready";
  hooks.slots = [];
  hooks.effects = [];
  mocks.focus = null;
  mocks.cleanup = null;
  mocks.appState = null;
  vi.clearAllMocks();
  mocks.load.mockImplementation(async () => undefined);
});
async function settledRender() {
  render();
  await Promise.resolve();
  await Promise.resolve();
  return render();
}
describe("Community home participation and navigation", () => {
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
    await Promise.resolve();
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
  it("makes inbox directly reachable from the enrolled Community home", async () => {
    mocks.enrolled = true;
    const tree = await settledRender();
    const header = tree.props.children[1].props.ListHeaderComponent;
    expect(linkFor(header, "Community inbox").props.href).toBe(
      "/community/inbox",
    );
    expect(
      linkFor(header, "My Community profile and settings").props.href,
    ).toBe("/community/settings");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("Community retained tab membership freshness", () => {
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
    await Promise.resolve();
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
    expect(tree.props.children[1].type).toBe("ScrollView");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    tree = render();
    expect(tree.props.children[1].type).toBe("CommunitySettingsScreen");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("Community foreground verification", () => {
  it("rechecks membership after backgrounding and hides feed until the check finishes", async () => {
    mocks.enrolled = true;
    await settledRender();
    mocks.appState!("background");
    expect(render().props.children[1].type).toBe("ScrollView");
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
    expect(render().props.children[1].type).toBe("ScrollView");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    expect(render().props.children[1].type).toBe("CommunitySettingsScreen");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
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
    await Promise.resolve();
    expect(render().props.children[1].type).toBe("ScrollView");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
