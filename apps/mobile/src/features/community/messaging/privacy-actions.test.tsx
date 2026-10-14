import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: true,
  error: null as string | null,
  busy: false,
  authorityDenied: false,
  accessToken: "first-token",
  focusCallbacks: [] as (() => () => void)[],
  data: {} as any,
  run: vi.fn(),
  request: vi.fn(),
  alert: vi.fn(),
  uuid: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  peer: "41000000-0000-4000-8000-000000000002",
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
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Alert: { alert: mocks.alert },
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "Screen" },
  useFocusEffect: (callback: () => () => void) => {
    mocks.focusCallbacks.push(callback);
  },
  router: { push: mocks.push, replace: mocks.replace },
  useLocalSearchParams: () => ({ userId: mocks.peer }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 20 }),
}));
vi.mock("../ui", () => ({
  CommunityPage: "Page",
  CommunityButton: "Button",
  CommunityRow: "Row",
  CommunityIdentityLink: "Identity",
  CommunityState: "State",
}));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 800,
  BottomTabInset: 90,
  Spacing: { one: 4, two: 8, three: 16 },
}));
vi.mock("@/components/ui", () => ({ Button: "UIButton", Card: "Card" }));
vi.mock("expo-crypto", () => ({ randomUUID: mocks.uuid }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "owner" }, accessToken: mocks.accessToken },
  }),
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
    busy: mocks.busy,
    authorityDenied: mocks.authorityDenied,
    error: mocks.error,
    principal: "owner",
    run: mocks.run,
    capture: () => () => mocks.current,
  }),
}));
import {
  CommunityMessagingScreen,
  CommunityConversationScreen,
} from "./screen";
import { CommunityBroaderDiscoveryScreen } from "../broader-discovery/screen";

function render(screen: () => any): any {
  hooks.index = 0;
  const outer = screen();
  return outer.type(outer.props);
}
function nodes(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return typeof node === "object"
    ? [node, ...nodes(node.props?.children), ...nodes(node.props?.action)]
    : [];
}
function button(tree: any, label: string): any {
  return nodes(tree).find(
    (node) =>
      (node.type === "Button" && node.props.label === label) ||
      (node.type === "Row" && node.props.title === label) ||
      ((node.type === "Pressable" || node.type === "UIButton") &&
        node.props.accessibilityLabel === label),
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
  mocks.error = null;
  mocks.busy = false;
  mocks.authorityDenied = false;
  mocks.accessToken = "first-token";
  mocks.focusCallbacks = [];
  mocks.peer = "41000000-0000-4000-8000-000000000002";
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
      nodes(render(CommunityBroaderDiscoveryScreen)).find(
        (node) => node.type === "Input",
      ).props.editable,
    ).toBe(false);
    mocks.current = false;
    resolve({ ok: true, value: { status: "pending" } });
    await settle();
    expect(
      nodes(render(CommunityBroaderDiscoveryScreen)).find(
        (node) => node.type === "Input",
      ).props.editable,
    ).toBe(true);
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
    expect(nodes(tree).some((n) => n.props?.children === "own body")).toBe(
      true,
    );
    expect(nodes(tree).some((n) => n.props?.children === "peer body")).toBe(
      false,
    );
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
    mocks.data = { messages: [] };
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
    button(render(CommunityConversationScreen), "Edit message").props.onPress();
    expect(
      nodes(render(CommunityConversationScreen)).find(
        (node) => node.type === "Input",
      ).props.value,
    ).toBe("Private message to edit");
    mocks.data = null;
    expect(
      nodes(render(CommunityConversationScreen)).find(
        (node) => node.type === "Input",
      ).props.value,
    ).toBe("");
    expect(
      button(render(CommunityConversationScreen), "Save message changes"),
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
    mocks.data = { messages: [] };
    button(
      render(CommunityConversationScreen),
      "Block this person",
    ).props.onPress();
    mocks.current = false;
    confirm();
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("blocks only the confirmed peer under the displayed account", async () => {
    mocks.data = { messages: [] };
    button(
      render(CommunityConversationScreen),
      "Block this person",
    ).props.onPress();
    expect(mocks.request).not.toHaveBeenCalled();
    confirm();
    await settle();
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/v1/community/blocks",
        expectedUserId: "owner",
        body: { blockedUserId: mocks.peer },
      }),
    );
  });
});

