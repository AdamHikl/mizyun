import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: true,
  data: {} as any,
  run: vi.fn(),
  request: vi.fn(),
  alert: vi.fn(),
  uuid: vi.fn(),
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => (hooks.slots[index] = next)];
  },
  useRef: (current: unknown) => {
    const index = hooks.index++;
    return (hooks.slots[index] ??= { current });
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (callback: () => void) => callback(),
}));
vi.mock("react-native", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" },
  Text: "Text",
  View: "View",
  ScrollView: "ScrollView",
  Alert: { alert: mocks.alert },
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "Screen" },
  useFocusEffect: () => {},
}));
vi.mock("expo-crypto", () => ({ randomUUID: mocks.uuid }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "owner" } } }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "black" }) }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("../community-presentation", () => ({ CommunityIntro: "Intro" }));
vi.mock("../safety", () => ({ ReportModal: "Report" }));
vi.mock("../expansions", () => ({
  ExpansionButton: "Button",
  ExpansionInput: "Input",
  useExpansionCommand: () => ({
    data: mocks.data,
    busy: false,
    error: null,
    principal: "owner",
    run: mocks.run,
    capture: () => () => mocks.current,
  }),
}));
import { CommunityMessagingScreen } from "./screen";
import { CommunityBroaderDiscoveryScreen } from "../broader-discovery/screen";

function render(screen: () => any): any {
  hooks.index = 0;
  const outer = screen();
  return outer.type(outer.props);
}
function nodes(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
}
function button(tree: any, label: string): any {
  return nodes(tree).find(
    (node) => node.type === "Button" && node.props.label === label,
  );
}
function confirm() {
  mocks.alert.mock.calls.at(-1)![2][1].onPress();
}
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
beforeEach(() => {
  hooks.slots = [];
  mocks.current = true;
  mocks.data = {};
  vi.clearAllMocks();
  mocks.run.mockResolvedValue(null);
  mocks.request.mockResolvedValue({
    ok: false,
    error: { kind: "network_error" },
  });
  mocks.uuid.mockReturnValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});
describe("private Community actions", () => {
  it("releases follow controls when a pending response settles after its authority expires", async () => {
    mocks.data = {
      profiles: [{ userId: "peer", handle: "friend", displayName: "Friend" }],
    };
    let resolve!: (value: any) => void;
    mocks.request.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    button(
      render(CommunityBroaderDiscoveryScreen),
      "Request to follow @friend · Friend",
    ).props.onPress();
    confirm();
    expect(
      button(
        render(CommunityBroaderDiscoveryScreen),
        "Search consenting members",
      ).props.disabled,
    ).toBe(true);
    mocks.current = false;
    resolve({ ok: true, value: { status: "pending" } });
    await settle();
    expect(
      button(
        render(CommunityBroaderDiscoveryScreen),
        "Let members find my handle prefix",
      ).props.disabled,
    ).toBe(false);
  });
  it("keeps own-message deletion and pagination accessible with messaging unavailable", async () => {
    let tree = render(CommunityMessagingScreen);
    button(tree, "Manage my sent messages").props.onPress();
    expect(mocks.run).toHaveBeenCalledWith({ operation: "listMine" });
    mocks.data = {
      messages: [
        { id: "mine", userId: "owner", text: "own body", deleted: false },
        { id: "theirs", userId: "peer", text: "peer body", deleted: false },
      ],
      nextCursor: "older",
    };
    tree = render(CommunityMessagingScreen);
    expect(nodes(tree).filter((n) => n.type === "View")).toHaveLength(1);
    button(tree, "Delete my message for both people").props.onPress();
    await settle();
    expect(mocks.run).toHaveBeenCalledWith({ operation: "delete", id: "mine" });
    button(tree, "Next page of my sent messages").props.onPress();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "listMine",
      after: "older",
    });
  });
  it("does not erase a failed own-message deletion with an automatic read", async () => {
    button(
      render(CommunityMessagingScreen),
      "Manage my sent messages",
    ).props.onPress();
    mocks.data = {
      messages: [
        { id: "mine", userId: "owner", text: "own body", deleted: false },
      ],
    };
    mocks.run.mockClear();
    mocks.run.mockResolvedValue(null);
    button(
      render(CommunityMessagingScreen),
      "Delete my message for both people",
    ).props.onPress();
    await settle();
    expect(mocks.run.mock.calls.map(([command]) => command.operation)).toEqual([
      "delete",
    ]);
  });
  it("retires a message-derived editing draft when protected messages expire", () => {
    mocks.data = { contacts: [{ userId: "peer", displayName: "Friend" }] };
    button(render(CommunityMessagingScreen), "Friend").props.onPress();
    mocks.data = {
      messages: [
        {
          id: "mine",
          userId: "owner",
          version: 1,
          text: "Private message to edit",
          deleted: false,
        },
      ],
    };
    button(render(CommunityMessagingScreen), "Edit message").props.onPress();
    expect(
      nodes(render(CommunityMessagingScreen)).find(
        (node) => node.type === "Input",
      ).props.value,
    ).toBe("Private message to edit");
    mocks.data = null;
    expect(
      nodes(render(CommunityMessagingScreen)).find(
        (node) => node.type === "Input",
      ).props.value,
    ).toBe("");
    expect(
      button(render(CommunityMessagingScreen), "Save message changes"),
    ).toBeUndefined();
  });
  it("confirms a scoped follow request and reuses its UUID after a lost response", async () => {
    mocks.data = {
      profiles: [{ userId: "peer", handle: "friend", displayName: "Friend" }],
    };
    let tree = render(CommunityBroaderDiscoveryScreen);
    button(tree, "Request to follow @friend · Friend").props.onPress();
    expect(mocks.request).not.toHaveBeenCalled();
    confirm();
    await settle();
    tree = render(CommunityBroaderDiscoveryScreen);
    button(tree, "Request to follow @friend · Friend").props.onPress();
    confirm();
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.request.mock.calls) {
      expect(request).toMatchObject({
        path: "/v1/community/relationships/follow",
        expectedUserId: "owner",
        body: {
          targetUserId: "peer",
          operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      });
    }
    expect(mocks.uuid).toHaveBeenCalledOnce();
  });
  it("rejects follow and block confirmations after the screen becomes stale", async () => {
    mocks.data = {
      profiles: [{ userId: "peer", handle: "friend", displayName: "Friend" }],
    };
    button(
      render(CommunityBroaderDiscoveryScreen),
      "Request to follow @friend · Friend",
    ).props.onPress();
    mocks.current = false;
    confirm();
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    hooks.slots = [];
    mocks.current = true;
    mocks.data = { contacts: [{ userId: "peer", displayName: "Friend" }] };
    button(render(CommunityMessagingScreen), "Friend").props.onPress();
    button(
      render(CommunityMessagingScreen),
      "Block this friend",
    ).props.onPress();
    mocks.current = false;
    confirm();
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("blocks only the confirmed peer under the displayed account", async () => {
    mocks.data = { contacts: [{ userId: "peer", displayName: "Friend" }] };
    button(render(CommunityMessagingScreen), "Friend").props.onPress();
    button(
      render(CommunityMessagingScreen),
      "Block this friend",
    ).props.onPress();
    expect(mocks.request).not.toHaveBeenCalled();
    confirm();
    await settle();
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/v1/community/blocks",
        expectedUserId: "owner",
        body: { blockedUserId: "peer" },
      }),
    );
  });
});
