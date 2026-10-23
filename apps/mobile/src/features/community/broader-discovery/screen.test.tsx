import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  follow: vi.fn(),
  alert: vi.fn(),
  valid: true,
  data: {} as any,
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: any) => (hooks.slots[index] = value)];
  },
  useRef: (current: any) => {
    const index = hooks.index++;
    return (hooks.slots[index] ??= { current });
  },
  useCallback: (callback: unknown) => callback,
}));
vi.mock("react-native", () => ({
  KeyboardAvoidingView: "Page",
  Platform: { OS: "ios" },
  Text: "Text",
  View: "View",
  Alert: { alert: mocks.alert },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: vi.fn() }),
  },
}));
vi.mock("expo-router", () => ({ useFocusEffect: () => {} }));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "owner" } } }),
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("../community-client", () => ({
  requestFollow: mocks.follow,
  humanizeCommunityError: () => "Unavailable",
}));
vi.mock("../scoped-client", () => ({
  scopeCommunityClient: (client: unknown) => client,
}));
vi.mock("../state/read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/read-cache")>()),
  invalidateCommunityReads: vi.fn(),
}));
vi.mock("../ui", () => ({
  CommunityPage: "CommunityPage",
  CommunityIdentityLink: "IdentityLink",
}));
vi.mock("../expansions", () => ({
  ExpansionButton: "Button",
  ExpansionInput: "Input",
  useExpansionCommand: () => ({
    data: mocks.data,
    busy: false,
    error: null,
    principal: "owner",
    run: mocks.run,
    capture: () => () => mocks.valid,
  }),
}));
import { CommunityBroaderDiscoveryScreen } from "./screen";
function render(): any {
  hooks.index = 0;
  const outer = CommunityBroaderDiscoveryScreen();
  return (outer.type as any)(outer.props);
}
function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === "object"
    ? [tree, ...nodes(tree.props?.children)]
    : [];
}
function button(label: string): any {
  return nodes(render()).find(
    (node) => node.type === "Button" && node.props.label === label,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  hooks.slots = [];
  mocks.valid = true;
  mocks.data = { enabled: false };
  mocks.run.mockResolvedValue(null);
  mocks.follow.mockResolvedValue({ ok: true, value: { status: "pending" } });
});
describe("optional handle prefix discovery", () => {
  it("keeps searching separate from the owner's optional discovery choice", () => {
    expect(button("Let members find my handle prefix")).toBeUndefined();
    const input = nodes(render()).find((node) => node.type === "Input");
    input.props.onChange("@ab");
    expect(button("Search consenting members").props.disabled).toBe(true);
    input.props.onChange("@Friend");
    button("Search consenting members").props.onPress();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "search",
      prefix: "friend",
    });
    expect(
      mocks.run.mock.calls.some(([command]) => command.enabled === true),
    ).toBe(false);
    button("Manage my prefix discovery choice").props.onPress();
    expect(nodes(render()).some((node) => node.type === "Input")).toBe(false);
    button("Let members find my handle prefix").props.onPress();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "preferences",
      enabled: true,
    });
  });
  it("opens a verified result's identity and binds follow confirmation to current authority", async () => {
    nodes(render())
      .find((node) => node.type === "Input")
      .props.onChange("friend");
    button("Search consenting members").props.onPress();
    mocks.data = {
      profiles: [
        { userId: "friend-id", handle: "friend", displayName: "Friend" },
      ],
    };
    expect(
      nodes(render()).find((node) => node.type === "IdentityLink").props.userId,
    ).toBe("friend-id");
    button("Request to follow @friend · Friend").props.onPress();
    mocks.valid = false;
    mocks.alert.mock.calls[0][2][1].onPress();
    await Promise.resolve();
    expect(mocks.follow).not.toHaveBeenCalled();
  });
});