describe("Messages routes and composer", () => {
  it("routes eligible contacts to a dedicated conversation without inventing recent history", () => {
    mocks.data = {
      enabled: true,
      contacts: [{ userId: mocks.peer, displayName: "Friend" }],
      threads: [],
    };
    let tree = render(CommunityMessagingScreen);
    expect(
      nodes(tree).filter(
        (node) =>
          node.type === "Row" &&
          node.props.title.startsWith("Conversation with"),
      ),
    ).toEqual([]);
    button(tree, "New message").props.onPress();
    tree = render(CommunityMessagingScreen);
    button(tree, "Message Friend").props.onPress();
    expect(mocks.push).toHaveBeenCalledWith(
      `/community/conversation/${mocks.peer}`,
    );
    expect(
      nodes(tree).find((node) => node.type === "Identity").props,
    ).toMatchObject({ userId: mocks.peer, displayName: "Friend" });
  });
  it("shows a recent conversation only from the authorized summary response", () => {
    mocks.data = {
      threads: [
        {
          userId: mocks.peer,
          displayName: "Friend",
          latestMessage: {
            text: "Accepted message",
            createdAt: "2026-10-07T10:00:00Z",
            deleted: false,
          },
        },
      ],
    };
    const row = nodes(render(CommunityMessagingScreen)).find(
      (node) => node.type === "Row",
    );
    expect(row.props.href).toBe(`/community/conversation/${mocks.peer}`);
    expect(row.props.description).toContain("Accepted message");
  });
  it("keeps the composer outside message scrolling and uses server-projected peer identity", () => {
    mocks.data = {
      messages: [],
      peer: { userId: mocks.peer, displayName: "Friend" },
    };
    const tree = render(CommunityConversationScreen);
    const scroll = nodes(tree).find((node) => node.type === "ScrollView");
    expect(nodes(scroll).some((node) => node.type === "Input")).toBe(false);
    expect(
      nodes(tree).find((node) => node.type === "Input").props.maxLength,
    ).toBe(1000);
    expect(
      nodes(tree).find((node) => node.type === "Identity").props.displayName,
    ).toBe("Friend");
  });
  it("retries an uncertain send with exactly the original operation and text", async () => {
    mocks.data = { messages: [] };
    let tree = render(CommunityConversationScreen);
    nodes(tree)
      .find((node) => node.type === "Input")
      .props.onChange("Hello connection");
    tree = render(CommunityConversationScreen);
    button(tree, "Send message").props.onPress();
    await settle();
    tree = render(CommunityConversationScreen);
    expect(
      nodes(tree).find((node) => node.type === "Input").props.editable,
    ).toBe(false);
    button(tree, "Retry the same message").props.onPress();
    await settle();
    expect(mocks.uuid).toHaveBeenCalledOnce();
    expect(mocks.run.mock.calls).toEqual([
      [
        {
          operation: "send",
          peerId: mocks.peer,
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          text: "Hello connection",
        },
      ],
      [
        {
          operation: "send",
          peerId: mocks.peer,
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          text: "Hello connection",
        },
      ],
    ]);
  });
  it("uses the bounded older cursor and recent refresh without traversing all history", () => {
    const before = {
      createdAt: "2026-10-07T10:00:00Z",
      id: "42000000-0000-4000-8000-000000000004",
    };
    mocks.data = { messages: [], nextBefore: before };
    let tree = render(CommunityConversationScreen);
    button(tree, "Load older messages").props.onPress();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "latest",
      peerId: mocks.peer,
      before,
    });
    tree = render(CommunityConversationScreen);
    button(tree, "Refresh recent messages").props.onPress();
    expect(mocks.run).toHaveBeenLastCalledWith({
      operation: "latest",
      peerId: mocks.peer,
    });
  });
  it("retires a caller draft when the protected ten-second result expires", () => {
    mocks.data = { messages: [] };
    nodes(render(CommunityConversationScreen))
      .find((node) => node.type === "Input")
      .props.onChange("Private draft");
    mocks.data = null;
    mocks.error = "Refresh to check your current Community access.";
    const tree = render(CommunityConversationScreen);
    expect(nodes(tree).find((node) => node.type === "Input").props.value).toBe(
      "",
    );
    expect(button(tree, "Send message").props.disabled).toBe(true);
  });
  it("returns an unavailable view for a malformed conversation deep link", () => {
    mocks.peer = "not-a-user-id";
    const tree = CommunityConversationScreen();
    expect(nodes(tree).find((node) => node.type === "State").props.title).toBe(
      "Conversation unavailable",
    );
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

describe("messaging authority transitions", () => {
  it("keys root and conversation lifetimes to refreshed authentication", () => {
    const root = CommunityMessagingScreen().key;
    const conversation = CommunityConversationScreen().key;
    mocks.accessToken = "refreshed-token";
    expect(CommunityMessagingScreen().key).not.toBe(root);
    expect(CommunityConversationScreen().key).not.toBe(conversation);
  });
  it("preserves the harmless New message selection across conversation navigation", async () => {
    mocks.data = {
      contacts: [{ userId: mocks.peer, displayName: "Friend" }],
      threads: [],
    };
    let tree = render(CommunityMessagingScreen);
    const cleanup = mocks.focusCallbacks.at(-1)!();
    button(tree, "New message").props.onPress();
    tree = render(CommunityMessagingScreen);
    button(tree, "Message Friend").props.onPress();
    cleanup();
    mocks.data = null;
    render(CommunityMessagingScreen);
    mocks.focusCallbacks.at(-1)!();
    await settle();
    mocks.data = {
      contacts: [{ userId: mocks.peer, displayName: "Friend" }],
      threads: [],
    };
    tree = render(CommunityMessagingScreen);
    expect(button(tree, "Back to conversations")).toBeDefined();
    expect(button(tree, "Message Friend")).toBeDefined();
  });
  it("retires a pending send and peer intent after definitive denial", async () => {
    mocks.data = { messages: [] };
    nodes(render(CommunityConversationScreen))
      .find((node) => node.type === "Input")
      .props.onChange("Denied draft");
    button(render(CommunityConversationScreen), "Send message").props.onPress();
    await settle();
    mocks.data = null;
    mocks.authorityDenied = true;
    mocks.error = "This action is unavailable.";
    const firstFrame = render(CommunityConversationScreen);
    expect(
      nodes(firstFrame).find((node) => node.type === "Input").props.value,
    ).toBe("");
    expect(button(firstFrame, "Retry the same message").props.disabled).toBe(
      true,
    );
    const tree = render(CommunityConversationScreen);
    expect(button(tree, "Retry the same message")).toBeUndefined();
    expect(nodes(tree).find((node) => node.type === "Input")).toBeUndefined();
    expect(nodes(tree).find((node) => node.type === "State").props.title).toBe(
      "Conversation unavailable",
    );
  });
  it("reloads current conversation authority after report closure", () => {
    mocks.data = {
      messages: [
        {
          id: "received",
          userId: "other",
          text: "Received message",
          createdAt: "2026-10-07T10:00:00Z",
          deleted: false,
        },
      ],
    };
    button(
      render(CommunityConversationScreen),
      "Report message",
    ).props.onPress();
    const report = nodes(render(CommunityConversationScreen)).find(
      (node) => node.type === "Report",
    );
    report.props.onClose();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "latest",
      peerId: mocks.peer,
    });
  });
});

