import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMUNITY_READ_LIFETIME_MS as LIFETIME,
  COMMUNITY_READ_RENEWAL_LEAD_MS as LEAD,
} from "../state/read-cache";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  deadline: vi.fn(),
  invalidate: vi.fn(),
  alert: vi.fn(),
  picker: vi.fn(),
  save: vi.fn(),
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
  const memo = (f: () => any, deps: any[]) => {
    const i = hooks.index++;
    if (!hooks.slots[i] || !same(hooks.slots[i].deps, deps))
      hooks.slots[i] = { deps, value: f() };
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
    useCallback: (f: any, deps: any[]) => memo(() => f, deps),
    useEffect: (callback: () => any, deps: any[]) => {
      const i = hooks.index++;
      const old = hooks.slots[i];
      if (!old || !same(old.deps, deps)) {
        hooks.slots[i] = { deps };
        hooks.effects.push(() => {
          old?.cleanup?.();
          hooks.slots[i].cleanup = callback();
        });
      }
    },
  };
});
vi.mock("../ui", () => ({
  CommunityPage: "CommunityPage",
  CommunityIdentityLink: "CommunityIdentityLink",
}));
vi.mock("react-native", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" },
  View: "View",
  Text: "Text",
  Image: "Image",
  TextInput: "TextInput",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
  Alert: { alert: mocks.alert },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (s: string) => void) => {
      mocks.appState = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    Stack: { Screen: "Screen" },
    useFocusEffect: (callback: () => () => void) => {
      mocks.focus = callback;
      React.useEffect(() => {
        mocks.cleanup = callback();
        return () => mocks.cleanup?.();
      }, [callback]);
    },
  };
});
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: mocks.picker }));
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => ({
      resize: vi.fn(),
      renderAsync: async () => ({
        saveAsync: mocks.save,
      }),
    }),
  },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "e1600000-0000-4000-8000-000000000001",
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    text: "black",
    textSecondary: "grey",
    border: "grey",
    background: "white",
  }),
}));
vi.mock("@/features/community", () => ({
  ReportModal: "ReportModal",
  scopeCommunityClient: (client: unknown) => client,
}));
vi.mock("../state/read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/read-cache")>()),
  getCommunityReadDeadline: mocks.deadline,
  invalidateCommunityReads: mocks.invalidate,
}));
import { CommunityRoutinesScreen } from "./screen";
const item = {
  id: "a1610000-0000-4000-8000-000000000001",
  authorHandle: "friend",
  authorUserId: "00000000-0000-4000-8000-000000000002",
  version: 1,
  isOwner: false,
  available: true,
  createdAt: "2026-10-01T00:00:00Z",
  snapshot: {
    schemaVersion: "2026-10-01",
    title: "Friend authored plan",
    exercises: [
      {
        name: "Bounded exercise",
        sets: 3,
        repsMin: 8,
        repsMax: 10,
        loadKg: null,
        restSeconds: 60,
      },
    ],
  },
};
function render(): any {
  hooks.index = 0;
  const root = CommunityRoutinesScreen();
  const tree = (root.type as any)(root.props);
  hooks.effects.splice(0).forEach((f) => f());
  return tree;
}
function nodes(tree: any, type: string): any[] {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap((n) => nodes(n, type));
  return [
    ...(tree.type === type ? [tree] : []),
    ...nodes(tree.props?.children, type),
  ];
}
function button(tree: any, label: string) {
  return nodes(tree, "Pressable").find((node) =>
    JSON.stringify(node.props.children).includes(label),
  );
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function text() {
  return JSON.stringify(nodes(render(), "Text"));
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.slots = [];
  hooks.effects = [];
  mocks.cleanup = null;
  mocks.appState = null;
  vi.clearAllMocks();
  mocks.deadline.mockReturnValue(undefined);
  mocks.request.mockImplementation(async (options) =>
    options.path.startsWith("/v1/workouts")
      ? {
          ok: true,
          value: {
            workouts: [
              { id: "private-source", name: "Private source routine" },
            ],
          },
        }
      : { ok: true, value: { items: [item], nextCursor: null } },
  );
});
afterEach(() => {
  mocks.cleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("protected routine snapshot freshness", () => {
  it("opens an authorized artifact author's stable profile identity", async () => {
    render();
    await flush();
    const identity = nodes(render(), "CommunityIdentityLink")[0];
    expect(identity.props.userId).toBe(item.authorUserId);
    expect(identity.props.displayName).toBe(`@${item.authorHandle}`);
  });

  it("renders shared routines without waiting for a slow private routine chooser", async () => {
    let release!: (value: any) => void;
    mocks.request.mockImplementation((options) =>
      options.path.startsWith("/v1/workouts")
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({
            ok: true,
            value: { items: [item], nextCursor: "next-page" },
          }),
    );
    render();
    await flush();
    expect(text()).toContain(item.snapshot.title);
    button(render(), "Next page of shared routines").props.onPress();
    await flush();
    expect(
      mocks.request.mock.calls.filter(([options]) =>
        options.path.startsWith("/v1/workouts"),
      ),
    ).toHaveLength(1);
    release({ ok: true, value: { workouts: [] } });
    await flush();
  });
  it("does not renew a reused shared routine page beyond its original deadline", async () => {
    const deadline = Date.now() + 1_000;
    mocks.deadline.mockReturnValue(deadline);
    render();
    await flush();
    expect(text()).toContain(item.snapshot.title);
    vi.advanceTimersByTime(1_000);
    expect(text()).not.toContain(item.snapshot.title);
  });
  it("silently renews the shared page before its deadline without a gap or notice", async () => {
    render();
    await flush();
    const calls = mocks.request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    await flush();
    expect(mocks.request.mock.calls.length).toBe(calls + 1);
    expect(mocks.request.mock.calls[calls][0].method).toBe("GET");
    expect(text()).toContain(item.snapshot.title);
    await vi.advanceTimersByTimeAsync(LEAD + 1_000);
    await flush();
    expect(text()).toContain(item.snapshot.title);
    expect(text()).not.toContain("Refresh shared routines");
  });
  it("retires at the original deadline when the renewal fails or hangs", async () => {
    render();
    await flush();
    mocks.request.mockResolvedValue({
      ok: false,
      error: { kind: "network_error", cause: null },
    });
    await vi.advanceTimersByTimeAsync(LIFETIME - 1);
    await flush();
    expect(text()).toContain(item.snapshot.title);
    // The failed renewal was retried while the page stayed visible.
    expect(mocks.request.mock.calls.length).toBeGreaterThan(2);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(text()).not.toContain(item.snapshot.title);
    expect(text()).toContain("Refresh shared routines");
    mocks.request.mockImplementation(() => new Promise(() => {}));
    button(render(), "Refresh routines").props.onPress();
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(text()).toContain("Refresh shared routines");
  });
  it("expires authored exercise snapshots while the route remains foregrounded", async () => {
    render();
    await flush();
    expect(text()).toContain(item.snapshot.title);
    expect(
      button(render(), "Import an independent private copy"),
    ).toBeUndefined();
    button(render(), `${item.snapshot.title} · @friend`).props.onPress();
    expect(text()).toContain("Bounded exercise");
    expect(text()).not.toContain("Private source routine");
    vi.advanceTimersByTime(LIFETIME);
    expect(text()).not.toContain(item.snapshot.title);
    expect(text()).not.toContain("Bounded exercise");
    button(render(), "Share a private routine").props.onPress();
    expect(text()).toContain("Private source routine");
  });
  it("clears an expired-access notice after a successful fresh empty read", async () => {
    render();
    await flush();
    vi.advanceTimersByTime(LIFETIME);
    expect(text()).toContain(
      "Refresh shared routines to check current access.",
    );
    mocks.request.mockResolvedValueOnce({
      ok: true,
      value: { items: [], nextCursor: null },
    });
    button(render(), "Refresh routines").props.onPress();
    await flush();
    expect(text()).toContain("No currently available shared routines.");
    expect(text()).not.toContain(
      "Refresh shared routines to check current access.",
    );
    expect(text()).not.toContain(item.snapshot.title);
    expect(
      button(render(), "Import an independent private copy"),
    ).toBeUndefined();
  });
  it("clears old snapshots before refresh and refuses stalled responses after expiry", async () => {
    render();
    await flush();
    vi.advanceTimersByTime(LIFETIME - 1_000);
    let release!: (value: any) => void;
    mocks.request.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    button(render(), "Refresh routines").props.onPress();
    expect(text()).not.toContain(item.snapshot.title);
    expect(text()).not.toContain("Private source routine");
    vi.advanceTimersByTime(LIFETIME);
    release({ ok: true, value: { items: [item], nextCursor: null } });
    await flush();
    expect(text()).not.toContain(item.snapshot.title);
  });
  it("does not retain snapshots after a failed fresh authorization read", async () => {
    render();
    await flush();
    mocks.request.mockResolvedValueOnce({ ok: false });
    button(render(), "Refresh routines").props.onPress();
    await flush();
    expect(text()).not.toContain(item.snapshot.title);
  });
  it("contains a rejected refresh while keeping previous targets hidden", async () => {
    render();
    await flush();
    mocks.request.mockRejectedValueOnce(new Error("Network unavailable"));
    button(render(), "Refresh routines").props.onPress();
    await flush();
    expect(text()).not.toContain(item.snapshot.title);
    expect(text()).not.toContain("Bounded exercise");
  });
  it("preserves the owner's deliberate private preview after shared cards expire", async () => {
    render();
    await flush();
    button(render(), "Share a private routine").props.onPress();
    button(render(), "Private source routine").props.onPress();
    nodes(render(), "TextInput")[0].props.onChangeText("Owner preview targets");
    mocks.request.mockResolvedValueOnce({
      ok: true,
      value: {
        sourceUpdatedAt: "2026-10-01T00:00:00Z",
        snapshot: { ...item.snapshot, title: "Owner preview targets" },
      },
    });
    button(render(), "Preview exact shared targets").props.onPress();
    await flush();
    expect(text()).toContain("Owner preview targets");
    vi.advanceTimersByTime(LIFETIME);
    expect(text()).not.toContain(item.snapshot.title);
    expect(text()).toContain("Owner preview targets");
    expect(
      button(
        render(),
        "Confirm and share this preview with approved followers",
      ),
    ).toBeDefined();
    expect(
      mocks.request.mock.calls.some(
        ([options]) =>
          options.method === "POST" &&
          options.path === "/v1/community/routines",
      ),
    ).toBe(false);
  });
  it("drops pending snapshots after background or route departure", async () => {
    let release!: (value: any) => void;
    mocks.request.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render();
    mocks.appState!("inactive");
    mocks.cleanup!();
    release({ ok: true, value: { items: [item], nextCursor: null } });
    await flush();
    expect(text()).not.toContain(item.snapshot.title);
  });
  it.each(["background", "expiry"])(
    "discards a confirmation after %s",
    async (transition) => {
      render();
      await flush();
      button(render(), `${item.snapshot.title} · @friend`).props.onPress();
      button(render(), "Import an independent private copy").props.onPress();
      const confirm = mocks.alert.mock.calls.at(-1)![2][1].onPress;
      if (transition === "background") {
        mocks.appState!("inactive");
        mocks.appState!("active");
        await flush();
      } else vi.advanceTimersByTime(LIFETIME);
      confirm();
      await flush();
      expect(
        mocks.request.mock.calls.some(([options]) =>
          options.path.endsWith("/import"),
        ),
      ).toBe(false);
    },
  );

  it("keeps shared routine management usable when the private workout list fails", async () => {
    mocks.request.mockImplementation(async (options) =>
      options.path.startsWith("/v1/workouts")
        ? { ok: false }
        : {
            ok: true,
            value: { items: [{ ...item, isOwner: true }], nextCursor: null },
          },
    );
    render();
    await flush();
    button(render(), `${item.snapshot.title} · @friend`).props.onPress();
    expect(button(render(), "Unshare routine")).toBeDefined();
  });
});
