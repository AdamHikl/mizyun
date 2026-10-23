import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  focus: null as any,
  cleanup: null as any,
  deadlines: new WeakMap<object, number>(),
  invalidate: vi.fn(),
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => {},
  useState: (initial: any) => {
    const i = hooks.index++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [
      hooks.slots[i],
      (n: any) =>
        (hooks.slots[i] = typeof n === "function" ? n(hooks.slots[i]) : n),
    ];
  },
  useRef: (current: any) => {
    const i = hooks.index++;
    return (hooks.slots[i] ??= { current });
  },
  useCallback: (callback: any, deps: any[]) => {
    const i = hooks.index++;
    const old = hooks.slots[i];
    if (!old || old.deps.some((v: any, j: number) => v !== deps[j]))
      hooks.slots[i] = { deps, value: callback };
    return hooks.slots[i].value;
  },
}));
vi.mock("../ui", () => ({
  CommunityPage: "CommunityPage",
  CommunityIdentityLink: "IdentityLink",
}));
vi.mock("react-native", () => ({
  View: "View",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" },
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "Input",
  ActivityIndicator: "Loading",
  Alert: { alert: vi.fn() },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: vi.fn() }),
  },
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useFocusEffect: (cb: any) => {
    if (mocks.focus !== cb) {
      mocks.cleanup?.();
      mocks.focus = cb;
      mocks.cleanup = cb();
    }
  },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "owner" } } }),
}));
vi.mock("@/constants/theme", () => ({ MaxContentWidth: 720 }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "black" }) }));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("../community-presentation", () => ({ CommunityIntro: "Intro" }));
vi.mock("../safety/report-modal", () => ({ ReportModal: "Report" }));
vi.mock("../state/read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/read-cache")>()),
  getCommunityReadDeadline: (value: object) => mocks.deadlines.get(value),
  invalidateCommunityReads: mocks.invalidate,
}));
vi.mock("./client", () => ({ groupAction: mocks.action }));
vi.mock("../community-client", async (original) => ({
  ...(await original<typeof import("../community-client")>()),
  fetchFollowing: async () => ({ ok: true, value: { items: [] } }),
}));
import { GroupsScreen } from "./screen";
import {
  COMMUNITY_READ_LIFETIME_MS as LIFETIME,
  COMMUNITY_READ_RENEWAL_LEAD_MS as LEAD,
} from "../state/read-cache";
function render(): any {
  hooks.index = 0;
  const outer = GroupsScreen();
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
  return nodes(tree).find((n) => n.type === "Pressable" && text(n) === label);
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
const group = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Private title",
  state: "member",
  role: "member",
  membershipVersion: 1,
  rules: "Group rules",
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  hooks.slots = [];
  mocks.focus = null;
  mocks.cleanup = null;
  vi.clearAllMocks();
  mocks.deadlines = new WeakMap();
  mocks.action.mockImplementation(async (_client, request) => ({
    ok: true,
    value:
      request.operation === "list"
        ? { groups: [group], posts: [], members: [], events: [], appeals: [] }
        : request.operation === "read"
          ? {
              groups: [],
              group,
              posts: [
                {
                  id: "post",
                  body: "Shared text",
                  displayName: "Friend",
                  userId: "friend",
                },
              ],
              members: [],
              events: [],
              appeals: [],
            }
          : { groups: [], posts: [], members: [], events: [], appeals: [] },
  }));
});
afterEach(() => {
  mocks.cleanup?.();
  vi.useRealTimers();
});
describe("bounded private-group rendering", () => {
  it("keeps creation and joining as explicit tasks on the group list", async () => {
    render();
    await settle();
    expect(nodes(render()).some((node) => node.type === "Input")).toBe(false);
    control(render(), "Join with a private code").props.onPress();
    expect(
      nodes(render()).some(
        (node) =>
          node.type === "Input" &&
          node.props.accessibilityLabel === "Private invitation code",
      ),
    ).toBe(true);
    expect(control(render(), "Create a private group")).toBeUndefined();
    control(render(), "Cancel group task").props.onPress();
    expect(nodes(render()).some((node) => node.type === "Input")).toBe(false);
  });
  async function openGroup() {
    render();
    await settle();
    control(render(), "Private title · Member").props.onPress();
    render();
    await settle();
    expect(text(render())).toContain("Shared text");
  }
  it("silently renews before the deadline: no gap, error or draft reset", async () => {
    await openGroup();
    const calls = mocks.action.mock.calls.length;
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    await settle();
    expect(mocks.action.mock.calls.length).toBeGreaterThan(calls);
    await vi.advanceTimersByTimeAsync(LEAD + 1_000);
    expect(text(render())).toContain("Shared text");
    expect(text(render())).not.toContain("Refresh to check");
    for (const [, request] of mocks.action.mock.calls)
      expect(["list", "inbox", "read"]).toContain(request.operation);
  });
  it("retires at the original deadline when the renewal fails, without replaying commands", async () => {
    await openGroup();
    const calls = mocks.action.mock.calls.length;
    mocks.action.mockResolvedValue({ ok: false, error: { kind: "network" } });
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(text(render())).not.toContain("Shared text");
    expect(text(render())).not.toContain("Private title");
    expect(text(render())).toContain("Refresh to check");
    const later = mocks.action.mock.calls.slice(calls);
    for (const [, request] of later)
      expect(["list", "inbox", "read"]).toContain(request.operation);
  });
  it("retires at the original deadline when the renewal hangs", async () => {
    await openGroup();
    mocks.action.mockImplementation(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(text(render())).not.toContain("Shared text");
    expect(text(render())).not.toContain("Private title");
    expect(text(render())).toContain("Refresh to check");
  });
  it("does not keep old updates alive when an inbox renewal fails with 503 while the list renews", async () => {
    const event = { id: "event-1", kind: "invitation" };
    const original = mocks.action.getMockImplementation()!;
    let inboxDown = false;
    mocks.action.mockImplementation(async (client, request) => {
      if (request.operation === "inbox")
        return inboxDown
          ? {
              ok: false,
              error: {
                kind: "http_error",
                status: 503,
                code: "UNAVAILABLE",
                message: "",
              },
            }
          : {
              ok: true,
              value: { groups: [], posts: [], members: [], events: [event] },
            };
      return original(client, request);
    });
    render();
    await settle();
    expect(text(render())).toContain("You have a private group invitation.");
    inboxDown = true;
    await vi.advanceTimersByTimeAsync(LIFETIME - 1);
    await settle();
    // Old content may stay only under the original deadline.
    expect(text(render())).toContain("You have a private group invitation.");
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(text(render())).not.toContain("private group invitation");
    expect(text(render())).not.toContain("Private title");
    expect(text(render())).toContain("Refresh to check");
  });
  it("starts the owner's rules editor with saved rules and keeps overview forms out of the detail", async () => {
    const original = mocks.action.getMockImplementation()!;
    mocks.action.mockImplementation(async (client, request) => {
      const response = await original(client, request);
      if (request.operation === "list")
        response.value.groups[0] = { ...group, role: "owner" };
      if (request.operation === "read")
        response.value.group = { ...group, role: "owner" };
      return response;
    });
    render();
    await settle();
    control(render(), "Private title · Member").props.onPress();
    render();
    await settle();
    control(render(), "Manage this group").props.onPress();
    const tree = render();
    expect(
      nodes(tree).find(
        (node) =>
          node.type === "Input" &&
          node.props.accessibilityLabel === "Updated group rules",
      ).props.value,
    ).toBe("Group rules");
    expect(control(tree, "Create a private group")).toBeUndefined();
    expect(control(tree, "Back to all groups")).toBeDefined();
  });
  it("does not reload protected data after a mutation response arrives beyond expiry", async () => {
    render();
    await settle();
    let finish!: (response: any) => void;
    mocks.action.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    control(render(), "Create a group").props.onPress();
    nodes(render())
      .find(
        (node) =>
          node.type === "Input" &&
          node.props.accessibilityLabel === "Group name",
      )
      .props.onChangeText("New group");
    control(render(), "Create a private group").props.onPress();
    await settle();
    const count = mocks.action.mock.calls.length;
    await vi.advanceTimersByTimeAsync(LIFETIME);
    finish({ ok: true, value: { group } });
    await settle();
    expect(mocks.action).toHaveBeenCalledTimes(count);
    expect(control(render(), "Refresh groups").props.disabled).toBe(false);
    expect(control(render(), "Create a private group").props.disabled).toBe(
      false,
    );
    expect(text(render())).not.toContain("Private title");
  });
  it("keeps the focus lifecycle stable when selecting a group and loads the detail once", async () => {
    render();
    await settle();
    const focus = mocks.focus;
    control(render(), "Private title · Member").props.onPress();
    render();
    await settle();
    render();
    expect(mocks.focus).toBe(focus);
    expect(
      mocks.action.mock.calls.filter(
        ([, request]) => request.operation === "read",
      ),
    ).toHaveLength(1);
    expect(mocks.action).toHaveBeenCalledTimes(5);
  });
  it("loads a newly created selected group once without restarting focus", async () => {
    render();
    await settle();
    const focus = mocks.focus;
    const original = mocks.action.getMockImplementation()!;
    mocks.action.mockImplementation(async (client, request) =>
      request.operation === "create"
        ? { ok: true, value: { group } }
        : original(client, request),
    );
    control(render(), "Create a group").props.onPress();
    nodes(render())
      .find(
        (node) =>
          node.type === "Input" &&
          node.props.accessibilityLabel === "Group name",
      )
      .props.onChangeText("New group");
    control(render(), "Create a private group").props.onPress();
    render();
    await settle();
    render();
    expect(mocks.focus).toBe(focus);
    expect(
      mocks.action.mock.calls.filter(
        ([, request]) => request.operation === "read",
      ),
    ).toHaveLength(1);
    expect(mocks.action).toHaveBeenCalledTimes(6);
    expect(text(render())).toContain("Shared text");
  });
  it("uses the earliest original authorization deadline for restored list, inbox and detail reads", async () => {
    vi.setSystemTime(5_000);
    const original = mocks.action.getMockImplementation()!;
    mocks.action.mockImplementation(async (client, request) => {
      const response = await original(client, request);
      mocks.deadlines.set(
        response.value,
        request.operation === "inbox"
          ? 5_000 + LIFETIME - 1_000
          : 5_000 + LIFETIME,
      );
      return response;
    });
    render();
    await settle();
    control(render(), "Private title · Member").props.onPress();
    render();
    await settle();
    expect(text(render())).toContain("Shared text");
    await vi.advanceTimersByTimeAsync(LIFETIME - 1_000);
    expect(text(render())).not.toContain("Shared text");
    expect(control(render(), "Refresh groups").props.disabled).toBe(false);
    control(render(), "Refresh groups").props.onPress();
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });
  it("does not refill after a delayed protected group read exceeds the load deadline", async () => {
    render();
    await settle();
    let resolve!: (r: any) => void;
    mocks.action.mockImplementation(async (_client, request) =>
      request.operation === "read"
        ? await new Promise((r) => (resolve = r))
        : {
            ok: true,
            value:
              request.operation === "list"
                ? { groups: [group], events: [] }
                : { events: [] },
          },
    );
    control(render(), "Private title · Member").props.onPress();
    render();
    await settle();
    await vi.advanceTimersByTimeAsync(LIFETIME);
    resolve({
      ok: true,
      value: { group, posts: [{ body: "Late shared text" }] },
    });
    await settle();
    expect(text(render())).not.toContain("Late shared text");
    expect(text(render())).not.toContain("Private title");
  });
});