describe("Messages list hierarchy and read states", () => {
  it("keeps New message as a tinted action without a repeated Messages title", () => {
    mocks.data = { enabled: true, threads: [], contacts: [] };
    const tree = render(CommunityMessagingScreen);
    const action = button(tree, "New message");
    expect(action.type).toBe("UIButton");
    expect(action.props.variant).toBe("tinted");
    expect(action.props.icon).toBe("add");
    expect(action.props.label).toBe("New message");
    expect(action.props.disabled).toBe(false);
    expect(
      nodes(tree).some(
        (node) =>
          node.props?.accessibilityRole === "header" &&
          node.props.children === "Messages",
      ),
    ).toBe(false);
    expect(button(tree, "Messaging settings").type).toBe("Row");
    expect(button(tree, "Manage my sent messages").type).toBe("Row");
    expect(button(tree, "Refresh message choices")).toBeUndefined();
    expect(button(tree, "Retry messages")).toBeUndefined();
  });
  it("uses pull to refresh current choices without an unconditional refresh button", async () => {
    mocks.data = { enabled: true, threads: [], contacts: [] };
    mocks.run
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({ threads: [], contacts: [] });
    const scroll = nodes(render(CommunityMessagingScreen)).find(
      (node) => node.type === "ScrollView",
    );
    expect(scroll.props.refreshControl.type).toBe("RefreshControl");
    expect(scroll.props.refreshControl.props.refreshing).toBe(false);
    scroll.props.refreshControl.props.onRefresh();
    await settle();
    expect(mocks.run.mock.calls).toEqual([
      [{ operation: "preferences" }],
      [{ operation: "threads" }],
    ]);
  });
  it("shows one failed-read state and a contextual retry without claiming a successful list", () => {
    mocks.error =
      "This action is unavailable. Refresh or check your Community choices.";
    mocks.data = { threads: [], contacts: [], enabled: false };
    const tree = render(CommunityMessagingScreen);
    const states = nodes(tree).filter((node) => node.type === "State");
    expect(states).toHaveLength(1);
    expect(states[0].props.title).toBe("Messages unavailable");
    expect(states[0].props.description).toBe(mocks.error);
    expect(button(tree, "Retry messages")).toBeDefined();
    expect(button(tree, "New message").props.disabled).toBe(true);
    expect(
      nodes(tree).some(
        (node) =>
          node.props?.children ===
          "Your currently available conversations. Messages expire after 90 days.",
      ),
    ).toBe(false);
    button(tree, "Manage my sent messages").props.onPress();
    expect(mocks.run).toHaveBeenCalledWith({ operation: "listMine" });
  });
  it("distinguishes checking, opt-out and an authorized empty conversation list", () => {
    mocks.busy = true;
    mocks.error = "Old error";
    let tree = render(CommunityMessagingScreen);
    expect(nodes(tree).find((node) => node.type === "State").props.title).toBe(
      "Checking messages…",
    );
    expect(button(tree, "Retry messages")).toBeUndefined();
    expect(button(tree, "Manage my sent messages").props.disabled).toBe(false);
    mocks.busy = false;
    mocks.error = null;
    mocks.data = { enabled: false, threads: [], contacts: [] };
    tree = render(CommunityMessagingScreen);
    expect(nodes(tree).find((node) => node.type === "State").props.title).toBe(
      "Messages are off",
    );
    expect(button(tree, "New message").props.disabled).toBe(true);
    button(tree, "Messaging settings").props.onPress();
    expect(mocks.run).toHaveBeenCalledWith({ operation: "preferences" });
    hooks.slots = [];
    mocks.data = { enabled: true, threads: [], contacts: [] };
    tree = render(CommunityMessagingScreen);
    expect(nodes(tree).find((node) => node.type === "State").props.title).toBe(
      "No conversations available",
    );
    expect(button(tree, "New message").props.disabled).toBe(false);
  });
});
