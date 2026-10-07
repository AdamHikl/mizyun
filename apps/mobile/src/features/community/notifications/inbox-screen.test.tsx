import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  items: [] as any[],
  busy: false,
  error: null as string | null,
  notice: undefined as string | undefined,
  load: vi.fn(),
  open: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
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

vi.mock("expo-router", () => ({
  Stack: { Screen: "StackScreen" },
  router: { push: mocks.push, replace: mocks.replace },
  useFocusEffect: () => {},
  useLocalSearchParams: () => ({ notice: mocks.notice }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    background: "#0B0F12",
    backgroundElement: "#161D22",
    text: "#F8FAFC",
    border: "#334155",
  }),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "a" } } }),
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
vi.mock("../ui", () => ({
  CommunityPage: "Page",
  CommunityState: ({ title, description }: any) => [title, description],
}));
vi.mock("./controller", () => ({
  InboxController: class {
    subscribe = vi.fn();
    getSnapshot = () => ({
      items: mocks.items,
      busy: mocks.busy,
      error: mocks.error,
      nextCursor: null,
    });
    reset = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    load = mocks.load;
    open = mocks.open;
  },
  notificationDestinationPath: () => "/community/relationships",
}));
import { CommunityInboxScreen } from "./inbox-screen";
function render(): any {
  hooks.index = 0;
  const outer = CommunityInboxScreen();
  return (outer.type as any)(outer.props);
}
function nodes(n: any): any[] {
  if (!n) return [];
  if (Array.isArray(n)) return n.flatMap(nodes);
  return typeof n === "object" ? [n, ...nodes(n.props?.children)] : [];
}
function text(n: any): string {
  if (typeof n === "string") return n;
  if (Array.isArray(n)) return n.map(text).join("");
  return n?.props ? text(n.props.children) : "";
}
function action(t: any, label: string): any {
  return nodes(t).find(
    (n) => n.type === "Pressable" && n.props.accessibilityLabel === label,
  );
}
beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  mocks.items = [];
  mocks.busy = false;
  mocks.error = null;
  mocks.notice = undefined;
  vi.clearAllMocks();
});
describe("Community inbox presentation and destinations", () => {
  it("opens an update through current-access controller verification", async () => {
    mocks.items = [
      {
        id: "event",
        kind: "request",
        createdAt: "2026-10-01T10:00:00Z",
        readAt: null,
      },
    ];
    mocks.open.mockResolvedValue({ kind: "relationships" });
    const tree = render();
    expect(text(tree)).toContain("Unread");
    expect(mocks.open).not.toHaveBeenCalled();
    action(tree, "New follow request").props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.open).toHaveBeenCalledWith("event");
    expect(mocks.push).toHaveBeenCalledWith("/community/relationships");
  });
  it("keeps actions disabled during checks and distinguishes errors from an empty inbox", () => {
    mocks.busy = true;
    let tree = render();
    expect(action(tree, "Checking updates…").props.disabled).toBe(true);
    expect(text(tree)).not.toContain("No Community updates");
    expect(text(tree)).not.toContain("No Community updates");
    mocks.busy = false;
    mocks.error = "Could not load updates";
    tree = render();
    expect(text(tree)).toContain(mocks.error);
    expect(text(tree)).not.toContain("No Community updates");
  });
  it("retains preferences, private exit and unavailable update recovery", () => {
    mocks.notice = "unavailable";
    const tree = render();
    expect(text(tree)).toContain("That Community update is unavailable");
    action(tree, "Notification preferences").props.onPress();
    expect(mocks.push).toHaveBeenCalledWith("/community/notifications");
    action(tree, "Keep tracking privately").props.onPress();
    expect(mocks.replace).toHaveBeenCalledWith("/(tabs)");
  });
});
