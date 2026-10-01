import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  receipt: vi.fn(),
  appState: null as null | ((state: string) => void),
  cleanup: null as null | (() => void),
  focus: null as null | (() => () => void),
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const same = (a: any[], b: any[]) =>
    a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (factory: () => any, deps: any[]) => {
    const i = hooks.index++;
    if (!hooks.slots[i] || !same(hooks.slots[i].deps, deps))
      hooks.slots[i] = { deps, value: factory() };
    return hooks.slots[i].value;
  };
  return {
    ...actual,
    useRef: (current: unknown) => {
      const i = hooks.index++;
      return (hooks.slots[i] ??= { current });
    },
    useState: (initial: unknown) => {
      const i = hooks.index++;
      if (!(i in hooks.slots)) hooks.slots[i] = initial;
      return [
        hooks.slots[i],
        (next: any) => {
          hooks.slots[i] =
            typeof next === "function" ? next(hooks.slots[i]) : next;
        },
      ];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: any[]) => memo(() => callback, deps),
    useEffect: (callback: () => any, deps: any[]) => {
      const i = hooks.index++;
      const previous = hooks.slots[i];
      if (!previous || !same(previous.deps, deps)) {
        hooks.slots[i] = { deps };
        hooks.effects.push(() => {
          previous?.cleanup?.();
          hooks.slots[i].cleanup = callback();
        });
      }
    },
  };
});

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
  Alert: { alert: vi.fn() },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, cb: (state: string) => void) => {
      mocks.appState = cb;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({ back: vi.fn() }),
    useFocusEffect: (cb: () => () => void) => {
      mocks.focus = cb;
      React.useEffect(() => {
        mocks.cleanup = cb();
        return () => mocks.cleanup?.();
      }, [cb]);
    },
  };
});
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: vi.fn() },
}));
vi.mock("../community-client", () => ({
  fetchSharedActivity: mocks.fetch,
  humanizeCommunityError: () => "Unavailable",
  blockUser: vi.fn(),
  setUserMuted: vi.fn(),
}));
vi.mock("../safety/safety-api", () => ({
  captureSafetyReceipt: mocks.receipt,
}));
vi.mock("../reactions", () => ({ ReactionBar: "ReactionBar" }));
vi.mock("../safety", () => ({ ReportModal: "ReportModal" }));
vi.mock("../initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
vi.mock("../shared-workout-details", () => ({
  SharedWorkoutDetails: "SharedWorkoutDetails",
}));
import { ActivityDetailScreen } from "./activity-detail-screen";
const activity = {
  id: "activity-a",
  authorUserId: "author",
  authorHandle: "friend",
  authorDisplayName: "Friend",
  avatarSymbol: "FR",
  category: "strength",
  sharedDay: "2026-10-01",
  durationSeconds: null,
  publishedAt: "2026-10-01T12:00:00Z",
  reactionCounts: {},
  viewerReaction: null,
};
function render(principalKey = "account-a"): any {
  hooks.index = 0;
  const tree = ActivityDetailScreen({ activityId: "activity-a", principalKey });
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, type: string): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((child) => find(child, type)).find(Boolean);
  if (node.type === type) return node;
  return find(node.props?.children, type);
}
beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  hooks.index = 0;
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({ ok: true, value: activity });
  mocks.receipt.mockResolvedValue({ ok: true, value: { id: "receipt-a" } });
});
describe("shared workout detail loading lifetime", () => {
  it("keeps the reactions client stable across unrelated receipt rerenders", async () => {
    let finish!: (value: any) => void;
    mocks.receipt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render();
    await Promise.resolve();
    await Promise.resolve();
    const before = find(render(), "ReactionBar").props.scopedClient;
    finish({ ok: true, value: { id: "receipt-a" } });
    await Promise.resolve();
    expect(find(render(), "ReactionBar").props.scopedClient).toBe(before);
  });
  it("does not reload on an unchanged foreground event", async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
    render();
    mocks.appState!("active");
    await Promise.resolve();
    render();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("retires the old reactions client immediately on background and account change", async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
    const before = find(render(), "ReactionBar").props.scopedClient;
    mocks.appState!("background");
    expect(find(render(), "ReactionBar")).toBeFalsy();
    expect(await before.request({ method: "GET", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "no_session" },
    });
    mocks.appState!("active");
    await Promise.resolve();
    await Promise.resolve();
    render("account-b");
    expect(await before.request({ method: "GET", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "no_session" },
    });
  });
});
